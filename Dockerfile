# syntax=docker/dockerfile:1

# ---- build: compile the API and the dashboard ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web/package.json web/package-lock.json web/
RUN npm --prefix web ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime: small, non-root image ----
FROM node:22-slim
ENV NODE_ENV=production \
    DATABASE_PATH=/app/data/radar.db \
    CONFIG_DIR=/app/config
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY --from=build /app/web/dist web/dist
COPY config config
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/cli.js", "serve"]
