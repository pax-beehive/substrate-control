// Package gateway implements a minimal admin client for the LiteLLM proxy.
// The master key is resolved from the environment or the cluster and is
// never logged or returned to callers.
package gateway

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"substrate-control/internal/kube"
)

// DefaultURL is the in-cluster LiteLLM ingress base (path prefix included).
const DefaultURL = "http://100.125.72.76:31358/litellm"

// ErrorKind classifies gateway failures for HTTP status mapping.
type ErrorKind int

const (
	// KindNotConfigured: no master key available from any source.
	KindNotConfigured ErrorKind = iota
	// KindUnreachable: LiteLLM could not be reached at all.
	KindUnreachable
	// KindUpstream: LiteLLM answered with an error status.
	KindUpstream
)

// Error is a classified gateway failure.
type Error struct {
	Kind    ErrorKind
	Message string
}

func (e *Error) Error() string { return e.Message }

// Client talks to the LiteLLM admin API.
type Client struct {
	baseURL string
	hc      *http.Client
	envKey  string
	kube    *kube.Client // may be nil

	mu    sync.Mutex
	cache string
}

// NewClient builds a Client for baseURL (trailing slash stripped). envKey is
// the LITELLM_MASTER_KEY value; when non-empty it always wins. Otherwise the
// key is read lazily from the k8s secret litellm/litellm-secrets via kc.
func NewClient(baseURL, envKey string, kc *kube.Client) *Client {
	if baseURL == "" {
		baseURL = DefaultURL
	}
	return &Client{
		baseURL: strings.TrimSuffix(baseURL, "/"),
		hc:      &http.Client{},
		envKey:  envKey,
		kube:    kc,
	}
}

// BaseURL is the configured LiteLLM base URL.
func (c *Client) BaseURL() string { return c.baseURL }

// ResolveMasterKey resolves (and caches) the master key; used at startup so
// misconfiguration is logged early. Failures are retried lazily per request.
func (c *Client) ResolveMasterKey(ctx context.Context) error {
	_, err := c.masterKey(ctx)
	return err
}

func (c *Client) masterKey(ctx context.Context) (string, error) {
	if c.envKey != "" {
		return c.envKey, nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cache != "" {
		return c.cache, nil
	}
	if c.kube == nil {
		return "", &Error{Kind: KindNotConfigured, Message: "no LITELLM_MASTER_KEY and kubernetes client unavailable"}
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	sec, err := c.kube.GetSecret(ctx, "litellm", "litellm-secrets")
	if err != nil {
		return "", &Error{Kind: KindNotConfigured, Message: "reading secret litellm/litellm-secrets: " + err.Error()}
	}
	data, _ := sec.Object["data"].(map[string]any)
	raw, _ := data["master-key"].(string)
	decoded, err := base64.StdEncoding.DecodeString(raw)
	if err != nil || len(decoded) == 0 {
		return "", &Error{Kind: KindNotConfigured, Message: "master-key missing or undecodable in secret litellm/litellm-secrets"}
	}
	c.cache = string(decoded)
	return c.cache, nil
}

// do performs one authenticated request. LiteLLM error statuses become
// *Error{Kind: KindUpstream}; transport failures become KindUnreachable.
func (c *Client) do(ctx context.Context, method, path string, body, out any) error {
	key, err := c.masterKey(ctx)
	if err != nil {
		return err
	}
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("encode request: %w", err)
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, rdr)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+key)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return &Error{Kind: KindUnreachable, Message: err.Error()}
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return &Error{Kind: KindUnreachable, Message: "reading response: " + err.Error()}
	}
	if resp.StatusCode >= 400 {
		return &Error{Kind: KindUpstream, Message: upstreamMessage(resp.StatusCode, data)}
	}
	if out != nil && len(data) > 0 {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("decode litellm response: %w", err)
		}
	}
	return nil
}

// upstreamMessage extracts a human-readable message from a LiteLLM error
// body ({"detail": ...} or {"error": {"message": ...}} shapes).
func upstreamMessage(status int, body []byte) string {
	var m map[string]any
	if json.Unmarshal(body, &m) == nil {
		switch d := m["detail"].(type) {
		case string:
			return d
		case []any:
			if len(d) > 0 {
				if first, ok := d[0].(map[string]any); ok {
					if msg, ok := first["msg"].(string); ok {
						return msg
					}
				}
			}
		}
		if e, ok := m["error"].(map[string]any); ok {
			if msg, ok := e["message"].(string); ok {
				return msg
			}
		}
	}
	s := strings.TrimSpace(string(body))
	if len(s) > 300 {
		s = s[:300] + "..."
	}
	return fmt.Sprintf("litellm returned HTTP %d: %s", status, s)
}

