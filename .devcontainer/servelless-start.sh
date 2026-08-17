#!/bin/bash
set -u
export PORT=3000
if [ -f package.json ]; then
  npm install --no-fund --no-audit >/dev/null 2>&1 || true
  (nohup npm start >/tmp/servelless-app.log 2>&1 &)
elif [ -f server.js ]; then
  (nohup node server.js >/tmp/servelless-app.log 2>&1 &)
elif [ -f app.py ]; then
  (nohup python3 -m flask run --host 0.0.0.0 --port "$PORT" --no-debugger --no-reload >/tmp/servelless-app.log 2>&1 &)
fi
exit 0
