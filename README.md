# Claude Saver

A local **Anthropic-compatible proxy** so tools like **Claude Code CLI** can keep using the normal SDK while you apply caching, routing, and prompt compression in one place.

## Prerequisites

- **Node.js 20+** (`node -v`)
- **Anthropic API key** (`sk-ant-...`) with Claude API access
- **Claude Code CLI** installed and working **without** the proxy first (so issues are easier to isolate)

## 1. Install the project

From the project root (`ClaudeSaver`):

```bash
cd /path/to/ClaudeSaver
npm install
```

## 2. Configure the proxy (optional)

Copy the example env file and edit it:

```bash
cp .env.example .env
```

### Variables the proxy reads

| Variable | Default | Purpose |
|----------|---------|---------|
| `HOST` | `127.0.0.1` | Address the server binds to |
| `PORT` | `8766` | Port the server listens on |
| `ANTHROPIC_UPSTREAM_URL` | `https://api.anthropic.com` | Where requests are forwarded (usually leave as-is) |
| `ANTHROPIC_API_KEY` | (unset) | If set, outgoing calls use this key instead of the client’s `x-api-key` (only on trusted machines) |
| `CHEAP_MODEL` | `claude-haiku-4-5-20251001` | **Haiku 4.5** — small / simple routed requests |
| `SMART_MODEL` | `claude-sonnet-4-6` | **Sonnet 4.6** — medium “complex” routed requests |
| `PREMIUM_MODEL` | `claude-opus-4-7` | **Opus 4.7** — largest / heaviest routed requests (see router heuristics) |
| `REDIS_URL` | (unset) | If set, shared cache uses Redis; otherwise in-memory LRU |
| `CACHE_TTL_SECONDS` | `86400` | How long entries live (seconds) |
| `CACHE_MAX_ENTRIES` | `5000` | Max entries for the in-memory cache |

### Loading `.env`

Node does not load `.env` automatically unless you use something like `dotenv`. This project reads **process env only**. Easiest options:

- Export variables in your shell before `npm run dev` / `npm start`, or
- Use a launcher that injects `.env` (e.g. `export $(grep -v '^#' .env | xargs)` — only if your `.env` has no spaces/special cases), or
- Add `dotenv` later if you want automatic `.env` loading.

## 3. Build and run

**Development** (TypeScript with reload):

```bash
npm run dev
```

**Production-style** (compiled JS):

```bash
npm run build
npm start
```

You should see logs that the server is listening on `http://127.0.0.1:8766` (or your `HOST`/`PORT`).

## 4. Health check

With the server running:

```bash
curl -s http://127.0.0.1:8766/health
```

Expected JSON includes `"ok": true` and `"service": "claude-saver"`.

## 5. Wire Claude Code CLI through the proxy

The CLI must send API traffic to the **proxy origin**, not to `api.anthropic.com` directly. That is done with **`ANTHROPIC_BASE_URL`**.

**One terminal session:**

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8766"
export ANTHROPIC_API_KEY="sk-ant-..."   # your real key
claude
```

**Important:**

- Use the **origin only**: `http://127.0.0.1:8766` — **no** `/v1` suffix.
- Port must match `PORT` (default `8766`).
- If the proxy runs on another machine, use that host/IP instead of `127.0.0.1`.

### Persist for every new shell (example: zsh)

Add to `~/.zshrc` (adjust host/port if needed):

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8766"
export ANTHROPIC_API_KEY="sk-ant-..."
```

Then `source ~/.zshrc` or open a new terminal.

### Bypass the proxy (talk to Anthropic directly)

```bash
env -u ANTHROPIC_BASE_URL claude
```

(or `unset ANTHROPIC_BASE_URL` in that shell)

## 6. Optional: Redis cache

Run Redis (example: `redis://127.0.0.1:6379`).

Set `REDIS_URL` in the environment for the proxy process, e.g.:

```bash
export REDIS_URL="redis://127.0.0.1:6379"
npm run dev
```

If `REDIS_URL` is unset, caching uses the in-memory LRU (not shared across processes).

## 7. What the proxy does (behavior)

- **`POST /v1/messages`**: prompt compression → routing (Haiku vs Sonnet vs Opus by heuristics) → cache lookup (only when `stream` is not `true`) → forwards to the upstream API.
- **Other** `GET`/`POST` `/v1/...`: passthrough to the same upstream.
- **`GET /health`**: health endpoint.

Check responses for header:

`x-claude-saver-cache`: `HIT` | `MISS-STORED` | `SKIP` | `BYPASS-STREAM` | `ERROR` (upstream error)

`BYPASS-STREAM`: streaming request; not cached in the current implementation.

## 8. Security notes

Prefer `ANTHROPIC_API_KEY` only on the **client** unless you fully trust the machine running the proxy.

If you set `ANTHROPIC_API_KEY` on the **server**, anyone who can reach the proxy could abuse it unless you also firewall / bind to localhost (`HOST=127.0.0.1`).

## 9. Limitations (current code)

- Streaming requests are not cached.
- Context pruning and diff-only workflows are not implemented inside this repo; they require trimming or rewriting messages before send (client-side or another service).

## 10. Troubleshooting

| Symptom | What to check |
|---------|----------------|
| `ECONNREFUSED` from CLI | Proxy not running, or wrong host/port in `ANTHROPIC_BASE_URL` |
| Still hitting Anthropic directly | `ANTHROPIC_BASE_URL` unset in the same shell that runs `claude`; confirm with `echo $ANTHROPIC_BASE_URL` |
| IDE extension ignores base URL | Some extensions do not respect `ANTHROPIC_BASE_URL`; validate with CLI first |
| Wrong model | Adjust `CHEAP_MODEL` / `SMART_MODEL` / `PREMIUM_MODEL` or routing logic in `src/core/router.ts` |

That is the full end-to-end path: install → configure → run proxy → set `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` → run `claude`, with optional Redis and cache tuning.
