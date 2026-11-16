import { texto, LARGO_MAXIMO_MOTIVO_ANULACION } from "@/core/texto";
import { validarDetalleLibreDeOperacion } from "@/core/movimientos/public";
import { validarFechaDeCompra } from "@/core/datos/fecha-operacion";
import { esClaveIdempotenciaValida, MENSAJE_CLAVE_DE_REINTENTO_INVALIDA } from "@/core/datos/clave-idempotencia";
import { guardComprobanteDeCompra } from "./compra.guard";
import { guardOrdenDeCompraDeLaCompra } from "./orden-de-compra.guard";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { LARGO_MAXIMO_DETALLE, MAXIMO_LINEAS_POR_OPERACION, validarTextoLibre, validarTopeDeLista } from "@/core/datos/limites";
import { esCondicionDePago, esMedioDePago, validarControlDeLinea } from "@/core/compras/public";
import { ZONA_ARGENTINA, diaDeCalendario, esDiaISOReal } from "@/core/tiempo/zona-horaria";
import type { ComandoAceptarParteDeFactura, ComandoAnularFacturaProveedor, ComandoAnularPagoDeFactura, ComandoConfirmarRecepcionDeFactura, ComandoCorregirFacturaProveedor, ComandoDeclararPagoDeFactura, ComandoRegistrarControlDeRecepcion, ControlDeLineaInput, DatosFacturaProveedorInput, EntradaDeRecepcionInput } from "./factura-proveedor.schema";

/**
 * E3a: guards de formato de los tres comandos de la factura de proveedor (docs/diseno-factura-de-proveedor-e3a-2026-10-27.md). Puros, sin base ni permisos: corren dentro de
 * `conPermiso`, antes del caso de uso. La clave de reintento es OBLIGATORIA en los tres (decisión 8 del dueño), con los textos de E1.
 */

/** Cuántas sucursales puede tener un reparto: un tope de pedido, no una regla de negocio. */
const MAXIMO_SUCURSALES_EN_UN_REPARTO = 50;

function claveObligatoria(clave: unknown): ResultadoDato<string> {
  if (clave === undefined || clave === null || clave === "") return rechazar("vacio", "Falta la clave de reintento: recargá la pantalla.");
  if (!esClaveIdempotenciaValida(clave)) return rechazar("formato", MENSAJE_CLAVE_DE_REINTENTO_INVALIDA);
  return aceptar(clave);
}

/**
 * «Cargar factura». `sucursalActivaId` es la sucursal de la sesión (la que compra): si tiene parte, hace falta la sección donde entra. El número de factura es OBLIGATORIO y estructurado (etapa 1 de Compras, I1:
 * letra, punto de venta y número, `guardComprobanteDeCompra`) y el comando sigue con el texto canónico «A-00023-00237728» (D10: sin número no hay unicidad y una factura repartida cargada dos veces duplicaría stock en varias sucursales).
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
  const detalle = validarDetalleLibreDeOperacion(e.detalleLibre);
  if (!detalle.ok) return rechazar(detalle.codigo, detalle.mensaje);
  const fecha = validarFechaDeCompra(e.fecha, ahora);
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

  const numero = guardComprobanteDeCompra(typeof e.nroFactura === "string" ? e.nroFactura : null);
  if (!numero.ok) return rechazar(numero.codigo, numero.mensaje);
  if (vistas.has(sucursalActivaId) && !texto(e.seccionId)) return rechazar("vacio", "Elegí la sección donde entra la parte de esta sucursal.");

  if (e.condicionPago !== undefined && !esCondicionDePago(e.condicionPago)) return rechazar("formato", "Elegí si la factura se pagó ahora o queda pendiente de pago.");

  const clave = claveObligatoria(e.claveIdempotencia);
  if (!clave.ok) return rechazar(clave.codigo, clave.mensaje);
  const orden = guardOrdenDeCompraDeLaCompra(e.ordenDeCompra, e.items.length);
  if (!orden.ok) return rechazar(orden.codigo, orden.mensaje);
  return aceptar({ ...(entrada as DatosFacturaProveedorInput), nroFactura: numero.valor, ...(orden.valor ? { ordenDeCompra: orden.valor } : {}) });
}

/** «Aceptar mi parte»: la parte, la sección y la fecha de stock (el rango contra la fecha de la factura lo mira el caso de uso, que la conoce). */
export function guardComandoAceptarParteDeFactura(entrada: unknown, ahora: Date): ResultadoDato<ComandoAceptarParteDeFactura> {
  const e = (entrada ?? {}) as Partial<Record<keyof ComandoAceptarParteDeFactura, unknown>>;
  if (!texto(e.propuestaId)) return rechazar("vacio", "No se encontró la parte de la factura.");
  if (!texto(e.seccionId)) return rechazar("vacio", "Elegí la sección donde entra la mercadería.");
  const fecha = validarFechaDeCompra(e.fechaStock, ahora);
  if (!fecha.ok) return rechazar(fecha.codigo, fecha.mensaje);
  const clave = claveObligatoria(e.claveIdempotencia);
  if (!clave.ok) return rechazar(clave.codigo, clave.mensaje);
  return aceptar(entrada as ComandoAceptarParteDeFactura);
}

