# Claude Saver

Local proxy for **[Claude Code CLI](https://code.claude.com/)** that sits between your machine and `api.anthropic.com`. It can **route requests across Haiku / Sonnet / Opus**, **cache** non-streaming responses, and (opt-in) **compress prompts** so you spend fewer tokens on repeat work.

**You still use Anthropic's normal billing** (API key or Pro/Max subscription). This app does not replace an API key or login — it only intermediates HTTP.

Default listen address: **`http://127.0.0.1:8766`**.

---

## Quickstart (≈ 30 seconds)

```bash
git clone https://github.com/cliclye/ClaudeSaver.git
cd ClaudeSaver
npm install
npm run claude        # starts the proxy if needed, launches `claude` through it
```

That's it. `npm run claude` auto-starts the proxy in the background, sets `ANTHROPIC_BASE_URL` for you, and execs `claude`. By default it runs in **subscription mode** (it strips `ANTHROPIC_API_KEY` so OAuth auth is used).

Running in two terminals is fine too:

```bash
# terminal 1
npm run dev

# terminal 2
npm run claude
```

To sanity-check the environment first:

```bash
npm run doctor
```

---

## Script reference

| Command | What it does |
|---------|--------------|
| `npm run claude` | Launches `claude` through the proxy. Starts the proxy in the background if not already running. Subscription mode by default. |
| `npm run claude -- --api-key` | Same, but keeps `ANTHROPIC_API_KEY` in the environment (Console / API-key mode). |
| `npm run claude -- <args>` | Any args after `--` are forwarded to `claude`. |
| `npm run dev` | Run the proxy in the foreground with hot reload. |
| `npm run build && npm start` | Production-style build + run. |
| `npm run setup` | Create `.env` from `.env.example` (optional — defaults work out of the box). |
| `npm run doctor` | Check Node version, port availability, `.env`, and whether `claude` is installed. |

---

## Manual setup (without the wrapper)

If you prefer to wire it up yourself:

1. Start the proxy: `npm run dev`
2. Point Claude Code at it in the **same shell where you run `claude`**:

   ```bash
   export ANTHROPIC_BASE_URL="http://127.0.0.1:8766"
   claude
   ```

### Path A — Console API key

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8766"
export ANTHROPIC_API_KEY="sk-ant-..."
claude
```

### Path B — Pro / Max / Team subscription

```bash
unset ANTHROPIC_API_KEY          # must not be set; subscription auth uses Bearer tokens
export ANTHROPIC_BASE_URL="http://127.0.0.1:8766"
claude
```

If you have never logged in to Claude Code, run `claude` once without the proxy and complete the browser login first.

To make these permanent, drop the exports in `~/.zshrc` or `~/.bashrc`. To temporarily bypass the proxy:

```bash
env -u ANTHROPIC_BASE_URL claude
```

---

## Configuration

`.env` next to `package.json` is loaded automatically (shell exports override it). All values are optional.

| Variable | Default | Role |
|----------|---------|------|
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `8766` | Listen port (must match `ANTHROPIC_BASE_URL`) |
| `ANTHROPIC_UPSTREAM_URL` | `https://api.anthropic.com` | Upstream API |
| `ANTHROPIC_API_KEY` | *(unset)* | Server-side API key injection for trusted setups only; leave unset for subscription users |
| `CLAUDE_SAVER_ENABLE_COMPRESSION` | *(unset)* | Set to `1` to enable prompt-text rewriting (off by default because it is lossy) |
| `CLAUDE_SAVER_SKIP_MODEL_ROUTING` | *(unset)* | Set to `1` to disable Haiku/Sonnet/Opus switching |
| `CHEAP_MODEL` | `claude-haiku-4-5-20251001` | Router: light requests |
| `SMART_MODEL` | `claude-sonnet-4-6` | Router: medium complexity |
| `PREMIUM_MODEL` | `claude-opus-4-7` | Router: heaviest prompts |
| `REDIS_URL` | *(unset)* | Shared cache; omit for in-memory LRU |
| `CACHE_TTL_SECONDS` | `86400` | Cache entry lifetime |
| `CACHE_MAX_ENTRIES` | `5000` | In-memory cache size cap |

Response header **`x-claude-saver-cache`** can be `HIT`, `MISS-STORED`, `SKIP`, `BYPASS-STREAM`, or `ERROR` for debugging.

---

## What the proxy does

- **`POST /v1/messages`**: optional compression → optional model routing → optional cache (not for streaming) → forward to Anthropic.
- **Other `/v1/...` routes**: forwarded as-is.
- **`GET /health`**: health check — returns `{ ok: true }`.

**Limitations:** streaming responses are not cached. There is no repo-wide context indexer here — only request-level optimizations.

---

## Security

- Bind to `127.0.0.1` unless you intend LAN access.
- Treat server `ANTHROPIC_API_KEY` like a secret — anyone who can reach the proxy could abuse it.

---

## Troubleshooting

Run `npm run doctor` first; it catches most issues.

| Problem | What to try |
|---------|-------------|
| `EADDRINUSE` on start | Another process is on port 8766. Set `PORT` in `.env` and match it in `ANTHROPIC_BASE_URL`. |
| Connection refused from `claude` | Proxy not running, or `ANTHROPIC_BASE_URL` host/port wrong. |
| Claude ignores the proxy | Run `echo $ANTHROPIC_BASE_URL` in the same shell as `claude`. |
| Auth errors after enabling proxy (subscription) | `unset ANTHROPIC_API_KEY`; remove `ANTHROPIC_API_KEY` from `.env`; check `/status` in Claude Code. |
| Wrong or unsupported model | Set `CLAUDE_SAVER_SKIP_MODEL_ROUTING=1` or adjust model env vars. |
| IDE vs CLI differs | Some IDE integrations ignore `ANTHROPIC_BASE_URL`; test with the CLI first. |

More detail: [Claude Code authentication](https://code.claude.com/docs/en/authentication), [environment variables](https://code.claude.com/docs/en/env-vars).
