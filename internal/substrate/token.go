package substrate

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	// tokenLifetime is the requested ServiceAccount token duration.
	tokenLifetime = time.Hour
	// tokenRefreshAfter is 80% of tokenLifetime; cached tokens are
	// proactively refreshed once this much time has passed.
	tokenRefreshAfter = tokenLifetime * 8 / 10
)

// TokenProvider mints and caches Kubernetes ServiceAccount tokens via
// `kubectl create token`. Tokens are never logged.
type TokenProvider struct {
	sa        string
	namespace string
	audience  string
	kubectl   string

	mu     sync.Mutex
	token  string
	expiry time.Time
}

// NewTokenProvider returns a provider that mints tokens for the given
// ServiceAccount and audience. Minting is lazy: the first token is created
// on the first Get, and failures are retried on every subsequent Get.
func NewTokenProvider(sa, namespace, audience string) *TokenProvider {
	return &TokenProvider{sa: sa, namespace: namespace, audience: audience, kubectl: "kubectl"}
}

// Get returns the cached token, minting a new one when absent or past 80%
// of its lifetime.
func (p *TokenProvider) Get(ctx context.Context) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.token != "" && time.Now().Before(p.expiry) {
		return p.token, nil
	}
	return p.mintLocked(ctx)
}

// ForceRefresh mints a new token regardless of cache state.
func (p *TokenProvider) ForceRefresh(ctx context.Context) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.mintLocked(ctx)
}

func (p *TokenProvider) mintLocked(ctx context.Context) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	var stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, p.kubectl, "create", "token", p.sa,
		"-n", p.namespace,
		"--audience="+p.audience,
		"--duration="+tokenLifetime.String())
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("kubectl create token: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	tok := strings.TrimSpace(string(out))
	if tok == "" {
		return "", errors.New("kubectl create token returned an empty token")
	}
	p.token = tok
	p.expiry = time.Now().Add(tokenRefreshAfter)
	return tok, nil
}

// TokenSource provides bearer tokens for authenticating substrate RPCs.
type TokenSource interface {
	// Get returns the current token, fetching or rotating it as needed.
	Get(ctx context.Context) (string, error)
	// ForceRefresh bypasses any cache and fetches a fresh token.
	ForceRefresh(ctx context.Context) (string, error)
}

// perRPCCreds attaches the current bearer token to every RPC.
type perRPCCreds struct{ ts TokenSource }

func (c perRPCCreds) GetRequestMetadata(ctx context.Context, _ ...string) (map[string]string, error) {
	tok, err := c.ts.Get(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]string{"authorization": "Bearer " + tok}, nil
}

// RequireTransportSecurity is true: tokens only travel over TLS.
func (c perRPCCreds) RequireTransportSecurity() bool { return true }

// unauthenticatedRetryInterceptor force-refreshes the token and retries the
// RPC once when the server rejects it as unauthenticated.
func unauthenticatedRetryInterceptor(ts TokenSource) grpc.UnaryClientInterceptor {
	return func(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
		err := invoker(ctx, method, req, reply, cc, opts...)
		if status.Code(err) != codes.Unauthenticated {
			return err
		}
		if _, rerr := ts.ForceRefresh(ctx); rerr != nil {
			return err // return the original auth error
		}
		return invoker(ctx, method, req, reply, cc, opts...)
	}
}