/**
 * «Confirmar recepción» (Compras N3-a y N3-b): la factura, las entradas de stock y la fecha de stock (formato; el rango contra la fecha de la factura, las secciones y la suma exacta por renglón los mira el caso de uso, que conoce la factura).
 * Cada entrada es `{ renglonId, seccionId, cantidad }` con cantidad numérica (la precisión por producto la mira `validarEntradasDeRecepcion`). Sin clave de reintento: es idempotente por estado.
 */
export function guardComandoConfirmarRecepcionDeFactura(entrada: unknown, ahora: Date): ResultadoDato<ComandoConfirmarRecepcionDeFactura> {
  const e = (entrada ?? {}) as Partial<Record<keyof ComandoConfirmarRecepcionDeFactura, unknown>>;
  if (typeof e.facturaId !== "string" || !texto(e.facturaId)) return rechazar("vacio", "No se encontró la compra a recibir.");
  if (!Array.isArray(e.entradas) || e.entradas.length === 0) return rechazar("vacio", "Elegí la sección donde entra la mercadería.");
  const excede = validarTopeDeLista(e.entradas, "Las entradas", MAXIMO_LINEAS_POR_OPERACION);
  if (excede) return rechazar("rango", excede);
  const entradas: EntradaDeRecepcionInput[] = [];
  for (const crudo of e.entradas as unknown[]) {
    const x = (crudo ?? {}) as Partial<Record<keyof EntradaDeRecepcionInput, unknown>>;
    if (typeof x.renglonId !== "string" || !texto(x.renglonId)) return rechazar("vacio", "Hay una entrada sin renglón.");
    if (typeof x.seccionId !== "string" || !texto(x.seccionId)) return rechazar("vacio", "Elegí la sección donde entra la mercadería.");
    if (typeof x.cantidad !== "number" || !Number.isFinite(x.cantidad)) return rechazar("formato", "Cada cantidad tiene que ser un número.");
    entradas.push({ renglonId: texto(x.renglonId), seccionId: texto(x.seccionId), cantidad: x.cantidad });
  }
  const fecha = validarFechaDeCompra(e.fechaStock, ahora);
  if (!fecha.ok) return rechazar(fecha.codigo, fecha.mensaje);
  return aceptar({ facturaId: texto(e.facturaId), fechaStock: e.fechaStock as Date, entradas });
}

/**
 * «Registrar el control» (Compras N3-b): la factura y los controles de las líneas (formato: renglón, condición de la lista, observación y cantidad según remito por `validarControlDeLinea`; un renglón no se repite). Que el renglón sea de la compra, que
 * no tenga ya control y el estado de la parte los mira el caso de uso. Devuelve los controles ya normalizados (observación en su forma canónica).
 */
