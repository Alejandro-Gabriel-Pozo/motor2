import { texto } from "@/core/texto";
import { esDetalleReservadoParaReversiones } from "@/core/movimientos/public";
import { validarFechaOperacion } from "@/core/datos/fecha-operacion";
import { esClaveIdempotenciaValida } from "@/core/datos/clave-idempotencia";
import { validarNroFactura } from "@/core/datos/nro-factura";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { LARGO_MAXIMO_DETALLE, MAXIMO_LINEAS_POR_OPERACION, validarTextoLibre, validarTopeDeLista } from "@/core/datos/limites";
import type { ComandoAceptarParteDeFactura, ComandoAnularFacturaProveedor, DatosFacturaProveedorInput } from "./factura-proveedor.schema";

/**
 * E3a: guards de formato de los tres comandos de la factura de proveedor (docs/diseno-factura-de-proveedor-e3a-2026-10-27.md). Puros, sin base ni permisos: corren dentro de
 * `conPermiso`, antes del caso de uso. La clave de reintento es OBLIGATORIA en los tres (decisión 8 del dueño), con los textos de E1.
 */

/** Cuántas sucursales puede tener un reparto: un tope de pedido, no una regla de negocio. */
export const MAXIMO_SUCURSALES_EN_UN_REPARTO = 50;

/** El motivo de una anulación: 1 a 200 caracteres con al menos uno visible (el mismo largo que el motivo de anulación de la nota de crédito, ADR-029 §12). */
export const LARGO_MAXIMO_MOTIVO_ANULACION = 200;

function claveObligatoria(clave: unknown): ResultadoDato<string> {
  if (clave === undefined || clave === null || clave === "") return rechazar("vacio", "Falta la clave de reintento: recargá la pantalla.");
  if (!esClaveIdempotenciaValida(clave)) return rechazar("formato", "Clave de reintento inválida.");
  return aceptar(clave);
}

/**
 * «Cargar factura». `sucursalActivaId` es la sucursal de la sesión (la que compra): si tiene parte, hace falta la sección donde entra; y si alguna parte es de OTRA sucursal, el número de
 * factura es obligatorio (D10: sin número no hay unicidad y una factura repartida cargada dos veces duplicaría stock en varias sucursales).
 */
