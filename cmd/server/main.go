// Command server runs the Substrate Control web console backend.
package main

import (
	"context"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"substrate-control/internal/api"
	"substrate-control/internal/gateway"
	"substrate-control/internal/kube"
	"substrate-control/internal/pforward"
	"substrate-control/internal/routerproxy"
	"substrate-control/internal/substrate"
	"substrate-control/internal/web"
)

// connectMode selects how the backend reaches the substrate control plane.
type connectMode int

const (
	modePortForward connectMode = iota // workstation default: kubectl port-forward
	modeDirect                         // SUBSTRATE_GRPC_ADDR explicitly set
	modeInCluster                      // running inside a Kubernetes pod
)

func (m connectMode) String() string {
	switch m {
	case modeDirect:
		return "direct"
	case modeInCluster:
		return "incluster"
	default:
		return "portforward"
	}
}

// defaultTokenFile is the projected ServiceAccount token path used in
// incluster mode (see deploy/deployment.yaml).
const defaultTokenFile = "/run/ateapi-token/token"

func tokenFilePath(getenv func(string) string) string {
	if v := getenv("SUBSTRATE_TOKEN_FILE"); v != "" {
		return v
	}
	return defaultTokenFile
}

// detectMode picks the connection mode, in order: direct when
// SUBSTRATE_GRPC_ADDR is set; incluster inside a pod (KUBERNETES_SERVICE_HOST
// present) with a token file; portforward otherwise.
func detectMode(getenv func(string) string, fileExists func(string) bool) connectMode {
	if getenv("SUBSTRATE_GRPC_ADDR") != "" {
		return modeDirect
	}
	if getenv("KUBERNETES_SERVICE_HOST") != "" && fileExists(tokenFilePath(getenv)) {
		return modeInCluster
	}
	return modePortForward
}

func fileExists(path string) bool {
	st, err := os.Stat(path)
	return err == nil && !st.IsDir()
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envOrInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
		slog.Warn("invalid integer env value; using default", "key", key, "value", v, "default", fallback)
	}
	return fallback
}

// warmUpToken acquires the first token in the background so a broken token
// source is logged early; failures are retried lazily per RPC and never
// crash startup. The token itself is never logged.
func warmUpToken(ctx context.Context, ts substrate.TokenSource, logAttrs ...any) {
	go func() {
		if _, err := ts.Get(ctx); err != nil {
			slog.Warn("initial token acquisition failed; will retry on demand", "error", err)
		} else {
			slog.Info("acquired substrate API token", logAttrs...)
		}
	}()
}

