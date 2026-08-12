ARG NODE_VERSION=24.19.0

FROM node:${NODE_VERSION}-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @tailwind/api...
COPY apps/api apps/api
RUN pnpm --filter @tailwind/api build

FROM node:${NODE_VERSION}-alpine AS runtime
RUN corepack enable
WORKDIR /repo
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod --filter @tailwind/api...
COPY --from=build /repo/apps/api/dist apps/api/dist
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/server.js"]
