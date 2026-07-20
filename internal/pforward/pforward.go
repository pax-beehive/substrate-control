// Package pforward supervises a `kubectl port-forward` child process that
// exposes the in-cluster ate-api-server on a local loopback port.
package pforward

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const (
	initialBackoff = 500 * time.Millisecond
	maxBackoff     = 10 * time.Second
)

// Config describes one port-forward.
type Config struct {
	// Kubectl is the kubectl binary to run; empty means "kubectl".
	Kubectl string
	// Namespace of the forward target.
	Namespace string
	// Target is the kubectl port-forward resource arg, e.g. "deploy/ate-api-server".
	Target string
	// LocalPort is bound on 127.0.0.1.
	LocalPort int
	// RemotePort on the target; zero means 443.
	RemotePort int
}

// Manager supervises the port-forward child process, restarting it with
// backoff when it dies (e.g. because the target pod restarted).
type Manager struct {
	cfg Config

	mu     sync.Mutex
	ready  chan struct{} // closed once, on the first successful forward
	cancel context.CancelFunc
}

func New(cfg Config) *Manager {
	if cfg.Kubectl == "" {
		cfg.Kubectl = "kubectl"
	}
	if cfg.RemotePort == 0 {
		cfg.RemotePort = 443
	}
	return &Manager{cfg: cfg, ready: make(chan struct{})}
}

// Addr is the local address the forward listens on.
func (m *Manager) Addr() string {
	return fmt.Sprintf("127.0.0.1:%d", m.cfg.LocalPort)
}

// Start launches the supervision loop and returns immediately. The loop
// stops when ctx is canceled or Stop is called.
func (m *Manager) Start(ctx context.Context) {
	ctx, cancel := context.WithCancel(ctx)
	m.mu.Lock()
	m.cancel = cancel
	m.mu.Unlock()
	go m.run(ctx)
}

// Stop terminates the child process and stops restarts.
func (m *Manager) Stop() {
	m.mu.Lock()
	cancel := m.cancel
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// WaitReady blocks until the first port-forward reports readiness or ctx
// expires. Readiness of later restarts is not tracked here; gRPC reconnects
// on its own once the forward is back.
func (m *Manager) WaitReady(ctx context.Context) error {
	select {
	case <-m.ready:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (m *Manager) run(ctx context.Context) {
	backoff := initialBackoff
	for {
		ready, err := m.runOnce(ctx)
		if ctx.Err() != nil {
			return
		}
		if ready {
			backoff = initialBackoff
		}
		slog.Warn("port-forward exited; restarting",
			"target", m.cfg.Target, "error", err, "retryIn", backoff)
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff *= 2
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
}

// runOnce spawns one `kubectl port-forward`, watches its stdout for the
// readiness line, then blocks until the process exits. It reports whether
// readiness was reached before the exit.
func (m *Manager) runOnce(ctx context.Context) (bool, error) {
	attemptReady := make(chan struct{})

	args := []string{
		"port-forward",
		"-n", m.cfg.Namespace,
		"--address", "127.0.0.1",
		m.cfg.Target,
		fmt.Sprintf("%d:%d", m.cfg.LocalPort, m.cfg.RemotePort),
	}
	cmd := exec.CommandContext(ctx, m.cfg.Kubectl, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return false, fmt.Errorf("stdout pipe: %w", err)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return false, fmt.Errorf("start kubectl: %w", err)
	}

	// Drain stdout; the readiness line marks this attempt ready and, on the
	// first successful attempt, closes the manager-wide readiness channel.
	// Keep draining after readiness so kubectl never blocks on a full pipe.
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			if strings.HasPrefix(scanner.Text(), "Forwarding from 127.0.0.1:") {
				select {
				case <-attemptReady:
				default:
					close(attemptReady)
					m.mu.Lock()
					select {
					case <-m.ready:
					default:
						close(m.ready)
					}
					m.mu.Unlock()
					slog.Info("port-forward ready", "target", m.cfg.Target, "addr", m.Addr())
				}
			}
		}
	}()

	err = cmd.Wait()
	wasReady := false
	select {
	case <-attemptReady:
		wasReady = true
	default:
	}
	if ctx.Err() != nil {
		return wasReady, ctx.Err()
	}
	return wasReady, fmt.Errorf("kubectl port-forward exited: %w: %s", err, tail(stderr.String(), 512))
}

func tail(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) > n {
		return "..." + s[len(s)-n:]
	}
	return s
}
