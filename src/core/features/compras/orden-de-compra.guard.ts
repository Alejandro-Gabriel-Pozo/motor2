import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { esClaveIdempotenciaValida, MENSAJE_CLAVE_DE_REINTENTO_INVALIDA } from "@/core/datos/clave-idempotencia";
import { LARGO_MAXIMO_DE_ID, MAXIMO_LINEAS_POR_OPERACION, validarTopeDeLista } from "@/core/datos/limites";
import { esNivelDeControl, validarMotivoDeAnulacionDeOrden, MENSAJE_ORDEN_NO_ENCONTRADA } from "@/core/compras/public";
import { texto } from "@/core/texto";
import type { ComandoAnularOrdenDeCompra, ComandoConfigurarControlDeExceso, ComandoCrearOrdenDeCompra, ComandoDeOrdenDeCompra, OrdenDeCompraDeLaCompraInput } from "./orden-de-compra.schema";

/**
 * Compras, orden de compra: guards de FORMATO de los comandos. Puros, sin base ni permisos: corren dentro de `conPermisoDeEmpresa`, antes del caso de uso. Declaran lo que se PERMITE (todo lo demás se rechaza): ids de hasta 64 caracteres, la clave
 * de reintento en formato UUID, la lista de líneas con tope, y el motivo por la lista de permitidos de catálogo. Las reglas de negocio (cantidades, precios, fechas) las revisa `validarDatosDeOrden` dentro del caso de uso, con el «hoy» del servidor.
 */

const esIdValido = (v: unknown): v is string => typeof v === "string" && texto(v) !== "" && texto(v).length <= LARGO_MAXIMO_DE_ID;

/** «Crear la orden»: formato del proveedor, la sucursal opcional, la clave, el tope de líneas y de la forma de cada una (el contenido de cada línea lo valida la regla pura con el «hoy»). */
export function guardComandoCrearOrdenDeCompra(entrada: unknown): ResultadoDato<ComandoCrearOrdenDeCompra> {
  const e = (entrada ?? {}) as Partial<Record<keyof ComandoCrearOrdenDeCompra, unknown>>;
  if (!esIdValido(e.proveedorId)) return rechazar("vacio", "Elegí el proveedor de la orden.");
  if (e.sucursalId !== undefined && e.sucursalId !== null && e.sucursalId !== "" && !esIdValido(e.sucursalId)) return rechazar("formato", "La sucursal destino no es válida.");
  if (e.fechaDeEntregaPrevista !== undefined && e.fechaDeEntregaPrevista !== null && typeof e.fechaDeEntregaPrevista !== "string") return rechazar("formato", "La entrega prevista no es una fecha válida.");
  if (!Array.isArray(e.lineas) || e.lineas.length === 0) return rechazar("vacio", "Agregá al menos una línea con una cantidad mayor que cero.");
  const excede = validarTopeDeLista(e.lineas, "Las líneas", MAXIMO_LINEAS_POR_OPERACION);
  if (excede) return rechazar("rango", excede);
  if (e.claveIdempotencia === undefined || e.claveIdempotencia === null || e.claveIdempotencia === "") return rechazar("vacio", "Falta la clave de reintento: recargá la pantalla.");
  if (!esClaveIdempotenciaValida(e.claveIdempotencia)) return rechazar("formato", MENSAJE_CLAVE_DE_REINTENTO_INVALIDA);
  return aceptar({
    proveedorId: texto(e.proveedorId),
    sucursalId: typeof e.sucursalId === "string" && e.sucursalId !== "" ? texto(e.sucursalId) : null,
    fechaDeEntregaPrevista: typeof e.fechaDeEntregaPrevista === "string" && e.fechaDeEntregaPrevista !== "" ? e.fechaDeEntregaPrevista : null,
    lineas: e.lineas as ComandoCrearOrdenDeCompra["lineas"],
    claveIdempotencia: e.claveIdempotencia,
  });
}

/** Pedir y cerrar: solo la orden. */
export function guardComandoDeOrdenDeCompra(entrada: unknown): ResultadoDato<ComandoDeOrdenDeCompra> {
  const e = (entrada ?? {}) as Partial<Record<keyof ComandoDeOrdenDeCompra, unknown>>;
  if (!esIdValido(e.ordenId)) return rechazar("vacio", MENSAJE_ORDEN_NO_ENCONTRADA);
  return aceptar({ ordenId: texto(e.ordenId) });
}

