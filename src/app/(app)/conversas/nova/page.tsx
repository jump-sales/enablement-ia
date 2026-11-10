import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { can } from "@/server/authz";
import { pageContext } from "@/server/page-context";
import { listMembers } from "@/server/services/members";
import { listRubrics } from "@/server/services/methodologies";
import { driveConfig } from "@/server/integrations/google-drive";
import { DriveImport } from "./drive-import";
import { UploadForm } from "./upload-form";

export const metadata = { title: "Enviar transcrição" };

export default async function NewConversationPage() {
  const ctx = await pageContext("conversation.upload");
  const forOthers = can(ctx.role, "conversation.upload_for_others");
  const sellers = forOthers
    ? (await listMembers(ctx)).filter((m) => m.status === "active").map((m) => ({ id: m.userId, name: m.name, jobTitle: m.jobTitle }))
    : [{ id: ctx.userId, name: ctx.user.name, jobTitle: ctx.jobTitle }];
  const drive = driveConfig();
  const rubrics = (await listRubrics(ctx)).filter((r) => r.version).map((r) => ({ id: r.id, name: r.name, appliesTo: r.appliesTo }));

  return (
    <>
      <PageHeader title="Enviar transcrição" description="Use a transcrição que o Meet, o Zoom ou o Teams já geram — não é preciso enviar o áudio." />
      {rubrics.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            Antes de enviar, é preciso configurar uma metodologia.{" "}
            <Link href="/metodologias" className="font-medium text-navy underline">Ir para Metodologias</Link>
          </p>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            {drive.enabled ? (
              <DriveImport config={{ clientId: drive.clientId, apiKey: drive.apiKey, appId: drive.appId }} sellers={sellers} rubrics={rubrics} defaultSeller={forOthers ? undefined : ctx.userId} />
            ) : (
              ctx.role === "org_admin" && (
                <Card title="Importar do Google Drive">
                  <p className="text-sm text-muted">A importação do Google Drive ainda não foi ativada nesta instalação. Fale com o suporte da Jump Sales.</p>
                </Card>
              )
            )}
            <UploadForm sellers={sellers} rubrics={rubrics} defaultSeller={forOthers ? undefined : ctx.userId} />
          </div>
          <Card title="Onde encontrar a transcrição">
            <ul className="flex flex-col gap-3 text-sm text-muted">
              <li><strong className="text-navy">Google Meet:</strong> o documento “Transcrição” é salvo no Google Drive do organizador (pasta “Meet Recordings”). Use “Escolher no Google Drive” ou baixe como .docx/.txt.</li>
              <li><strong className="text-navy">Zoom:</strong> nas gravações em nuvem, baixe o arquivo de transcrição (.vtt).</li>
              <li><strong className="text-navy">Teams:</strong> na reunião, em Transcrição, baixe como .vtt ou .docx.</li>
            </ul>
            <p className="mt-4 text-xs text-muted">Limite: 5 MB por arquivo e até 2 horas de conversa.</p>
          </Card>
        </div>
      )}
    </>
  );
}
