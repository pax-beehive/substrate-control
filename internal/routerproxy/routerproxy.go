// Package routerproxy forwards HTTP requests to actors through the atenet
// router's Host-based ingress.
package routerproxy

import (
	"context"
	"io"
	"net/http"
	"strings"
	"time"
)

// DefaultAddr is the traefik ingress fronting the atenet router.
const DefaultAddr = "http://100.125.72.76:31358"

// maxBody caps the relayed response body at 1 MiB.
const maxBody = 1 << 20

// Client forwards requests to the atenet router.
type Client struct {
	addr string
	hc   *http.Client
}

// NewClient builds a Client for addr (trailing slash stripped; empty means
// DefaultAddr).
func NewClient(addr string) *Client {
	if addr == "" {
		addr = DefaultAddr
	}
	return &Client{
		addr: strings.TrimSuffix(addr, "/"),
		hc: &http.Client{
			Timeout: 90 * time.Second,
			// Do not follow redirects — envoy answers plain HTTP with a
			// TLS upgrade redirect, which we must not chase.
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

// Result is the relayed upstream response.
type Result struct {
	Status      int
	ContentType string
	Body        string
}

// Forward sends one request to <addr><path> with the given Host header and
// streams the body verbatim. The response body is capped at 1 MiB, with a
// truncation marker appended when larger.
func (c *Client) Forward(ctx context.Context, host, method, path, body, contentType string) (*Result, error) {
	var rdr io.Reader
	if body != "" {
		rdr = strings.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.addr+path, rdr)
	if err != nil {
		return nil, err
	}
	req.Host = host
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return nil, err
	}
	res := &Result{
		Status:      resp.StatusCode,
		ContentType: resp.Header.Get("Content-Type"),
		Body:        string(data),
	}
	if len(data) > maxBody {
		res.Body = string(data[:maxBody]) + "\n...[truncated by substrate-control]"
	}
	return res, nil
}
