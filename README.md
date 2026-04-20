# Claude Saver

Local proxy for **[Claude Code CLI](https://code.claude.com/)** that sits between your machine and `api.anthropic.com`. It can **compress prompts**, **route requests across Haiku / Sonnet / Opus**, and **cache** non-streaming responses so you spend fewer tokens on repeat work.

**You still use Anthropic’s normal billing** (API key or Pro/Max subscription). This app does not replace an API key or login—it only intermediates HTTP.

---

## Setup overview

| Step | What you do |
|------|----------------|
| 1 | Install dependencies in this repo |
| 2 | *(Optional)* copy `.env.example` → `.env` and edit |
| 3 | Start the proxy (`npm run dev`) |
| 4 | Tell Claude Code to use the proxy (`ANTHROPIC_BASE_URL`) and pick **Path A** (API key) or **Path B** (subscription) |

Default listen address: **`http://127.0.0.1:8766`**.

---

## 1. Install

```bash
cd /path/to/ClaudeSaver
npm install
```

(Optional) create `.env` from the template:

```bash
npm run setup
```

or manually: `cp .env.example .env`. You can skip this until you need non-default ports or Redis.

**Requires:** Node.js 20+ (`node -v`).

---

## 2. Start the proxy

Development (reloads on file changes):

```bash
npm run dev
```

Production-style:

```bash
npm run build
npm start
```

The server loads **`.env` next to `package.json`** on startup ([`dotenv`](https://github.com/motdotla/dotenv)). Shell exports override `.env` values.

**Confirm it is running:**

```bash
curl -s http://127.0.0.1:8766/health
```

You should see `"ok": true`. If you changed `PORT` or `HOST` in `.env`, use that URL instead.

---

## 3. Point Claude Code at the proxy

Claude Code reads **`ANTHROPIC_BASE_URL`**. Set it to the proxy **origin only**—no path, no `/v1`:

```text
http://127.0.0.1:8766
```

If you changed the port in `.env`, match it here (example: `http://127.0.0.1:9000`).

Then choose **one** of the next two paths. They correspond to how you already use Claude Code **without** this proxy.

---

### Path A — Claude Console API key

Use this if you normally set `ANTHROPIC_API_KEY` and bill via the [Anthropic Console](https://platform.claude.com/).

1. Start the proxy (step 2).
2. In the **same terminal** where you run `claude`:

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8766"
export ANTHROPIC_API_KEY="sk-ant-..."   # your Console API key
claude
```

3. If something breaks, verify the proxy URL matches `HOST`/`PORT` from `.env`.

---

### Path B — Pro / Max / Team (subscription, no API key)

Use this if you **sign in with your Claude account** and do **not** use a Console API key.

1. **Remove** the API key from your environment so subscription auth is not overridden:

```bash
unset ANTHROPIC_API_KEY
echo "$ANTHROPIC_API_KEY"    # should be empty
```

2. **Log in** if you have not already: run `claude` once and complete browser login. (For headless/CI, see Anthropic’s [`claude setup-token`](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token) and `CLAUDE_CODE_OAUTH_TOKEN`.)
3. Start the proxy (step 2).
4. Point only the base URL at the proxy:

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8766"
claude
```

**Important for Path B**

- Do **not** put `ANTHROPIC_API_KEY` in this project’s **server** `.env` unless you know you need it—subscription traffic uses `Authorization: Bearer …`, and the proxy is written so a server-injected API key does not stomp Bearer auth.
- If changing models in the proxy causes errors on your plan, set in **server** `.env`:

```bash
CLAUDE_SAVER_SKIP_MODEL_ROUTING=1
```

That turns off automatic Haiku/Sonnet/Opus switching; prompt compression still runs.

---

## 4. Keep the settings (optional)

To avoid exporting every time, add to `~/.zshrc` or `~/.bashrc`:

**Path A (API key):**

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8766"
export ANTHROPIC_API_KEY="sk-ant-..."
```

**Path B (subscription):**

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8766"
# Do NOT export ANTHROPIC_API_KEY here
```

Then run `source ~/.zshrc` (or open a new terminal).

**Temporarily bypass the proxy** (talk to Anthropic directly):

```bash
env -u ANTHROPIC_BASE_URL claude
```

---

## Optional: Redis for a shared cache

By default the cache is **in-memory** (per proxy process). To share cache across processes, run Redis and set in **server** `.env` or shell:

```bash
REDIS_URL=redis://127.0.0.1:6379
```

---

## Environment variables (reference)

All are optional unless noted. Defaults match a local dev setup.

| Variable | Default | Role |
|----------|---------|------|
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `8766` | Listen port (must match what you put in `ANTHROPIC_BASE_URL`) |
| `ANTHROPIC_UPSTREAM_URL` | `https://api.anthropic.com` | Upstream API (rarely changed) |
| `ANTHROPIC_API_KEY` | *(unset)* | **Server-side** API key injection for trusted setups only; leave unset for Path B |
| `CHEAP_MODEL` | `claude-haiku-4-5-20251001` | Router: light requests |
| `SMART_MODEL` | `claude-sonnet-4-6` | Router: medium complexity |
| `PREMIUM_MODEL` | `claude-opus-4-7` | Router: heaviest prompts |
| `CLAUDE_SAVER_SKIP_MODEL_ROUTING` | *(unset)* | Set to `1` or `true` to disable model switching |
| `REDIS_URL` | *(unset)* | Shared cache; omit for in-memory LRU |
| `CACHE_TTL_SECONDS` | `86400` | Cache entry lifetime |
| `CACHE_MAX_ENTRIES` | `5000` | In-memory cache size cap |

Response header **`x-claude-saver-cache`** can be `HIT`, `MISS-STORED`, `SKIP`, `BYPASS-STREAM`, or `ERROR` for debugging.

---

## What the proxy does

- **`POST /v1/messages`**: optional compression → optional model routing → optional cache (not for streaming) → forward to Anthropic.
- **Other `/v1/...` routes**: forwarded as-is.
- **`GET /health`**: health check.

**Limitations:** streaming responses are not cached. There is no repo-wide context indexer here—only request-level optimizations.

---

## Security (short)

- Bind to `127.0.0.1` unless you intend LAN access.
- Treat server `ANTHROPIC_API_KEY` like a secret; anyone who can reach the proxy could abuse it.

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| Connection refused | Proxy not running, or `ANTHROPIC_BASE_URL` host/port wrong |
| Claude ignores the proxy | Same shell as `claude`; run `echo $ANTHROPIC_BASE_URL` |
| Auth errors after enabling proxy (Path B) | `unset ANTHROPIC_API_KEY`; remove server `ANTHROPIC_API_KEY` from `.env`; check `/status` in Claude Code |
| Wrong or unsupported model | Set `CLAUDE_SAVER_SKIP_MODEL_ROUTING=1` or adjust model env vars |
| IDE vs CLI differs | Some IDE integrations ignore `ANTHROPIC_BASE_URL`; test with the CLI first |

More detail: [Claude Code authentication](https://code.claude.com/docs/en/authentication), [environment variables](https://code.claude.com/docs/en/env-vars).
