import type { PlanDeCarta } from "./planificar-carta";
import type { PlanDeProductos } from "./planificar-productos";
import type { CatalogoNormalizado, ErrorDeImportacion } from "./tipos";

/**
 * Todos los ERRORES de una importación (I1: cualquiera la vuelve NO CONFIRMABLE): los del Excel y las correcciones (normalizador), los globales del plan (sucursales, unidad, permisos de
 * empresa), los de cada SKU y los de cada fila de la carta. Puro; el orden es el de esas cuatro fuentes.
 */
export function erroresDeLaImportacion(catalogo: CatalogoNormalizado, productos: PlanDeProductos, carta: PlanDeCarta): ErrorDeImportacion[] {
  return [
    ...catalogo.errores,
    ...productos.errores,
    ...productos.productos.flatMap((p) =>
      p.errores.map((e): ErrorDeImportacion => ({ hoja: "Catálogo", fila: p.fila, columna: null, valor: null, sku: p.sku, codigo: e.codigo, motivo: e.motivo })),
    ),
    ...carta.contenidos
      .filter((c) => c.accion === "ERROR")
      .map((c): ErrorDeImportacion => ({ hoja: "Precios por local", fila: c.fila, columna: null, valor: c.local, sku: c.sku, codigo: c.codigo ?? "ERROR", motivo: c.motivo })),
  ];
}

export interface ConteosDeLaImportacion {
  productos: Record<"CREAR" | "SIN_CAMBIOS" | "ERROR", number>;
  filasDeDisponibilidad: number;
  contenidos: Record<"CREAR" | "SIN_CAMBIOS" | "FUERA_DE_CARTA" | "NO_SE_EVALUA" | "ERROR", number>;
  /** Auditorías que escribiría la confirmación: una por producto nuevo y una por contenido nuevo. */
  auditorias: number;
  /** Con un precio por empresa, siempre 0 (A.1). */
  preciosLocales: 0;
}

/** Cuánto hay de cada acción (lo que muestra el «Resumen» de la vista previa). */
export function conteosDeLaImportacion(productos: PlanDeProductos, carta: PlanDeCarta): ConteosDeLaImportacion {
  const p = { CREAR: 0, SIN_CAMBIOS: 0, ERROR: 0 };
  for (const x of productos.productos) p[x.accion] += 1;
  const c = { CREAR: 0, SIN_CAMBIOS: 0, FUERA_DE_CARTA: 0, NO_SE_EVALUA: 0, ERROR: 0 };
  for (const x of carta.contenidos) c[x.accion] += 1;
  const filasDeDisponibilidad = productos.productos.filter((x) => x.accion === "CREAR").reduce((suma, x) => suma + x.disponibilidad.length, 0);
  return { productos: p, filasDeDisponibilidad, contenidos: c, auditorias: p.CREAR + c.CREAR, preciosLocales: 0 };
}
