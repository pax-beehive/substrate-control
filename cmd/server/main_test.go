package main

import "testing"

func TestDetectMode(t *testing.T) {
	const tf = defaultTokenFile
	cases := []struct {
		name  string
		env   map[string]string
		files map[string]bool
		want  connectMode
	}{
		{
			name:  "direct wins over everything",
			env:   map[string]string{"SUBSTRATE_GRPC_ADDR": "100.125.72.76:30348", "KUBERNETES_SERVICE_HOST": "10.152.183.1"},
			files: map[string]bool{tf: true},
			want:  modeDirect,
		},
		{
			name:  "in pod with default token file",
			env:   map[string]string{"KUBERNETES_SERVICE_HOST": "10.152.183.1"},
			files: map[string]bool{tf: true},
			want:  modeInCluster,
		},
		{
			name:  "in pod with custom token file",
			env:   map[string]string{"KUBERNETES_SERVICE_HOST": "10.152.183.1", "SUBSTRATE_TOKEN_FILE": "/custom/token"},
			files: map[string]bool{"/custom/token": true},
			want:  modeInCluster,
		},
		{
			name:  "in pod but token file missing falls back to portforward",
			env:   map[string]string{"KUBERNETES_SERVICE_HOST": "10.152.183.1"},
			files: map[string]bool{tf: false},
			want:  modePortForward,
		},
		{
			name:  "token file alone (no pod env) is not incluster",
			env:   map[string]string{},
			files: map[string]bool{tf: true},
			want:  modePortForward,
		},
		{
			name:  "workstation default",
			env:   map[string]string{},
			files: map[string]bool{},
			want:  modePortForward,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			getenv := func(k string) string { return tc.env[k] }
			exists := func(p string) bool { return tc.files[p] }
			if got := detectMode(getenv, exists); got != tc.want {
				t.Errorf("detectMode() = %v, want %v", got, tc.want)
			}
		})
	}
}
