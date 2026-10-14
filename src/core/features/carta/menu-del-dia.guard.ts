import { esIdentificador } from "@/core/datos/identificador";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { MENSAJE_SUCURSAL_CAMBIADA } from "@/core/features/catalogo/opciones-por-sucursal.guard";
import type { ComandoAgregarPlatoDelDia, ComandoCopiarMenuDelDiaAnterior, ComandoQuitarPlatoDelDia } from "./menu-del-dia.schema";

/**
 * Guard de la feature «menú del día» (GO-3b, ADR-032). Formato del comando, ANTES de tocar la base; lo llama la Server Action DENTRO de su `conPermiso("promo_menu_del_dia", …)`. Puro.
 *
 * Lo PRIMERO es el eco de la sucursal (como el de las opciones por sucursal): la pantalla manda la sucursal que tenía cargada y, si ya no es la activa (cambió de sucursal en otra pestaña), no se
 * escribe nada. El caso de uso escribe SOLO en la sucursal activa del contexto, nunca en una que llegue por parámetro; las políticas por sucursal de la base son la segunda barrera (42501). Que la
 * fecha esté entre hoy y hoy + 13 lo decide el caso de uso (necesita «hoy», de la zona de la empresa).
 */

const LARGO_MAXIMO_DE_ID = 64;

function id(valor: unknown, mensaje: string): ResultadoDato<string> {
  return esIdentificador(valor) && valor.length <= LARGO_MAXIMO_DE_ID ? aceptar(valor) : rechazar("formato", mensaje);
}

function eco(sucursalId: unknown, sucursalActivaId: string): ResultadoDato<null> {
  return sucursalId === sucursalActivaId ? aceptar(null) : rechazar("formato", MENSAJE_SUCURSAL_CAMBIADA);
}

function fecha(valor: unknown): ResultadoDato<string> {
  return typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? aceptar(valor) : rechazar("formato", "La fecha del menú del día no es válida.");
}

export function guardComandoAgregarPlatoDelDia(entrada: { sucursalId: unknown; sucursalActivaId: string; cupoId: unknown; fecha: unknown; productoId: unknown }): ResultadoDato<ComandoAgregarPlatoDelDia> {
  const enLaActiva = eco(entrada.sucursalId, entrada.sucursalActivaId);
  if (!enLaActiva.ok) return enLaActiva;
  const cupoId = id(entrada.cupoId, "No se encontró ese lugar del menú.");
  if (!cupoId.ok) return cupoId;
  const dia = fecha(entrada.fecha);
  if (!dia.ok) return dia;
  const productoId = id(entrada.productoId, "Elegí un producto de venta.");
  if (!productoId.ok) return productoId;
  return aceptar({ cupoId: cupoId.valor, fecha: dia.valor, productoId: productoId.valor });
}

export function guardComandoQuitarPlatoDelDia(entrada: { sucursalId: unknown; sucursalActivaId: string; platoId: unknown }): ResultadoDato<ComandoQuitarPlatoDelDia> {
  const enLaActiva = eco(entrada.sucursalId, entrada.sucursalActivaId);
  if (!enLaActiva.ok) return enLaActiva;
  const platoId = id(entrada.platoId, "No se encontró ese plato del día.");
  if (!platoId.ok) return platoId;
  return aceptar({ platoId: platoId.valor });
}

export function guardComandoCopiarMenuDelDiaAnterior(entrada: { sucursalId: unknown; sucursalActivaId: string; fecha: unknown }): ResultadoDato<ComandoCopiarMenuDelDiaAnterior> {
  const enLaActiva = eco(entrada.sucursalId, entrada.sucursalActivaId);
  if (!enLaActiva.ok) return enLaActiva;
  const dia = fecha(entrada.fecha);
  if (!dia.ok) return dia;
  return aceptar({ fecha: dia.valor });
}
