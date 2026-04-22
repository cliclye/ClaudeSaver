# Claude Saver

Local proxy for the **[Claude Code CLI](https://code.claude.com/)** that sits between your machine and the Anthropic API. It can **route requests across cheaper/more expensive models**, **cache** non-streaming responses, and (opt-in) **compress prompts** so you spend fewer tokens on repeat work.

| Path | Forwarded to |
|------|--------------|
| `/v1/messages*` | `ANTHROPIC_UPSTREAM_URL` (default `https://api.anthropic.com`) |
| Other `/v1/*` | Same upstream, passed through unmodified |

**You still use Anthropic's normal billing** (API key or your Pro/Max subscription). This app does not replace API keys or logins — it only intermediates HTTP.

Default listen address: **`http://127.0.0.1:8766`**.

---

## Quickstart (≈ 30 seconds)

```bash
git clone https://github.com/cliclye/ClaudeSaver.git
cd ClaudeSaver
npm install

npm run claude        # Claude Code through the proxy
```

`npm run claude` auto-starts the proxy in the background, points Claude Code at it, and installs a **Claude Code status line** so you can see `● ClaudeSaver` is active at the bottom of the UI. It defaults to **subscription mode** (strips `ANTHROPIC_API_KEY`).

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
| `npm run claude` | Launches `claude` through the proxy. Starts/recycles the proxy as needed and installs the status line on first use. Subscription mode by default. |
| `npm run claude -- --api-key` | Same, but keeps `ANTHROPIC_API_KEY` in the environment (Console / API-key mode). |
| `npm run claude -- --no-statusline` | Skip the status-line auto-install. |
| `npm run claude -- --no-open` | Don't auto-open the web dashboard on first launch. |
| `npm run claude -- --no-title` | Don't update the terminal window title with savings. |
| `npm run claude -- <args>` | Any args after `--` are forwarded to `claude`. |
| `npm run dev` | Run the proxy in the foreground with hot reload. |
| `npm run build && npm start` | Production-style build + run. |
| `npm run setup` | Create `.env` from `.env.example` (optional — defaults work out of the box). |
| `npm run doctor` | Check Node version, port availability, `.env`, and whether `claude` is installed. |
| `npm run install-statusline` | Manually install the Claude Code status line (written to `~/.claude/settings.json`). |
| `npm run install-statusline -- --uninstall` | Remove the status line from Claude Code settings. |
| `npm run install-statusline -- --project` | Scope the status line to this repo only (`./.claude/settings.json`). |

---

## Manual setup (without the wrapper)

Start the proxy: `npm run dev`. Then point Claude Code at it in the **same shell where you run `claude`**:

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8766"
claude
```

### Path A — Claude Code with a Console API key

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

## Seeing that the proxy is active

Three places, no extra apps required.

### 1. Live web dashboard

Open `http://127.0.0.1:8766` in your browser (auto-opens once on first `npm run claude`). Auto-refreshes every 2s and shows:

- Total dollars saved + tokens saved
- Cache hits and hit rate
- Routed downgrades and routing savings
- Recent activity feed

### 2. Terminal window title

While `claude` is running, the terminal window title is updated every few seconds with:

```
● ClaudeSaver Claude · saved 12.3k tok · $0.42
```

Disable with `npm run claude -- --no-title` if your terminal doesn't like it.

### 3. Claude Code status line

`npm run claude` auto-installs a [Claude Code status line](https://code.claude.com/docs/en/statusline) into `~/.claude/settings.json`. At the bottom of the Claude Code UI you'll see:

```
● ClaudeSaver http://127.0.0.1:8766 · Opus 4.6 · 37% ctx · saved 12.3k tok ($0.42)
```

- Green dot: proxy reachable — requests are being optimized.
- Red dot + `offline`: proxy is down and the CLI is talking directly to the upstream.
- `saved 12.3k tok ($0.42)`: running total of tokens / dollars saved (cache hits + model downgrades). Persists across restarts in `.claude-saver-stats.json`.

Uninstall the Claude Code status line with `npm run install-statusline -- --uninstall`.

### How "saved" is calculated

| Source | What's counted |
|--------|---------------|
| **Cache hits** | When the proxy serves a cached response, the request never reaches Anthropic. We charge the avoided cost using the original model and the cached response's `usage` block. |
| **Model routing** | When the router downgrades a request (e.g. Opus → Sonnet → Haiku), we measure the actual `usage` returned and credit the **price difference** between the requested model and the chosen model. |

Pricing comes from a built-in table (Haiku $1/$5, Sonnet $3/$15, Opus $15/$75 per 1M tokens). Override with `PRICE_TABLE_JSON` in `.env`:

```bash
PRICE_TABLE_JSON='{"claude-haiku-4-5":{"in":1,"out":5},"claude-sonnet-4-6":{"in":3,"out":15},"claude-opus-4-7":{"in":15,"out":75}}'
```

Inspect or reset stats:

```bash
curl -s http://127.0.0.1:8766/stats         # full breakdown
curl -X POST http://127.0.0.1:8766/stats/reset
```

---

## Configuration

`.env` next to `package.json` is loaded automatically (shell exports override it). All values are optional.

| Variable | Default | Role |
|----------|---------|------|
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `8766` | Listen port (must match `ANTHROPIC_BASE_URL`) |
| `ANTHROPIC_UPSTREAM_URL` | `https://api.anthropic.com` | Anthropic upstream API |
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
- **Other `/v1/...` routes**: forwarded to Anthropic unchanged.
- **`GET /health`**: returns `{ ok: true, build: "..." }`.
- **`GET /stats`** & **`POST /stats/reset`**: cumulative savings.

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
| `Decompression error: ZlibError` in Claude Code | Fixed in recent versions — rebuild with `npm run build` (or just `npm run dev`) and relaunch. The proxy now requests `identity` encoding upstream and strips stale `content-encoding` headers. |
| Connection refused from `claude` | Proxy not running, or `ANTHROPIC_BASE_URL` host/port wrong. |
| Claude ignores the proxy | Run `echo $ANTHROPIC_BASE_URL` in the same shell as `claude`. |
| Auth errors after enabling proxy (subscription) | `unset ANTHROPIC_API_KEY`; remove `ANTHROPIC_API_KEY` from `.env`; check `/status` in Claude Code. |
| Wrong or unsupported model | Set `CLAUDE_SAVER_SKIP_MODEL_ROUTING=1` or adjust model env vars. |
| IDE vs CLI differs | Some IDE integrations ignore `ANTHROPIC_BASE_URL`; test with the CLI first. |

More detail: [Claude Code authentication](https://code.claude.com/docs/en/authentication), [environment variables](https://code.claude.com/docs/en/env-vars).
