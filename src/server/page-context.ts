import { redirect } from "next/navigation";
import { AppError, can, type Permission } from "./authz";
import { getRequestContext, type RequestContext } from "./context";

/** Para Server Components: resolve o contexto ou redireciona. */
export async function pageContext(required?: Permission): Promise<RequestContext> {
  let ctx: RequestContext;
  try {
    ctx = await getRequestContext();
  } catch (e) {
    if (e instanceof AppError && e.status === 401) redirect("/entrar");
    if (e instanceof AppError && e.code === "no_organization") redirect("/cadastro");
    throw e;
  }
  if (required && !can(ctx.role, required)) redirect("/painel");
  return ctx;
}
