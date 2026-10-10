# Environments

```
pnpm --filter <api|mobile> db:generate   # run after you edit the src/db/schema.ts of that workspace
scripts/deploy-api.sh                    # deploys apps/api with the commit of HEAD on it
scripts/check-deploy.sh                  # tells if the live API runs this commit (/health gives the sha)
```

## Local Postgres

Start it with `docker run -d --name chores-pg -p 5499:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=chores postgres:17-alpine`. Then run `createdb chores_test` in the container.

The container holds two databases:

- `chores` is the database of the dev server. `DATABASE_URL` in `apps/api/.env` names it.
- `chores_test` is the database of the tests. `TEST_DATABASE_URL` names it, and `apps/api/src/test/db.ts` uses it as the default.

The Tests rules in `CODING_STANDARDS.md` keep the two databases separate.

## Live API

https://mibokids.app/health

A healthy container does not tell you which build it runs. An API from before a milestone answers `/health` normally, but it gives a 404 for each route of that milestone. Nothing deploys automatically. Run `scripts/check-deploy.sh` before you trust a result from the live API.
