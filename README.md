# Rollback Tower

Stateless, single-host container update/rollback dashboard. Watches Docker
containers labeled `rollback-tower.enable=true`, auto-updates them when their
image tag changes upstream (unless pinned by a rollback), and lets you roll
back or switch to any tag published in the image's registry.

## Run

Mount the Docker socket and your registry credentials read-only:

    docker compose -f docker-compose.example.yml up --build

Opt a container in by adding the label `rollback-tower.enable=true`.

## Environment

| Var | Meaning | Default |
| --- | --- | --- |
| `POLL_INTERVAL` | Poll cadence (`300s`, `5m`, `0` disables) | `300s` |
| `ADMIN_PASSWORD` | If set, required to use the UI | unset (open) |
| `SESSION_SECRET` | Cookie signing secret; required if password set | — |
| `WEBHOOK_TOKEN` | Required for `/api/webhook`; unset → 503 | unset |
| `MAX_TAGS` | Cap on rollback targets listed per repo | `50` |
| `DOCKER_CONFIG` | Path to docker config.json | `~/.docker/config.json` |

When `ADMIN_PASSWORD` is unset the app is open — put it behind a proxy/VPN.

## Webhook

    curl -X POST "https://host/api/webhook?token=$WEBHOOK_TOKEN"
