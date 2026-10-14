"use server";

import { guardComandoActivarEntradaDeCupo, guardComandoAgregarEntradaDeCupo, guardComandoGuardarVigenciaPromoCarta } from "@/core/features/carta/combos.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermisoDeEmpresa } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { actualizarActivaEntradaDeCupoCasoDeUso } from "./casos-de-uso/actualizar-activa-entrada-de-cupo";
import { agregarEntradaDeCupoCasoDeUso } from "./casos-de-uso/agregar-entrada-de-cupo";
import { guardarVigenciaPromoCartaCasoDeUso } from "./casos-de-uso/guardar-vigencia-promo-carta";
import { revalidarCartasPublicas } from "./revalidar";

/**
 * Server Actions de los COMBOS de la carta (GO-3b, ADR-032): las opciones de un lugar LISTA (productos de venta, aunque no estén en la carta, con una configuración fija opcional) y la VIGENCIA
 * de una promo. Son de la EMPRESA, como definir la promo: `carta_promo_definir` (conPermisoDeEmpresa, la PRIMERA línea). Adaptadores finos: permiso → guard (DENTRO del envoltorio: el rechazo por
 * permiso llega antes que el de formato) → caso de uso → revalidar la carta pública si salió bien (lo que un combo incluye se puede mostrar) → `aResultadoAccion`. Nada se borra: una opción se da
 * de baja y se vuelve a prender.
 */

/** Que un producto (con su configuración fija, si la lleva) sea una opción de un lugar LISTA: la crea o la reactiva. */
export async function agregarEntradaDeCupo(entrada: { cupoId: unknown; productoId: unknown; opciones?: unknown }): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_promo_definir", async (ctx) => {
    const comando = guardComandoAgregarEntradaDeCupo(entrada);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await agregarEntradaDeCupoCasoDeUso(ctx, comando.valor);
    if (resultado.ok && resultado.datos.huboCambio) revalidarCartasPublicas(ctx.empresaSlug);
    return aResultadoAccion(resultado);
  });
}

/** Prende o apaga una opción de un lugar LISTA. */
export async function actualizarActivaEntradaDeCupo(entrada: { entradaId: unknown; activa: unknown }): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_promo_definir", async (ctx) => {
    const comando = guardComandoActivarEntradaDeCupo(entrada);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await actualizarActivaEntradaDeCupoCasoDeUso(ctx, comando.valor);
    if (resultado.ok && resultado.datos.huboCambio) revalidarCartasPublicas(ctx.empresaSlug);
    return aResultadoAccion(resultado);
  });
}

/** La vigencia de una promo (fechas y días de la semana), con la versión que vio la pantalla. */
export async function guardarVigenciaPromoCarta(entrada: {
  promoCartaId: unknown;
  versionEsperada: unknown;
  vigenteDesde?: unknown;
  vigenteHasta?: unknown;
  diasDeSemana?: unknown;
}): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("carta_promo_definir", async (ctx) => {
    const comando = guardComandoGuardarVigenciaPromoCarta(entrada);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await guardarVigenciaPromoCartaCasoDeUso(ctx, comando.valor);
    if (resultado.ok && resultado.datos.huboCambio) revalidarCartasPublicas(ctx.empresaSlug);
    return aResultadoAccion(resultado);
  });
}
