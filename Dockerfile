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

# 12-factor: configuration comes from the runtime environment, NOT a baked file.
# Provide DATABASE_URL / DATABASE_AUTH_TOKEN / ANTHROPIC_API_KEY (etc.) as deploy
# env vars on Manus / Fly / Render / Cloud Run. See DEPLOY.md and .env.example.
# Without a durable DATABASE_URL the app still boots (local file DB) but will not
# persist across container restarts.

# Run as a non-root user (least privilege).
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && chown -R nextjs:nodejs /app
USER nextjs

ENV HOSTNAME=0.0.0.0
EXPOSE 3000

# Container-native healthcheck hits the liveness/readiness probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
