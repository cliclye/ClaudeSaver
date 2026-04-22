/**
 * Single-file HTML dashboard served at GET /. Polls /stats every 2s.
 * No external dependencies — vanilla JS + a small bit of CSS.
 */
export function renderDashboard(opts: { origin: string; build: string }): string {
  const { origin, build } = opts;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Claude Saver — live</title>
  <style>
    :root {
      --bg: #0b0f17;
      --panel: #131a26;
      --panel-2: #1a2233;
      --border: #232b3d;
      --text: #e6ecf5;
      --muted: #8b96ad;
      --green: #4ade80;
      --green-dim: #16a34a;
      --amber: #fbbf24;
      --red: #f87171;
      --cyan: #38bdf8;
      --violet: #a78bfa;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #f6f8fb;
        --panel: #ffffff;
        --panel-2: #f0f3f8;
        --border: #e3e8ef;
        --text: #0b0f17;
        --muted: #525c70;
        --green: #16a34a;
      }
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Inter", "SF Pro Text", system-ui, sans-serif; }
    a { color: var(--cyan); text-decoration: none; }
    .wrap { max-width: 1100px; margin: 0 auto; padding: 32px 24px 64px; }
    header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 28px; }
    h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.01em; display: flex; align-items: center; gap: 10px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--green); box-shadow: 0 0 12px var(--green); display: inline-block; }
    .dot.offline { background: var(--red); box-shadow: 0 0 12px var(--red); }
    .meta { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
    .meta code { background: var(--panel-2); padding: 2px 6px; border-radius: 4px; font-size: 12px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 24px; }
    .card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; }
    .card .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px; }
    .card .big { font-size: 30px; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
    .card .sub { color: var(--muted); font-size: 12px; margin-top: 6px; font-variant-numeric: tabular-nums; }
    .big.usd { color: var(--green); }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 24px; }
    @media (max-width: 720px) { .row { grid-template-columns: 1fr; } }
    .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; }
    .panel h2 { margin: 0 0 12px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 500; }
    table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; font-size: 13px; }
    th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--border); }
    th { color: var(--muted); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 500; border: 1px solid var(--border); }
    .pill.cache { color: var(--cyan); border-color: rgba(56, 189, 248, 0.4); }
    .pill.routed { color: var(--violet); border-color: rgba(167, 139, 250, 0.4); }
    .empty { color: var(--muted); font-size: 13px; padding: 12px 0; text-align: center; }
    footer { color: var(--muted); font-size: 12px; margin-top: 28px; display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    button { background: var(--panel-2); color: var(--text); border: 1px solid var(--border); padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; }
    button:hover { border-color: var(--muted); }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1><span class="dot" id="dot"></span> Claude Saver</h1>
      <div class="meta">
        <code>${origin}</code>
        &middot; build <code>${build}</code>
        &middot; <span id="uptime">—</span>
        &middot; <button id="reset" title="POST /stats/reset">reset</button>
      </div>
    </header>

    <div class="grid">
      <div class="card">
        <div class="label">Total saved</div>
        <div class="big usd" id="total-usd">$0.00</div>
        <div class="sub" id="total-tokens">0 tokens</div>
      </div>
      <div class="card">
        <div class="label">Cache hits</div>
        <div class="big" id="cache-hits">0</div>
        <div class="sub" id="cache-rate">0% hit rate</div>
      </div>
      <div class="card">
        <div class="label">Routed downgrades</div>
        <div class="big" id="routed">0</div>
        <div class="sub" id="routed-usd">$0.00 saved by routing</div>
      </div>
      <div class="card">
        <div class="label">Total requests</div>
        <div class="big" id="reqs">0</div>
        <div class="sub" id="req-split">forwarded to Anthropic</div>
      </div>
    </div>

    <div class="row">
      <div class="panel" style="grid-column: 1 / -1;">
        <h2>Recent activity</h2>
        <div id="recent"></div>
      </div>
    </div>

    <footer>
      <span>Refreshes every 2s. <a href="/stats">/stats</a> &middot; <a href="/health">/health</a></span>
      <span>Set <code>ANTHROPIC_BASE_URL=${origin}</code> for Claude Code.</span>
    </footer>
  </div>

<script>
const $ = (id) => document.getElementById(id);

function fmtTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1e6) return (n/1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}
function fmtUsd(n) {
  if (!Number.isFinite(n) || n <= 0) return '$0.00';
  if (n >= 100) return '$' + n.toFixed(0);
  if (n >= 1) return '$' + n.toFixed(2);
  if (n >= 0.01) return '$' + n.toFixed(3);
  return '$' + n.toFixed(4);
}
function fmtUptime(ms) {
  const s = Math.max(0, Math.floor(ms/1000));
  const d = Math.floor(s/86400), h = Math.floor((s%86400)/3600), m = Math.floor((s%3600)/60);
  if (d) return d + 'd ' + h + 'h';
  if (h) return h + 'h ' + m + 'm';
  if (m) return m + 'm ' + (s%60) + 's';
  return s + 's';
}
function timeAgo(ms) {
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return sec + 's ago';
  if (sec < 3600) return Math.floor(sec/60) + 'm ago';
  if (sec < 86400) return Math.floor(sec/3600) + 'h ago';
  return Math.floor(sec/86400) + 'd ago';
}

async function tick() {
  let s;
  try {
    const r = await fetch('/stats', { cache: 'no-store' });
    if (!r.ok) throw new Error('bad status');
    s = await r.json();
    $('dot').classList.remove('offline');
  } catch (e) {
    $('dot').classList.add('offline');
    return;
  }
  $('total-usd').textContent = fmtUsd(s.totalUsdSaved);
  $('total-tokens').textContent = fmtTokens(s.totalTokensSaved) + ' tokens saved';
  $('cache-hits').textContent = s.cacheHits.toLocaleString();
  $('cache-rate').textContent = (s.cacheHitRate * 100).toFixed(1) + '% hit rate, ' + fmtUsd(s.cacheUsdSaved) + ' saved';
  $('routed').textContent = s.routedRequests.toLocaleString();
  $('routed-usd').textContent = fmtUsd(s.routingUsdSaved) + ' saved by routing';
  $('reqs').textContent = s.totalRequests.toLocaleString();
  $('req-split').textContent = 'forwarded to Anthropic';
  $('uptime').textContent = 'up ' + fmtUptime(Date.now() - s.startedAt);

  const r2 = $('recent');
  if (!s.recent || s.recent.length === 0) {
    r2.innerHTML = '<div class="empty">no activity yet — make a request through the proxy</div>';
  } else {
    r2.innerHTML = s.recent.map(e => {
      const kindCls = e.kind === 'cache-hit' ? 'cache' : 'routed';
      const kindName = e.kind === 'cache-hit' ? 'cache hit' : 'routed';
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">' +
        '<div style="display:flex;gap:8px;align-items:center;min-width:0;">' +
          '<span class="pill ' + kindCls + '">' + kindName + '</span>' +
          (e.note ? '<span style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + e.note + '</span>' : '') +
        '</div>' +
        '<div style="color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap;">' +
          fmtTokens(e.tokens) + ' tok &middot; ' + fmtUsd(e.usd) + ' &middot; ' + timeAgo(e.at) +
        '</div>' +
      '</div>';
    }).join('');
  }
}

document.getElementById('reset').addEventListener('click', async () => {
  if (!confirm('Reset all saved-stats counters to zero?')) return;
  await fetch('/stats/reset', { method: 'POST' });
  tick();
});

tick();
setInterval(tick, 2000);
</script>
</body>
</html>`;
}
