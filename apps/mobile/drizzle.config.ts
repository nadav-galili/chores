import { defineConfig } from 'drizzle-kit';

/** Generates SQL into `drizzle/`; `scripts/bundle-migrations.ts` then inlines it for the app. */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
