package api

import (
	"sort"
	"strings"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	pb "substrate-control/gen/ateapipb"
)

// JSON wire types for the REST contract (see API_CONTRACT.md). All field
// names are camelCase; timestamps are RFC3339 strings.

type atespaceJSON struct {
	Name       string `json:"name"`
	UID        string `json:"uid"`
	Version    int64  `json:"version"`
	CreateTime string `json:"createTime"`
	UpdateTime string `json:"updateTime"`
}

type selectorJSON struct {
	MatchLabels map[string]string `json:"matchLabels"`
}

type snapshotInfoJSON struct {
	Type                  string   `json:"type"`
	SnapshotURIPrefix     string   `json:"snapshotUriPrefix,omitempty"`
	SnapshotPrefix        string   `json:"snapshotPrefix,omitempty"`
	NodeVMsWithLocalSnaps []string `json:"nodeVmsWithLocalSnapshots,omitempty"`
}

type actorJSON struct {
	Atespace               string            `json:"atespace"`
	Name                   string            `json:"name"`
	UID                    string            `json:"uid"`
	Version                int64             `json:"version"`
	CreateTime             string            `json:"createTime"`
	UpdateTime             string            `json:"updateTime"`
	ActorTemplateNamespace string            `json:"actorTemplateNamespace"`
	ActorTemplateName      string            `json:"actorTemplateName"`
	Status                 string            `json:"status"`
	AteomPodNamespace      string            `json:"ateomPodNamespace"`
	AteomPodName           string            `json:"ateomPodName"`
	AteomPodIP             string            `json:"ateomPodIP"`
	WorkerPoolName         string            `json:"workerPoolName"`
	WorkerSelector         *selectorJSON     `json:"workerSelector,omitempty"`
	SnapshotInfo           *snapshotInfoJSON `json:"snapshotInfo,omitempty"`
}

type assignmentJSON struct {
	Actor         *objectRefJSON `json:"actor,omitempty"`
	ActorTemplate *nsRefJSON     `json:"actorTemplate,omitempty"`
}

type objectRefJSON struct {
	Atespace string `json:"atespace"`
	Name     string `json:"name"`
}

type nsRefJSON struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
}

type workerJSON struct {
	WorkerNamespace string            `json:"workerNamespace"`
	WorkerPool      string            `json:"workerPool"`
	WorkerPod       string            `json:"workerPod"`
	IP              string            `json:"ip"`
	Version         int64             `json:"version"`
	WorkerPodUID    string            `json:"workerPodUid"`
	NodeName        string            `json:"nodeName"`
	SandboxClass    string            `json:"sandboxClass"`
	Labels          map[string]string `json:"labels"`
	Assignment      *assignmentJSON   `json:"assignment,omitempty"`
}

type k8sObjectJSON struct {
	Namespace         string            `json:"namespace"`
	Name              string            `json:"name"`
	UID               string            `json:"uid"`
	CreationTimestamp string            `json:"creationTimestamp"`
	Labels            map[string]string `json:"labels,omitempty"`
	Spec              map[string]any    `json:"spec"`
	Status            map[string]any    `json:"status,omitempty"`
}

// Request bodies.

type createAtespaceRequest struct {
	Name string `json:"name"`
}

type createActorRequest struct {
	Atespace               string        `json:"atespace"`
	Name                   string        `json:"name"`
	ActorTemplateNamespace string        `json:"actorTemplateNamespace"`
	ActorTemplateName      string        `json:"actorTemplateName"`
	WorkerSelector         *selectorJSON `json:"workerSelector"`
}

type resumeActorRequest struct {
	Boot bool `json:"boot"`
}

type updateActorRequest struct {
	WorkerSelector *selectorJSON `json:"workerSelector"`
}

type createK8sObjectRequest struct {
	Namespace string            `json:"namespace"`
	Name      string            `json:"name"`
	Labels    map[string]string `json:"labels"`
	Spec      map[string]any    `json:"spec"`
}

// secretInfoJSON never carries secret values — key names only.
type secretInfoJSON struct {
	Namespace         string   `json:"namespace"`
	Name              string   `json:"name"`
	Type              string   `json:"type"`
	Keys              []string `json:"keys"`
	CreationTimestamp string   `json:"creationTimestamp"`
}

