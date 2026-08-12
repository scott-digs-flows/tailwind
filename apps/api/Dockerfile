ARG NODE_VERSION=24.19.0

# The API runs from TypeScript source: Node 24 strips types natively, and the workspace
# packages export .ts directly (no build step, one resolution story). tsc stays as the
# typecheck gate in CI rather than doubling as a bundler.
FROM node:${NODE_VERSION}-alpine AS runtime
RUN corepack enable
WORKDIR /repo
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/spec/package.json packages/spec/
COPY packages/semantic/package.json packages/semantic/
RUN pnpm install --frozen-lockfile --prod --filter @tailwind/api...

# Source for the app and every workspace package it imports.
COPY apps/api apps/api
COPY packages/spec packages/spec
COPY packages/semantic packages/semantic

USER node
EXPOSE 3001
CMD ["node", "apps/api/src/server.ts"]
