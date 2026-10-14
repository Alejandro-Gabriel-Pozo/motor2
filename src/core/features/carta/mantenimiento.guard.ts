import { esIdentificador } from "@/core/datos/identificador";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { MENSAJE_SUCURSAL_CAMBIADA } from "@/core/features/catalogo/opciones-por-sucursal.guard";
import type { ComandoAgregarProductoALaCarta } from "./mantenimiento.schema";

/**
 * Guard de la feature «mantenimiento de la carta» (CARTA-MANT). Formato del comando, ANTES de tocar la base; lo llama la Server Action DENTRO de su `conPermiso(…)`. Puro.
 *
 * Lo PRIMERO es el eco de la sucursal (como el de las opciones por sucursal y el menú del día): la pantalla manda la sucursal que tenía cargada y, si ya no es la activa (cambió de sucursal en
 * otra pestaña), no se escribe nada. El caso de uso escribe SOLO en la sucursal activa del contexto; las políticas por sucursal de la base son la segunda barrera (42501).
 */

const LARGO_MAXIMO_DE_ID = 64;

function id(valor: unknown, mensaje: string): ResultadoDato<string> {
  return esIdentificador(valor) && valor.length <= LARGO_MAXIMO_DE_ID ? aceptar(valor) : rechazar("formato", mensaje);
}

function eco(sucursalId: unknown, sucursalActivaId: string): ResultadoDato<null> {
  return sucursalId === sucursalActivaId ? aceptar(null) : rechazar("formato", MENSAJE_SUCURSAL_CAMBIADA);
}

export function guardComandoAgregarProductoALaCarta(entrada: { sucursalId: unknown; sucursalActivaId: string; productoId: unknown; seccionCartaId: unknown }): ResultadoDato<ComandoAgregarProductoALaCarta> {
  const enLaActiva = eco(entrada.sucursalId, entrada.sucursalActivaId);
  if (!enLaActiva.ok) return enLaActiva;
  const productoId = id(entrada.productoId, "No se encontró el producto.");
  if (!productoId.ok) return productoId;
  const seccionCartaId = id(entrada.seccionCartaId, "Elegí la sección de la carta donde va.");
  if (!seccionCartaId.ok) return seccionCartaId;
  return aceptar({ productoId: productoId.valor, seccionCartaId: seccionCartaId.valor });
}
