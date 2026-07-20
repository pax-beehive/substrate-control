package api

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"

	"k8s.io/apimachinery/pkg/api/resource"
)

// Monitoring wire types (see API_CONTRACT.md "Monitoring").

type nodeMetricJSON struct {
	Name          string  `json:"name"`
	CPUUsage      string  `json:"cpuUsage"`
	CPUPercent    float64 `json:"cpuPercent"`
	MemoryUsage   string  `json:"memoryUsage"`
	MemoryPercent float64 `json:"memoryPercent"`
}

type podNamespaceMetricJSON struct {
	Namespace   string `json:"namespace"`
	PodCount    int    `json:"podCount"`
	CPUUsage    string `json:"cpuUsage"`
	MemoryUsage string `json:"memoryUsage"`
}

type metricsSectionJSON[T any] struct {
	Available bool `json:"available"`
	Items     []T  `json:"items"`
}

type substrateMetricsJSON struct {
	WorkersTotal        int `json:"workersTotal"`
	WorkersAssigned     int `json:"workersAssigned"`
	WorkersIdle         int `json:"workersIdle"`
	ActorsRunning       int `json:"actorsRunning"`
	ActorsSuspended     int `json:"actorsSuspended"`
	ActorsTransitioning int `json:"actorsTransitioning"`
	ActorsCrashed       int `json:"actorsCrashed"`
	Pools               int `json:"pools"`
	Templates           int `json:"templates"`
	Atespaces           int `json:"atespaces"`
}

type tokensJSON struct {
	Prompt     int64 `json:"prompt"`
	Completion int64 `json:"completion"`
	Total      int64 `json:"total"`
}

type spendByKeyJSON struct {
	KeyAlias string  `json:"keyAlias"`
	KeyName  string  `json:"keyName"`
	Spend    float64 `json:"spend"`
	Tokens   int64   `json:"tokens"`
	Requests int     `json:"requests"`
}

type spendByModelJSON struct {
	Model    string  `json:"model"`
	Spend    float64 `json:"spend"`
	Tokens   int64   `json:"tokens"`
	Requests int     `json:"requests"`
}

type gatewayMetricsJSON struct {
	Reachable     bool               `json:"reachable"`
	TotalSpend    float64            `json:"totalSpend"`
	MaxBudget     float64            `json:"maxBudget"`
	TotalRequests int                `json:"totalRequests"`
	Tokens        tokensJSON         `json:"tokens"`
	SpendByKey    []spendByKeyJSON   `json:"spendByKey"`
	SpendByModel  []spendByModelJSON `json:"spendByModel"`
}

type overviewJSON struct {
	Nodes     metricsSectionJSON[nodeMetricJSON]         `json:"nodes"`
	Pods      metricsSectionJSON[podNamespaceMetricJSON] `json:"pods"`
	Substrate substrateMetricsJSON                       `json:"substrate"`
	Gateway   gatewayMetricsJSON                         `json:"gateway"`
}

type spendLogJSON struct {
	RequestID        string  `json:"requestId"`
	StartTime        string  `json:"startTime"`
	EndTime          string  `json:"endTime"`
	Model            string  `json:"model"`
	KeyAlias         string  `json:"keyAlias"`
	PromptTokens     int64   `json:"promptTokens"`
	CompletionTokens int64   `json:"completionTokens"`
	TotalTokens      int64   `json:"totalTokens"`
	Spend            float64 `json:"spend"`
}

// Handlers.

func (s *Server) handleMetricsOverview(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	substrate, err := s.collectSubstrateMetrics(ctx)
	if err != nil {
		writeGRPCError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, overviewJSON{
		Nodes:     s.collectNodeMetrics(ctx),
		Pods:      s.collectPodMetrics(ctx),
		Substrate: substrate,
		Gateway:   s.collectGatewayMetrics(ctx),
	})
}

