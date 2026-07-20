// Package api implements the REST/JSON contract for the Substrate Control
// web console using only the stdlib net/http ServeMux.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net"
	"net/http"
	"path"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"substrate-control/internal/gateway"
	"substrate-control/internal/kube"
	"substrate-control/internal/routerproxy"
	"substrate-control/internal/substrate"
)

// Server wires the Substrate gRPC client, the Kubernetes client, the
// LiteLLM gateway client and the atenet router proxy into the HTTP API.
// kube may be nil (kubeErr non-nil); the CRD/secret endpoints then still
// respond with 503 while everything else keeps working.
type Server struct {
	sub        *substrate.Client
	kube       *kube.Client
	kubeErr    error
	gw         *gateway.Client
	rp         *routerproxy.Client
	staticFS   fs.FS // nil = API-only mode
	fileServer http.Handler
}

func NewServer(sub *substrate.Client, kc *kube.Client, kubeErr error, gw *gateway.Client, rp *routerproxy.Client, staticFS fs.FS) *Server {
	s := &Server{sub: sub, kube: kc, kubeErr: kubeErr, gw: gw, rp: rp, staticFS: staticFS}
	if staticFS != nil {
		s.fileServer = http.FileServerFS(staticFS)
	}
	return s
}

// Handler returns the root http.Handler with method+pattern routing.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/healthz", s.handleHealthz)

	mux.HandleFunc("GET /api/atespaces", s.handleListAtespaces)
	mux.HandleFunc("POST /api/atespaces", s.handleCreateAtespace)
	mux.HandleFunc("DELETE /api/atespaces/{name}", s.handleDeleteAtespace)

	mux.HandleFunc("GET /api/actors", s.handleListActors)
	mux.HandleFunc("POST /api/actors", s.handleCreateActor)
	mux.HandleFunc("GET /api/actors/{atespace}/{name}", s.handleGetActor)
	mux.HandleFunc("PATCH /api/actors/{atespace}/{name}", s.handleUpdateActor)
	mux.HandleFunc("DELETE /api/actors/{atespace}/{name}", s.handleDeleteActor)
	mux.HandleFunc("POST /api/actors/{atespace}/{name}/suspend", s.handleSuspendActor)
	mux.HandleFunc("POST /api/actors/{atespace}/{name}/pause", s.handlePauseActor)
	mux.HandleFunc("POST /api/actors/{atespace}/{name}/resume", s.handleResumeActor)
	mux.HandleFunc("POST /api/actors/{atespace}/{name}/proxy", s.handleProxyActor)

	mux.HandleFunc("GET /api/workers", s.handleListWorkers)

	mux.HandleFunc("GET /api/actortemplates", s.handleListActorTemplates)
	mux.HandleFunc("POST /api/actortemplates", func(w http.ResponseWriter, r *http.Request) {
		s.handleCreateK8sObject(w, r, kube.ActorTemplatesGVR, "ActorTemplate")
	})
	mux.HandleFunc("DELETE /api/actortemplates/{namespace}/{name}", func(w http.ResponseWriter, r *http.Request) {
		s.handleDeleteK8sObject(w, r, kube.ActorTemplatesGVR)
	})
	mux.HandleFunc("GET /api/workerpools", s.handleListWorkerPools)
	mux.HandleFunc("POST /api/workerpools", func(w http.ResponseWriter, r *http.Request) {
		s.handleCreateK8sObject(w, r, kube.WorkerPoolsGVR, "WorkerPool")
	})
	mux.HandleFunc("DELETE /api/workerpools/{namespace}/{name}", func(w http.ResponseWriter, r *http.Request) {
		s.handleDeleteK8sObject(w, r, kube.WorkerPoolsGVR)
	})

	mux.HandleFunc("GET /api/secrets", s.handleListSecrets)
	mux.HandleFunc("POST /api/secrets", s.handleCreateSecret)
	mux.HandleFunc("DELETE /api/secrets/{namespace}/{name}", s.handleDeleteSecret)

	mux.HandleFunc("GET /api/gateway/info", s.handleGatewayInfo)
	mux.HandleFunc("GET /api/gateway/keys", s.handleListGatewayKeys)
	mux.HandleFunc("POST /api/gateway/keys", s.handleCreateGatewayKey)
	mux.HandleFunc("DELETE /api/gateway/keys/{key}", s.handleDeleteGatewayKey)
	mux.HandleFunc("GET /api/gateway/models", s.handleListGatewayModels)
	mux.HandleFunc("POST /api/gateway/models", s.handleRegisterGatewayModel)
	mux.HandleFunc("DELETE /api/gateway/models/{id}", s.handleDeleteGatewayModel)

	mux.HandleFunc("GET /api/metrics/overview", s.handleMetricsOverview)
	mux.HandleFunc("GET /api/metrics/spendlogs", s.handleMetricsSpendLogs)

	// Static SPA hosting (or API-only 404); must not swallow /api/* misses.
	mux.HandleFunc("GET /", s.handleStatic)

	return mux
}

