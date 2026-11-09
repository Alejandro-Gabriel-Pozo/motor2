import type { ReactNode } from "react";

/**
 * Barra de filtros (docs/diseno-estilo-de-planilla-2026-11-09.md): la banda PROPIA, con fondo suave y contorno, donde van los filtros encima de los datos, separada de la tabla. No filtra nada
 * ni sabe de filtros: aloja a `FiltrosDeLista` (u otro formulario GET) para que la pantalla no tenga los controles «pegados» a la tabla. Sin negocio ni estado; solo tokens y sin modo oscuro (DEC-04).
 */
export function BarraDeFiltros({ children }: { children: ReactNode }) {
  return <div data-barra-de-filtros="" className="rounded border border-borde bg-superficie-suave p-3">{children}</div>;
}
