"use server";

import { guardComandoAgregarProductoALaCarta } from "@/core/features/carta/mantenimiento.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { agregarProductoALaCartaCasoDeUso } from "./casos-de-uso/agregar-producto-a-la-carta";
import { revalidarCartasPublicas } from "./revalidar";

/**
 * Server Actions del MANTENIMIENTO de la carta de la sucursal (CARTA-MANT; ADR-034). Son de la SUCURSAL ACTIVA, con `conPermiso` como PRIMERA línea y la clave que YA gobierna lo
 * que tocan (no hay claves nuevas: una clave nueva necesita una migración de datos). Adaptadores finos: permiso → guard (lo primero es el eco: la sucursal que vio la pantalla tiene que ser la
 * activa, `sucursalActivaId: ctx.sucursalId`) → caso de uso (escribe SOLO en la sucursal activa, con su auditoría) → revalidar la carta pública si cambió algo → `aResultadoAccion`.
 */

/** «Agregar a la carta» un producto que está fuera de carta (POS y menú del día), en la sección elegida y al final (`carta_contenido_producto`, la misma clave del contenido de carta). */
export async function agregarProductoALaCarta(entrada: { sucursalId: unknown; productoId: unknown; seccionCartaId: unknown }): Promise<ResultadoAccion> {
  return conPermiso("carta_contenido_producto", async (ctx) => {
    const comando = guardComandoAgregarProductoALaCarta({ ...entrada, sucursalActivaId: ctx.sucursalId });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await agregarProductoALaCartaCasoDeUso(ctx, comando.valor);
    if (resultado.ok && resultado.datos.huboCambio) revalidarCartasPublicas(ctx.empresaSlug);
    return aResultadoAccion(resultado);
  });
}
