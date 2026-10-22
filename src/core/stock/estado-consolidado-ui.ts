import type { EstadoStockConsolidado } from "./consolidado";

/**
 * Única fuente de la humanización/color de EstadoStockConsolidado — antes
 * vivía solo en /stock/consolidado/page.tsx, así que otras pantallas que
 * también muestran este mismo estado (ej. Salud por producto) imprimían
 * el enum en crudo ("NEGATIVO", "CON_DESVIO") en vez de reusar esto.
 *
 * Separado de consolidado.ts a propósito: ese archivo importa `prisma`
 * (calcularStockConsolidado), y un Client Component (tabla-salud.tsx) que
 * importara algo de ahí arrastraría todo ese grafo — incluido `pg`/`dns` —
 * al bundle del browser. Acá solo hay un `import type` (se borra en
 * compilación), así que este archivo es 100% seguro para el cliente.
 */
export const ESTADO_STOCK_CONSOLIDADO_LABEL: Record<EstadoStockConsolidado, string> = {
  NEGATIVO: "Negativo (revisar)",
  CON_DESVIO: "Con desvío",
  SIN_CONTEO: "Sin conteo",
  SIN_MOVIMIENTOS: "Sin movimientos",
  CONCILIADO: "Conciliado",
};

export const ESTADO_STOCK_CONSOLIDADO_COLOR: Record<EstadoStockConsolidado, string> = {
  NEGATIVO: "text-error",
  CON_DESVIO: "text-aviso-tinta",
  SIN_CONTEO: "text-tinta-tenue",
  // Un gris más claro daba 2.58:1 sobre blanco (WCAG AA pide 4.5:1 para texto normal) — encontrado corriendo el proyecto
  // Playwright de la demo (§5, docs/planes-demo-y-claridad-reportes-2026-09-21.md, tramo 5) con datos reales: ninguna de
  // las dos pantallas que usan este estado (/stock/consolidado, /reportes/salud) tenía chequeo de axe hasta ahora.
  // `tinta-tenue` está medido en test/arquitectura/tokens-del-sistema-visual.test.ts (>= 4,5:1).
  SIN_MOVIMIENTOS: "text-tinta-tenue",
  CONCILIADO: "text-ok-tinta",
};
