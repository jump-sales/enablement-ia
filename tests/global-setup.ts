import { Client } from "pg";
import { runMigrations } from "../scripts/migrate";
import { TEST_OWNER_URL } from "./env";

/** Recria o banco de teste do zero e aplica todas as migrations. Nunca usa dados reais. */
export default async function setup() {
  const c = new Client({ connectionString: TEST_OWNER_URL });
  await c.connect();
  await c.query(`DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE;
                 CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO jump_app;`);
  await c.end();
  await runMigrations(TEST_OWNER_URL);
}
