"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, JOB_LABEL, ROLE_LABEL, Select } from "@/components/ui";

type Member = { id: string; userId: string; name: string; email: string; role: string; jobTitle: string | null; teamId: string | null; teamName: string | null; status: string };
type Invitation = { id: string; email: string; role: string; jobTitle: string | null; expiresAt: string };
type Team = { id: string; name: string };

export function TeamManager({ canManage, currentUserId, members, invitations, teams }: { canManage: boolean; currentUserId: string; members: Member[]; invitations: Invitation[]; teams: Team[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado.");
    } finally {
      setBusy(false);
    }
  }

  async function onInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const role = String(f.get("role"));
    await run(async () => {
      const r = await api<{ inviteUrl: string }>("/invitations", {
        body: {
          email: f.get("email"),
          role,
          jobTitle: role === "rep" ? f.get("jobTitle") : role === "manager" ? "manager" : null,
          teamId: f.get("teamId") || null,
        },
      });
      setInviteUrl(r.inviteUrl);
      setCopied(false);
      form.reset();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <Alert tone="error">{error}</Alert>}

      {canManage && (
        <Card title="Convidar pessoa" description="O link é válido por 7 dias e só pode ser usado pelo e-mail convidado.">
          <form onSubmit={onInvite} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
            <div className="sm:col-span-2">
              <Field id="inv-email" label="E-mail">
                <Input id="inv-email" name="email" type="email" required />
              </Field>
            </div>
            <Field id="inv-role" label="Acesso">
              <Select id="inv-role" name="role" defaultValue="rep">
                <option value="rep">Vendedor</option>
                <option value="manager">Gestor</option>
                <option value="org_admin">Administrador</option>
              </Select>
            </Field>
            <Field id="inv-job" label="Função">
              <Select id="inv-job" name="jobTitle" defaultValue="sdr">
                <option value="sdr">SDR</option>
                <option value="closer">Closer</option>
                <option value="other">Outro</option>
              </Select>
            </Field>
            <Button type="submit" disabled={busy}>Gerar convite</Button>
            {teams.length > 0 && (
              <div className="sm:col-span-2">
                <Field id="inv-team" label="Time (opcional)">
                  <Select id="inv-team" name="teamId" defaultValue="">
                    <option value="">Sem time</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}
          </form>
          {inviteUrl && (
            <div className="mt-4 flex flex-col gap-2 rounded-md border border-line bg-surface p-3 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 truncate text-xs" title={inviteUrl}>{inviteUrl}</code>
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  await navigator.clipboard.writeText(inviteUrl);
                  setCopied(true);
                }}
              >
                {copied ? "Copiado" : "Copiar link"}
              </Button>
            </div>
          )}
        </Card>
      )}

      <Card title={`Pessoas (${members.length})`}>
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-5 py-2 font-medium">Nome</th>
                <th className="px-5 py-2 font-medium">Acesso</th>
                <th className="px-5 py-2 font-medium">Função</th>
                <th className="px-5 py-2 font-medium">Time</th>
                <th className="px-5 py-2 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-line last:border-0">
                  <td className="px-5 py-3">
                    <div className="font-medium text-navy">{m.name}</div>
                    <div className="text-xs text-muted">{m.email}</div>
                  </td>
                  <td className="px-5 py-3">
                    {canManage && m.userId !== currentUserId ? (
                      <Select
                        aria-label={`Acesso de ${m.name}`}
                        value={m.role}
                        disabled={busy}
                        onChange={(e) => run(() => api(`/members/${m.id}`, { method: "PATCH", body: { role: e.target.value } }))}
                      >
                        <option value="rep">Vendedor</option>
                        <option value="manager">Gestor</option>
                        <option value="org_admin">Administrador</option>
                      </Select>
                    ) : (
                      ROLE_LABEL[m.role]
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {canManage && m.role === "rep" ? (
                      <Select
                        aria-label={`Função de ${m.name}`}
                        value={m.jobTitle ?? "other"}
                        disabled={busy}
                        onChange={(e) => run(() => api(`/members/${m.id}`, { method: "PATCH", body: { jobTitle: e.target.value } }))}
                      >
                        <option value="sdr">SDR</option>
                        <option value="closer">Closer</option>
                        <option value="other">Outro</option>
                      </Select>
                    ) : (
                      (m.jobTitle && JOB_LABEL[m.jobTitle]) ?? "—"
                    )}
                  </td>
                  <td className="px-5 py-3">{m.teamName ?? "—"}</td>
                  <td className="px-5 py-3">
                    {m.status === "active" ? <Badge tone="success">Ativo</Badge> : <Badge>Desativado</Badge>}
                    {canManage && m.userId !== currentUserId && (
                      <button
                        className="ml-3 text-xs text-muted underline"
                        disabled={busy}
                        onClick={() =>
                          run(() => api(`/members/${m.id}`, { method: "PATCH", body: { status: m.status === "active" ? "disabled" : "active" } }))
                        }
                      >
                        {m.status === "active" ? "Desativar" : "Reativar"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {invitations.length > 0 && (
        <Card title="Convites pendentes">
          <ul className="divide-y divide-line text-sm">
            {invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {i.email} · {ROLE_LABEL[i.role]}
                  {i.jobTitle && i.role === "rep" ? ` (${JOB_LABEL[i.jobTitle]})` : ""}
                  <span className="ml-2 text-xs text-muted">expira em {new Date(i.expiresAt).toLocaleDateString("pt-BR")}</span>
                </span>
                {canManage && (
                  <Button variant="danger" disabled={busy} onClick={() => run(() => api(`/invitations/${i.id}`, { method: "DELETE" }))}>
                    Cancelar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {canManage && (
        <Card title="Times" description="Agrupe vendedores para comparar a evolução por time.">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const name = new FormData(form).get("name");
              run(async () => {
                await api("/teams", { body: { name } });
                form.reset();
              });
            }}
          >
            <Input name="name" placeholder="Ex.: Time SDR Inbound" aria-label="Nome do time" required minLength={2} />
            <Button type="submit" variant="secondary" disabled={busy}>Criar time</Button>
          </form>
          {teams.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {teams.map((t) => (
                <Badge key={t.id}>{t.name}</Badge>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
