# Build context is the repo root (fly.admin.toml sets the dockerfile path).
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/admin-portal/package.json apps/admin-portal/package.json
RUN pnpm install --frozen-lockfile --filter @amana/admin-portal...
COPY apps/admin-portal apps/admin-portal
RUN pnpm --filter @amana/admin-portal build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production PORT=3400 HOSTNAME=0.0.0.0
WORKDIR /app
# `output: 'standalone'` emits a self-contained server plus the minimal node_modules it needs.
# Next resolves the file-tracing root from the lockfile at /repo, so inside the standalone tree the
# server sits at its workspace path: apps/admin-portal/server.js.
COPY --from=builder /repo/apps/admin-portal/.next/standalone ./
COPY --from=builder /repo/apps/admin-portal/.next/static ./apps/admin-portal/.next/static
# There is no `public/` directory in this app — nothing is served statically outside .next, and a
# COPY of a missing path fails the build. Add the COPY back if one is ever introduced.
EXPOSE 3400
CMD ["node", "apps/admin-portal/server.js"]
