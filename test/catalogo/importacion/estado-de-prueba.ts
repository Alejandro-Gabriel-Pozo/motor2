import { deCentavos } from "../../../src/core/carta/public";
import type { EstadoDeLaBase, PermisosDelActor, ProductoExistente } from "../../../src/core/features/catalogo/importacion/estado";
import type { PlanDeProductos } from "../../../src/core/features/catalogo/importacion/planificar-productos";
import { LOCALES_DEL_IMPORTADOR, type LocalDelImportador } from "../../../src/core/features/catalogo/importacion/tipos";

/** El estado de una base «de papel» para las pruebas PURAS del planificador: las 5 sucursales, la unidad y las secciones de la ADENDA A.2. */
export const idDeSucursal = (local: LocalDelImportador) => `suc-${local.toLowerCase().replace(/\s+/g, "-")}`;
export const SECCIONES_DE_PRUEBA = ["Entrada", "Platos principales", "Clásicos", "Pastas caseras", "Pizzas", "Postres", "Bebidas"].map((nombre) => ({ id: `sec-${nombre}`, nombre, activa: true }));

export function estadoVacio(parcial: Partial<EstadoDeLaBase> = {}): EstadoDeLaBase {
  return {
    sucursales: Object.fromEntries(LOCALES_DEL_IMPORTADOR.map((l) => [l, { id: idDeSucursal(l), nombre: l, activa: true }])),
    unidadId: "unidad-1",
    secciones: SECCIONES_DE_PRUEBA,
    productos: [],
    ...parcial,
  };
}

export function permisosCompletos(parcial: Partial<PermisosDelActor> = {}): PermisosDelActor {
  return { altaProducto: true, camposSensibles: true, porLocal: Object.fromEntries(LOCALES_DEL_IMPORTADOR.map((l) => [l, { disponibilidad: true, carta: true }])), ...parcial };
}

/** Lo que dejaría en la base aplicar el plan de productos (los `CREAR`), para las propiedades de idempotencia. */
export function productosAplicados(plan: PlanDeProductos, unidadId: string): ProductoExistente[] {
  return plan.productos
    .filter((p) => p.accion === "CREAR")
    .map((p) => ({
      id: `id-${p.sku}`,
      codigo: p.sku,
      nombre: p.nombre,
      tipo: "PV",
      precioVenta: deCentavos(p.precio!.centavos),
      modoDeVenta: "DIRECTO",
      seProduce: false,
      factorConversion: "1",
      unidadStockId: unidadId,
      filasDeDisponibilidad: p.disponibilidad.map((d) => ({ sucursalId: d.sucursalId!, disponible: d.disponible })),
      preciosLocales: [],
      contenidos: [],
      agrupadoEn: [],
      esAnclaDeAdicional: false,
    }));
}
