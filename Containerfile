FROM node:24-bookworm-slim AS build

WORKDIR /app
RUN apt-get update \
  && apt-get install --no-install-recommends -y python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY install ./install
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    LOOM_HOST=127.0.0.1 \
    LOOM_PORT=3000 \
    LOOM_CONFIG_DIR=/var/lib/loom/config \
    LOOM_SKILLS_DIR=/var/lib/loom/skills

COPY --from=build --chown=1000:1000 /app/node_modules ./node_modules
COPY --from=build --chown=1000:1000 /app/dist ./dist
COPY --from=build --chown=1000:1000 /app/package.json ./package.json
RUN mkdir -p /var/lib/loom/config \
  && chown 1000:1000 /var/lib/loom/config \
  && chmod 700 /var/lib/loom/config

USER 1000:1000
EXPOSE 3000
ENTRYPOINT ["node", "dist/src/server/index.js"]
