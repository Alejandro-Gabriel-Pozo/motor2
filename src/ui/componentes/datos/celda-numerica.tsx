import type { ReactNode } from "react";

/**
 * Celda de una tabla con un NÚMERO ya formateado (`core/formato-de-numero.ts`): alineada a la derecha (para que las comas decimales caigan una debajo de la otra),
 * con cifras de ancho fijo (`tabular-nums`) y sin partirse en dos renglones (el número y su unidad, «0,22 kg», quedan juntos). Regla del dueño, 2026-11-09. Es el
 * `<td>` de las tablas escritas a mano; `TablaDeDatos` y `TablaReporte` hacen lo mismo con las columnas `alinear: "derecha"`.
 */
export function CeldaNumerica({ children, encabezado = false }: { children: ReactNode; encabezado?: boolean }) {
  const Etiqueta = encabezado ? "th" : "td";
  return (
    <Etiqueta {...(encabezado ? { scope: "col" } : {})} className="pl-2 pr-4 text-right tabular-nums whitespace-nowrap">
      {children}
    </Etiqueta>
  );
}
