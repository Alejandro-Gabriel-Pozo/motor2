"use server";

import { MENSAJE_TEMA_SIMPLE_APAGADO } from "@/core/carta/public";
import { guardComandoGuardarTemaCarta, guardComandoGuardarTemaSimpleCarta } from "@/core/features/carta/tema.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { temaSimpleVisible } from "@/lib/tema-simple-visible";
import { conPermiso } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { guardarTemaCartaCasoDeUso } from "./casos-de-uso/guardar-tema-carta";
import { guardarTemaSimpleCartaCasoDeUso } from "./casos-de-uso/guardar-tema-simple-carta";
import { revalidarCartasPublicas } from "./revalidar";
/**
 * Tema visual de la carta pública de una sucursal (docs/plan-tema-carta-2026-09-24.md, M8): lo que lee la carta pública
 * interna (ADR-006). Solo escriben en `TemaCartaSucursal`
 * (lo fija test/arquitectura/carta-solo-lectura.test.ts). Gate: `carta_tema` (sucursal).
 *
 * Reciben el `Sucursal.id` (la fila es 1:1 con la sucursal) y solo operan sobre la sucursal activa: `carta_tema` es de contexto
 * sucursal, así que otra sucursal responde igual que una inexistente. Guardar = aplicar: no hay borrador.
 *
 * Desde el Hito 5 de la pureza (bloque D, `docs/plan-hito-5-pureza.md` §6.1) la acción es un adaptador fino de su caso de uso
 * (`./casos-de-uso/guardar-tema-carta.ts`; escrituras en server/persistencia/carta/tema.ts; el formato y la sucursal activa en
 * core/features/carta/tema.guard.ts): el archivo entero está en `ACCIONES_CON_CASO_DE_USO`. Revalida la carta pública solo si salió bien, como antes.
 */

/**
 * Guarda los valores del tema (reemplaza TODO lo guardado por lo que llega: el formulario manda las 64 claves). Permiso (`conPermiso("carta_tema")`) → que sea la
 * sucursal activa y el formato (`guardComandoGuardarTemaCarta`, DENTRO del envoltorio: `validarValoresTema` normaliza, ignora lo que no es del catálogo —incluidas las
 * `precio_*`, convención fija del sistema— y, si hay errores, devuelve hasta 5 juntos sin escribir nada) → caso de uso (`casos-de-uso/guardar-tema-carta.ts`: `upsert`
 * por `sucursalId`; con `aplicarEnCarta: true`) → revalidar si salió bien →
 * `aResultadoAccion`.
 */
export async function guardarTemaCarta(sucursalId: string, valores: Readonly<Record<string, unknown>>): Promise<ResultadoAccion> {
  return conPermiso("carta_tema", async (ctx) => {
    const comando = guardComandoGuardarTemaCarta({ sucursalId, valores, sucursalActivaId: ctx.sucursalId });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await guardarTemaCartaCasoDeUso(ctx, comando.valor);
    if (resultado.ok) revalidarCartasPublicas(ctx.empresaSlug);
    return aResultadoAccion(resultado);
  });
}

/**
 * Guarda la pantalla SIMPLE del tema (PASO A de «Apariencia y publicación», `docs/diseno-carta-apariencia-y-publicacion-como-pedernal-2026-11-17.md`): MEZCLA, no reemplaza (solo cambia las siete claves de la pantalla simple y conserva todo lo
 * demás). Permiso (`conPermiso("carta_tema")`, el mismo de siempre) → interruptor (`temaSimpleVisible`: apagado, el servidor rechaza aunque el pedido se arme a mano) → que sea la sucursal activa, la versión vista y el formato
 * (`guardComandoGuardarTemaSimpleCarta`; sin regla de contraste: se ajusta al mostrar) → caso de uso (`casos-de-uso/guardar-tema-simple-carta.ts`: SERIALIZABLE, con `versionEsperada`) → revalidar si salió bien → `aResultadoAccion`.
 */
export async function guardarTemaSimpleCarta(sucursalId: string, valores: Readonly<Record<string, unknown>>, versionEsperada: string): Promise<ResultadoAccion> {
  return conPermiso("carta_tema", async (ctx) => {
    if (!temaSimpleVisible()) return error(MENSAJE_TEMA_SIMPLE_APAGADO);
    const comando = guardComandoGuardarTemaSimpleCarta({ sucursalId, valores, versionEsperada, sucursalActivaId: ctx.sucursalId });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await guardarTemaSimpleCartaCasoDeUso(ctx, comando.valor);
    if (resultado.ok && resultado.datos.cambiado) revalidarCartasPublicas(ctx.empresaSlug);
    return aResultadoAccion(resultado);
  });
}
