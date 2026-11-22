FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/gateway/package.json ./apps/gateway/

RUN npm install --ignore-scripts

COPY packages/shared ./packages/shared
COPY apps/gateway ./apps/gateway
COPY tsconfig.base.json ./

RUN npm run build -w packages/shared
RUN npm run build -w apps/gateway

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/gateway/dist ./dist
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