type createSecretRequest struct {
	Namespace string            `json:"namespace"`
	Name      string            `json:"name"`
	Data      map[string]string `json:"data"`
}

// Gateway (LiteLLM admin proxy) wire types.

type gatewayKeyJSON struct {
	Key       string   `json:"key"`
	KeyAlias  string   `json:"keyAlias"`
	Models    []string `json:"models"`
	Spend     float64  `json:"spend"`
	MaxBudget float64  `json:"maxBudget"`
	Expires   string   `json:"expires"`
	CreatedAt string   `json:"createdAt"`
	UserID    string   `json:"userId"`
}

type generateKeyRequestJSON struct {
	KeyAlias  string   `json:"keyAlias"`
	Duration  string   `json:"duration"`
	Models    []string `json:"models"`
	MaxBudget float64  `json:"maxBudget"`
}

type generatedKeyJSON struct {
	Key      string `json:"key"`
	KeyAlias string `json:"keyAlias"`
	Duration string `json:"duration"`
	Expires  string `json:"expires"`
}

type gatewayModelJSON struct {
	ID        string `json:"id"`
	ModelName string `json:"modelName"`
	Model     string `json:"model"`
	Provider  string `json:"provider"`
	APIBase   string `json:"apiBase,omitempty"`
	HasAPIKey bool   `json:"hasApiKey"`
	CreatedAt string `json:"createdAt,omitempty"`
	UpdatedAt string `json:"updatedAt,omitempty"`
}

type registerModelRequestJSON struct {
	ModelName   string         `json:"modelName"`
	Model       string         `json:"model"`
	APIKey      string         `json:"apiKey"`
	APIBase     string         `json:"apiBase"`
	ExtraParams map[string]any `json:"extraParams"`
}

// actorProxyRequest is the console's request to reach an actor over HTTP.
type actorProxyRequest struct {
	Method      string `json:"method"`
	Path        string `json:"path"`
	Body        string `json:"body"`
	ContentType string `json:"contentType"`
}

// actorProxyResponse relays the upstream response verbatim.
type actorProxyResponse struct {
	Status      int    `json:"status"`
	ContentType string `json:"contentType"`
	Body        string `json:"body"`
}

// Conversions from protobuf / unstructured types.

func formatTime(t *timestamppb.Timestamp) string {
	if t == nil {
		return ""
	}
	return t.AsTime().UTC().Format(time.RFC3339)
}

func atespaceToJSON(a *pb.Atespace) atespaceJSON {
	md := a.GetMetadata()
	return atespaceJSON{
		Name:       md.GetName(),
		UID:        md.GetUid(),
		Version:    md.GetVersion(),
		CreateTime: formatTime(md.GetCreateTime()),
		UpdateTime: formatTime(md.GetUpdateTime()),
	}
}

// statusToString maps e.g. STATUS_RUNNING -> "RUNNING".
func statusToString(s pb.Actor_Status) string {
	return strings.TrimPrefix(s.String(), "STATUS_")
}

func selectorToJSON(s *pb.Selector) *selectorJSON {
	if s == nil {
		return nil
	}
	labels := s.GetMatchLabels()
	if labels == nil {
		labels = map[string]string{}
	}
	return &selectorJSON{MatchLabels: labels}
}

func selectorFromJSON(s *selectorJSON) *pb.Selector {
	if s == nil {
		return nil
	}
	return &pb.Selector{MatchLabels: s.MatchLabels}
}

// newActor builds the protobuf Actor for a CreateActor call.
func newActor(req createActorRequest) *pb.Actor {
	return &pb.Actor{
		Metadata: &pb.ResourceMetadata{
			Atespace: req.Atespace,
			Name:     req.Name,
		},
		ActorTemplateNamespace: req.ActorTemplateNamespace,
		ActorTemplateName:      req.ActorTemplateName,
		WorkerSelector:         selectorFromJSON(req.WorkerSelector),
	}
}

