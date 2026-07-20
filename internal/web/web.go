// Package web embeds the built frontend into the server binary.
//
// The committed dist/index.html is a placeholder so the module builds
// without a frontend build; the Docker image replaces it with the real
// Vite output (see Dockerfile). At runtime a disk frontend/dist directory
// takes precedence over the embedded copy (see cmd/server).
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var distFS embed.FS

// Dist returns the embedded frontend rooted at the dist directory.
func Dist() fs.FS {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		panic(err)
	}
	return sub
}
