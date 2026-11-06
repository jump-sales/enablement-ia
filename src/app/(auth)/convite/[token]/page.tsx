"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { Alert, Button, Field, Input, ROLE_LABEL } from "@/components/ui";

type Invite = { organizationName: string; email: string; role: string };

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const session = authClient.useSession();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<Invite>("/invitations/lookup", { body: { token } }).then(setInvite, (e) => setError(e.message));
  }, [token]);

  async function accept() {
    await api("/invitations/accept", { body: { token } });
    router.replace("/painel");
    router.refresh();
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!invite) return;
    setError(null);
    setLoading(true);
    const f = new FormData(e.currentTarget);
    try {
      if (!session.data?.user) {
        const r =
          mode === "signup"
            ? await authClient.signUp.email({ name: String(f.get("name")), email: invite.email, password: String(f.get("password")) })
            : await authClient.signIn.email({ email: invite.email, password: String(f.get("password")) });
        if (r.error) throw new Error(mode === "signup" ? "Não foi possível criar a conta. Se você já tem conta, escolha “Já tenho conta”." : "Senha incorreta.");
      }
      await accept();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado.");
    } finally {
      setLoading(false);
    }
  }

  if (error && !invite) return <Alert tone="error">{error}</Alert>;
  if (!invite) return <p className="text-sm text-muted">Carregando convite…</p>;

  const loggedAs = session.data?.user?.email;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-navy">Convite para {invite.organizationName}</h1>
        <p className="mt-1 text-sm text-muted">
          Acesso como <strong>{ROLE_LABEL[invite.role]}</strong> para <strong>{invite.email}</strong>.
        </p>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {loggedAs ? (
        loggedAs.toLowerCase() === invite.email.toLowerCase() ? (
          <Button type="submit" disabled={loading}>Aceitar convite</Button>
        ) : (
          <Alert tone="error">Você está conectado como {loggedAs}. Saia e entre com {invite.email} para aceitar.</Alert>
        )
      ) : (
        <>
          <div className="flex gap-2" role="tablist">
            <Button type="button" variant={mode === "signup" ? "primary" : "secondary"} onClick={() => setMode("signup")} aria-pressed={mode === "signup"}>
              Criar conta
            </Button>
            <Button type="button" variant={mode === "signin" ? "primary" : "secondary"} onClick={() => setMode("signin")} aria-pressed={mode === "signin"}>
              Já tenho conta
            </Button>
          </div>
          {mode === "signup" && (
            <Field id="name" label="Seu nome">
              <Input id="name" name="name" required minLength={2} autoComplete="name" />
            </Field>
          )}
          <Field id="password" label="Senha" hint={mode === "signup" ? "Mínimo de 10 caracteres." : undefined}>
            <Input id="password" name="password" type="password" required minLength={mode === "signup" ? 10 : 1} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
          </Field>
          <Button type="submit" disabled={loading}>{loading ? "Aguarde…" : "Entrar na empresa"}</Button>
        </>
      )}
    </form>
  );
}
