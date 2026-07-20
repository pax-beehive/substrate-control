// Package kube provides access to Substrate's Kubernetes CRDs and core
// Secrets through the client-go dynamic client.
package kube

import (
	"context"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

var (
	// ActorTemplatesGVR is actortemplates.ate.dev/v1alpha1 (namespaced).
	ActorTemplatesGVR = schema.GroupVersionResource{Group: "ate.dev", Version: "v1alpha1", Resource: "actortemplates"}
	// WorkerPoolsGVR is workerpools.ate.dev/v1alpha1 (namespaced).
	WorkerPoolsGVR  = schema.GroupVersionResource{Group: "ate.dev", Version: "v1alpha1", Resource: "workerpools"}
	secretsGVR      = schema.GroupVersionResource{Group: "", Version: "v1", Resource: "secrets"}
	nodesGVR        = schema.GroupVersionResource{Group: "", Version: "v1", Resource: "nodes"}
	metricsNodesGVR = schema.GroupVersionResource{Group: "metrics.k8s.io", Version: "v1beta1", Resource: "nodes"}
	metricsPodsGVR  = schema.GroupVersionResource{Group: "metrics.k8s.io", Version: "v1beta1", Resource: "pods"}
)

// Client lists Substrate CRDs across all namespaces.
type Client struct {
	dyn dynamic.Interface
}

// New builds a Client using the default kubeconfig loading rules
// ($KUBECONFIG or ~/.kube/config, current context), falling back to the
// in-cluster service account configuration when running inside a pod.
func New() (*Client, error) {
	cfg, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		clientcmd.NewDefaultClientConfigLoadingRules(),
		&clientcmd.ConfigOverrides{},
	).ClientConfig()
	if err != nil {
		cfg, err = rest.InClusterConfig()
		if err != nil {
			return nil, err
		}
	}
	dyn, err := dynamic.NewForConfig(cfg)
	if err != nil {
		return nil, err
	}
	return &Client{dyn: dyn}, nil
}

// ListActorTemplates returns all actortemplates.ate.dev across all namespaces.
func (c *Client) ListActorTemplates(ctx context.Context) ([]unstructured.Unstructured, error) {
	return c.list(ctx, ActorTemplatesGVR)
}

// CreateObject creates a CR of the given resource in its object's namespace.
func (c *Client) CreateObject(ctx context.Context, gvr schema.GroupVersionResource, obj *unstructured.Unstructured) (*unstructured.Unstructured, error) {
	return c.dyn.Resource(gvr).Namespace(obj.GetNamespace()).Create(ctx, obj, metav1.CreateOptions{})
}

// DeleteObject deletes a CR of the given resource by namespace and name.
func (c *Client) DeleteObject(ctx context.Context, gvr schema.GroupVersionResource, namespace, name string) error {
	return c.dyn.Resource(gvr).Namespace(namespace).Delete(ctx, name, metav1.DeleteOptions{})
}

// ListSecrets returns all core/v1 Secrets in one namespace.
func (c *Client) ListSecrets(ctx context.Context, namespace string) ([]unstructured.Unstructured, error) {
	res, err := c.dyn.Resource(secretsGVR).Namespace(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	return res.Items, nil
}

// GetSecret returns one Secret by namespace and name.
func (c *Client) GetSecret(ctx context.Context, namespace, name string) (*unstructured.Unstructured, error) {
	return c.dyn.Resource(secretsGVR).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
}

// CreateSecret creates a Secret in its object's namespace.
func (c *Client) CreateSecret(ctx context.Context, obj *unstructured.Unstructured) (*unstructured.Unstructured, error) {
	return c.dyn.Resource(secretsGVR).Namespace(obj.GetNamespace()).Create(ctx, obj, metav1.CreateOptions{})
}

// DeleteSecret deletes a Secret by namespace and name.
func (c *Client) DeleteSecret(ctx context.Context, namespace, name string) error {
	return c.dyn.Resource(secretsGVR).Namespace(namespace).Delete(ctx, name, metav1.DeleteOptions{})
}

// ListNodes returns all core/v1 Nodes (cluster-scoped; used for capacity).
func (c *Client) ListNodes(ctx context.Context) ([]unstructured.Unstructured, error) {
	return c.list(ctx, nodesGVR)
}

// ListNodeMetrics returns all metrics.k8s.io NodeMetrics. It errors when
// metrics-server is not installed.
func (c *Client) ListNodeMetrics(ctx context.Context) ([]unstructured.Unstructured, error) {
	return c.list(ctx, metricsNodesGVR)
}

// ListPodMetrics returns all metrics.k8s.io PodMetrics across all
// namespaces.
func (c *Client) ListPodMetrics(ctx context.Context) ([]unstructured.Unstructured, error) {
	return c.list(ctx, metricsPodsGVR)
}

// ListWorkerPools returns all workerpools.ate.dev across all namespaces.
func (c *Client) ListWorkerPools(ctx context.Context) ([]unstructured.Unstructured, error) {
	return c.list(ctx, WorkerPoolsGVR)
}

func (c *Client) list(ctx context.Context, gvr schema.GroupVersionResource) ([]unstructured.Unstructured, error) {
	res, err := c.dyn.Resource(gvr).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	return res.Items, nil
}
