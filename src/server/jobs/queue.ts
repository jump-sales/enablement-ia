/**
 * Fila de processamento assíncrono (pg-boss sobre o Postgres).
 * Os jobs carregam SOMENTE identificadores; o worker recarrega os dados dentro
 * do tenant (withTenant), com o mesmo RLS da aplicação.
 */
import { logger } from "@/lib/logger";

export const QUEUES = { evaluate: "evaluate-conversation" } as const;
export type EvaluateJob = { orgId: string; conversationId: string; evaluationId: string };

export interface JobQueue {
  enqueueEvaluation(job: EvaluateJob): Promise<void>;
}

type Boss = import("pg-boss").PgBoss;
const g = globalThis as unknown as { __jumpBoss?: Promise<Boss> };

export async function getBoss(): Promise<Boss> {
  if (!g.__jumpBoss) {
    g.__jumpBoss = (async () => {
      const { PgBoss } = await import("pg-boss");
      const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema: "pgboss" });
      boss.on("error", (err) => logger.error({ err: String(err) }, "pg-boss"));
      await boss.start();
      await boss.createQueue(QUEUES.evaluate, {
        retryLimit: 3,
        retryDelay: 30,
        retryBackoff: true,
        retryDelayMax: 600,
        expireInSeconds: 15 * 60,
      });
      return boss;
    })();
  }
  return g.__jumpBoss;
}

const pgBossQueue: JobQueue = {
  async enqueueEvaluation(job) {
    const boss = await getBoss();
    // singletonKey: o mesmo pedido de avaliação nunca vira dois jobs.
    await boss.send(QUEUES.evaluate, job, { singletonKey: job.evaluationId });
  },
};

let impl: JobQueue = pgBossQueue;
export const queue = (): JobQueue => impl;
export function setQueueForTesting(q: JobQueue | null) {
  impl = q ?? pgBossQueue;
}
