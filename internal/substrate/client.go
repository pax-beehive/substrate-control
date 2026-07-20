// Package substrate wraps the Agent Substrate Control gRPC API behind a
// single shared connection.
package substrate

import (
	"context"
	"crypto/tls"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"

	pb "substrate-control/gen/ateapipb"
)

// Client is a thin wrapper around the Control service. It owns one shared
// gRPC connection to the Substrate control plane.
type Client struct {
	conn *grpc.ClientConn
	ctrl pb.ControlClient
}

// Dial creates an unauthenticated Client for addr (host:port) — the direct
// mode, used with endpoints that do not require auth. The cluster uses a
// self-signed certificate, so TLS verification is disabled. The connection
// is established lazily on the first RPC.
func Dial(addr string) (*Client, error) {
	return dial(addr, nil)
}

// DialAuthenticated creates a Client for addr that attaches a bearer token
// from ts to every RPC, force-refreshing the token and retrying once when
// an RPC fails as unauthenticated.
func DialAuthenticated(addr string, ts TokenSource) (*Client, error) {
	return dial(addr, ts)
}

func dial(addr string, ts TokenSource) (*Client, error) {
	opts := []grpc.DialOption{
		grpc.WithTransportCredentials(credentials.NewTLS(&tls.Config{
			InsecureSkipVerify: true, // self-signed cluster cert
		})),
	}
	if ts != nil {
		opts = append(opts,
			grpc.WithPerRPCCredentials(perRPCCreds{ts: ts}),
			grpc.WithChainUnaryInterceptor(unauthenticatedRetryInterceptor(ts)),
		)
	}
	conn, err := grpc.NewClient(addr, opts...)
	if err != nil {
		return nil, err
	}
	return &Client{conn: conn, ctrl: pb.NewControlClient(conn)}, nil
}

// Close closes the underlying connection.
func (c *Client) Close() error { return c.conn.Close() }

// Ping verifies connectivity with a lightweight single-page ListAtespaces.
func (c *Client) Ping(ctx context.Context) error {
	_, err := c.ctrl.ListAtespaces(ctx, &pb.ListAtespacesRequest{PageSize: 1})
	return err
}

// Atespaces.

func (c *Client) CreateAtespace(ctx context.Context, name string) (*pb.Atespace, error) {
	return c.ctrl.CreateAtespace(ctx, &pb.CreateAtespaceRequest{
		Atespace: &pb.Atespace{Metadata: &pb.ResourceMetadata{Name: name}},
	})
}

func (c *Client) DeleteAtespace(ctx context.Context, name string) (*pb.Atespace, error) {
	return c.ctrl.DeleteAtespace(ctx, &pb.DeleteAtespaceRequest{
		Atespace: &pb.ObjectRef{Name: name},
	})
}

// ListAtespaces returns all atespaces, following pagination.
func (c *Client) ListAtespaces(ctx context.Context) ([]*pb.Atespace, error) {
	var out []*pb.Atespace
	req := &pb.ListAtespacesRequest{}
	for {
		resp, err := c.ctrl.ListAtespaces(ctx, req)
		if err != nil {
			return nil, err
		}
		out = append(out, resp.GetAtespaces()...)
		if resp.GetNextPageToken() == "" {
			return out, nil
		}
		req.PageToken = resp.GetNextPageToken()
	}
}

// Actors.

func (c *Client) GetActor(ctx context.Context, atespace, name string) (*pb.Actor, error) {
	return c.ctrl.GetActor(ctx, &pb.GetActorRequest{
		Actor: &pb.ObjectRef{Atespace: atespace, Name: name},
	})
}

func (c *Client) CreateActor(ctx context.Context, actor *pb.Actor) (*pb.Actor, error) {
	return c.ctrl.CreateActor(ctx, &pb.CreateActorRequest{Actor: actor})
}

func (c *Client) UpdateActor(ctx context.Context, atespace, name string, sel *pb.Selector) (*pb.Actor, error) {
	resp, err := c.ctrl.UpdateActor(ctx, &pb.UpdateActorRequest{
		Actor:          &pb.ObjectRef{Atespace: atespace, Name: name},
		WorkerSelector: sel,
	})
	if err != nil {
		return nil, err
	}
	return resp.GetActor(), nil
}

func (c *Client) SuspendActor(ctx context.Context, atespace, name string) (*pb.Actor, error) {
	resp, err := c.ctrl.SuspendActor(ctx, &pb.SuspendActorRequest{
		Actor: &pb.ObjectRef{Atespace: atespace, Name: name},
	})
	if err != nil {
		return nil, err
	}
	return resp.GetActor(), nil
}

func (c *Client) PauseActor(ctx context.Context, atespace, name string) (*pb.Actor, error) {
	resp, err := c.ctrl.PauseActor(ctx, &pb.PauseActorRequest{
		Actor: &pb.ObjectRef{Atespace: atespace, Name: name},
	})
	if err != nil {
		return nil, err
	}
	return resp.GetActor(), nil
}

func (c *Client) ResumeActor(ctx context.Context, atespace, name string, boot bool) (*pb.Actor, error) {
	resp, err := c.ctrl.ResumeActor(ctx, &pb.ResumeActorRequest{
		Actor: &pb.ObjectRef{Atespace: atespace, Name: name},
		Boot:  boot,
	})
	if err != nil {
		return nil, err
	}
	return resp.GetActor(), nil
}

func (c *Client) DeleteActor(ctx context.Context, atespace, name string) (*pb.Actor, error) {
	return c.ctrl.DeleteActor(ctx, &pb.DeleteActorRequest{
		Actor: &pb.ObjectRef{Atespace: atespace, Name: name},
	})
}

// ListActors returns all actors in the given atespace (empty = all
// atespaces), following pagination.
func (c *Client) ListActors(ctx context.Context, atespace string) ([]*pb.Actor, error) {
	var out []*pb.Actor
	req := &pb.ListActorsRequest{Atespace: atespace}
	for {
		resp, err := c.ctrl.ListActors(ctx, req)
		if err != nil {
			return nil, err
		}
		out = append(out, resp.GetActors()...)
		if resp.GetNextPageToken() == "" {
			return out, nil
		}
		req.PageToken = resp.GetNextPageToken()
	}
}

// Workers.

// ListWorkers returns all workers, following pagination.
func (c *Client) ListWorkers(ctx context.Context) ([]*pb.Worker, error) {
	var out []*pb.Worker
	req := &pb.ListWorkersRequest{}
	for {
		resp, err := c.ctrl.ListWorkers(ctx, req)
		if err != nil {
			return nil, err
		}
		out = append(out, resp.GetWorkers()...)
		if resp.GetNextPageToken() == "" {
			return out, nil
		}
		req.PageToken = resp.GetNextPageToken()
	}
}
