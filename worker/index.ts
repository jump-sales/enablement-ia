/**
 * Worker de processamento: consome a fila de avaliações.
 *   npm run worker
 * Cada job roda dentro do tenant da empresa (RLS), com retentativa e backoff.
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { logger } from "@/lib/logger";
import { runEvaluation, RetryableJobError } from "@/server/jobs/evaluate";
import { getBoss, queue, QUEUES, type EvaluateJob } from "@/server/jobs/queue";


/** Reenfileira avaliações "na fila" há mais de 10 min (ex.: queda entre commit e envio). */
async function sweep() {
  const r = await getDb().execute(sql`select * from app_stale_queued_evaluations(interval '10 minutes')`);
  for (const row of r.rows as { organization_id: string; conversation_id: string; evaluation_id: string }[]) {
    await queue().enqueueEvaluation({ orgId: row.organization_id, conversationId: row.conversation_id, evaluationId: row.evaluation_id });
  }
  if (r.rows.length) logger.info({ count: r.rows.length }, "avaliações reenfileiradas");
}

async function main() {
  const boss = await getBoss();
  await boss.work<EvaluateJob>(QUEUES.evaluate, { batchSize: 1 }, async ([job]) => {
    const started = Date.now();
    try {
      const status = await runEvaluation(job.data);
      logger.info({ evaluationId: job.data.evaluationId, status, ms: Date.now() - started }, "avaliação processada");
    } catch (e) {
      if (e instanceof RetryableJobError) logger.warn({ evaluationId: job.data.evaluationId, code: e.message }, "falha transitória; nova tentativa agendada");
      else logger.error({ evaluationId: job.data.evaluationId, err: String(e) }, "erro inesperado");
      throw e; // a fila aplica retentativa com backoff
    }
  });
  await sweep();
  setInterval(() => sweep().catch((e) => logger.error({ err: String(e) }, "varredura")), 5 * 60_000);
  logger.info("worker iniciado");
  const stop = async () => {
    logger.info("encerrando worker");
    await boss.stop({ graceful: true });
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((e) => {
  logger.error({ err: String(e) }, "falha ao iniciar o worker");
  process.exit(1);
});
