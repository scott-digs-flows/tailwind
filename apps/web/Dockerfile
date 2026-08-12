ARG NODE_VERSION=24.19.0
ARG NGINX_VERSION=1.27-alpine

FROM node:${NODE_VERSION}-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @tailwind/web...
COPY apps/web apps/web
RUN pnpm --filter @tailwind/web build

# No Node in the runtime image: static assets only, served by nginx, which also
# proxies /api so the browser keeps ONE origin in prod as it does in dev.
FROM nginx:${NGINX_VERSION} AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
