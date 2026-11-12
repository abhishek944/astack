# pi-litellm (local gateway)

A private, local-only LiteLLM gateway with the Admin UI and Postgres: two
containers, one named volume, no cloud. Pi uses a per-person virtual key.
Independent unit: no package.json, workspace or published package.

## What runs

| Service | Pinned image | Exposure |
|---|---|---|
| `litellm` | `ghcr.io/berriai/litellm:v1.108.4` | `http://127.0.0.1:4000` (loopback only) |
| `db` | `postgres:16.9-alpine` | Compose network only; no host port |

The LiteLLM image resolves to index digest
`sha256:17921779153960f086e2660994cc398fc76ed65c531765177803b9ae0a25d97a`
and reports version 1.108.4. Its `v<version>` tag is valid; the legacy
`main-v<version>` scheme does not exist for this release. This image already ships
Prisma and startup schema migration support; no separate database image is needed.
Python urllib runs the public readiness healthcheck because curl/wget are absent.

State lives in `pi-litellm_litellm-db-data`. There are no fixed container names.
Preserve the volume and the existing master key, encryption salt and DB password;
changing credentials is not part of a configuration-source migration.

## Doppler is the configuration source

Prerequisites: a running local Docker context, Compose v2, free loopback port 4000,
and authenticated Doppler CLI access to project `effect-boilerplate`, config `dev`.
This unit never uses `prd`, starts Docker or provisions a remote service.

Required Doppler names:

- `LITELLM_MASTER_KEY`: server-only proxy admin credential, not a client key.
- `LITELLM_SALT_KEY`: encrypts stored credentials; changing it breaks decryption.
- `LITELLM_UI_USERNAME` and `LITELLM_UI_PASSWORD`: existing bootstrap UI login.
- `LITELLM_POSTGRES_PASSWORD`: existing DB password, mapped to the database's
  `POSTGRES_PASSWORD` and the proxy's `DATABASE_URL`.
- `OPENAI_API_KEY`: existing OpenAI provider key; model entries store only
  `os.environ/OPENAI_API_KEY`, not the provider secret.

The existing DB password is URL-safe hex. Preserve it exactly; arbitrary characters
would require URL encoding before constructing `DATABASE_URL`. The existing five
values were migrated unchanged, not generated or rotated. `.env.example` is now
only a nonsecret name reference; do not copy it to an active env file. The legacy
private `.env` has been removed. Do not print secrets or rendered Compose
configuration, source `.env`, or dump container/process environments.

## Start and inspect

From a directory where Doppler authentication is available, point Compose at this
service directory. For this checkout, the authenticated directory is the
`effect-alchemy-cf` repository; using its cwd avoids changing credential scope.
Replace the service path below if your checkout is elsewhere.

```sh
cd /Users/abhishektatikella/Documents/boilerplate/effect-alchemy-cf
doppler run -p effect-boilerplate -c dev --no-fallback --preserve-env=false \
  --only-secrets LITELLM_MASTER_KEY,LITELLM_SALT_KEY,LITELLM_UI_USERNAME,LITELLM_UI_PASSWORD,LITELLM_POSTGRES_PASSWORD,OPENAI_API_KEY \
  -- docker compose --project-directory /Users/abhishektatikella/Documents/astack/services/pi-litellm \
  --env-file /dev/null up -d

docker ps --filter label=com.docker.compose.project=pi-litellm --format '{{.Names}} {{.Ports}} {{.Status}}'
```

If Doppler is authenticated in the service directory instead, run the same Doppler
command there and omit `--project-directory`. Do not copy a token into commands,
files or another scope just to start this unit.

`--no-fallback` disables Doppler's cached-file fallback. `--preserve-env=false`
ensures Doppler wins over same-named shell values. `--only-secrets` requires the
explicit names and prevents unrelated project secrets from reaching Docker.
`--env-file /dev/null` disables Compose's automatic `.env` loading; there is no
`env_file` entry. Compose passes only its explicit environment entries into each
container. Missing Doppler inputs fail before startup, even if legacy `.env` or
shell values exist. Do not bypass this command with bare `docker compose up`.

`LITELLM_PORT` is an optional nonsecret shell override (default 4000), not a
credential. Check Docker port metadata before reporting the live UI address.

For configuration edits, reuse the same Doppler command and replace `up -d` with
`config --quiet` for validation or `up -d --no-deps litellm` for a proxy-only
refresh. `restart` does not reload environment values. Coordinate with active
clients before recreating the proxy; never interrupt or replay accepted paid work.
Use the same command prefix with `stop` to stop without removing containers/data.
Never use `down -v` unless deletion of keys, users, catalog and spend is intended.