// connectSubstrate builds the substrate client for the detected mode. In
// portforward mode it also starts the port-forward manager and waits
// (bounded) for the first forward to come up before dialing.
func connectSubstrate(ctx context.Context, mode connectMode) (*substrate.Client, *pforward.Manager) {
	switch mode {
	case modeDirect:
		addr := os.Getenv("SUBSTRATE_GRPC_ADDR")
		slog.Info("connecting to substrate", "mode", mode, "addr", addr)
		sub, err := substrate.Dial(addr)
		if err != nil {
			slog.Error("failed to set up substrate gRPC client", "addr", addr, "error", err)
			os.Exit(1)
		}
		return sub, nil

	case modeInCluster:
		addr := envOr("SUBSTRATE_API_ADDR", "api.ate-system.svc:443")
		tokenFile := tokenFilePath(os.Getenv)
		slog.Info("connecting to substrate", "mode", mode, "addr", addr, "tokenFile", tokenFile)
		tp := substrate.NewFileTokenProvider(tokenFile)
		warmUpToken(ctx, tp, "tokenFile", tokenFile)
		sub, err := substrate.DialAuthenticated(addr, tp)
		if err != nil {
			slog.Error("failed to set up substrate gRPC client", "addr", addr, "error", err)
			os.Exit(1)
		}
		return sub, nil

	default: // modePortForward
		pfCfg := pforward.Config{
			Namespace:  envOr("SUBSTRATE_PF_NAMESPACE", "ate-system"),
			Target:     envOr("SUBSTRATE_PF_TARGET", "deploy/ate-api-server"),
			LocalPort:  envOrInt("SUBSTRATE_PF_LOCAL_PORT", 18443),
			RemotePort: 443,
		}
		slog.Info("connecting to substrate",
			"mode", mode,
			"namespace", pfCfg.Namespace,
			"target", pfCfg.Target,
			"localPort", pfCfg.LocalPort)
		pf := pforward.New(pfCfg)
		pf.Start(ctx)

		waitCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		if err := pf.WaitReady(waitCtx); err != nil {
			// Not fatal: the manager keeps retrying and gRPC connects lazily;
			// /api/healthz reports 503 until the first call succeeds.
			slog.Warn("port-forward not ready yet; continuing startup", "error", err)
		}

		sa := envOr("SUBSTRATE_SA", "ate-api-server")
		saNS := envOr("SUBSTRATE_SA_NAMESPACE", "ate-system")
		aud := envOr("SUBSTRATE_TOKEN_AUDIENCE", "api.ate-system.svc")
		tp := substrate.NewTokenProvider(sa, saNS, aud)
		warmUpToken(ctx, tp, "serviceAccount", sa, "namespace", saNS, "audience", aud)

		sub, err := substrate.DialAuthenticated(pf.Addr(), tp)
		if err != nil {
			slog.Error("failed to set up substrate gRPC client", "addr", pf.Addr(), "error", err)
			os.Exit(1)
		}
		return sub, pf
	}
}

// staticFS picks the frontend source: disk frontend/dist (dev) when it has
// an index.html, otherwise the copy embedded in the binary.
func staticFS() (fs.FS, string) {
	diskDist := filepath.Join("frontend", "dist")
	if st, err := os.Stat(filepath.Join(diskDist, "index.html")); err == nil && !st.IsDir() {
		return os.DirFS(diskDist), "disk:" + diskDist
	}
	return web.Dist(), "embedded"
}

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))

	listenAddr := envOr("LISTEN_ADDR", ":8080")

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	mode := detectMode(os.Getenv, fileExists)
	sub, pf := connectSubstrate(ctx, mode)
	defer sub.Close()
	if pf != nil {
		defer pf.Stop()
	}

	kc, kubeErr := kube.New()
	if kubeErr != nil {
		slog.Warn("kubernetes client unavailable; CRD endpoints will return 503", "error", kubeErr)
	}

	// In-cluster defaults use service DNS (ADR-0002); env always wins.
	routerDefault := routerproxy.DefaultAddr
	litellmDefault := gateway.DefaultURL
	if mode == modeInCluster {
		routerDefault = "http://atenet-router.ate-system.svc"
		litellmDefault = "http://litellm.litellm.svc:4000"
	}

	gw := gateway.NewClient(envOr("LITELLM_URL", litellmDefault), os.Getenv("LITELLM_MASTER_KEY"), kc)
	if err := gw.ResolveMasterKey(ctx); err != nil {
		slog.Warn("litellm master key not resolved; gateway endpoints will return 503 until it resolves")
	} else {
		slog.Info("litellm gateway configured", "url", gw.BaseURL())
	}

	rp := routerproxy.NewClient(envOr("SUBSTRATE_ROUTER_ADDR", routerDefault))

	static, staticSrc := staticFS()
	slog.Info("serving frontend", "source", staticSrc)

	srv := api.NewServer(sub, kc, kubeErr, gw, rp, static)
	httpSrv := &http.Server{Addr: listenAddr, Handler: srv.Handler()}

	go func() {
		<-ctx.Done()
		slog.Info("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(shutdownCtx)
	}()

	slog.Info("starting server", "listen", listenAddr)
	if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server exited", "error", err)
		os.Exit(1)
	}
}
