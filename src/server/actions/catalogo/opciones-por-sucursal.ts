"use server";

import { guardComandoApagarOpcionEnSucursal, guardComandoFijarPrecioLocalDeOpcion } from "@/core/features/catalogo/opciones-por-sucursal.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso } from "../con-permiso";
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
 * Todavía no hay pantallas (GO-2b): ningún cliente las importa y Next no las publica; cada una lleva igual su guarda.
 */

export async function apagarOpcionEnSucursal(entrada: { sucursalId: unknown; opcionId: unknown; apagada: unknown }): Promise<ResultadoAccion> {
  return conPermiso("opcion_apagar_en_sucursal", async (ctx) => {
    const comando = guardComandoApagarOpcionEnSucursal({ ...entrada, sucursalActivaId: ctx.sucursalId });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await apagarOpcionEnSucursalCasoDeUso(ctx, comando.valor);
    if (resultado.ok) refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
  });
}

export async function fijarPrecioLocalDeOpcion(entrada: { sucursalId: unknown; productoId: unknown; opcionId: unknown; esperado: unknown; precio: unknown }): Promise<ResultadoAccion> {
  return conPermiso("precio_local", async (ctx) => {
    const comando = guardComandoFijarPrecioLocalDeOpcion({ ...entrada, sucursalActivaId: ctx.sucursalId });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await fijarPrecioLocalDeOpcionCasoDeUso(ctx, comando.valor);
    if (resultado.ok) refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
  });
}