export function guardComandoRegistrarControlDeRecepcion(entrada: unknown): ResultadoDato<ComandoRegistrarControlDeRecepcion> {
  const e = (entrada ?? {}) as Partial<Record<keyof ComandoRegistrarControlDeRecepcion, unknown>>;
  if (typeof e.facturaId !== "string" || !texto(e.facturaId)) return rechazar("vacio", "No se encontró la compra a controlar.");
  if (!Array.isArray(e.controles) || e.controles.length === 0) return rechazar("vacio", "Indicá cómo llegó al menos una línea.");
  const excede = validarTopeDeLista(e.controles, "Los controles", MAXIMO_LINEAS_POR_OPERACION);
  if (excede) return rechazar("rango", excede);
  const vistos = new Set<string>();
  const controles: ControlDeLineaInput[] = [];
  for (const crudo of e.controles as unknown[]) {
    const x = (crudo ?? {}) as Partial<Record<keyof ControlDeLineaInput, unknown>>;
    if (typeof x.renglonId !== "string" || !texto(x.renglonId)) return rechazar("vacio", "Hay un control sin renglón.");
    const renglonId = texto(x.renglonId);
    if (vistos.has(renglonId)) return rechazar("formato", "Un renglón no puede tener dos controles.");
    vistos.add(renglonId);
    const c = validarControlDeLinea({ condicion: x.condicion, observacion: x.observacion, cantidadSegunRemito: x.cantidadSegunRemito });
    if (!c.ok) return rechazar("formato", c.mensaje);
    controles.push({ renglonId, condicion: c.valor.condicion, observacion: c.valor.observacion, cantidadSegunRemito: c.valor.cantidadSegunRemito });
  }
  return aceptar({ facturaId: texto(e.facturaId), controles });
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

/**
 * U1 «Corregir datos de la factura»: solo la factura. `nueva` y `esperado` pasan tal cual: los normaliza `normalizarCorreccion` (core/compras/correccion.ts) en el caso de uso, que ya tolera `null`/`undefined` en cada campo.
 * El formato del número y la regla «con proveedor» las valida `validarCorreccion` sobre lo que cambia (una factura vieja con texto libre no se traba por un campo que no se tocó).
 */
export function guardComandoCorregirFacturaProveedor(entrada: unknown): ResultadoDato<ComandoCorregirFacturaProveedor> {
  const e = (entrada ?? {}) as Partial<Record<keyof ComandoCorregirFacturaProveedor, unknown>>;
  if (typeof e.facturaId !== "string" || !texto(e.facturaId)) return rechazar("formato", "No se encontró la factura.");
  if (typeof e.nueva !== "object" || e.nueva === null || typeof e.esperado !== "object" || e.esperado === null) return rechazar("formato", "Faltan los datos a corregir: recargá la pantalla.");
  return aceptar({ facturaId: texto(e.facturaId), nueva: e.nueva as ComandoCorregirFacturaProveedor["nueva"], esperado: e.esperado as ComandoCorregirFacturaProveedor["esperado"] });
}

/**
 * Pagos X0 «Declarar pago»: la factura, el día del pago (texto `AAAA-MM-DD` real, no posterior a HOY en Argentina) y el medio (lista cerrada). El piso (no anterior al día de la factura) y el resto lo decide el caso de uso, que conoce la
 * factura. El «hoy» sale del reloj que pasa quien llama (el del servidor), nunca del cliente.
 */
export function guardComandoDeclararPagoDeFactura(entrada: unknown, ahora: Date): ResultadoDato<ComandoDeclararPagoDeFactura> {
  const e = (entrada ?? {}) as Partial<Record<keyof ComandoDeclararPagoDeFactura, unknown>>;
  if (!texto(e.facturaId)) return rechazar("vacio", "No se encontró la factura.");
  if (e.fechaPago === undefined || e.fechaPago === null || e.fechaPago === "") return rechazar("vacio", "Elegí la fecha en que se pagó.");
  if (!esDiaISOReal(e.fechaPago)) return rechazar("formato", "La fecha del pago no es válida.");
  if (e.fechaPago > diaDeCalendario(ahora, ZONA_ARGENTINA)) return rechazar("rango", "La fecha del pago no puede ser posterior a hoy.");
  if (!esMedioDePago(e.medio)) return rechazar("formato", "Elegí cómo se pagó.");
  const clave = claveObligatoria(e.claveIdempotencia);
  if (!clave.ok) return rechazar(clave.codigo, clave.mensaje);
  return aceptar({ facturaId: texto(e.facturaId), fechaPago: e.fechaPago, medio: e.medio, claveIdempotencia: clave.valor });
}

/** Pagos X0 «Anular pago declarado»: el pago y el motivo (obligatorio, 1 a 200 caracteres). */
export function guardComandoAnularPagoDeFactura(entrada: unknown): ResultadoDato<ComandoAnularPagoDeFactura> {
  const e = (entrada ?? {}) as Partial<Record<keyof ComandoAnularPagoDeFactura, unknown>>;
  if (!texto(e.pagoId)) return rechazar("vacio", "No se encontró el pago.");
  const motivo = validarTextoLibre(e.motivo, "El motivo", LARGO_MAXIMO_MOTIVO_ANULACION);
  if (!motivo.ok) return rechazar(motivo.codigo, motivo.mensaje);
  if (!motivo.valor) return rechazar("vacio", "Escribí el motivo de la anulación del pago.");
  const clave = claveObligatoria(e.claveIdempotencia);
  if (!clave.ok) return rechazar(clave.codigo, clave.mensaje);
  return aceptar({ pagoId: texto(e.pagoId), motivo: motivo.valor, claveIdempotencia: clave.valor });
}