// Info is the gateway status: reachable (implied by a nil error) plus the
// LiteLLM version when the deployment exposes it.
type Info struct {
	Version string
}

// Info checks reachability via /health/liveliness (3s timeout) and then
// best-effort probes /version, omitting the version when absent.
func (c *Client) Info(ctx context.Context) (*Info, error) {
	liveCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := c.do(liveCtx, http.MethodGet, "/health/liveliness", nil, nil); err != nil {
		return nil, err
	}
	info := &Info{}
	verCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	var v map[string]any
	if err := c.do(verCtx, http.MethodGet, "/version", nil, &v); err == nil {
		info.Version = strField(v, "version")
	}
	return info, nil
}

// Key is a normalized LiteLLM virtual key (snake_case source fields).
type Key struct {
	Key       string
	KeyAlias  string
	Models    []string
	Spend     float64
	MaxBudget float64
	Expires   string
	CreatedAt string
	UserID    string
}

// ListKeys returns all virtual keys, paging through /key/list at the maximum
// page size of 100 (larger sizes are rejected by LiteLLM). It asks for full
// key objects (return_full_object); on deployments that reject the
// parameter it falls back to the default bare-token list.
func (c *Client) ListKeys(ctx context.Context) ([]Key, error) {
	keys, err := c.listKeys(ctx, true)
	if err != nil {
		var ge *Error
		if errors.As(err, &ge) && ge.Kind == KindUpstream {
			return c.listKeys(ctx, false)
		}
		return nil, err
	}
	return keys, nil
}

func (c *Client) listKeys(ctx context.Context, full bool) ([]Key, error) {
	var out []Key
	for page := 1; ; page++ {
		pageCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		var resp struct {
			Keys        []json.RawMessage `json:"keys"`
			CurrentPage int               `json:"current_page"`
			TotalPages  int               `json:"total_pages"`
		}
		url := fmt.Sprintf("/key/list?size=100&page=%d", page)
		if full {
			url += "&return_full_object=true"
		}
		err := c.do(pageCtx, http.MethodGet, url, nil, &resp)
		cancel()
		if err != nil {
			return nil, err
		}
		for _, raw := range resp.Keys {
			out = append(out, normalizeKey(raw))
		}
		if len(resp.Keys) == 0 || page >= resp.TotalPages {
			return out, nil
		}
	}
}

// normalizeKey accepts both object and bare-string list entries. Full
// objects carry the (hashed) key under varying field names depending on
// LiteLLM version ("token", sometimes "key"/"token_id"/"api_key").
func normalizeKey(raw json.RawMessage) Key {
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return Key{Key: s}
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return Key{Key: string(raw)}
	}
	k := Key{
		KeyAlias:  strField(m, "key_alias"),
		Models:    strSliceField(m, "models"),
		Spend:     numField(m, "spend"),
		MaxBudget: numField(m, "max_budget"),
		Expires:   strField(m, "expires"),
		CreatedAt: strField(m, "created_at"),
		UserID:    strField(m, "user_id"),
	}
	for _, f := range []string{"key", "token", "token_id", "api_key"} {
		if v := strField(m, f); v != "" {
			k.Key = v
			break
		}
	}
	return k
}

// GeneratedKey carries the plaintext key returned once by /key/generate.
type GeneratedKey struct {
	Key      string
	KeyAlias string
	Duration string
	Expires  string
}

// GenerateKeyRequest is the admin request to mint a virtual key. Zero-valued
// optional fields are omitted from the upstream call.
type GenerateKeyRequest struct {
	KeyAlias  string
	Duration  string
	Models    []string
	MaxBudget float64
}

// GenerateKey proxies POST /key/generate.
func (c *Client) GenerateKey(ctx context.Context, req GenerateKeyRequest) (*GeneratedKey, error) {
	body := map[string]any{"key_alias": req.KeyAlias}
	if req.Duration != "" {
		body["duration"] = req.Duration
	}
	if len(req.Models) > 0 {
		body["models"] = req.Models
	}
	if req.MaxBudget != 0 {
		body["max_budget"] = req.MaxBudget
	}
	genCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var resp map[string]any
	if err := c.do(genCtx, http.MethodPost, "/key/generate", body, &resp); err != nil {
		return nil, err
	}
	out := &GeneratedKey{
		Key:      strField(resp, "key"),
		KeyAlias: strField(resp, "key_alias"),
		Duration: strField(resp, "duration"),
		Expires:  strField(resp, "expires"),
	}
	if out.KeyAlias == "" {
		out.KeyAlias = req.KeyAlias
	}
	if out.Duration == "" {
		out.Duration = req.Duration
	}
	return out, nil
}

