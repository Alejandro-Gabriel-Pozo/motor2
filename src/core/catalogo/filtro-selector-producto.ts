import type { TipoProducto } from "@prisma/client";

/**
 * Filtro del combobox de producto (`<SelectorProducto>`) y de su fuente de datos, `buscarProductosSelector`
 * (`src/server/actions/catalogo/productos.ts`). Vive en `core/` y no junto a la Server Action porque también lo usa
 * `core/movimientos/ui-config.ts` (el filtro de producto de cada proceso): `core/` no importa de `server/actions/`
 * (regla `core-sin-capas-superiores` de `.dependency-cruiser.cjs`, ni siquiera un `import type`). La Server Action lo
 * importa de acá y NO lo reexporta: en un archivo `"use server"` todo lo exportado queda expuesto como endpoint, y el
 * analizador de guardas (`test/arquitectura/guardas/analizador.ts`) marca cualquier reexport como no reconocido.
 */
export interface FiltroSelectorProducto {
  tipo?: TipoProducto;
  /** Disponible EN LA SUCURSAL ACTIVA de quien busca (docs/plan-disponibilidad-por-sucursal-2026-09-23.md §5.2) — la sucursal se toma del contexto del servidor, NUNCA de un parámetro del cliente: si no, cualquiera podría mirar el catálogo disponible de otra sucursal. */
  soloDisponibles?: boolean;
  /** El equivalente "central" de `soloDisponibles`: disponible en ALGUNA sucursal (no importa cuál) — para catálogo compartido entre sucursales, como hermanar Insumos (§5.2, call-site 12). */
  soloDisponiblesEnAlguna?: boolean;
  /** MP, o PV solo si está marcado "Se produce" — mismo criterio que `tieneStockReal` (Conteo Físico, Stock consolidado). */
  soloConStockReal?: boolean;
  /** `producto.seProduce === true`, en MP o PV — quién puede ser el RESULTADO de una Producción (distinto de `soloConStockReal`: una MP comprada, no producida, tiene stock real pero no es válida acá). */
  soloSeProduce?: boolean;
  /** PV, o MP solo si está marcada "Se produce" — quién puede tener una Receta (`/catalogo/recetas`). Es el criterio inverso a `soloConStockReal`: ahí toda MP entra y el PV es la excepción, acá es al revés. */
  elegibleParaReceta?: boolean;
  /** true = solo productos en consignación (Devolución al consignante); false = excluirlos (Devolución a proveedor — nunca se "compró" algo en consignación). Sin definir = sin filtrar. */
  esConsignacion?: boolean;
}
