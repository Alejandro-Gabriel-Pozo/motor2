import { esIdentificador } from "@/core/datos/identificador";
import { validarImporte } from "@/core/datos/importe";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { ComandoApagarOpcionEnSucursal, ComandoFijarPrecioLocalDeOpcion, PrecioLocalVisto } from "./opciones-por-sucursal.schema";

/**
 * Guard de la feature «opciones de venta en la sucursal» (GO-2a). Formato del comando, ANTES de tocar la base; lo llama la Server Action DENTRO de su `conPermiso(…)`. Puro.
 *
 * Lo PRIMERO es el eco de la sucursal (como `guardComandoSincronizarPrecioLocalGrupoCarta`): la pantalla manda la sucursal que tenía cargada y, si ya no es la activa (cambió de
 * sucursal en otra pestaña), no se escribe nada. El caso de uso escribe SOLO en la sucursal activa del contexto, nunca en una que llegue por parámetro.
 */

export const MENSAJE_SUCURSAL_CAMBIADA = "La sucursal activa cambió desde que se cargó la pantalla: recargala y volvé a intentar.";

const LARGO_MAXIMO_DE_ID = 64;

function id(valor: unknown, mensaje: string): ResultadoDato<string> {
  return esIdentificador(valor) && valor.length <= LARGO_MAXIMO_DE_ID ? aceptar(valor) : rechazar("formato", mensaje);
}

function eco(sucursalId: unknown, sucursalActivaId: string): ResultadoDato<null> {
  return sucursalId === sucursalActivaId ? aceptar(null) : rechazar("formato", MENSAJE_SUCURSAL_CAMBIADA);
}

/** Un precio de la grilla: 0,01 o más (`PrecioLocalDeOpcion_precio_chk`), con hasta 2 decimales. */
function precio(valor: unknown, etiqueta: string): ResultadoDato<number> {
  const p = validarImporte(valor, { etiqueta, obligatorio: true, permitirCero: false });
  if (!p.ok) return rechazar(p.codigo, p.mensaje);
  return aceptar(p.valor!); // obligatorio: nunca null
}

export function guardComandoApagarOpcionEnSucursal(entrada: { sucursalId: unknown; sucursalActivaId: string; opcionId: unknown; apagada: unknown }): ResultadoDato<ComandoApagarOpcionEnSucursal> {
  const enLaActiva = eco(entrada.sucursalId, entrada.sucursalActivaId);
  if (!enLaActiva.ok) return enLaActiva;
  const opcionId = id(entrada.opcionId, "No se encontró la opción.");
  if (!opcionId.ok) return opcionId;
  if (typeof entrada.apagada !== "boolean") return rechazar("formato", "Elegí si la opción queda apagada o prendida.");
  return aceptar({ opcionId: opcionId.valor, apagada: entrada.apagada });
}

export function guardComandoFijarPrecioLocalDeOpcion(entrada: {
  sucursalId: unknown;
  sucursalActivaId: string;
  productoId: unknown;
  opcionId: unknown;
  esperado: unknown;
  precio: unknown;
}): ResultadoDato<ComandoFijarPrecioLocalDeOpcion> {
  const enLaActiva = eco(entrada.sucursalId, entrada.sucursalActivaId);
  if (!enLaActiva.ok) return enLaActiva;
  const productoId = id(entrada.productoId, "No se encontró el producto.");
  if (!productoId.ok) return productoId;
  const opcionId = id(entrada.opcionId, "No se encontró la opción.");
  if (!opcionId.ok) return opcionId;
  let esperado: PrecioLocalVisto | null = null;
  if (entrada.esperado !== null && entrada.esperado !== undefined) {
    if (typeof entrada.esperado !== "object") return rechazar("formato", "El precio que mostraba la pantalla no es válido: recargala.");
    const visto = entrada.esperado as { precio?: unknown; habilitado?: unknown };
    const p = precio(visto.precio, "El precio que mostraba la pantalla");
    if (!p.ok) return p;
    if (typeof visto.habilitado !== "boolean") return rechazar("formato", "El precio que mostraba la pantalla no es válido: recargala.");
    esperado = { precio: p.valor, habilitado: visto.habilitado };
  }
  if (entrada.precio === null || entrada.precio === undefined) return aceptar({ productoId: productoId.valor, opcionId: opcionId.valor, esperado, precio: null });
  const nuevo = precio(entrada.precio, "El precio");
  if (!nuevo.ok) return nuevo;
  return aceptar({ productoId: productoId.valor, opcionId: opcionId.valor, esperado, precio: nuevo.valor });
}
