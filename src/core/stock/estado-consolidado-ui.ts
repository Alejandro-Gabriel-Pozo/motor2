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
  NEGATIVO: "text-red-600",
  CON_DESVIO: "text-amber-600",
  SIN_CONTEO: "text-neutral-500",
  SIN_MOVIMIENTOS: "text-neutral-400",
  CONCILIADO: "text-green-700",
};
