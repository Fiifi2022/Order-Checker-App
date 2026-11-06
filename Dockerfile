FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY tsconfig.json vite.config.ts index.html server.ts firebase-applet-config.json ./
COPY scripts/ ./scripts/
COPY src/ ./src/
COPY shared/ ./shared/
COPY server/ ./server/
COPY extension/ ./extension/
COPY data/health-facilities-2026-10-19.csv ./data/health-facilities-2026-10-19.csv
# Direct Railway deployments must pass the same regression gates as CI.
# Build first so extension tests exercise the current generated shared engine.
RUN npm run verify:release && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/extension ./extension
COPY --from=build --chown=node:node /app/firebase-applet-config.json ./firebase-applet-config.json
USER node
EXPOSE 3000
CMD ["node", "dist/server.cjs"]
