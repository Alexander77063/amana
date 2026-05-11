# Stage 1 — build
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/ packages/
COPY apps/backend/ apps/backend/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @amana/types build
RUN pnpm --filter @amana/validation build
RUN pnpm --filter @amana/backend build
RUN pnpm --filter @amana/backend deploy --prod --legacy /standalone

# Stage 2 — runtime
FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=builder /standalone .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
