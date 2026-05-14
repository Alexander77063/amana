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
# Bundle backend + workspace packages; keep npm packages external (avoids dynamic-require issues)
RUN apps/backend/node_modules/.bin/esbuild apps/backend/src/index.ts \
    --bundle --platform=node --target=node20 \
    --outfile=apps/backend/dist/index.js \
    --format=esm \
    "--external:@aws-sdk/*" \
    "--external:@hono/*" \
    "--external:@sentry/*" \
    "--external:argon2" \
    "--external:drizzle-orm" \
    "--external:expo-server-sdk" \
    "--external:hono" \
    "--external:jose" \
    "--external:node-cron" \
    "--external:pino" \
    "--external:postgres" \
    "--external:zod"
RUN pnpm --filter @amana/backend deploy --prod --legacy /standalone
# dist/ is gitignored so pnpm deploy omits it; copy just the bundle
RUN mkdir -p /standalone/dist && cp apps/backend/dist/index.js /standalone/dist/index.js

# Stage 2 — runtime
FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=builder /standalone .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
