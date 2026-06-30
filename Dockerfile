# ─────────────────────────────────────────────────────────────
# EAS Industrial Copilot — production image (Next.js standalone)
# Works on Manus, Fly, Render, Railway, Cloud Run, K8s, etc.
# ─────────────────────────────────────────────────────────────
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Standalone server + static assets (the only things needed at runtime).
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Baked deploy config (durable Turso DB). Runtime env vars still override this.
COPY --from=builder /app/.env ./.env

EXPOSE 3000
CMD ["node", "server.js"]
