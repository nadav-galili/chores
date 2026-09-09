---
status: accepted
---
# Hono + Drizzle on the API, Drizzle + expo-sqlite on the device

The deciding factor was the client: Drizzle runs on the phone via expo-sqlite, so the device's local database and the server share schema shapes and query style, and shared logic in `packages/shared` runs unchanged on both. Prisma cannot run on device, which would have meant a second hand-written data layer. Express + Prisma was the more familiar pair and was rejected for that reason only. WatermelonDB was rejected as a second sync model to learn on top of our own outbox.
