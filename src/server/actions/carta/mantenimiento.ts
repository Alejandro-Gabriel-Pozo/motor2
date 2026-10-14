"use server";

import { guardComandoAgregarProductoALaCarta, guardComandoFijarDisponibilidadDeHoy, guardComandoQuitarProductoDeLaCarta } from "@/core/features/carta/mantenimiento.guard";
import { puedeEditarCamposSensiblesDelProducto } from "@/server/acceso/campos-sensibles-de-producto";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { fijarDisponibilidadDeHoyCasoDeUso } from "../catalogo/casos-de-uso/fijar-disponibilidad-de-hoy";
import { agregarProductoALaCartaCasoDeUso } from "./casos-de-uso/agregar-producto-a-la-carta";
import { quitarProductoDeLaCartaCasoDeUso } from "./casos-de-uso/quitar-producto-de-la-carta";
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

/** «Quitar de la carta» (el «Deshacer» de agregar, o sacar uno que no va): vuelve a «Fuera de carta» (`carta_contenido_producto`). Con datos cargados exige `confirmado`. */
export async function quitarProductoDeLaCarta(entrada: { sucursalId: unknown; productoId: unknown; confirmado?: unknown }): Promise<ResultadoAccion> {
  return conPermiso("carta_contenido_producto", async (ctx) => {
    const comando = guardComandoQuitarProductoDeLaCarta({ ...entrada, sucursalActivaId: ctx.sucursalId });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await quitarProductoDeLaCartaCasoDeUso(ctx, comando.valor);
    if (resultado.ok && resultado.datos.huboCambio) revalidarCartasPublicas(ctx.empresaSlug);
    return aResultadoAccion(resultado);
  });
}

/**
 * «Hoy»: dejar disponibles o sin stock HOY uno o varios productos de la sucursal activa, TODO O NADA (una sección entera, un producto o su «Deshacer»). Es la disponibilidad por producto y
 * sucursal de siempre, con su clave (`producto_disponibilidad`) y sus reglas (`fijar-disponibilidad-de-hoy.ts` reusa las de `actualizar-disponibilidad-producto.ts`). D4: la clave fina
 * (`producto_campos_sensibles`) se calcula solo si alguno se pone a la venta.
 */
export async function fijarDisponibilidadDeHoy(entrada: { sucursalId: unknown; cambios: unknown }): Promise<ResultadoAccion> {
  return conPermiso("producto_disponibilidad", async (ctx) => {
    const comando = guardComandoFijarDisponibilidadDeHoy({ ...entrada, sucursalActivaId: ctx.sucursalId });
    if (!comando.ok) return error(comando.mensaje);
    const puedeEditarCamposSensibles = comando.valor.cambios.some((c) => c.disponible) ? await puedeEditarCamposSensiblesDelProducto(ctx) : false;
    const resultado = await fijarDisponibilidadDeHoyCasoDeUso(ctx, { ...comando.valor, puedeEditarCamposSensibles });
    if (resultado.ok && resultado.datos.cambiados > 0) revalidarCartasPublicas(ctx.empresaSlug);
    return aResultadoAccion(resultado);
  });
}
