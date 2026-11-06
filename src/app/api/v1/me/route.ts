import { can, PERMISSIONS, type Permission } from "@/server/authz";
import { listUserOrgs } from "@/server/context";
import { route } from "@/server/http";

export const GET = route(async (_req, ctx) => ({
  user: ctx.user,
  organization: ctx.org,
  role: ctx.role,
  jobTitle: ctx.jobTitle,
  permissions: (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(ctx.role, p)),
  organizations: await listUserOrgs(ctx.userId),
}));
