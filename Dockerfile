# Single-container deploy for Railway / Render / any VPS.
# Runs both the FastAPI bridge (port 8787, internal) and the Next.js dashboard
# (port $PORT, public). Next.js proxies /api/* to the bridge via its server-side
# route handler.

FROM node:20-slim AS web-build
WORKDIR /web
COPY apps/web/package.json apps/web/package-lock.json* ./
RUN npm ci
COPY apps/web .
RUN npm run build

FROM python:3.11-slim AS final
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

# Node runtime for the Next.js standalone server.
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates gnupg tini \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

WORKDIR /app

# Bridge + vendored HERMÉS (HERMÉS install can take a while; cache aggressively).
COPY apps/bridge /app/apps/bridge
COPY vendor /app/vendor
RUN cd /app/apps/bridge && uv pip install --system -e . \
    && uv pip install --system -e /app/vendor/hermes-agent || \
       echo "WARN: hermes-agent install failed; CLI may not be available"

# Next.js standalone bundle.
COPY --from=web-build /web/.next/standalone /app/apps/web
COPY --from=web-build /web/.next/static /app/apps/web/.next/static
COPY --from=web-build /web/public /app/apps/web/public

COPY scripts/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Default to Railway's PORT contract; fall back to 3737 locally.
ENV PORT=3737 \
    HOSTNAME=0.0.0.0 \
    BRIDGE_URL=http://127.0.0.1:8787 \
    HERMES_HOME=/data/hermes \
    STAFFROOM_HOME=/data/staffroom

EXPOSE 3737
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8787/api/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/start.sh"]
