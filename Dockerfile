# --- Build stage --------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY scripts ./scripts
COPY src ./src
COPY frontend ./frontend
COPY docs ./docs
RUN npm run build

# --- Runtime stage --------------------------------------------------------------
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends wget && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY docs ./docs
RUN mkdir -p /data && chown node:node /data
EXPOSE 3000
VOLUME /data
USER node
CMD ["node", "dist/server/index.js"]