// DeleteKey proxies POST /key/delete {"keys": [key]}.
func (c *Client) DeleteKey(ctx context.Context, key string) error {
	delCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return c.do(delCtx, http.MethodPost, "/key/delete", map[string]any{"keys": []string{key}}, nil)
}

// Model is a normalized LiteLLM model registration. Upstream provider
// credentials are never included.
type Model struct {
	ID        string
	ModelName string
	Model     string
	Provider  string
	APIBase   string
	HasAPIKey bool
	CreatedAt string
	UpdatedAt string
}

// RegisterModelRequest describes a model registration. APIKey is
// write-only: it is sent upstream and never read back.
type RegisterModelRequest struct {
	ModelName   string
	Model       string
	APIKey      string
	APIBase     string
	ExtraParams map[string]any
}

// ListModels proxies GET /v2/model/info and normalizes each entry.
func (c *Client) ListModels(ctx context.Context) ([]Model, error) {
	listCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var resp struct {
		Data []struct {
			ModelName     string         `json:"model_name"`
			LitellmParams map[string]any `json:"litellm_params"`
			ModelInfo     map[string]any `json:"model_info"`
		} `json:"data"`
	}
	if err := c.do(listCtx, http.MethodGet, "/v2/model/info", nil, &resp); err != nil {
		return nil, err
	}
	out := make([]Model, 0, len(resp.Data))
	for _, e := range resp.Data {
		out = append(out, normalizeModel(e.ModelName, e.LitellmParams, e.ModelInfo))
	}
	return out, nil
}

// RegisterModel proxies POST /model/new.
func (c *Client) RegisterModel(ctx context.Context, req RegisterModelRequest) (*Model, error) {
	params := make(map[string]any, len(req.ExtraParams)+3)
	for k, v := range req.ExtraParams {
		params[k] = v
	}
	if req.APIBase != "" {
		params["api_base"] = req.APIBase
	}
	// Written after the merge so extraParams cannot override them.
	params["model"] = req.Model
	params["api_key"] = req.APIKey

	regCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var resp map[string]any
	if err := c.do(regCtx, http.MethodPost, "/model/new", map[string]any{
		"model_name":     req.ModelName,
		"litellm_params": params,
	}, &resp); err != nil {
		return nil, err
	}
	// The /model/new echo returns litellm_params encrypted, so the result is
	// built from the request plus the response's id and timestamps.
	m := &Model{
		ModelName: req.ModelName,
		Model:     req.Model,
		Provider:  providerOf(req.Model),
		APIBase:   req.APIBase,
		HasAPIKey: true, // apiKey is required and was just registered
		CreatedAt: strField(resp, "created_at"),
		UpdatedAt: strField(resp, "updated_at"),
	}
	if name := strField(resp, "model_name"); name != "" {
		m.ModelName = name
	}
	if info, ok := resp["model_info"].(map[string]any); ok {
		m.ID = strField(info, "id")
	}
	if m.ID == "" {
		m.ID = strField(resp, "model_id")
	}
	return m, nil
}

// DeleteModel proxies POST /model/delete {"id": id}.
func (c *Client) DeleteModel(ctx context.Context, id string) error {
	delCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return c.do(delCtx, http.MethodPost, "/model/delete", map[string]any{"id": id}, nil)
}

func normalizeModel(modelName string, params, info map[string]any) Model {
	model := strField(params, "model")
	// Hardened LiteLLM deployments strip credentials from model/info reads,
	// so presence detection alone always yields false there. Models added
	// via /model/new (db_model) always registered a key through this console,
	// so treat stripped DB models as keyed.
	_, isDBModel := info["db_model"].(bool)
	return Model{
		ID:        strField(info, "id"),
		ModelName: modelName,
		Model:     model,
		Provider:  providerOf(model),
		APIBase:   strField(params, "api_base"),
		HasAPIKey: hasCredentials(params) || isDBModel,
		CreatedAt: strField(info, "created_at"),
		UpdatedAt: strField(info, "updated_at"),
	}
}

// providerOf derives the provider prefix before the first "/" (the whole
// string when there is no slash).
func providerOf(model string) string {
	before, _, _ := strings.Cut(model, "/")
	return before
}

// sensitiveField matches credential-bearing parameter names
// (case-insensitive *key*/*secret*/*password*), e.g. api_key or
// aws_secret_access_key. api_base is intentionally not sensitive.
func sensitiveField(k string) bool {
	k = strings.ToLower(k)
	return strings.Contains(k, "key") || strings.Contains(k, "secret") || strings.Contains(k, "password")
}