func snapshotInfoToJSON(si *pb.SnapshotInfo) *snapshotInfoJSON {
	if si == nil {
		return nil
	}
	switch d := si.GetData().(type) {
	case *pb.SnapshotInfo_External:
		return &snapshotInfoJSON{
			Type:              "external",
			SnapshotURIPrefix: d.External.GetSnapshotUriPrefix(),
		}
	case *pb.SnapshotInfo_Local:
		return &snapshotInfoJSON{
			Type:                  "local",
			SnapshotPrefix:        d.Local.GetSnapshotPrefix(),
			NodeVMsWithLocalSnaps: d.Local.GetNodeVmsWithLocalSnapshots(),
		}
	default:
		return nil
	}
}

func actorToJSON(a *pb.Actor) actorJSON {
	md := a.GetMetadata()
	return actorJSON{
		Atespace:               md.GetAtespace(),
		Name:                   md.GetName(),
		UID:                    md.GetUid(),
		Version:                md.GetVersion(),
		CreateTime:             formatTime(md.GetCreateTime()),
		UpdateTime:             formatTime(md.GetUpdateTime()),
		ActorTemplateNamespace: a.GetActorTemplateNamespace(),
		ActorTemplateName:      a.GetActorTemplateName(),
		Status:                 statusToString(a.GetStatus()),
		AteomPodNamespace:      a.GetAteomPodNamespace(),
		AteomPodName:           a.GetAteomPodName(),
		AteomPodIP:             a.GetAteomPodIp(),
		WorkerPoolName:         a.GetWorkerPoolName(),
		WorkerSelector:         selectorToJSON(a.GetWorkerSelector()),
		SnapshotInfo:           snapshotInfoToJSON(a.GetLatestSnapshotInfo()),
	}
}

func workerToJSON(w *pb.Worker) workerJSON {
	labels := w.GetLabels()
	if labels == nil {
		labels = map[string]string{}
	}
	out := workerJSON{
		WorkerNamespace: w.GetWorkerNamespace(),
		WorkerPool:      w.GetWorkerPool(),
		WorkerPod:       w.GetWorkerPod(),
		IP:              w.GetIp(),
		Version:         w.GetVersion(),
		WorkerPodUID:    w.GetWorkerPodUid(),
		NodeName:        w.GetNodeName(),
		SandboxClass:    w.GetSandboxClass(),
		Labels:          labels,
	}
	if as := w.GetAssignment(); as != nil {
		out.Assignment = &assignmentJSON{
			Actor: &objectRefJSON{
				Atespace: as.GetActor().GetAtespace(),
				Name:     as.GetActor().GetName(),
			},
			ActorTemplate: &nsRefJSON{
				Namespace: as.GetActorTemplate().GetNamespace(),
				Name:      as.GetActorTemplate().GetName(),
			},
		}
	}
	return out
}

func unstructuredToJSON(u unstructured.Unstructured) k8sObjectJSON {
	out := k8sObjectJSON{
		Namespace:         u.GetNamespace(),
		Name:              u.GetName(),
		UID:               string(u.GetUID()),
		CreationTimestamp: u.GetCreationTimestamp().UTC().Format(time.RFC3339),
		Labels:            u.GetLabels(),
	}
	if spec, ok := u.Object["spec"].(map[string]any); ok {
		out.Spec = spec
	}
	if status, ok := u.Object["status"].(map[string]any); ok {
		out.Status = status
	}
	return out
}

// secretToJSON flattens a Secret to its metadata and the sorted union of
// data/stringData key names. Values are never read out of the object.
func secretToJSON(u unstructured.Unstructured) secretInfoJSON {
	keySet := map[string]struct{}{}
	for _, field := range []string{"data", "stringData"} {
		if m, ok := u.Object[field].(map[string]any); ok {
			for k := range m {
				keySet[k] = struct{}{}
			}
		}
	}
	keys := make([]string, 0, len(keySet))
	for k := range keySet {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	typ, _ := u.Object["type"].(string)
	return secretInfoJSON{
		Namespace:         u.GetNamespace(),
		Name:              u.GetName(),
		Type:              typ,
		Keys:              keys,
		CreationTimestamp: u.GetCreationTimestamp().UTC().Format(time.RFC3339),
	}
}
