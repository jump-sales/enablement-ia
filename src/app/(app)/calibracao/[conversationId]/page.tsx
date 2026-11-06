import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { pageContext } from "@/server/page-context";
import { getCalibrationForm } from "@/server/services/calibration";
import { getConversationDetail } from "@/server/services/conversations";
import { CalibrationForm } from "./form";

export const metadata = { title: "Calibrar conversa" };

export default async function CalibrateConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  const ctx = await pageContext("calibration.manage");
  const [form, detail] = await Promise.all([getCalibrationForm(ctx, conversationId), getConversationDetail(ctx, conversationId)]);
  const roleBy = new Map(detail.participants.map((p) => [p.speakerLabel, p.role]));
  return (
    <>
      <PageHeader
        title={`Calibrar: ${detail.conversation.title}`}
        description="Avalie como você avaliaria. A nota da IA fica oculta até você enviar, para não influenciar."
        actions={<Link href="/calibracao" className="text-sm text-navy underline">← Calibração</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <CalibrationForm conversationId={conversationId} form={form} />
        </div>
        <div className="lg:col-span-2">
          <section className="rounded-lg border border-line bg-white p-5 lg:sticky lg:top-6">
            <h2 className="mb-3 text-base font-semibold text-navy">Transcrição</h2>
            <ol className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto text-sm">
              {detail.segments.map((s) => (
                <li key={s.id}>
                  <div className="text-xs text-muted">
                    <span className={roleBy.get(s.speakerLabel ?? "") === "seller" ? "font-semibold text-navy" : ""}>{s.speakerLabel ?? "?"}</span>
                  </div>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </>
  );
}