// hasCredentials reports whether litellm_params carries any credential-ish
// field with a non-empty value. Hardened LiteLLM deployments strip stored
// credentials from model/info responses entirely, so false is not proof
// that no key is configured upstream.
func hasCredentials(params map[string]any) bool {
	for k, v := range params {
		if !sensitiveField(k) || v == nil {
			continue
		}
		if s, ok := v.(string); ok && s == "" {
			continue
		}
		return true
	}
	return false
}

// GlobalSpend is the LiteLLM-wide spend summary from GET /global/spend.
type GlobalSpend struct {
	Spend     float64
	MaxBudget float64
}

// GlobalSpend proxies GET /global/spend.
func (c *Client) GlobalSpend(ctx context.Context) (*GlobalSpend, error) {
	spendCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var resp struct {
		Spend     float64 `json:"spend"`
		MaxBudget float64 `json:"max_budget"`
	}
	if err := c.do(spendCtx, http.MethodGet, "/global/spend", nil, &resp); err != nil {
		return nil, err
	}
	return &GlobalSpend{Spend: resp.Spend, MaxBudget: resp.MaxBudget}, nil
}

// SpendLogEntry is the normalized subset of one LiteLLM spend log row.
type SpendLogEntry struct {
	RequestID        string
	APIKey           string // hashed key as returned upstream
	Model            string
	PromptTokens     int64
	CompletionTokens int64
	TotalTokens      int64
	Spend            float64
	StartTime        string
	EndTime          string
}

// SpendLogs proxies GET /spend/logs?limit=N (newest first upstream).
func (c *Client) SpendLogs(ctx context.Context, limit int) ([]SpendLogEntry, error) {
	logsCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	var raw []map[string]any
	if err := c.do(logsCtx, http.MethodGet, fmt.Sprintf("/spend/logs?limit=%d", limit), nil, &raw); err != nil {
		return nil, err
	}
	out := make([]SpendLogEntry, 0, len(raw))
	for _, e := range raw {
		out = append(out, SpendLogEntry{
			RequestID:        strField(e, "request_id"),
			APIKey:           strField(e, "api_key"),
			Model:            strField(e, "model"),
			PromptTokens:     intField(e, "prompt_tokens"),
			CompletionTokens: intField(e, "completion_tokens"),
			TotalTokens:      intField(e, "total_tokens"),
			Spend:            numField(e, "spend"),
			StartTime:        strField(e, "startTime"),
			EndTime:          strField(e, "endTime"),
		})
	}
	return out, nil
}

// KeySpend is one entry of GET /global/spend/keys.
type KeySpend struct {
	APIKey     string
	KeyAlias   string
	KeyName    string
	TotalSpend float64
}

// GlobalSpendKeys proxies GET /global/spend/keys.
func (c *Client) GlobalSpendKeys(ctx context.Context) ([]KeySpend, error) {
	keysCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var raw []map[string]any
	if err := c.do(keysCtx, http.MethodGet, "/global/spend/keys", nil, &raw); err != nil {
		return nil, err
	}
	out := make([]KeySpend, 0, len(raw))
	for _, e := range raw {
		out = append(out, KeySpend{
			APIKey:     strField(e, "api_key"),
			KeyAlias:   strField(e, "key_alias"),
			KeyName:    strField(e, "key_name"),
			TotalSpend: numField(e, "total_spend"),
		})
	}
	return out, nil
}

// ModelSpend is one entry of GET /global/spend/models.
type ModelSpend struct {
	Model      string
	TotalSpend float64
}

// GlobalSpendModels proxies GET /global/spend/models.
func (c *Client) GlobalSpendModels(ctx context.Context) ([]ModelSpend, error) {
	modelsCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var raw []map[string]any
	if err := c.do(modelsCtx, http.MethodGet, "/global/spend/models", nil, &raw); err != nil {
		return nil, err
	}
	out := make([]ModelSpend, 0, len(raw))
	for _, e := range raw {
		out = append(out, ModelSpend{
			Model:      strField(e, "model"),
			TotalSpend: numField(e, "total_spend"),
		})
	}
	return out, nil
}

func intField(m map[string]any, k string) int64 {
	f, _ := m[k].(float64)
	return int64(f)
}

func strField(m map[string]any, k string) string {
	switch v := m[k].(type) {
	case string:
		return v
	case nil:
		return ""
	default:
		return fmt.Sprintf("%v", v)
	}
}

func numField(m map[string]any, k string) float64 {
	f, _ := m[k].(float64)
	return f
}

func strSliceField(m map[string]any, k string) []string {
	arr, _ := m[k].([]any)
	out := []string{}
	for _, e := range arr {
		if s, ok := e.(string); ok {
			out = append(out, s)
		}
	}
	return out
}