// Response helpers.

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// writeGRPCError maps gRPC status codes to HTTP statuses per the contract.
func writeGRPCError(w http.ResponseWriter, err error) {
	st, ok := status.FromError(err)
	if !ok {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	code := http.StatusInternalServerError
	switch st.Code() {
	case codes.NotFound:
		code = http.StatusNotFound
	case codes.FailedPrecondition:
		code = http.StatusPreconditionFailed
	case codes.InvalidArgument:
		code = http.StatusBadRequest
	case codes.AlreadyExists:
		code = http.StatusConflict
	}
	writeError(w, code, st.Message())
}

func decodeBody(r *http.Request, v any) error {
	err := json.NewDecoder(r.Body).Decode(v)
	if errors.Is(err, io.EOF) {
		return nil // empty body is acceptable; v keeps zero values
	}
	return err
}

// Ops.

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := s.sub.Ping(ctx); err != nil {
		writeError(w, http.StatusServiceUnavailable, "substrate gRPC unreachable: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// Atespaces.

func (s *Server) handleListAtespaces(w http.ResponseWriter, r *http.Request) {
	spaces, err := s.sub.ListAtespaces(r.Context())
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	out := make([]atespaceJSON, 0, len(spaces))
	for _, sp := range spaces {
		out = append(out, atespaceToJSON(sp))
	}
	writeJSON(w, http.StatusOK, map[string]any{"atespaces": out})
}

func (s *Server) handleCreateAtespace(w http.ResponseWriter, r *http.Request) {
	var req createAtespaceRequest
	if err := decodeBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	sp, err := s.sub.CreateAtespace(r.Context(), req.Name)
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, atespaceToJSON(sp))
}

func (s *Server) handleDeleteAtespace(w http.ResponseWriter, r *http.Request) {
	sp, err := s.sub.DeleteAtespace(r.Context(), r.PathValue("name"))
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, atespaceToJSON(sp))
}

// Actors.

func (s *Server) handleListActors(w http.ResponseWriter, r *http.Request) {
	actors, err := s.sub.ListActors(r.Context(), r.URL.Query().Get("atespace"))
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	out := make([]actorJSON, 0, len(actors))
	for _, a := range actors {
		out = append(out, actorToJSON(a))
	}
	writeJSON(w, http.StatusOK, map[string]any{"actors": out})
}

func (s *Server) handleCreateActor(w http.ResponseWriter, r *http.Request) {
	var req createActorRequest
	if err := decodeBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}
	if req.Atespace == "" || req.Name == "" {
		writeError(w, http.StatusBadRequest, "atespace and name are required")
		return
	}
	actor, err := s.sub.CreateActor(r.Context(), newActor(req))
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, actorToJSON(actor))
}

func (s *Server) handleGetActor(w http.ResponseWriter, r *http.Request) {
	actor, err := s.sub.GetActor(r.Context(), r.PathValue("atespace"), r.PathValue("name"))
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, actorToJSON(actor))
}

func (s *Server) handleDeleteActor(w http.ResponseWriter, r *http.Request) {
	actor, err := s.sub.DeleteActor(r.Context(), r.PathValue("atespace"), r.PathValue("name"))
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, actorToJSON(actor))
}

func (s *Server) handleSuspendActor(w http.ResponseWriter, r *http.Request) {
	actor, err := s.sub.SuspendActor(r.Context(), r.PathValue("atespace"), r.PathValue("name"))
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"actor": actorToJSON(actor)})
}

func (s *Server) handlePauseActor(w http.ResponseWriter, r *http.Request) {
	actor, err := s.sub.PauseActor(r.Context(), r.PathValue("atespace"), r.PathValue("name"))
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"actor": actorToJSON(actor)})
}

func (s *Server) handleResumeActor(w http.ResponseWriter, r *http.Request) {
	var req resumeActorRequest
	if err := decodeBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}
	actor, err := s.sub.ResumeActor(r.Context(), r.PathValue("atespace"), r.PathValue("name"), req.Boot)
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"actor": actorToJSON(actor)})
}

