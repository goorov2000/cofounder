FROM node:24.18.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig*.json ./
COPY src ./src
COPY shared ./shared
COPY server ./server
RUN npm run build && npm prune --omit=dev
FROM node:24.18.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/.data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
RUN mkdir -p .data && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["npm","start"]
