"use server";

import { ofrecerSincronizarPrecio } from "@/core/carta/public";
import { guardComandoSetPrecioLocalProducto, guardComandoSincronizarPrecioLocalGrupoCarta } from "@/core/features/movimientos/precio-local.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { resolverGrupoDeProducto } from "@/server/lecturas/carta/grupo-de-producto";
import { conPermiso } from "../con-permiso";
import { error, type ResultadoAccion, type ResultadoConSincronizable } from "../tipos";
import { requerirVerEnSucursal } from "../con-sesion";
import { revalidarCartasPublicas } from "../carta/revalidar";
import { setPrecioLocalProductoCasoDeUso } from "./casos-de-uso/set-precio-local-producto";
import { sincronizarPrecioLocalGrupoCartaCasoDeUso } from "./casos-de-uso/sincronizar-precio-local-grupo-carta";

/**
 * Port de HOJA_PRECIO_LOCAL/"Precio Local" (Catalogo.js:2043-2077) — hueco
 * encontrado investigando Venta (porción Movimientos): Producto.precioVenta
 * es el precio GLOBAL, esto es el override por sucursal. `resolverPrecioVenta`
 * (src/server/lecturas/movimientos/precio-venta.ts) es quien lee esto — acá solo el CRUD.
 *
 * Desde el Hito 4 de la pureza (bloque 4.2, paso H4C-4) las dos mutaciones son adaptadores finos de sus casos de uso
 * (`./casos-de-uso/{set-precio-local-producto,sincronizar-precio-local-grupo-carta}.ts`, con el paso compartido `guardar-precio-local-en-tx.ts` que escribe en
 * server/persistencia/movimientos/precio-local.ts y audita): el archivo entero está en `ACCIONES_CON_CASO_DE_USO`. Las dos lecturas de abajo siguen acá.
 */
export async function obtenerPrecioLocalProducto(sucursalId: string, productoId: string) {
  const ctx = await requerirVerEnSucursal(sucursalId, "precio_local");
  return ctx.db.precioLocalProducto.findUnique({ where: { sucursalId_productoId: { sucursalId, productoId } } });
}

export async function listarPreciosLocales(sucursalId: string) {
  const ctx = await requerirVerEnSucursal(sucursalId, "precio_local");
  // S-15 (plan de endurecimiento, T7): solo lo que el panel dibuja (el `Producto` entero llevaba el costo de consignación a quien invoca la acción a mano). Más campos: se AGREGAN acá (GT-3a).
  return ctx.db.precioLocalProducto.findMany({
    where: { sucursalId },
    select: { id: true, productoId: true, precio: true, habilitado: true, producto: { select: { nombre: true, precioVenta: true } } },
    orderBy: { producto: { nombre: "asc" } },
  });
}

/**
 * Si el producto está en un ítem agrupado de la carta y, con el precio local HABILITADO, sus hermanos quedaron a otro precio EN ESTA
 * SUCURSAL, el resultado trae además `sincronizable` (docs/plan-agrupacion-items-carta-2026-09-24.md, D11/M8): la pantalla ofrece
 * aplicar el mismo precio local con un botón aparte (`sincronizarPrecioLocalGrupoCarta`). Nunca se sincroniza solo.
 *
 * Desde el Hito 4 (H4C-4): permiso (`conPermiso("precio_local")`) → formato del precio (`guardComandoSetPrecioLocalProducto`,
 * core/features/movimientos/precio-local.guard.ts, DENTRO del envoltorio) → caso de uso (`casos-de-uso/set-precio-local-producto.ts`) → revalidar la carta
 * pública → y DESPUÉS de revalidar, el `sincronizable` (lee el ítem agrupado con la base del contexto, como antes) → el resultado sin `datos` ni `codigo`
 * (`aResultadoAccion`, más el `sincronizable` elegido a mano).
 */
export async function setPrecioLocalProducto(productoId: string, precio: number, habilitado: boolean): Promise<ResultadoConSincronizable> {
  return conPermiso<ResultadoConSincronizable>("precio_local", async (ctx) => {
    const comando = guardComandoSetPrecioLocalProducto({ productoId, precio, habilitado });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await setPrecioLocalProductoCasoDeUso(ctx, comando.valor);
    const base = aResultadoAccion(resultado);
    if (!base.ok) return base;
    revalidarCartasPublicas(ctx.empresaSlug);

    if (habilitado) {
      const sincronizable = ofrecerSincronizarPrecio(await resolverGrupoDeProducto(productoId, ctx.sucursalId, ctx.db), Number(comando.valor.precio), "enSucursal");
      if (sincronizable) return { ok: true, mensaje: base.mensaje, sincronizable };
    }
    return base;
  });
}

/**
 * Aplica el mismo precio local (en la sucursal activa) a varios productos de UN mismo ítem agrupado de la carta: el paso que ofrece
 * `setPrecioLocalProducto` con `sincronizable` (docs/plan-agrupacion-items-carta-2026-09-24.md, D11/M8). Mismo permiso, mismo upsert y
 * misma auditoría que fijarlo a mano en cada uno. `sucursalId` tiene que ser la sucursal activa (la que vio la pantalla): si cambió en
 * el medio, no se escribe nada.
 *
 * Desde el Hito 4 (H4C-4): permiso → formato (`guardComandoSincronizarPrecioLocalGrupoCarta`: la sucursal de la pantalla, el precio y la lista, en ese orden,
 * DENTRO del envoltorio) → caso de uso (`casos-de-uso/sincronizar-precio-local-grupo-carta.ts`) → revalidar la carta pública si salió bien → `aResultadoAccion`.
 */
export async function sincronizarPrecioLocalGrupoCarta(sucursalId: string, productoIds: string[], precio: number, habilitado: boolean): Promise<ResultadoAccion> {
  return conPermiso("precio_local", async (ctx) => {
    const comando = guardComandoSincronizarPrecioLocalGrupoCarta({ sucursalId, sucursalActivaId: ctx.sucursalId, productoIds, precio, habilitado });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await sincronizarPrecioLocalGrupoCartaCasoDeUso(ctx, comando.valor);
    if (resultado.ok) revalidarCartasPublicas(ctx.empresaSlug);
    return aResultadoAccion(resultado);
  });
}