export function guardComandoRegistrarFacturaProveedor(entrada: unknown, ahora: Date, sucursalActivaId: string): ResultadoDato<DatosFacturaProveedorInput> {
  const e = (entrada ?? {}) as Partial<Record<keyof DatosFacturaProveedorInput, unknown>>;
  if (!texto(e.proveedorId)) return rechazar("vacio", "Elegí el proveedor de la factura.");
  if (!Array.isArray(e.items) || !e.items.length) return rechazar("vacio", "Cargá al menos un producto con cantidad.");
  const excedeLineas = validarTopeDeLista(e.items, "Las líneas", MAXIMO_LINEAS_POR_OPERACION);
  if (excedeLineas) return rechazar("rango", excedeLineas);
  for (const item of e.items) {
    if (!texto((item as { productoId?: unknown } | null)?.productoId)) return rechazar("vacio", "Hay una línea sin producto.");
    const referencia = validarTextoLibre((item as { referenciaProveedor?: unknown }).referenciaProveedor, "La referencia del proveedor", LARGO_MAXIMO_DETALLE);
    if (!referencia.ok) return rechazar(referencia.codigo, referencia.mensaje);
  }
  const detalle = validarTextoLibre(e.detalleLibre, "El detalle", LARGO_MAXIMO_DETALLE);
  if (!detalle.ok) return rechazar(detalle.codigo, detalle.mensaje);
  if (typeof e.detalleLibre === "string" && esDetalleReservadoParaReversiones(e.detalleLibre)) return rechazar("formato", "Ese detalle está reservado para las anulaciones: escribilo de otra forma.");
  const fecha = validarFechaOperacion(e.fecha, ahora);
  if (!fecha.ok) return rechazar(fecha.codigo, fecha.mensaje);

  const reparto = e.reparto as { modo?: unknown; partes?: unknown } | undefined;
  if (!reparto || (reparto.modo !== "IMPORTE" && reparto.modo !== "PORCENTAJE")) return rechazar("formato", "Elegí si el reparto va por importe o por porcentaje.");
  if (!Array.isArray(reparto.partes) || !reparto.partes.length) return rechazar("vacio", "Elegí al menos una sucursal.");
  const excedeSucursales = validarTopeDeLista(reparto.partes, "Las sucursales", MAXIMO_SUCURSALES_EN_UN_REPARTO);
  if (excedeSucursales) return rechazar("rango", excedeSucursales);
  const vistas = new Set<string>();
  for (const parte of reparto.partes as Array<{ sucursalId?: unknown; valor?: unknown } | null>) {
    const id = texto(parte?.sucursalId);
    if (!id) return rechazar("vacio", "Hay una sucursal del reparto sin elegir.");
    if (vistas.has(id)) return rechazar("formato", "Una sucursal aparece dos veces en el reparto.");
    vistas.add(id);
    if (typeof parte?.valor !== "number" || !Number.isFinite(parte.valor) || parte.valor <= 0) {
      return rechazar("cero", reparto.modo === "IMPORTE" ? "El importe de cada sucursal tiene que ser mayor que cero." : "El porcentaje de cada sucursal tiene que ser mayor que cero.");
    }
  }

  const numero = validarNroFactura(e.nroFactura);
  if (!numero.ok) return rechazar(numero.codigo, numero.mensaje);
  const hayParteAjena = [...vistas].some((id) => id !== sucursalActivaId);
  if (hayParteAjena && !numero.valor) return rechazar("vacio", "Para repartir una factura entre sucursales hace falta su número.");
  if (vistas.has(sucursalActivaId) && !texto(e.seccionId)) return rechazar("vacio", "Elegí la sección donde entra la parte de esta sucursal.");

  const clave = claveObligatoria(e.claveIdempotencia);
  if (!clave.ok) return rechazar(clave.codigo, clave.mensaje);
  return aceptar(entrada as DatosFacturaProveedorInput);
}

/** «Aceptar mi parte»: la parte, la sección y la fecha de stock (el rango contra la fecha de la factura lo mira el caso de uso, que la conoce). */
export function guardComandoAceptarParteDeFactura(entrada: unknown, ahora: Date): ResultadoDato<ComandoAceptarParteDeFactura> {
  const e = (entrada ?? {}) as Partial<Record<keyof ComandoAceptarParteDeFactura, unknown>>;
  if (!texto(e.propuestaId)) return rechazar("vacio", "No se encontró la parte de la factura.");
  if (!texto(e.seccionId)) return rechazar("vacio", "Elegí la sección donde entra la mercadería.");
  const fecha = validarFechaOperacion(e.fechaStock, ahora);
  if (!fecha.ok) return rechazar(fecha.codigo, fecha.mensaje);
  const clave = claveObligatoria(e.claveIdempotencia);
  if (!clave.ok) return rechazar(clave.codigo, clave.mensaje);
  return aceptar(entrada as ComandoAceptarParteDeFactura);
}

/** «Anular factura»: la factura y el motivo (obligatorio, 1 a 200 caracteres). */
export function guardComandoAnularFacturaProveedor(entrada: unknown): ResultadoDato<ComandoAnularFacturaProveedor> {
  const e = (entrada ?? {}) as Partial<Record<keyof ComandoAnularFacturaProveedor, unknown>>;
  if (!texto(e.facturaId)) return rechazar("vacio", "No se encontró la factura.");
  const motivo = validarTextoLibre(e.motivo, "El motivo", LARGO_MAXIMO_MOTIVO_ANULACION);
  if (!motivo.ok) return rechazar(motivo.codigo, motivo.mensaje);
  if (!motivo.valor) return rechazar("vacio", "Escribí el motivo de la anulación.");
  const clave = claveObligatoria(e.claveIdempotencia);
  if (!clave.ok) return rechazar(clave.codigo, clave.mensaje);
  return aceptar({ facturaId: texto(e.facturaId), motivo: motivo.valor, claveIdempotencia: clave.valor });
}
