# Environments

```
pnpm --filter <api|mobile> db:generate                 # after you edit that workspace's src/db/schema.ts
scripts/deploy-api.sh                                  # deploy apps/api, stamped with HEAD's commit
scripts/check-deploy.sh                                # is the live API this commit? /health reports the sha
```

## Local Postgres

`docker run -d --name chores-pg -p 5499:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=chores postgres:17-alpine`, then `createdb chores_test` inside it.

Two databases on it. `chores` is the dev server's, named by `DATABASE_URL` in `apps/api/.env`. `chores_test` is the tests', named by `TEST_DATABASE_URL` and defaulted to in `apps/api/src/test/db.ts`. `CODING_STANDARDS.md` (Tests) keeps them two.

## Live API

https://mibokids.app/health

A container that boots and passes its healthcheck says nothing about *which* build is in it: an API deployed before a milestone landed answers `/health` normally and silently 404s the routes it has never heard of. Nothing deploys automatically — CI runs typecheck, lint, test and the asset check only — so run `scripts/check-deploy.sh` before trusting anything against the live API.
