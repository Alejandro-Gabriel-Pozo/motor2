import { guardNroFacturaCompra } from "@/core/features/compras/compra.guard";

/**
 * Reglas de la CORRECCIÓN de una compra confirmada (K1b, docs/planes-implementacion-pendientes-2026-09-21.md §5). Módulo PURO: sin base de datos ni permisos.
 *
 * Qué se puede corregir: SOLO la cabecera de la compra —proveedor, N.º de factura y detalle libre—. NO las líneas: ni precios ni cantidades. Un precio mal
 * cargado se arregla anulando la compra y volviéndola a cargar (K1c). El motivo es que editar una línea obligaría a modificar el Kardex, que es append-only,
 * y cambiaría en forma retroactiva el costo de reposición, el margen real reconstruido y el gasto por insumo de períodos ya cerrados. Los dos estándares de
 * referencia (ERPNext y Dolibarr) tampoco dejan tocar proveedor, N.º de factura ni importes de un documento confirmado; esto es más laxo que ellos solo en la
 * cabecera, que no mueve stock ni plata.
 */

export const LARGO_MAXIMO_DETALLE_COMPRA = 200;

/** Los campos corregibles, tal como están guardados en la `Operacion` (null = sin dato). */
export interface CabeceraCompra {
  proveedorId: string | null;
  nroFactura: string | null;
  detalleLibre: string | null;
}

export type CampoCabecera = keyof CabeceraCompra;

export interface CambioDeCabecera {
  campo: CampoCabecera;
  anterior: string | null;
  nuevo: string | null;
}

/** Lo que llega del formulario: textos crudos; el proveedor vacío es «sin proveedor». */
export interface EntradaCorreccion {
  proveedorId: string | null | undefined;
  nroFactura: string | null | undefined;
  detalleLibre: string | null | undefined;
}

function textoOVacio(v: string | null | undefined): string | null {
  const t = String(v ?? "").trim();
  return t === "" ? null : t;
}

/** Recorta los espacios y convierte el vacío en `null`, igual que hace la carga de una compra (`texto(x) || null`). */
export function normalizarCorreccion(entrada: EntradaCorreccion): CabeceraCompra {
  return { proveedorId: textoOVacio(entrada.proveedorId), nroFactura: textoOVacio(entrada.nroFactura), detalleLibre: textoOVacio(entrada.detalleLibre) };
}

/** Los campos que cambian entre lo guardado y lo pedido, en un orden fijo (proveedor, factura, detalle). */
export function diferenciasDeCabecera(actual: CabeceraCompra, nueva: CabeceraCompra): CambioDeCabecera[] {
  const campos: CampoCabecera[] = ["proveedorId", "nroFactura", "detalleLibre"];
  return campos.filter((c) => actual[c] !== nueva[c]).map((c) => ({ campo: c, anterior: actual[c], nuevo: nueva[c] }));
}

/**
 * Valida SOLO lo que cambia: una compra vieja cuyo detalle superaba un largo que hoy se exige (la carga no lo limitaba) tiene que poder corregirse en otro
 * campo sin que el detalle, que no se tocó, la trabe.
 */
export function validarCorreccion(cambios: readonly CambioDeCabecera[]): string | null {
  for (const c of cambios) {
    if (c.campo === "nroFactura") {
      // Mismo validador que la carga de la compra (registrarMovimiento): largo y al menos una letra o número.
      const factura = guardNroFacturaCompra(c.nuevo);
      if (!factura.ok) return factura.mensaje;
    }
    if (c.campo === "detalleLibre" && c.nuevo && c.nuevo.length > LARGO_MAXIMO_DETALLE_COMPRA) return `El detalle no puede superar los ${LARGO_MAXIMO_DETALLE_COMPRA} caracteres.`;
  }
  return null;
}

/**
 * Guarda optimista: lo que la persona vio al abrir el formulario (`esperado`) tiene que ser lo que hoy está guardado. Si otra persona corrigió o anuló la
 * compra mientras tanto, no se pisa en silencio: se le avisa. Es el mismo patrón que el choque de versión de una receta.
 */
export function cabeceraCoincide(actual: CabeceraCompra, esperado: CabeceraCompra): boolean {
  return actual.proveedorId === esperado.proveedorId && actual.nroFactura === esperado.nroFactura && actual.detalleLibre === esperado.detalleLibre;
}

/** Los tres campos que forman la clave de «factura repetida» (con `sucursalId`): solo choca si hay proveedor y N.º de factura. */
export function clavesDeFactura(cabecera: CabeceraCompra): { proveedorId: string; nroFactura: string } | null {
  return cabecera.proveedorId && cabecera.nroFactura ? { proveedorId: cabecera.proveedorId, nroFactura: cabecera.nroFactura } : null;
}

const fechaCorta = (f: Date) => f.toISOString().slice(0, 10);

/** Mensaje de éxito de una corrección (Task #41, Fase M): texto EXACTO que armaba en línea la Server Action `corregirCompra`. */
export function mensajeCompraCorregida(cambios: readonly CambioDeCabecera[]): string {
  return `Compra corregida: ${cambios.map((c) => ETIQUETA_CAMPO[c.campo]).join(", ")}.`;
}

/**
 * Descripción de la fila de auditoría de UN campo corregido, con el texto EXACTO de antes. `nroFacturaAnterior` es el N.º que la compra
 * tenía ANTES de corregir (el que la identifica para quien lee el registro), no el nuevo.
 */
export function descripcionAuditoriaCorreccion(fecha: Date, nroFacturaAnterior: string | null, campo: CampoCabecera): string {
  return `Compra del ${fechaCorta(fecha)}${nroFacturaAnterior ? ` (factura ${nroFacturaAnterior})` : ""}: ${ETIQUETA_CAMPO[campo]}`;
}

export const ETIQUETA_CAMPO: Record<CampoCabecera, string> = {
  proveedorId: "proveedor",
  nroFactura: "N.º de factura",
  detalleLibre: "detalle",
};
