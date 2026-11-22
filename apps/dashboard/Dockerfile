FROM node:20-alpine AS builder
WORKDIR /app

ARG VITE_WS_URL="ws://localhost:4001/ws"
ARG VITE_API_URL="http://localhost:4001"
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_API_URL=$VITE_API_URL

COPY package.json ./
COPY apps/dashboard/package.json ./apps/dashboard/

RUN npm install --workspace=apps/dashboard --ignore-scripts

COPY apps/dashboard ./apps/dashboard

RUN npm run build -w apps/dashboard

FROM nginx:alpine
COPY --from=builder /app/apps/dashboard/dist /usr/share/nginx/html
COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
