import pino from "pino";

/** Logs estruturados. Nunca registrar transcrições, e-mails de clientes ou tokens. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: { paths: ["*.password", "*.token", "*.accessToken", "accessToken", "*.authorization", "*.cookie", "*.text", "*.transcript"], censor: "[redigido]" },
  base: { service: process.env.SERVICE_NAME ?? "web" },
});
