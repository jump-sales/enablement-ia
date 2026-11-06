import { Card, PageHeader } from "@/components/ui";
import { pageContext } from "@/server/page-context";

export const metadata = { title: "Conversas" };

export default async function Page() {
  await pageContext();
  return (
    <>
      <PageHeader title="Conversas" description="Upload de gravações, transcrição sincronizada, scorecard e revisão humana." />
      <Card>
        <p className="text-sm text-muted">Este módulo está em desenvolvimento na próxima etapa do MVP.</p>
      </Card>
    </>
  );
}
