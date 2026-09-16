FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter api... build

FROM base AS runtime
# `/health` reports this so a deploy can be told apart from the commit it was meant to be. Railway
# passes service variables to a Dockerfile build as build arguments, and `scripts/deploy-api.sh`
# sets `GIT_SHA` to the working tree's commit right before it uploads.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
EXPOSE 3000
CMD ["node", "dist/index.js"]
