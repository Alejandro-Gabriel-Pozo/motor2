"use server";

import { guardComandoAgregarPlatoDelDia, guardComandoCopiarMenuDelDiaAnterior, guardComandoQuitarPlatoDelDia } from "@/core/features/carta/menu-del-dia.guard";
import { MENSAJE_MENU_DEL_DIA_APAGADO, MENU_DEL_DIA_VISIBLE } from "@/core/carta/public";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { agregarPlatoDelDiaCasoDeUso } from "./casos-de-uso/agregar-plato-del-dia";
import { copiarMenuDelDiaAnteriorCasoDeUso } from "./casos-de-uso/copiar-menu-del-dia-anterior";
import { quitarPlatoDelDiaCasoDeUso } from "./casos-de-uso/quitar-plato-del-dia";
import { revalidarCartasPublicas } from "./revalidar";

/**
 * Server Actions del MENÚ DEL DÍA de la sucursal (GO-3b, ADR-032, D-1 y D-5): cargar y quitar el plato del día de un lugar DEL_DIA en una fecha, y copiar el del día anterior. Son de la SUCURSAL
 * ACTIVA: `promo_menu_del_dia` (sucursal, piso operario, semilla admin: el gerente la delega al encargado), con `conPermiso` como PRIMERA línea. Adaptadores finos: permiso → guard (lo primero es el
 * eco: la sucursal que vio la pantalla tiene que ser la activa, `sucursalActivaId: ctx.sucursalId`) → caso de uso (escribe SOLO en la sucursal activa) → revalidar la carta pública si cambió algo
 * (el plato del día se puede mostrar) → `aResultadoAccion`. Nada se borra: un plato se quita (queda inactivo) y se vuelve a poner.
 *
 * Interruptor `MENU_DEL_DIA_VISIBLE` (`core/carta/menu-del-dia.ts`, decisión del dueño 2026-10-20): apagado, la pantalla no existe y CARGAR o COPIAR un plato del día se rechaza aunque el pedido se
 * arme a mano (después del permiso, que sigue siendo lo primero). Quitar uno que ya estaba sigue andando: no suma nada.
 */

export async function agregarPlatoDelDia(entrada: { sucursalId: unknown; cupoId: unknown; fecha: unknown; productoId: unknown }): Promise<ResultadoAccion> {
  return conPermiso("promo_menu_del_dia", async (ctx) => {
    if (!MENU_DEL_DIA_VISIBLE) return error(MENSAJE_MENU_DEL_DIA_APAGADO);
    const comando = guardComandoAgregarPlatoDelDia({ ...entrada, sucursalActivaId: ctx.sucursalId });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await agregarPlatoDelDiaCasoDeUso(ctx, comando.valor);
    if (resultado.ok && resultado.datos.huboCambio) revalidarCartasPublicas(ctx.empresaSlug);
    return aResultadoAccion(resultado);
  });
}

export async function quitarPlatoDelDia(entrada: { sucursalId: unknown; platoId: unknown }): Promise<ResultadoAccion> {
  return conPermiso("promo_menu_del_dia", async (ctx) => {
    const comando = guardComandoQuitarPlatoDelDia({ ...entrada, sucursalActivaId: ctx.sucursalId });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await quitarPlatoDelDiaCasoDeUso(ctx, comando.valor);
    if (resultado.ok && resultado.datos.huboCambio) revalidarCartasPublicas(ctx.empresaSlug);
    return aResultadoAccion(resultado);
  });
}

export async function copiarMenuDelDiaAnterior(entrada: { sucursalId: unknown; fecha: unknown }): Promise<ResultadoAccion> {
  return conPermiso("promo_menu_del_dia", async (ctx) => {
    if (!MENU_DEL_DIA_VISIBLE) return error(MENSAJE_MENU_DEL_DIA_APAGADO);
    const comando = guardComandoCopiarMenuDelDiaAnterior({ ...entrada, sucursalActivaId: ctx.sucursalId });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await copiarMenuDelDiaAnteriorCasoDeUso(ctx, comando.valor);
    if (resultado.ok && resultado.datos.copiados > 0) revalidarCartasPublicas(ctx.empresaSlug);
    return aResultadoAccion(resultado);
  });
}
