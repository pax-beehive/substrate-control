package substrate

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"time"
)

// FileTokenProvider reads a ServiceAccount bearer token from a projected
// file (e.g. /run/ateapi-token/token). Kubernetes rotates projected tokens;
// the file is re-read whenever its mtime changes, and ForceRefresh forces a
// re-read (used after an Unauthenticated response). The token is never
// logged.
type FileTokenProvider struct {
	path string

	mu    sync.Mutex
	token string
	mtime time.Time
}

func NewFileTokenProvider(path string) *FileTokenProvider {
	return &FileTokenProvider{path: path}
}

// Get returns the cached token, re-reading the file when it changed on disk.
func (p *FileTokenProvider) Get(context.Context) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	fi, err := os.Stat(p.path)
	if err != nil {
		return "", err
	}
	if p.token != "" && fi.ModTime().Equal(p.mtime) {
		return p.token, nil
	}
	return p.readLocked()
}

// ForceRefresh re-reads the token file regardless of cache state.
func (p *FileTokenProvider) ForceRefresh(context.Context) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.readLocked()
}

func (p *FileTokenProvider) readLocked() (string, error) {
	b, err := os.ReadFile(p.path)
	if err != nil {
		return "", err
	}
	tok := strings.TrimSpace(string(b))
	if tok == "" {
		return "", errors.New("token file is empty")
	}
	fi, err := os.Stat(p.path)
	if err != nil {
		return "", err
	}
	p.token = tok
	p.mtime = fi.ModTime()
	return tok, nil
}
