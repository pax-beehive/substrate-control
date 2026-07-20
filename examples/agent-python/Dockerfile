# Build for linux/amd64 — the Substrate cluster nodes are x86_64:
#   docker buildx build --platform linux/amd64 ...
FROM python:3.13-slim

# No dependencies beyond the stdlib — checkpoint/restore via gVisor works
# with any normal process; keep it boring.
WORKDIR /app
COPY main.py .

# atenet routes actor traffic to port 80.
EXPOSE 80
CMD ["python", "/app/main.py"]
