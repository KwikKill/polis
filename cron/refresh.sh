#!/bin/sh
# Calls POST /api/cities/refresh (app/api/cities/refresh/route.ts) with no
# username, refreshing every published city's data from GitHub using each
# owner's own stored OAuth token. `polis` here is the app service's own
# container/service name, both containers sit on the same `polis` docker
# network (see docker-compose.yml), so no public hostname or TLS is needed.
set -eu

status=$(curl -sS -o /tmp/refresh-response.json -w '%{http_code}' \
  -X POST "http://polis:3000/api/cities/refresh" \
  -H "Authorization: Bearer ${REFRESH_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{}')

echo "[refresh] HTTP ${status} $(cat /tmp/refresh-response.json)"

if [ "$status" -ge 400 ]; then
  exit 1
fi