func (s *Server) handleMetricsSpendLogs(w http.ResponseWriter, r *http.Request) {
	limit := 100
	if q := r.URL.Query().Get("limit"); q != "" {
		n, err := strconv.Atoi(q)
		if err != nil || n < 1 || n > 500 {
			writeError(w, http.StatusBadRequest, "limit must be an integer between 1 and 500")
			return
		}
		limit = n
	}
	logs, err := s.gw.SpendLogs(r.Context(), limit)
	if err != nil {
		writeGatewayError(w, err)
		return
	}
	keys, err := s.gw.GlobalSpendKeys(r.Context())
	if err != nil {
		writeGatewayError(w, err)
		return
	}
	aliasByHash := make(map[string]string, len(keys))
	for _, k := range keys {
		aliasByHash[k.APIKey] = k.KeyAlias
	}
	out := make([]spendLogJSON, 0, len(logs))
	for _, e := range logs {
		out = append(out, spendLogJSON{
			RequestID:        e.RequestID,
			StartTime:        e.StartTime,
			EndTime:          e.EndTime,
			Model:            e.Model,
			KeyAlias:         aliasByHash[e.APIKey],
			PromptTokens:     e.PromptTokens,
			CompletionTokens: e.CompletionTokens,
			TotalTokens:      e.TotalTokens,
			Spend:            e.Spend,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

// Collectors.

// collectNodeMetrics joins metrics.k8s.io node usage with core/v1 node
// capacity. available=false when either source fails.
func (s *Server) collectNodeMetrics(ctx context.Context) metricsSectionJSON[nodeMetricJSON] {
	out := metricsSectionJSON[nodeMetricJSON]{Items: []nodeMetricJSON{}}
	if s.kube == nil {
		return out
	}
	usage, err := s.kube.ListNodeMetrics(ctx)
	if err != nil {
		return out
	}
	nodes, err := s.kube.ListNodes(ctx)
	if err != nil {
		return out
	}
	type capacity struct{ cpu, mem resource.Quantity }
	capByName := make(map[string]capacity, len(nodes))
	for _, n := range nodes {
		cpu := parseQuantity(nestedString(n.Object, "status", "capacity", "cpu"))
		mem := parseQuantity(nestedString(n.Object, "status", "capacity", "memory"))
		capByName[n.GetName()] = capacity{cpu: cpu, mem: mem}
	}
	for _, m := range usage {
		cpuUse := parseQuantity(nestedString(m.Object, "usage", "cpu"))
		memUse := parseQuantity(nestedString(m.Object, "usage", "memory"))
		cp := capByName[m.GetName()]
		out.Items = append(out.Items, nodeMetricJSON{
			Name:          m.GetName(),
			CPUUsage:      formatCPU(cpuUse),
			CPUPercent:    percent(cpuUse.MilliValue(), cp.cpu.MilliValue()),
			MemoryUsage:   formatMemory(memUse),
			MemoryPercent: percent(memUse.Value(), cp.mem.Value()),
		})
	}
	out.Available = true
	return out
}

// collectPodMetrics aggregates metrics.k8s.io pod usage per namespace.
func (s *Server) collectPodMetrics(ctx context.Context) metricsSectionJSON[podNamespaceMetricJSON] {
	out := metricsSectionJSON[podNamespaceMetricJSON]{Items: []podNamespaceMetricJSON{}}
	if s.kube == nil {
		return out
	}
	pods, err := s.kube.ListPodMetrics(ctx)
	if err != nil {
		return out
	}
	type agg struct {
		count int
		cpu   int64 // millicores
		mem   int64 // bytes
	}
	byNS := map[string]*agg{}
	for _, p := range pods {
		ns := p.GetNamespace()
		a := byNS[ns]
		if a == nil {
			a = &agg{}
			byNS[ns] = a
		}
		a.count++
		containers, _ := p.Object["containers"].([]any)
		for _, c := range containers {
			cm, _ := c.(map[string]any)
			cpuQ := parseQuantity(nestedString(cm, "usage", "cpu"))
			memQ := parseQuantity(nestedString(cm, "usage", "memory"))
			a.cpu += cpuQ.MilliValue()
			a.mem += memQ.Value()
		}
	}
	namespaces := make([]string, 0, len(byNS))
	for ns := range byNS {
		namespaces = append(namespaces, ns)
	}
	sort.Strings(namespaces)
	for _, ns := range namespaces {
		a := byNS[ns]
		out.Items = append(out.Items, podNamespaceMetricJSON{
			Namespace:   ns,
			PodCount:    a.count,
			CPUUsage:    fmt.Sprintf("%dm", a.cpu),
			MemoryUsage: formatMemory(*resource.NewQuantity(a.mem, resource.BinarySI)),
		})
	}
	out.Available = true
	return out
}

// collectSubstrateMetrics counts workers/actors/atespaces via gRPC and
// pools/templates via the CRD lists (zeroed when kube is unavailable).
func (s *Server) collectSubstrateMetrics(ctx context.Context) (substrateMetricsJSON, error) {
	var out substrateMetricsJSON
	workers, err := s.sub.ListWorkers(ctx)
	if err != nil {
		return out, err
	}
	actors, err := s.sub.ListActors(ctx, "")
	if err != nil {
		return out, err
	}
	atespaces, err := s.sub.ListAtespaces(ctx)
	if err != nil {
		return out, err
	}
	out.WorkersTotal = len(workers)
	for _, wk := range workers {
		if wk.GetAssignment() != nil {
			out.WorkersAssigned++
		}
	}
	out.WorkersIdle = out.WorkersTotal - out.WorkersAssigned
	for _, a := range actors {
		// RESUMING/SUSPENDING/PAUSING/PAUSED and UNSPECIFIED all count as
		// transitioning; only RUNNING/SUSPENDED/CRASHED are terminal buckets.
		switch statusToString(a.GetStatus()) {
		case "RUNNING":
			out.ActorsRunning++
		case "SUSPENDED":
			out.ActorsSuspended++
		case "CRASHED":
			out.ActorsCrashed++
		default:
			out.ActorsTransitioning++
		}
	}
	out.Atespaces = len(atespaces)
	if s.kube != nil {
		if pools, err := s.kube.ListWorkerPools(ctx); err == nil {
			out.Pools = len(pools)
		}
		if templates, err := s.kube.ListActorTemplates(ctx); err == nil {
			out.Templates = len(templates)
		}
	}
	return out, nil
}

// collectGatewayMetrics aggregates LiteLLM spend. Any gateway failure
// degrades the whole section to reachable=false with zero values.
func (s *Server) collectGatewayMetrics(ctx context.Context) gatewayMetricsJSON {
	out := gatewayMetricsJSON{
		SpendByKey:   []spendByKeyJSON{},
		SpendByModel: []spendByModelJSON{},
	}
	global, err := s.gw.GlobalSpend(ctx)
	if err != nil {
		return out
	}
	logs, err := s.gw.SpendLogs(ctx, 1000)
	if err != nil {
		return out
	}
	keys, err := s.gw.GlobalSpendKeys(ctx)
	if err != nil {
		return out
	}
	models, err := s.gw.GlobalSpendModels(ctx)
	if err != nil {
		return out
	}

	out.Reachable = true
	out.TotalSpend = global.Spend
	out.MaxBudget = global.MaxBudget
	out.TotalRequests = len(logs)
	for _, l := range logs {
		out.Tokens.Prompt += l.PromptTokens
		out.Tokens.Completion += l.CompletionTokens
		out.Tokens.Total += l.TotalTokens
	}

	// spendByKey: every known key appears; spend/tokens/requests are summed
	// over the fetched logs. Keys without traffic in the window keep their
	// lifetime total_spend from /global/spend/keys.
	byKey := make(map[string]*spendByKeyJSON, len(keys))
	keyOrder := []string{}
	for _, k := range keys {
		byKey[k.APIKey] = &spendByKeyJSON{KeyAlias: k.KeyAlias, KeyName: k.KeyName, Spend: k.TotalSpend}
		keyOrder = append(keyOrder, k.APIKey)
	}
	for _, l := range logs {
		e := byKey[l.APIKey]
		if e == nil {
			e = &spendByKeyJSON{}
			byKey[l.APIKey] = e
			keyOrder = append(keyOrder, l.APIKey)
		}
		e.Spend += l.Spend
		e.Tokens += l.TotalTokens
		e.Requests++
	}
	for _, h := range keyOrder {
		out.SpendByKey = append(out.SpendByKey, *byKey[h])
	}

	// spendByModel: group logs by model; models absent from the window keep
	// their lifetime total_spend from /global/spend/models.
	byModel := make(map[string]*spendByModelJSON, len(models))
	modelOrder := []string{}
	for _, m := range models {
		byModel[m.Model] = &spendByModelJSON{Model: m.Model, Spend: m.TotalSpend}
		modelOrder = append(modelOrder, m.Model)
	}
	for _, l := range logs {
		e := byModel[l.Model]
		if e == nil {
			e = &spendByModelJSON{Model: l.Model}
			byModel[l.Model] = e
			modelOrder = append(modelOrder, l.Model)
		}
		e.Spend += l.Spend
		e.Tokens += l.TotalTokens
		e.Requests++
	}
	for _, m := range modelOrder {
		out.SpendByModel = append(out.SpendByModel, *byModel[m])
	}
	return out
}

// Quantity helpers.

func nestedString(obj map[string]any, fields ...string) string {
	cur := obj
	for i, f := range fields {
		if i == len(fields)-1 {
			s, _ := cur[f].(string)
			return s
		}
		next, ok := cur[f].(map[string]any)
		if !ok {
			return ""
		}
		cur = next
	}
	return ""
}

func parseQuantity(s string) resource.Quantity {
	q, err := resource.ParseQuantity(s)
	if err != nil {
		return resource.Quantity{}
	}
	return q
}

func formatCPU(q resource.Quantity) string {
	return fmt.Sprintf("%dm", q.MilliValue())
}

func formatMemory(q resource.Quantity) string {
	v := q.Value()
	const gi = 1 << 30
	const mi = 1 << 20
	if v >= gi {
		return fmt.Sprintf("%.1fGi", float64(v)/gi)
	}
	return fmt.Sprintf("%.1fMi", float64(v)/mi)
}

func percent(part, whole int64) float64 {
	if whole <= 0 {
		return 0
	}
	return math.Round(float64(part)/float64(whole)*1000) / 10
}
