import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, PageHeader } from "@/components/ui";
import { AppError, can } from "@/server/authz";
import { pageContext } from "@/server/page-context";
import { getRubricForEdit } from "@/server/services/methodologies";
import { RubricEditor } from "./editor";

export const metadata = { title: "Editar metodologia" };

export default async function EditRubricPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await pageContext("methodology.view");
  let data;
  try {
    data = await getRubricForEdit(ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.status === 400) notFound();
    throw e;
  }
  const manage = can(ctx.role, "methodology.manage");
  return (
    <>
      <PageHeader
        title={data.rubric.name}
        description="As alterações ficam em um rascunho. Ao publicar, ele vira a nova versão; as avaliações antigas continuam ligadas à versão com que foram feitas."
        actions={<Link href="/metodologias" className="text-sm text-navy underline">← Metodologias</Link>}
      />
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {data.versions.map((v) => (
          <Badge key={v.id} tone={v.status === "draft" ? "warning" : v.id === data.rubric.currentVersionId ? "success" : "neutral"}>
            v{v.version} · {v.status === "draft" ? "rascunho" : v.id === data.rubric.currentVersionId ? "vigente" : "arquivada"}
          </Badge>
        ))}
      </div>
      <RubricEditor rubricId={id} data={JSON.parse(JSON.stringify(data))} manage={manage} />
    </>
  );
}
