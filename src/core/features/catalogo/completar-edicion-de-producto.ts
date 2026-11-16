import type { EntradaEdicionProducto, EntradaProducto } from "@/core/features/catalogo/productos.schema";
import type { TipoProducto } from "@/core/datos/enumerados-del-esquema";

/**
 * EDICIÓN PARCIAL de un producto (decisión 0356 de Pedernal, 13/11/2026; el dueño pidió ser iguales a Pedernal en todo, 2026-11-13): al editar, un campo AUSENTE (`undefined`) NO se toca y conserva lo guardado;
 * `null` o vacío enviado a propósito SÍ lo borra. Antes `datosParaGuardar` convertía en null o false la categoría, el insumo, «se produce», la consignación y el proveedor de consignación cuando no venían (y el precio
 * de consignación en 0): una pantalla que olvidaba mandar uno lo borraba en silencio.
 *
 * Esta es la fuente única de qué hace la edición con cada campo que puede faltar. `TRATAMIENTO_DE_AUSENTE` tiene que declarar TODOS los campos de `EntradaEdicionProducto`: agregar uno al tipo sin declararlo acá no
 * compila (el guardián de tipos), y `test/catalogo/edicion-parcial-de-producto.test.ts` lo recorre contra su tabla escrita aparte. Lo que declara «COMPLETA» se completa con lo guardado ANTES de validar y de escribir,
 * así que `datosParaGuardar` (que sirve al alta y a la edición) recibe siempre una entrada entera y no decide nada por la ausencia.
 */
export type TratamientoDeAusente =
  /** Ausente = queda como estaba: se completa con lo guardado. `null` o vacío enviado = se borra. */
  | "COMPLETA"
  /** No se edita (el código y el tilde de sucursales son del alta): la edición lo ignora venga o no. */
  | "NO_SE_EDITA"
  /** No es un dato del producto sino un control del formulario (el valor que se veía): el caso de uso lo compara, no lo guarda. */
  | "CONTROL"
  /** Tiene su propia regla de «no viene = queda como estaba» dentro del caso de uso (clave fina, valor visto): no se completa acá. */
  | "LO_TRATA_EL_CASO_DE_USO";

export const TRATAMIENTO_DE_AUSENTE = {
  nombre: "COMPLETA",
  tipo: "COMPLETA",
  categoriaId: "COMPLETA",
  unidadCompraId: "COMPLETA",
  unidadStockId: "COMPLETA",
  factorConversion: "COMPLETA",
  observaciones: "COMPLETA",
  nombreDeCocina: "COMPLETA",
  insumoId: "COMPLETA",
  precioVenta: "COMPLETA",
  pasoVenta: "COMPLETA",
  seProduce: "COMPLETA",
  esConsignacion: "COMPLETA",
  proveedorConsignacionId: "COMPLETA",
  precioConsignacion: "COMPLETA",
  codigo: "NO_SE_EDITA",
  activoEnTodasLasSucursales: "NO_SE_EDITA",
  precioVentaVisto: "CONTROL",
  alicuotaVista: "CONTROL",
  modoDeVenta: "LO_TRATA_EL_CASO_DE_USO",
  alicuotaIvaVenta: "LO_TRATA_EL_CASO_DE_USO",
  alicuotaIvaCompra: "LO_TRATA_EL_CASO_DE_USO",
} as const satisfies Record<keyof EntradaEdicionProducto, TratamientoDeAusente>;

type CampoQueSeCompleta = { [K in keyof typeof TRATAMIENTO_DE_AUSENTE]: (typeof TRATAMIENTO_DE_AUSENTE)[K] extends "COMPLETA" ? K : never }[keyof typeof TRATAMIENTO_DE_AUSENTE];

/** Lo que la edición lee de la fila guardada del producto (los números de la base —Decimal— se leen con `Number`). */
export interface ProductoGuardado {
  nombre: string;
  tipo: TipoProducto;
  categoriaId: string | null;
  unidadCompraId: string | null;
  unidadStockId: string;
  factorConversion: unknown;
  observaciones: string | null;
  nombreDeCocina: string | null;
  insumoId: string | null;
  precioVenta: unknown;
  pasoVenta: unknown;
  seProduce: boolean;
  esConsignacion: boolean;
  proveedorConsignacionId: string | null;
  precioConsignacion: unknown;
}

const LO_GUARDADO: { [K in CampoQueSeCompleta]: (guardado: ProductoGuardado) => EntradaEdicionProducto[K] } = {
  nombre: (g) => g.nombre,
  tipo: (g) => g.tipo,
  categoriaId: (g) => g.categoriaId,
  unidadCompraId: (g) => g.unidadCompraId,
  unidadStockId: (g) => g.unidadStockId,
  factorConversion: (g) => Number(g.factorConversion),
  observaciones: (g) => g.observaciones,
  nombreDeCocina: (g) => g.nombreDeCocina,
  insumoId: (g) => g.insumoId,
  precioVenta: (g) => Number(g.precioVenta),
  pasoVenta: (g) => (g.pasoVenta === null || g.pasoVenta === undefined ? null : Number(g.pasoVenta)),
  seProduce: (g) => g.seProduce,
  esConsignacion: (g) => g.esConsignacion,
  proveedorConsignacionId: (g) => g.proveedorConsignacionId,
  precioConsignacion: (g) => Number(g.precioConsignacion ?? 0),
};

/**
 * La entrada que se valida y se guarda: lo pedido y, de cada campo ausente (`undefined`), lo guardado. `null` y vacío pasan tal cual (borran). `hayAusentes`: si algo se completó (la puerta del guard, que la Server Action
 * calculó con lo que mandó el cliente, hay que volver a calcularla con lo que de verdad se valida).
 */
export function completarEdicionConLoGuardado(pedidos: EntradaEdicionProducto, guardado: ProductoGuardado): { datos: EntradaProducto; hayAusentes: boolean } {
  const completado: Record<string, unknown> = { ...pedidos };
  let hayAusentes = false;
  for (const campo of Object.keys(LO_GUARDADO) as CampoQueSeCompleta[]) {
    if (pedidos[campo] !== undefined) continue;
    completado[campo] = LO_GUARDADO[campo](guardado);
    hayAusentes = true;
  }
  // Todo campo obligatorio de `EntradaProducto` (nombre, tipo, unidad de stock, factor) es «COMPLETA»: acá ya están todos.
  return { datos: completado as unknown as EntradaProducto, hayAusentes };
}