## Bootstrap and provider setup (operator-owned)

Open **http://127.0.0.1:4000/ui/** (`/ui` redirects there) and use the existing
Doppler bootstrap username/password. LiteLLM can fall back to the master key when
UI_PASSWORD is absent, so this Compose file requires an explicit password.

Create a database-backed proxy admin before optionally setting
`general_settings.disable_env_credential_login: true` in `config.yaml`.
Version 1.108.4 warns that enabling it too early locks out UI login; the master key
still works over the API for recovery. Recreate the proxy with the command above.
No bootstrap account changes are performed by startup or this migration.

The file catalog starts empty intentionally. Existing database-backed models load
on startup and refresh on the config-reload interval because
`general_settings.store_model_in_db: true` is set. `STORE_MODEL_IN_DB` is an
alternative, not an extra required variable. No provider env input was present at
the migration; existing encrypted database credentials remain in the same volume.

OpenAI now uses the explicit `OPENAI_API_KEY` Doppler input and proxy environment
entry. In the Admin UI, use `api_key: os.environ/OPENAI_API_KEY`; never paste the
provider secret into the browser or store it in a model entry. The GPT-6 Luna chat
mapping uses public name and underlying model `openai/gpt-6-luna`.
For another provider, add only its required name to both the command's
`--only-secrets` list and the proxy's explicit `environment` map, then recreate
only the proxy. Never forward all of Doppler or revive `env_file`.

Use real upstream model IDs and verified capabilities/prices. LiteLLM's built-in
cost map can miss custom API bases; unknown pricing can appear as zero spend.
Correct that with verified `model_info.pricing_provider` or explicit per-token rates.

## Per-person keys and Pi

Issue virtual keys through the Admin UI with a distinct user_id for each person.
Give each person that key, never the master key. Client-supplied request `user` is
spoofable; the persisted key user_id is the trustworthy attribution source.
Key/account creation is an explicit operator action, not a startup/readiness check.

Pi's native models.json custom provider needs no extension:

```json
{
  "providers": {
    "litellm": {
      "baseUrl": "http://127.0.0.1:4000/v1",
      "api": "openai-completions",
      "apiKey": "$LITELLM_API_KEY",
      "models": [{ "id": "chat-default", "name": "chat-default" }]
    }
  }
}
```

The alias must match a real LiteLLM model_name. Each client supplies its own
LITELLM_API_KEY; that is not a Compose input. Native model discovery is not a
models.json feature: refresh aliases manually and only specify context, output
capacity and costs when verified. ChatGPT/Codex subscription transport is not this
OpenAI-compatible API-key path.

## Verify without inference

```sh
curl --noproxy '*' -fsS --max-time 10 http://127.0.0.1:4000/health/readiness
curl --noproxy '*' -sS --max-time 10 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4000/ui/
```

Public readiness reports healthy/DB connected, or 503 if Postgres is unreachable.
UI HTTP 200 proves only the shell is reachable: not login, model availability,
pricing, usage accuracy or successful inference. Do not make model, report or
telemetry calls as startup verification. Failed authenticated-route probes can
create zero-spend failure rows; do not mistake those for successful traffic.

## Data, privacy and operations

Postgres holds virtual keys, users/teams, models and LiteLLM_SpendLogs.
`litellm_settings.turn_off_message_logging: true` configures request/response body
redaction for spend rows in this version. Successful-call privacy is not runtime
verified by this unit. This flag does not change what upstream providers see.
No Langfuse, Datadog or OTLP callback is configured by this unit.
Optional metadata filtering and disabling spend logs are left unapplied.

Spend and cost are estimates from real traffic and the cost map, not a provider
invoice. Empty usage before traffic is normal. OSS features include keys, teams,
budgets, rate limits, spend, Admin UI and Prometheus metrics; Enterprise-only SSO,
RBAC/orgs, audit logs, JWT request auth and some reports/guardrails are not claimed.
No rate limit, budget, token cap or retention policy is preset.

Backups contain sensitive database data. An operator may use the same Doppler
command prefix with `exec -T db pg_dump -U litellm litellm`, directing output to
secure storage outside the repository. Restore requires the unchanged encryption
salt. The legacy `.env` was removed after the unchanged-value migration; no
backup/export was made.

No cloud deployment, Redis, auth gateway, reverse proxy/TLS, Pi extension,
packaging or optional integration is part of this unit.