func (s *Server) handleUpdateActor(w http.ResponseWriter, r *http.Request) {
	var req updateActorRequest
	if err := decodeBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}
	actor, err := s.sub.UpdateActor(r.Context(), r.PathValue("atespace"), r.PathValue("name"), selectorFromJSON(req.WorkerSelector))
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"actor": actorToJSON(actor)})
}

// actorProxyHostSuffix is the atenet router's Host-routing domain suffix.
const actorProxyHostSuffix = ".actors.resources.substrate.ate.dev"

// handleProxyActor forwards an HTTP request to the actor through the atenet
// router using Host-based routing.
func (s *Server) handleProxyActor(w http.ResponseWriter, r *http.Request) {
	var req actorProxyRequest
	if err := decodeBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}
	if req.Method != http.MethodGet && req.Method != http.MethodPost {
		writeError(w, http.StatusBadRequest, "method must be GET or POST")
		return
	}
	if !strings.HasPrefix(req.Path, "/") {
		writeError(w, http.StatusBadRequest, "path must start with /")
		return
	}
	contentType := req.ContentType
	if contentType == "" {
		contentType = "text/plain"
	}
	host := r.PathValue("name") + "." + r.PathValue("atespace") + actorProxyHostSuffix
	res, err := s.rp.Forward(r.Context(), host, req.Method, req.Path, req.Body, contentType)
	if err != nil {
		var nerr net.Error
		if errors.As(err, &nerr) && nerr.Timeout() {
			writeError(w, http.StatusGatewayTimeout, "actor request timed out: "+err.Error())
			return
		}
		writeError(w, http.StatusBadGateway, "actor unreachable: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, actorProxyResponse{
		Status:      res.Status,
		ContentType: res.ContentType,
		Body:        res.Body,
	})
}

// Workers.

func (s *Server) handleListWorkers(w http.ResponseWriter, r *http.Request) {
	workers, err := s.sub.ListWorkers(r.Context())
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	out := make([]workerJSON, 0, len(workers))
	for _, wk := range workers {
		out = append(out, workerToJSON(wk))
	}
	writeJSON(w, http.StatusOK, map[string]any{"workers": out})
}

// Kubernetes CRDs.

func (s *Server) handleListActorTemplates(w http.ResponseWriter, r *http.Request) {
	s.listKube(w, r, func(ctx context.Context) ([]k8sObjectJSON, error) {
		items, err := s.kube.ListActorTemplates(ctx)
		return flattenUnstructured(items, err)
	})
}

func (s *Server) handleListWorkerPools(w http.ResponseWriter, r *http.Request) {
	s.listKube(w, r, func(ctx context.Context) ([]k8sObjectJSON, error) {
		items, err := s.kube.ListWorkerPools(ctx)
		return flattenUnstructured(items, err)
	})
}

// handleCreateK8sObject creates a CR of the given kind from a
// CreateK8sObjectRequest. The server sets only apiVersion/kind/metadata;
// spec passes through unchanged and the CRD's own schema validation judges
// its contents.
func (s *Server) handleCreateK8sObject(w http.ResponseWriter, r *http.Request, gvr schema.GroupVersionResource, kind string) {
	if s.kubeUnavailable(w) {
		return
	}
	var req createK8sObjectRequest
	if err := decodeBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}
	if req.Namespace == "" || req.Name == "" || len(req.Spec) == 0 {
		writeError(w, http.StatusBadRequest, "namespace, name and spec are required")
		return
	}
	obj := &unstructured.Unstructured{}
	obj.SetAPIVersion(apiVersionOf(gvr))
	obj.SetKind(kind)
	obj.SetNamespace(req.Namespace)
	obj.SetName(req.Name)
	obj.SetLabels(req.Labels)
	obj.Object["spec"] = req.Spec

	created, err := s.kube.CreateObject(r.Context(), gvr, obj)
	if err != nil {
		writeKubeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, unstructuredToJSON(*created))
}

