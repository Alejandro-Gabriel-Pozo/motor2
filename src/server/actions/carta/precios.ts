"use server";

import { guardComandoAjustarPreciosDeLaCarta, guardComandoAjustarPreciosDeLaEmpresa } from "@/core/features/carta/mantenimiento.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { puedeEditarCamposSensiblesDelProducto } from "@/server/acceso/campos-sensibles-de-producto";
import { conPermiso, conPermisoDeEmpresa } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { ajustarPreciosDeLaEmpresaCasoDeUso } from "../catalogo/casos-de-uso/ajustar-precios-de-la-empresa";
import { ajustarPreciosDeLaCartaCasoDeUso } from "../movimientos/casos-de-uso/ajustar-precios-de-la-carta";
import { revalidarCartasPublicas } from "./revalidar";

/**
 * F4 «Precios» de la carta (CARTA-MANT; ADR-034; decisión del dueño 2026-10-14). Archivo aparte a propósito: «Precios» se puede apagar sin tocar el resto (`PRECIOS_EDITABLES` en
 * `src/app/(app)/carta/page.tsx`). Adaptadores finos: permiso → guard → caso de uso → revalidar la carta pública si cambió algo → `aResultadoAccion`.
 */

/** Por defecto: el PRECIO LOCAL de la sucursal activa (clave `precio_local`, la misma de «Precio local»), una sección o un producto, todo o nada y contra el precio que mostró la vista previa. */
export async function ajustarPreciosDeLaCarta(entrada: { sucursalId: unknown; ajuste: unknown; items: unknown }): Promise<ResultadoAccion> {
  return conPermiso("precio_local", async (ctx) => {
    const comando = guardComandoAjustarPreciosDeLaCarta({ ...entrada, sucursalActivaId: ctx.sucursalId });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await ajustarPreciosDeLaCartaCasoDeUso(ctx, comando.valor);
    if (resultado.ok && resultado.datos.cambiados > 0) revalidarCartasPublicas(ctx.empresaSlug);
    return aResultadoAccion(resultado);
  });
}

/**
 * «En toda la empresa»: el precio de LISTA (`producto_editar` y, calculada acá con el gate, `producto_campos_sensibles`: las dos claves de editar el precio en Catálogo), con la confirmación explícita
 * del comando (`confirmado: true`; la pantalla la pide con una casilla y el caso de uso la vuelve a exigir).
 */
export async function ajustarPreciosDeLaEmpresa(entrada: { ajuste: unknown; items: unknown; confirmado: unknown }): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("producto_editar", async (ctx) => {
    const comando = guardComandoAjustarPreciosDeLaEmpresa(entrada);
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await ajustarPreciosDeLaEmpresaCasoDeUso(ctx, { ...comando.valor, puedeEditarCamposSensibles: await puedeEditarCamposSensiblesDelProducto(ctx) });
    if (resultado.ok && resultado.datos.cambiados > 0) revalidarCartasPublicas(ctx.empresaSlug);
    return aResultadoAccion(resultado);
  });
}
