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
#
# With ALCOVE_JOB=checks the checks job runs in the API's place (dist/operator-job.js, for an API that won't start;
# infra/confidential-space/job.sh runs it on a VM of its own): every start step on its own, then the live checks, and it
# exits with the container. It never listens. The proxy runs beside it as beside the API, but a proxy that doesn't come up
# stops nothing: the job runs anyway, and its database step says how the database can't be reached.
set -uo pipefail

if (($#)); then exec "$@"; fi

log() { printf '{"severity":"%s","component":"entrypoint","msg":"%s"}\n' "$1" "$2" >&2; }

case "${ALCOVE_JOB:-}" in
  '') program=(dist/server.js) ;;
  checks) program=(dist/operator-job.js checks) ;;
  *)
    log ERROR "ALCOVE_JOB names a job this image doesn't have: the one it has is checks"
    exit 2
    ;;
esac

export API_PORT="${PORT:-8080}"
if [[ -z "${CLOUDSQL_INSTANCE:-}" ]]; then
  exec node --enable-source-maps "${program[@]}"
fi

/app/bin/cloud-sql-proxy --unix-socket=/cloudsql --structured-logs "$CLOUDSQL_INSTANCE" &
proxy=$!
socket="/cloudsql/$CLOUDSQL_INSTANCE/.s.PGSQL.5432"
why=''
for ((tenths = 0; ; tenths++)); do
  [[ -S "$socket" ]] && break
  if ! kill -0 "$proxy" 2>/dev/null; then
    why="the Cloud SQL Auth Proxy stopped before its socket was ready"
    break
  fi
  if ((tenths >= 600)); then
    why="the Cloud SQL Auth Proxy's socket wasn't ready after 60 seconds"
    break
  fi
  sleep 0.1
done
if [[ -n "$why" && -z "${ALCOVE_JOB:-}" ]]; then
  log ERROR "$why"
  kill -TERM "$proxy" 2>/dev/null
  exit 1
fi

if [[ -n "${ALCOVE_JOB:-}" ]]; then
  [[ -z "$why" ]] || log WARNING "$why; the job runs without it"
  node --enable-source-maps "${program[@]}" &
  job=$!
  trap 'kill -TERM "$job" 2>/dev/null' TERM INT
  # As below: wait returns early when a trapped signal arrives, so it waits again until the job has really stopped.
  while :; do
    ended=''
    wait -n -p ended "$job"
    status=$?
    [[ -n "${ended:-}" ]] && break
    if ((status <= 128)); then
      log ERROR "lost track of the job (wait: $status)"
      kill -TERM "$job" "$proxy" 2>/dev/null
      exit 1
    fi
  done
  kill -TERM "$proxy" 2>/dev/null
  wait "$proxy"
  exit "$status"
fi

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
