# Legacy hosted backend (not used by pagevoice.tech)

Status: **archived experiment. Not deployed, not maintained, not required.**

This folder holds the Docker, Compose, PocketBase and Caddy files from an earlier
plan to run PageVoice as a hosted service with server-side guest libraries. The
current product does not work that way:

- `https://www.pagevoice.tech` is a static site. It makes no API or PocketBase calls.
- Documents, audio and reading positions stay in the visitor's browser.
- The Python package (`pagevoice/`, `rag/`) is an optional local command-line and
  server tool. It is documented in [Python power mode](../../docs/python-power-mode.md).
  It is kept because it has its own tests and CI job. It is not the hosted service.

Keep these files only as a reference for the earlier design. Running them requires
secrets and a public HTTPS origin that this project does not provide.

| File | What it was for |
| --- | --- |
| `compose.yaml` | Python worker alone, with a local data volume |
| `docker-compose.yml` | PocketBase guest identity plus the Python worker |
| `Dockerfile.pocketbase` | PocketBase image used by the compose file above |
| `pb_migrations/` | PocketBase collection for guest libraries |
| `deploy/Caddyfile.example` | Example reverse proxy with placeholder domains |

Build paths are relative to this folder. Compose commands must run here, for example
`docker compose -f docker-compose.yml up`. Compose reads a `.env` file from this folder.
See [`../../.env.example`](../../.env.example) for the variable names. Historical
notes are in [docs/deployment.md](../../docs/deployment.md) and
[docs/pocketbase-fit.md](../../docs/pocketbase-fit.md).
