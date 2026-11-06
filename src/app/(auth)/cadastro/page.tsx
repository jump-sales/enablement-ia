"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { Alert, Button, Field, Input } from "@/components/ui";

const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

export default function SignupPage() {
  const router = useRouter();
  const session = authClient.useSession();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [company, setCompany] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const loggedIn = Boolean(session.data?.user);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    if (!loggedIn && f.get("password") !== f.get("password2")) return setError("As senhas não conferem.");
    if (!f.get("consent")) return setError("É preciso aceitar os termos para continuar.");
    setLoading(true);
    try {
      if (!loggedIn) {
        const { error } = await authClient.signUp.email({
          name: String(f.get("name")),
          email: String(f.get("email")),
          password: String(f.get("password")),
        });
        if (error) throw new Error(error.code === "USER_ALREADY_EXISTS" ? "Este e-mail já tem conta. Entre para continuar." : error.message ?? "Não foi possível criar a conta.");
      }
      await api("/organizations", { body: { name: company, slug } });
      router.replace("/painel");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div>
        <h1 className="text-xl font-semibold text-navy">Cadastrar empresa</h1>
        <p className="mt-1 text-sm text-muted">Você será o administrador e poderá convidar sua equipe.</p>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {!loggedIn && (
        <>
          <Field id="name" label="Seu nome">
            <Input id="name" name="name" autoComplete="name" required minLength={2} />
          </Field>
          <Field id="email" label="E-mail profissional">
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
          <Field id="password" label="Senha" hint="Mínimo de 10 caracteres.">
            <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
          </Field>
          <Field id="password2" label="Confirme a senha">
            <Input id="password2" name="password2" type="password" autoComplete="new-password" required minLength={10} />
          </Field>
        </>
      )}
      <Field id="company" label="Nome da empresa">
        <Input
          id="company"
          required
          value={company}
          onChange={(e) => {
            setCompany(e.target.value);
            if (!slugEdited) setSlug(slugify(e.target.value));
          }}
        />
      </Field>
      <Field id="slug" label="Identificador" hint="Usado em links internos. Letras minúsculas, números e hífens.">
        <Input id="slug" required value={slug} onChange={(e) => (setSlugEdited(true), setSlug(e.target.value))} />
      </Field>
      <label className="flex items-start gap-2 text-sm text-muted">
        <input type="checkbox" name="consent" className="mt-1" />
        <span>
          Declaro que a empresa possui base legal para gravar e analisar as conversas enviadas e que os participantes serão
          informados sobre a gravação e a análise.
        </span>
      </label>
      <Button type="submit" disabled={loading}>{loading ? "Criando…" : "Criar empresa"}</Button>
      <p className="text-center text-sm text-muted">
        Já tem conta? <Link className="font-medium text-navy underline" href="/entrar">Entrar</Link>
      </p>
    </form>
  );
}
