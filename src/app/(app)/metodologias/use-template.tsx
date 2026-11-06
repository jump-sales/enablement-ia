"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui";

export function UseTemplateButton({ template, disabled }: { template: string; disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="secondary"
        disabled={disabled || busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api("/methodologies", { body: { template } });
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Erro.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {disabled ? "Já adicionado" : busy ? "Adicionando…" : "Usar este modelo"}
      </Button>
      {error && <p className="mt-1 text-xs text-red-700" role="alert">{error}</p>}
    </>
  );
}
