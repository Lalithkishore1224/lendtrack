#!/bin/bash
set -u
export PORT=3000
START_CMD='static site (serve index.html)'
LOG=/tmp/servelless-app.log

app_up() { curl -fsS -m 5 "http://127.0.0.1:$PORT/" >/dev/null 2>&1; }

# Try a candidate command; succeeds as soon as the port responds. Bails out
# early if the process exits without ever listening.
run_and_wait() {
  local cmd="$1"
  nohup bash -c "$cmd" > "$LOG" 2>&1 &
  local pid=$!
  for i in $(seq 1 20); do
    app_up && return 0
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 2
  done
  return 1
}

start_app() {
  if [ -n "$START_CMD" ]; then
    run_and_wait "$START_CMD" && return 0
  fi
  if [ -f package.json ]; then
    run_and_wait "npm start" && return 0
  fi
  for f in server.js index.js app.js main.js; do
    [ -f "$f" ] && run_and_wait "node $f" && return 0
  done
  if [ -f app.py ] || [ -f main.py ] || [ -f server.py ]; then
    for f in app.py main.py server.py; do
      [ -f "$f" ] && run_and_wait "python3 $f" && return 0
    done
  fi
  if [ -f index.html ]; then
    # No python guaranteed in the node image — use a tiny dependency-free
    # static file server so any plain HTML site just works.
    cat > /tmp/servelless-static.js <<'SERVEEOF'
const http = require("http");
const fs = require("fs");
const path = require("path");
const root = process.cwd();
const port = Number(process.env.PORT || 3000);
const types = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain",
  ".pdf": "application/pdf", ".woff2": "font/woff2", ".woff": "font/woff",
  ".ttf": "font/ttf", ".map": "application/json", ".xml": "application/xml"
};
http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || "/").split("?")[0]);
  if (p === "/") p = "/index.html";
  const fp = path.normalize(path.join(root, p));
  if (!fp.startsWith(root)) { res.writeHead(403); res.end("Forbidden"); return; }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(fp).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
}).listen(port, "0.0.0.0");
SERVEEOF
    run_and_wait "node /tmp/servelless-static.js" && return 0
  fi
  return 1
}

if ! start_app; then
  echo "servelless: app failed to start"
  exit 0
fi

# Publish a real public Cloudflare tunnel (same mechanism as Cloud Shell) so
# the app URL works for anyone with no GitHub auth. The URL is written back to
# the repo under .servelless/ where verification reads it via the GitHub API.
publish_tunnel() {
  local CF="$HOME/.servelless/cloudflared"
  mkdir -p "$HOME/.servelless"
  if [ ! -x "$CF" ]; then
    curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o "$CF" || return 1
    chmod +x "$CF"
  fi
  rm -f /tmp/servelless-tunnel.log
  nohup "$CF" tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate --logfile /tmp/servelless-tunnel.log >/dev/null 2>&1 &
  local url=""
  for i in $(seq 1 60); do
    url=$(grep -oE 'https://[a-z0-9-]+[.]trycloudflare[.]com' /tmp/servelless-tunnel.log 2>/dev/null | tail -1)
    [ -n "$url" ] && break
    sleep 2
  done
  [ -z "$url" ] && return 1
  local repo="${GITHUB_REPOSITORY:-}"
  local csname="${CODESPACE_NAME:-}"
  local token="${GH_TOKEN:-}"
  if [ -z "$repo" ] || [ -z "$csname" ] || [ -z "$token" ]; then
    echo "servelless: tunnel=$url (no repo credentials to publish)"
    return 0
  fi
  local payload
  payload=$(printf '{"url":"%s","port":%s,"updated":"%s"}' "$url" "$PORT" "$(date -u +%FT%TZ)")
  local sha=""
  local getres
  getres=$(curl -fsS -H "Authorization: Bearer $token" "https://api.github.com/repos/$repo/contents/.servelless/tunnel-$csname.json" 2>/dev/null || true)
  sha=$(printf '%s' "$getres" | grep -o '"sha":"[^"]*"' | head -1 | sed 's/"sha":"//;s/"//')
  local enc
  enc=$(printf '%s' "$payload" | base64 -w0)
  local body
  body=$(printf '{"message":"chore: update servelless tunnel","content":"%s","branch":"main"%s}' "$enc" "${sha:+, "sha": "$sha"}")
  curl -fsS -X PUT -H "Authorization: Bearer $token" "https://api.github.com/repos/$repo/contents/.servelless/tunnel-$csname.json" -d "$body" >/dev/null 2>&1 && echo "servelless: published $url"
}
publish_tunnel
