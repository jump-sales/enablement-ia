import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { __jumpPool?: Pool; __jumpDb?: Db };

/** Conexão de runtime (papel `jump_app`, sujeito a RLS). */
export function getDb(): Db {
  if (!globalForDb.__jumpDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL não definido");
    globalForDb.__jumpPool = new Pool({ connectionString: url, max: 10 });
    globalForDb.__jumpDb = drizzle(globalForDb.__jumpPool, { schema });
  }
  return globalForDb.__jumpDb;
}

export async function closeDb() {
  await globalForDb.__jumpPool?.end();
  globalForDb.__jumpPool = undefined;
  globalForDb.__jumpDb = undefined;
}

export { schema };
