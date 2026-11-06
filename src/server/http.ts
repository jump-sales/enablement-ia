import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { logger } from "@/lib/logger";
import { AppError } from "./authz";
import { getRequestContext, type RequestContext } from "./context";

export type ApiError = { error: { code: string; message: string; details?: unknown } };

function errorResponse(e: unknown) {
  if (e instanceof AppError) {
    return NextResponse.json<ApiError>({ error: { code: e.code, message: e.message } }, { status: e.status });
  }
  if (e instanceof ZodError) {
    return NextResponse.json<ApiError>(
      { error: { code: "validation_error", message: e.issues[0]?.message ?? "Dados inválidos.", details: e.issues } },
      { status: 422 },
    );
  }
  logger.error({ err: e instanceof Error ? { message: e.message, stack: e.stack } : String(e) }, "erro não tratado");
  return NextResponse.json<ApiError>({ error: { code: "internal_error", message: "Erro interno. Tente novamente." } }, { status: 500 });
}

/** Defesa CSRF: mutações só aceitas da própria origem. */
function assertSameOrigin(req: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) {
    throw new AppError(403, "bad_origin", "Origem da requisição não permitida.");
  }
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError(400, "invalid_json", "Corpo da requisição inválido.");
  }
}

type Params = Promise<Record<string, string>>;

/** Rota autenticada (com organização ativa resolvida). */
export function route<P extends Params = Params>(
  fn: (req: Request, ctx: RequestContext, params: Awaited<P>) => Promise<unknown>,
) {
  return async (req: Request, { params }: { params: P }) => {
    try {
      assertSameOrigin(req);
      const ctx = await getRequestContext();
      const result = await fn(req, ctx, await params);
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Rota que não exige organização (ex.: cadastro, aceite de convite). */
export function publicRoute<P extends Params = Params>(fn: (req: Request, params: Awaited<P>) => Promise<unknown>) {
  return async (req: Request, { params }: { params: P }) => {
    try {
      assertSameOrigin(req);
      const result = await fn(req, await params);
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}
