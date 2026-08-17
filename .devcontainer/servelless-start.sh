#!/bin/bash
set -u
export PORT=3000
START_CMD=''
LOG=/tmp/servelless-app.log
CF="$HOME/.servelless/cloudflared"

repo="${GITHUB_REPOSITORY:-}"
csname="${CODESPACE_NAME:-}"
token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"

# Write a status file back to the repo (.servelless/status-<cs>.json) so
# verification can report exactly what happened — even on silent failures.
report() {
  [ -n "$repo" ] || return 0
  [ -n "$csname" ] || return 0
  [ -n "$token" ] || return 0
  local ok="$1" msg="$2" url="$3"
  local payload enc sha getres body
  payload=$(printf '{"ok":%s,"message":"%s","url":"%s","port":%s,"updated":"%s"}'     "$ok" "$msg" "$url" "$PORT" "$(date -u +%FT%TZ)")
  enc=$(printf '%s' "$payload" | base64 -w0)
  getres=$(curl -fsS -H "Authorization: Bearer $token" "https://api.github.com/repos/$repo/contents/.servelless/status-$csname.json" 2>/dev/null || true)
  sha=$(printf '%s' "$getres" | grep -o '"sha":"[^"]*"' | head -1 | sed 's/"sha":"//;s/"//')
  body=$(printf '{"message":"servelless status","content":"%s","branch":"main"%s}' "$enc" "${sha:+, "sha": "$sha"}")
  curl -fsS -X PUT -H "Authorization: Bearer $token" "https://api.github.com/repos/$repo/contents/.servelless/status-$csname.json" -d "$body" >/dev/null 2>&1 || true
}

app_up() { curl -s -m 5 -o /dev/null "http://127.0.0.1:$PORT/"; }

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
  report false "app failed to start (see servelless-app.log)" ""
  echo "servelless: app failed to start"
  exit 0
fi

# Publish a real public Cloudflare tunnel (same mechanism as Cloud Shell) so
# the app URL works for anyone with no GitHub auth. The URL is written back to
# the repo under .servelless/ where verification reads it via the GitHub API.
publish_tunnel() {
  mkdir -p "$HOME/.servelless"
  if [ ! -x "$CF" ]; then
    curl -fsSL --retry 3 --connect-timeout 15       https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64       -o "$CF" || { report false "cloudflared download failed" ""; return 1; }
    chmod +x "$CF"
  fi
  for attempt in 1 2; do
    rm -f /tmp/servelless-tunnel.log
    if command -v setsid >/dev/null 2>&1; then
      setsid "$CF" tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate --logfile /tmp/servelless-tunnel.log >/dev/null 2>&1 &
    else
      nohup "$CF" tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate --logfile /tmp/servelless-tunnel.log >/dev/null 2>&1 &
    fi
    local url=""
    for i in $(seq 1 45); do
      url=$(grep -oE 'https://[a-z0-9-]+[.]trycloudflare[.]com' /tmp/servelless-tunnel.log 2>/dev/null | tail -1)
      [ -n "$url" ] && break
      sleep 2
    done
    if [ -n "$url" ]; then
      if [ -n "$repo" ] && [ -n "$csname" ] && [ -n "$token" ]; then
        local payload enc sha getres body
        payload=$(printf '{"url":"%s","port":%s,"updated":"%s"}' "$url" "$PORT" "$(date -u +%FT%TZ)")
        enc=$(printf '%s' "$payload" | base64 -w0)
        getres=$(curl -fsS -H "Authorization: Bearer $token" "https://api.github.com/repos/$repo/contents/.servelless/tunnel-$csname.json" 2>/dev/null || true)
        sha=$(printf '%s' "$getres" | grep -o '"sha":"[^"]*"' | head -1 | sed 's/"sha":"//;s/"//')
        body=$(printf '{"message":"chore: update servelless tunnel","content":"%s","branch":"main"%s}' "$enc" "${sha:+, "sha": "$sha"}")
        if curl -fsS -X PUT -H "Authorization: Bearer $token" "https://api.github.com/repos/$repo/contents/.servelless/tunnel-$csname.json" -d "$body" >/dev/null 2>&1; then
          report true "published tunnel" "$url"
          echo "servelless: published $url"
          return 0
        fi
        # Contents API failed (restricted token) — fall back to a git push, which
        # works in codespaces via the GITHUB_TOKEN credential helper.
        git config user.email "servelless@localhost" >/dev/null 2>&1
        git config user.name "servelless" >/dev/null 2>&1
        git fetch origin main --quiet >/dev/null 2>&1
        git checkout -B servelless-tunnel origin/main >/dev/null 2>&1
        printf '{"url":"%s","port":%s,"updated":"%s"}' "$url" "$PORT" "$(date -u +%FT%TZ)" > ".servelless/tunnel-$csname.json"
        git add -f ".servelless/tunnel-$csname.json" >/dev/null 2>&1
        git commit -m "chore: servelless tunnel" >/dev/null 2>&1
        if git push -f origin servelless-tunnel >/dev/null 2>&1; then
          report true "published tunnel (git)" "$url"
          echo "servelless: published $url"
          return 0
        fi
      fi
      report false "tunnel url obtained but could not publish to repo" "$url"
      return 1
    fi
    pkill -f cloudflared 2>/dev/null || true
    sleep 2
  done
  report false "cloudflared could not obtain a tunnel url" ""
  return 1
}
publish_tunnel

# Keep this script alive so the app and tunnel processes started above are
# never reaped when the postCreateCommand session ends. Every cycle: ensure the
# app is still up, and re-publish the tunnel if cloudflared has died.
while true; do
  if ! app_up; then
    start_app >/dev/null 2>&1 || true
    sleep 15
    continue
  fi
  if ! pgrep -f "cloudflared.*tunnel" >/dev/null 2>&1; then
    publish_tunnel >/dev/null 2>&1 || true
  fi
  sleep 25
done
