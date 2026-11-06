/**
 * Marca textual neutra. NÃO recria a logomarca oficial da Jump Sales:
 * quando o arquivo oficial for fornecido, coloque-o em /public/brand/ e
 * substitua este componente por um <img>.
 */
export function Brand({ inverted = false }: { inverted?: boolean }) {
  return (
    <div className="leading-tight">
      <div className={inverted ? "text-sm font-semibold text-white" : "text-sm font-semibold text-navy"}>Sales Enablement AI</div>
      <div className={inverted ? "text-xs text-white/70" : "text-xs text-muted"}>Jump Sales</div>
    </div>
  );
}
