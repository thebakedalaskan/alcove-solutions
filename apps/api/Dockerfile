# Alcove API. Build from the repo root: docker build -f apps/api/Dockerfile --build-arg ALCOVE_COMMIT=<sha> .
# Base images are pinned by digest and installs are frozen, so a commit always builds from the same inputs,
# and the image records its commit: what a confidential VM runs traces back to one commit
# (docs: privacy › Moving to confidential computing).
FROM node:24-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @alcove/server... && pnpm --filter @alcove/server build

FROM node:24-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
ARG ALCOVE_COMMIT=dev
ENV NODE_ENV=production API_HOST=0.0.0.0 ALCOVE_COMMIT=$ALCOVE_COMMIT
WORKDIR /app
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/migrations ./migrations
USER node
EXPOSE 8080
# Cloud Run sets PORT; the API listens on API_PORT.
CMD ["sh", "-c", "API_PORT=${PORT:-8080} node --enable-source-maps dist/server.js"]
