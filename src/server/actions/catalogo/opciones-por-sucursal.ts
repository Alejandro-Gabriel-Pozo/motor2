"use server";

import { guardComandoApagarOpcionEnSucursal, guardComandoFijarPrecioLocalDeOpcion } from "@/core/features/catalogo/opciones-por-sucursal.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso } from "../con-permiso";
import { revalidarCartasPublicas } from "../carta/revalidar";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { error, type ResultadoAccion } from "../tipos";
import { apagarOpcionEnSucursalCasoDeUso } from "./casos-de-uso/apagar-opcion-en-sucursal";
import { fijarPrecioLocalDeOpcionCasoDeUso } from "./casos-de-uso/fijar-precio-local-de-opcion";

/**
 * Server Actions de lo que decide cada SUCURSAL sobre las opciones de venta (GO-2a; ADR-030 §5). Adaptadores finos: `conPermiso` con su clave (la PRIMERA línea; el gate mira
 * módulo, capacidad, rol y piso EN LA SUCURSAL ACTIVA) → guard (lo primero es el eco: la sucursal que vio la pantalla tiene que ser la activa, `sucursalActivaId: ctx.sucursalId`)
 * → caso de uso (escribe SOLO en la sucursal activa) → `aResultadoAccion`.
 *
 * - `opcion_apagar_en_sucursal` (sucursal, piso operario, semilla admin; delegable al encargado del turno): apagar o prender una opción.
 * - `precio_local` (sucursal, con su capacidad): la grilla del precio de una medida con precio propio.
 *
 * Las usan las pantallas de GO-2d («Opciones agotadas» y «Precios por tamaño» de la sucursal). GO-2d: al salir bien invalidan la carta pública de la empresa
 * (`revalidarCartasPublicas`): una opción agotada sale de la carta y un tamaño muestra su precio de la sucursal.
 */

export async function apagarOpcionEnSucursal(entrada: { sucursalId: unknown; opcionId: unknown; apagada: unknown }): Promise<ResultadoAccion> {
  return conPermiso("opcion_apagar_en_sucursal", async (ctx) => {
    const comando = guardComandoApagarOpcionEnSucursal({ ...entrada, sucursalActivaId: ctx.sucursalId });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await apagarOpcionEnSucursalCasoDeUso(ctx, comando.valor);
    if (resultado.ok) {
      // GO-2d: la carta pública muestra las opciones (precios, agotadas): se invalida su caché, solo la de esta empresa.
      revalidarCartasPublicas(ctx.empresaSlug);
      refrescarVistaSiHaceFalta();
    }
    return aResultadoAccion(resultado);
  });
}

export async function fijarPrecioLocalDeOpcion(entrada: { sucursalId: unknown; productoId: unknown; opcionId: unknown; esperado: unknown; precio: unknown }): Promise<ResultadoAccion> {
  return conPermiso("precio_local", async (ctx) => {
    const comando = guardComandoFijarPrecioLocalDeOpcion({ ...entrada, sucursalActivaId: ctx.sucursalId });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await fijarPrecioLocalDeOpcionCasoDeUso(ctx, comando.valor);
    if (resultado.ok) {
      // GO-2d: la carta pública muestra las opciones (precios, agotadas): se invalida su caché, solo la de esta empresa.
      revalidarCartasPublicas(ctx.empresaSlug);
      refrescarVistaSiHaceFalta();
    }
    return aResultadoAccion(resultado);
  });
}
