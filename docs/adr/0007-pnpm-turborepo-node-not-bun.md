---
status: accepted
---
# Monorepo on pnpm workspaces + Turborepo with Node 22 everywhere; not Bun

Layout is `apps/mobile` (Expo), `apps/api` (Hono, Docker on Railway) and `packages/shared`. Bun was considered as package manager and API runtime; rejected because Metro and EAS Build assume Node/pnpm, Bun's EAS support is second-class, and the speed gain is invisible at this size while adding a failure mode. Expo in a pnpm monorepo requires `node-linker=hoisted` in `.npmrc`.
