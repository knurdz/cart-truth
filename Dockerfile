FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5173
ENV CARTTRUTH_SQLITE_PATH=/data/carttruth.db
ENV CARTTRUTH_SESSIONS_DIR=/data/sessions
ENV CARTTRUTH_RUNS_DIR=/data/runs

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    novnc \
    openbox \
    sqlite3 \
    websockify \
    x11vnc \
    xvfb \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json vitest.config.ts ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile \
  && pnpm exec playwright install --with-deps chromium

RUN mkdir -p /data

EXPOSE 5173

CMD ["pnpm", "web"]
