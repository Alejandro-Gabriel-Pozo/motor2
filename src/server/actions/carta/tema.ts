"use server";

import { guardComandoCambiarAplicacionTema, guardComandoGuardarTemaCarta } from "@/core/features/carta/tema.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { cambiarAplicacionTemaCasoDeUso } from "./casos-de-uso/cambiar-aplicacion-tema";
import { guardarTemaCartaCasoDeUso } from "./casos-de-uso/guardar-tema-carta";
import { revalidarCartasPublicas } from "./revalidar";
/**
 * Tema visual de la carta pública de una sucursal (docs/plan-tema-carta-2026-09-24.md, M8): lo que lee la carta pública
 * interna (ADR-006). Solo escriben en `TemaCartaSucursal`
 * (lo fija test/arquitectura/carta-solo-lectura.test.ts). Gate: `carta_tema` (sucursal).
 *
 * Reciben el `Sucursal.id` (la fila es 1:1 con la sucursal) y solo operan sobre la sucursal activa: `carta_tema` es de contexto
 * sucursal, así que otra sucursal responde igual que una inexistente. Guardar y aplicar son
 * acciones separadas (D4): un tema guardado sin aplicar es un borrador y la carta usa el estilo por defecto.
 *
 * Desde el Hito 5 de la pureza (bloque D, `docs/plan-hito-5-pureza.md` §6.1) las dos acciones son adaptadores finos de sus casos de uso
 * (`./casos-de-uso/{guardar-tema-carta,cambiar-aplicacion-tema}.ts`; escrituras en server/persistencia/carta/tema.ts; el formato y la sucursal activa en
 * core/features/carta/tema.guard.ts): el archivo entero está en `ACCIONES_CON_CASO_DE_USO`. Las dos revalidan la carta pública solo si salió bien, como antes.
 */

/**
 * Guarda los valores del tema (reemplaza TODO lo guardado por lo que llega: el formulario manda las 64 claves). Permiso (`conPermiso("carta_tema")`) → que sea la
 * sucursal activa y el formato (`guardComandoGuardarTemaCarta`, DENTRO del envoltorio: `validarValoresTema` normaliza, ignora lo que no es del catálogo —incluidas las
 * `precio_*`, convención fija del sistema— y, si hay errores, devuelve hasta 5 juntos sin escribir nada) → caso de uso (`casos-de-uso/guardar-tema-carta.ts`: `upsert`
 * por `sucursalId`; al crear la fila no toca `aplicarEnCarta`, queda en borrador; al editar, un tema ya aplicado sigue aplicado) → revalidar si salió bien →
 * `aResultadoAccion`.
 */
export async function guardarTemaCarta(sucursalId: string, valores: Readonly<Record<string, unknown>>): Promise<ResultadoAccion> {
  return conPermiso("carta_tema", async (ctx) => {
    const comando = guardComandoGuardarTemaCarta({ sucursalId, valores, sucursalActivaId: ctx.sucursalId });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await guardarTemaCartaCasoDeUso(ctx, comando.valor);
    if (resultado.ok) revalidarCartasPublicas();
    return aResultadoAccion(resultado);
  });
}

/**
 * Aplica o desaplica el tema en la carta. Aplicar exige que el tema exista y tenga al menos un valor válido (no se aplica un tema
 * vacío, D4). Si la sucursal no está en el portal (o no está publicada) se guarda igual y se avisa: no tiene efecto hasta que la
 * carta la conozca. Desaplicar es la vuelta atrás: la carta vuelve al estilo por defecto y los valores se conservan. Permiso → que sea la sucursal activa
 * (`guardComandoCambiarAplicacionTema`) → caso de uso (`casos-de-uso/cambiar-aplicacion-tema.ts`) → revalidar si salió bien (también en los avisos «sin efecto») →
 * `aResultadoAccion`.
 */
export async function cambiarAplicacionTema(sucursalId: string, aplicar: boolean): Promise<ResultadoAccion> {
  return conPermiso("carta_tema", async (ctx) => {
    const comando = guardComandoCambiarAplicacionTema({ sucursalId, aplicar, sucursalActivaId: ctx.sucursalId });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await cambiarAplicacionTemaCasoDeUso(ctx, comando.valor);
    if (resultado.ok) revalidarCartasPublicas();
    return aResultadoAccion(resultado);
  });
}
