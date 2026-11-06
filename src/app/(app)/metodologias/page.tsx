import { Card, PageHeader } from "@/components/ui";
import { pageContext } from "@/server/page-context";

export const metadata = { title: "Metodologias" };

export default async function Page() {
  await pageContext();
  return (
    <>
      <PageHeader title="Metodologias" description="Templates editáveis (SPIN, Challenger, Consultiva, Qualificação SDR, Discovery Closer), critérios, pesos e versões." />
      <Card>
        <p className="text-sm text-muted">Este módulo está em desenvolvimento na próxima etapa do MVP.</p>
      </Card>
    </>
  );
}
