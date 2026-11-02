# Alcove API. Build from the repo root: docker build -f apps/api/Dockerfile .
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @alcove/server... && pnpm --filter @alcove/server build

FROM node:24-slim
ENV NODE_ENV=production API_HOST=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/migrations ./migrations
USER node
EXPOSE 8080
# Cloud Run sets PORT; the API listens on API_PORT.
CMD ["sh", "-c", "API_PORT=${PORT:-8080} node --enable-source-maps dist/server.js"]
