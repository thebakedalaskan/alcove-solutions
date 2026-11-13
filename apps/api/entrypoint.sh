#!/bin/bash
# The image's entrypoint (apps/api/Dockerfile). Arguments, when there are any, run instead: `docker run <image> node
# dist/migrate-cli.js` works as it always has (Cloud Run's migration job replaces the entrypoint outright).
#
# Locally, in CI and on Cloud Run this is the API alone, as before: on API_PORT, which is Cloud Run's PORT or 8080.
#
# In Confidential Space the VM's environment names the Cloud SQL instance (CLOUDSQL_INSTANCE). Cloud SQL only takes
# connections that present its client certificates, so the Cloud SQL Auth Proxy runs beside the API as the VM's service
# account, on the Unix socket Cloud Run provided, /cloudsql/<instance>: DATABASE_URL is the same wherever the API runs.
# The proxy holds no keys. The database only holds ciphertext, and its password comes from Secret Manager.
#
# This script then stays as the container's first process: SIGTERM (Confidential Space gives 120 seconds) goes to the
# API, which drains and closes its connections while the proxy is still there, and the proxy stops after it. If the
# proxy stops first, the API is stopped too and the container exits non-zero, so the VM restarts (tee-restart-policy).
set -uo pipefail

if (($#)); then exec "$@"; fi

export API_PORT="${PORT:-8080}"
if [[ -z "${CLOUDSQL_INSTANCE:-}" ]]; then
  exec node --enable-source-maps dist/server.js
fi

log() { printf '{"severity":"%s","component":"entrypoint","msg":"%s"}\n' "$1" "$2" >&2; }

/app/bin/cloud-sql-proxy --unix-socket=/cloudsql --structured-logs "$CLOUDSQL_INSTANCE" &
proxy=$!
socket="/cloudsql/$CLOUDSQL_INSTANCE/.s.PGSQL.5432"
for ((tenths = 0; ; tenths++)); do
  [[ -S "$socket" ]] && break
  if ! kill -0 "$proxy" 2>/dev/null; then
    log ERROR "the Cloud SQL Auth Proxy stopped before its socket was ready"
    exit 1
  fi
  if ((tenths >= 600)); then
    log ERROR "the Cloud SQL Auth Proxy's socket wasn't ready after 60 seconds"
    kill -TERM "$proxy" 2>/dev/null
    exit 1
  fi
  sleep 0.1
done

node --enable-source-maps dist/server.js &
api=$!
trap 'kill -TERM "$api" 2>/dev/null' TERM INT

# wait returns early, above 128, when a trapped signal arrives (leaving ended unset); keep waiting until one of the two
# has really stopped.
while :; do
  ended=''
  wait -n -p ended "$api" "$proxy"
  status=$?
  [[ -n "${ended:-}" ]] && break
  if ((status <= 128)); then
    log ERROR "lost track of the API and the proxy (wait: $status)"
    kill -TERM "$api" "$proxy" 2>/dev/null
    exit 1
  fi
done
if [[ "$ended" == "$proxy" ]]; then
  log ERROR "the Cloud SQL Auth Proxy stopped (status $status); stopping the API"
  kill -TERM "$api" 2>/dev/null
  wait "$api"
  exit 1
fi
kill -TERM "$proxy" 2>/dev/null
wait "$proxy"
exit "$status"