func (s *Server) handleDeleteK8sObject(w http.ResponseWriter, r *http.Request, gvr schema.GroupVersionResource) {
	if s.kubeUnavailable(w) {
		return
	}
	if err := s.kube.DeleteObject(r.Context(), gvr, r.PathValue("namespace"), r.PathValue("name")); err != nil {
		writeKubeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// apiVersionOf renders a GVR's group/version as an apiVersion string.
func apiVersionOf(gvr schema.GroupVersionResource) string {
	if gvr.Group == "" {
		return gvr.Version
	}
	return gvr.Group + "/" + gvr.Version
}

// Secrets.

func (s *Server) handleListSecrets(w http.ResponseWriter, r *http.Request) {
	if s.kubeUnavailable(w) {
		return
	}
	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		writeError(w, http.StatusBadRequest, "namespace query parameter is required")
		return
	}
	items, err := s.kube.ListSecrets(r.Context(), namespace)
	if err != nil {
		writeKubeError(w, err)
		return
	}
	out := make([]secretInfoJSON, 0, len(items))
	for _, u := range items {
		out = append(out, secretToJSON(u))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

func (s *Server) handleCreateSecret(w http.ResponseWriter, r *http.Request) {
	if s.kubeUnavailable(w) {
		return
	}
	var req createSecretRequest
	if err := decodeBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}
	if req.Namespace == "" || req.Name == "" || len(req.Data) == 0 {
		writeError(w, http.StatusBadRequest, "namespace, name and non-empty data are required")
		return
	}
	// Always Opaque; data goes in as stringData so the API server does the
	// base64 encoding.
	obj := &unstructured.Unstructured{}
	obj.SetAPIVersion("v1")
	obj.SetKind("Secret")
	obj.SetNamespace(req.Namespace)
	obj.SetName(req.Name)
	obj.Object["type"] = "Opaque"
	stringData := make(map[string]any, len(req.Data))
	for k, v := range req.Data {
		stringData[k] = v
	}
	obj.Object["stringData"] = stringData

	created, err := s.kube.CreateSecret(r.Context(), obj)
	if err != nil {
		writeKubeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, secretToJSON(*created))
}

func (s *Server) handleDeleteSecret(w http.ResponseWriter, r *http.Request) {
	if s.kubeUnavailable(w) {
		return
	}
	if err := s.kube.DeleteSecret(r.Context(), r.PathValue("namespace"), r.PathValue("name")); err != nil {
		writeKubeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// Gateway (LiteLLM admin proxy).

func (s *Server) handleGatewayInfo(w http.ResponseWriter, r *http.Request) {
	info, err := s.gw.Info(r.Context())
	if err != nil {
		writeGatewayError(w, err)
		return
	}
	resp := map[string]any{"reachable": true, "url": s.gw.BaseURL()}
	if info.Version != "" {
		resp["version"] = info.Version
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleListGatewayKeys(w http.ResponseWriter, r *http.Request) {
	keys, err := s.gw.ListKeys(r.Context())
	if err != nil {
		writeGatewayError(w, err)
		return
	}
	out := make([]gatewayKeyJSON, 0, len(keys))
	for _, k := range keys {
		out = append(out, gatewayKeyJSON{
			Key:       k.Key,
			KeyAlias:  k.KeyAlias,
			Models:    k.Models,
			Spend:     k.Spend,
			MaxBudget: k.MaxBudget,
			Expires:   k.Expires,
			CreatedAt: k.CreatedAt,
			UserID:    k.UserID,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

func (s *Server) handleCreateGatewayKey(w http.ResponseWriter, r *http.Request) {
	var req generateKeyRequestJSON
	if err := decodeBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}
	if req.KeyAlias == "" {
		writeError(w, http.StatusBadRequest, "keyAlias is required")
		return
	}
	gen, err := s.gw.GenerateKey(r.Context(), gateway.GenerateKeyRequest{
		KeyAlias:  req.KeyAlias,
		Duration:  req.Duration,
		Models:    req.Models,
		MaxBudget: req.MaxBudget,
	})
	if err != nil {
		writeGatewayError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, generatedKeyJSON{
		Key:      gen.Key,
		KeyAlias: gen.KeyAlias,
		Duration: gen.Duration,
		Expires:  gen.Expires,
	})
}

func (s *Server) handleDeleteGatewayKey(w http.ResponseWriter, r *http.Request) {
	if err := s.gw.DeleteKey(r.Context(), r.PathValue("key")); err != nil {
		writeGatewayError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

func gatewayModelToJSON(m gateway.Model) gatewayModelJSON {
	return gatewayModelJSON{
		ID:        m.ID,
		ModelName: m.ModelName,
		Model:     m.Model,
		Provider:  m.Provider,
		APIBase:   m.APIBase,
		HasAPIKey: m.HasAPIKey,
		CreatedAt: m.CreatedAt,
		UpdatedAt: m.UpdatedAt,
	}
}

func (s *Server) handleListGatewayModels(w http.ResponseWriter, r *http.Request) {
	models, err := s.gw.ListModels(r.Context())
	if err != nil {
		writeGatewayError(w, err)
		return
	}
	out := make([]gatewayModelJSON, 0, len(models))
	for _, m := range models {
		out = append(out, gatewayModelToJSON(m))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

func (s *Server) handleRegisterGatewayModel(w http.ResponseWriter, r *http.Request) {
	var req registerModelRequestJSON
	if err := decodeBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}
	if req.ModelName == "" || req.Model == "" || req.APIKey == "" {
		writeError(w, http.StatusBadRequest, "modelName, model and apiKey are required")
		return
	}
	m, err := s.gw.RegisterModel(r.Context(), gateway.RegisterModelRequest{
		ModelName:   req.ModelName,
		Model:       req.Model,
		APIKey:      req.APIKey,
		APIBase:     req.APIBase,
		ExtraParams: req.ExtraParams,
	})
	if err != nil {
		writeGatewayError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, gatewayModelToJSON(*m))
}

func (s *Server) handleDeleteGatewayModel(w http.ResponseWriter, r *http.Request) {
	// PathValue is already URL-decoded by the ServeMux.
	if err := s.gw.DeleteModel(r.Context(), r.PathValue("id")); err != nil {
		writeGatewayError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// writeGatewayError maps classified gateway failures: unconfigured or
// unreachable → 503, upstream LiteLLM errors → 502 with its message.
func writeGatewayError(w http.ResponseWriter, err error) {
	var ge *gateway.Error
	if errors.As(err, &ge) {
		switch ge.Kind {
		case gateway.KindNotConfigured:
			writeError(w, http.StatusServiceUnavailable, "litellm gateway not configured")
			return
		case gateway.KindUnreachable:
			writeError(w, http.StatusServiceUnavailable, "litellm gateway unreachable: "+ge.Message)
			return
		case gateway.KindUpstream:
			writeError(w, http.StatusBadGateway, ge.Message)
			return
		}
	}
	writeError(w, http.StatusInternalServerError, err.Error())
}

// kubeUnavailable reports 503 when the kubernetes client was never set up
// (no kubeconfig at startup).
func (s *Server) kubeUnavailable(w http.ResponseWriter) bool {
	if s.kube == nil {
		writeError(w, http.StatusServiceUnavailable, "kubernetes client unavailable: "+s.kubeErr.Error())
		return true
	}
	return false
}

// writeKubeError maps Kubernetes API errors to HTTP statuses per the contract.
func writeKubeError(w http.ResponseWriter, err error) {
	switch {
	case apierrors.IsAlreadyExists(err):
		writeError(w, http.StatusConflict, err.Error())
	case apierrors.IsNotFound(err):
		writeError(w, http.StatusNotFound, err.Error())
	case apierrors.IsForbidden(err):
		writeError(w, http.StatusForbidden, err.Error())
	case apierrors.IsInvalid(err):
		writeError(w, http.StatusUnprocessableEntity, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}

func (s *Server) listKube(w http.ResponseWriter, r *http.Request, list func(context.Context) ([]k8sObjectJSON, error)) {
	if s.kubeUnavailable(w) {
		return
	}
	items, err := list(r.Context())
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func flattenUnstructured(items []unstructured.Unstructured, err error) ([]k8sObjectJSON, error) {
	if err != nil {
		return nil, err
	}
	out := make([]k8sObjectJSON, 0, len(items))
	for _, u := range items {
		out = append(out, unstructuredToJSON(u))
	}
	return out, nil
}

// Static SPA hosting.

func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	// /api/* misses land here when no API route matched: report a JSON 404
	// instead of falling through to the SPA.
	if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/api" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if s.staticFS == nil {
		writeError(w, http.StatusNotFound, "frontend not built; API-only mode")
		return
	}
	// Serve the file directly when it exists...
	p := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if f, err := s.staticFS.Open(p); err == nil {
		st, serr := f.Stat()
		f.Close()
		if serr == nil && !st.IsDir() {
			s.fileServer.ServeHTTP(w, r)
			return
		}
	}
	// ...otherwise fall back to index.html (SPA client-side routing).
	s.serveIndex(w, r)
}

func (s *Server) serveIndex(w http.ResponseWriter, r *http.Request) {
	f, err := s.staticFS.Open("index.html")
	if err != nil {
		writeError(w, http.StatusNotFound, "frontend index.html missing")
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	rs, ok := f.(io.ReadSeeker)
	if !ok {
		writeError(w, http.StatusInternalServerError, "frontend file is not seekable")
		return
	}
	http.ServeContent(w, r, "index.html", st.ModTime(), rs)
}
