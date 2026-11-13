# Alcove: the API, and the web app it serves in Confidential Space. Build from the repo root:
#   docker build -f apps/api/Dockerfile --build-arg ALCOVE_COMMIT=<sha> .
# infra/confidential-space/build.sh builds it for an environment, passing that environment's WEB_* arguments; without
# them the web app is built for local use. Base images are pinned by digest, downloads by checksum, and installs are
# frozen, so a commit always builds from the same inputs, and the image records its commit: what a confidential VM runs
# traces back to one commit (docs: privacy › Moving to confidential computing; infra/confidential-space/README.md).
FROM node:24-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS build
# Set by BuildKit for the platform being built (a default here would override it).
ARG TARGETARCH
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @alcove/server... && pnpm --filter @alcove/server build
# ffmpeg for shared screens' video (apps/api/src/ffmpeg.ts): ffmpeg-static's binary, pinned in apps/api/package.json and
# fetched by its install script (allowed in pnpm-workspace.yaml). The bundle can't find it in node_modules, so it's
# copied next to it and named in FFMPEG_PATH. Checked here so a build without it fails.
RUN cp "$(cd apps/api && node -p "require('ffmpeg-static')")" /repo/ffmpeg && /repo/ffmpeg -hide_banner -version > /dev/null
# The Cloud SQL Auth Proxy, which the entrypoint runs beside the API in Confidential Space (apps/api/entrypoint.sh).
ADD https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.26.3/cloud-sql-proxy.linux.${TARGETARCH} /repo/cloud-sql-proxy
RUN case "$TARGETARCH" in \
      amd64) sum=5533a05cdbf12f8a0cb46db34c775847a496e181d47f863284d3d02b0fad49fa ;; \
      arm64) sum=75273ebeba06cf82ed72726a662b89e6a886b72e7b507a4fcaade4703c4a0d2d ;; \
      *) echo "no Cloud SQL Auth Proxy for $TARGETARCH" >&2; exit 1 ;; \
    esac \
  && echo "$sum  /repo/cloud-sql-proxy" | sha256sum -c - && chmod 0755 /repo/cloud-sql-proxy

# The web app, built for the API it talks to. csp.mjs writes its Content-Security-Policy into dist/client/_headers, with
# that API's origin and LiveKit's host and the hashes of exactly this build's inline scripts; the API serves the files
# with those headers (WEB_DIR). The whole workspace is installed, as CI's build does: the client's MLS library finds
# @noble/hashes only where a full install hoists it. The build prerenders pages from a preview server on localhost, which
# the build sandbox resolves to ::1 for the server and 127.0.0.1 for the request unless IPv4 comes first.
FROM node:24-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS web
ARG WEB_API_URL=http://localhost:8787
ARG WEB_LIVEKIT_URL=ws://localhost:7880
ARG WEB_DEMO_AUTH_ENABLED=true
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile \
  && NODE_OPTIONS=--dns-result-order=ipv4first VITE_ALCOVE_API_URL="$WEB_API_URL" \
    VITE_ALCOVE_DEMO_AUTH_ENABLED="$WEB_DEMO_AUTH_ENABLED" pnpm --filter @alcove/web build \
  && node apps/web/scripts/csp.mjs apps/web/dist/client "$WEB_API_URL" "$WEB_LIVEKIT_URL"

FROM node:24-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
ARG ALCOVE_COMMIT=dev
# Not secret, and never may be: in Confidential Space every variable of the container's environment is in its attestation
# token's claims, which the launcher logs. Secrets come from Secret Manager at startup. HTTP_PORT and HTTPS_PORT are the
# ports EXPOSEd below, where the load balancer sends 80 and 443; they're used only when TLS_HOSTS is set.
ENV NODE_ENV=production API_HOST=0.0.0.0 ALCOVE_COMMIT=$ALCOVE_COMMIT FFMPEG_PATH=/app/bin/ffmpeg WEB_DIR=/app/web \
    HTTP_PORT=8080 HTTPS_PORT=8443
WORKDIR /app
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/migrations ./migrations
COPY --from=build /repo/ffmpeg ./bin/ffmpeg
COPY --from=build /repo/cloud-sql-proxy ./bin/cloud-sql-proxy
COPY --from=web /repo/apps/web/dist/client ./web
COPY apps/api/entrypoint.sh ./bin/entrypoint
RUN chmod 0755 ./bin/entrypoint && mkdir /cloudsql && chown node:node /cloudsql
# The Cloud SQL Auth Proxy (Go) verifies Google's TLS with the system's roots, which node:24-slim doesn't ship. Node's own
# bundled roots (Mozilla's, fixed by the pinned base image) become that store, so the image needs no package download.
RUN mkdir -p /etc/ssl/certs && node -e "process.stdout.write(require('node:tls').rootCertificates.join('\n') + '\n')" > /etc/ssl/certs/ca-certificates.crt
# Not root: the container shares the VM's network in Confidential Space, so it listens above 1024, where it needs no
# capabilities.
USER node
# Confidential Space opens only the ports an image exposes. Locally and on Cloud Run the API listens on 8080 (API_PORT).
EXPOSE 8080/tcp 8443/tcp
# Confidential Space's launch policy. The container's logs may go to Cloud Logging on the production image. The operator
# may set exactly these variables (tee-env-*), all names and flags, listed in infra/confidential-space/env.sh; the
# launcher refuses to start the image with any other, so deploy.sh checks the list before it rolls anything out.
LABEL "tee.launch_policy.log_redirect"="always"
LABEL "tee.launch_policy.allow_env_override"="TEE,GCP_PROJECT,KMS_MASTER_KEY,WIF_PROVIDER,SECRETS,LEGACY_SECRETS,RETIRE_LEGACY_KMASTER,CLOUDSQL_INSTANCE,TLS_HOSTS,ACME_DIRECTORY,CLOUDFLARE_ZONE,WEB_ORIGIN,API_URL,LIVEKIT_URL,OBJECTS_ENDPOINT,OBJECTS_BUCKET,GOOGLE_SIGNUP_MODE,DEMO_AUTH_ENABLED,NEAR_AI_BASE_URL,TREASURY_INTENTS_ACCOUNT,OPERATOR_TOKEN_SHA256,LOG_FORMAT,LOG_LEVEL"
ENTRYPOINT ["/app/bin/entrypoint"]