/** Anular: la orden y el motivo (obligatorio, lista de permitidos, hasta 500; viaja en su forma canónica). */
export function guardComandoAnularOrdenDeCompra(entrada: unknown): ResultadoDato<ComandoAnularOrdenDeCompra> {
  const e = (entrada ?? {}) as Partial<Record<keyof ComandoAnularOrdenDeCompra, unknown>>;
  if (!esIdValido(e.ordenId)) return rechazar("vacio", MENSAJE_ORDEN_NO_ENCONTRADA);
  const m = validarMotivoDeAnulacionDeOrden(e.motivo);
  if (!m.ok) return rechazar(m.codigo === "MOTIVO_OBLIGATORIO" ? "vacio" : "formato", m.mensaje);
  return aceptar({ ordenId: texto(e.ordenId), motivo: m.valor });
}

/** Configurar el control: el nivel de la lista cerrada. */
export function guardComandoConfigurarControlDeExceso(entrada: unknown): ResultadoDato<ComandoConfigurarControlDeExceso> {
  const e = (entrada ?? {}) as Partial<Record<keyof ComandoConfigurarControlDeExceso, unknown>>;
  if (!esNivelDeControl(e.nivel)) return rechazar("formato", "Elegí un nivel: permitir, avisar o bloquear.");
  return aceptar({ nivel: e.nivel });
}

/**
 * La orden a la que se carga una compra (opcional): el id de la orden y, por cada renglón vinculado, la posición del ítem (entero >= 0), el número de línea de la orden (entero >= 1) y si se confirma el exceso (boolean, por defecto NO: todo nace cerrado).
 * Un ítem no se vincula dos veces. Devuelve `undefined` si no vino orden. Que la orden exista, sea del proveedor y esté pedida lo mira el caso de uso.
 */
export function guardOrdenDeCompraDeLaCompra(entrada: unknown, cantidadDeItems: number): ResultadoDato<OrdenDeCompraDeLaCompraInput | undefined> {
  if (entrada === undefined || entrada === null) return aceptar(undefined);
  const e = entrada as { ordenId?: unknown; renglones?: unknown };
  if (!esIdValido(e.ordenId)) return rechazar("formato", MENSAJE_ORDEN_NO_ENCONTRADA);
  if (!Array.isArray(e.renglones) || e.renglones.length === 0) return rechazar("vacio", "Indicá a qué línea de la orden corresponde cada renglón de la compra.");
  const excede = validarTopeDeLista(e.renglones, "Los vínculos con la orden", MAXIMO_LINEAS_POR_OPERACION);
  if (excede) return rechazar("rango", excede);
  const vistos = new Set<number>();
  const renglones: OrdenDeCompraDeLaCompraInput["renglones"] = [];
  for (const crudo of e.renglones as unknown[]) {
    const r = (crudo ?? {}) as { itemIndex?: unknown; lineaDeOrden?: unknown; confirmoExceso?: unknown };
    if (!Number.isInteger(r.itemIndex) || (r.itemIndex as number) < 0 || (r.itemIndex as number) >= cantidadDeItems) return rechazar("rango", "Un vínculo con la orden apunta a un renglón que no existe.");
    if (!Number.isInteger(r.lineaDeOrden) || (r.lineaDeOrden as number) < 1 || (r.lineaDeOrden as number) > MAXIMO_LINEAS_POR_OPERACION) return rechazar("rango", "Un vínculo con la orden apunta a una línea que no existe.");
    if (r.confirmoExceso !== undefined && typeof r.confirmoExceso !== "boolean") return rechazar("formato", "La confirmación del exceso no es válida.");
    const indice = r.itemIndex as number;
    if (vistos.has(indice)) return rechazar("formato", "Un renglón de la compra no puede estar vinculado dos veces con la orden.");
    vistos.add(indice);
    renglones.push({ itemIndex: indice, lineaDeOrden: r.lineaDeOrden as number, confirmoExceso: r.confirmoExceso === true });
  }
  return aceptar({ ordenId: texto(e.ordenId), renglones });
}
