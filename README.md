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

## Publishing (CI)

`.github/workflows/publish-ecr.yml` builds a multi-arch (`amd64` + `arm64`)
image and pushes it to Amazon ECR on every push to `main` and on `vX.Y.Z`
tags. Tags applied: the commit `sha-<short>` (main builds), the semver
`{version}` and `{major}.{minor}` (release tags), and `latest` (whichever
build ran most recently).

Auth uses GitHub OIDC — no static AWS keys are stored. One-time setup:

1. In AWS, add GitHub's OIDC provider
   (`token.actions.githubusercontent.com`, audience `sts.amazonaws.com`) and
   an IAM role that trusts it. AWS requires the role's trust policy to scope
   on the `sub` claim. GitHub now issues **immutable subject claims** for this
   repo, so `sub` embeds numeric org/repo IDs rather than the slug — a
   pattern like `repo:<org>/<repo>:ref:refs/heads/main` will **not** match.
   Fetch the actual prefix and build the condition from it:

   ```sh
   gh api /repos/spqr-game/rollback-tower/actions/oidc/customization/sub \
     --jq .sub_claim_prefix
   # -> repo:spqr-game@65671182/rollback-tower@1306767090
   ```

   Then scope `sub` (StringLike) to that prefix on the refs the workflow runs:
   `<prefix>:ref:refs/heads/main` and `<prefix>:ref:refs/tags/*`. Grant the
   role `ecr:GetAuthorizationToken` (resource `*`) plus push actions
   (`BatchCheckLayerAvailability`, `InitiateLayerUpload`, `UploadLayerPart`,
   `CompleteLayerUpload`, `PutImage`, `BatchGetImage`,
   `GetDownloadUrlForLayer`) scoped to the target repository ARN.
2. Create the ECR repository.
3. Set these in the GitHub repo:

   | Name | Kind | Example |
   | --- | --- | --- |
   | `AWS_ROLE_ARN` | secret | `arn:aws:iam::123456789012:role/rollback-tower-ci` |
   | `AWS_REGION` | variable | `us-east-1` |
   | `ECR_REPOSITORY` | variable | `rollback-tower` |
