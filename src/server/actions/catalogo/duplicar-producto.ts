"use server";

import { guardComandoDuplicarProducto } from "@/core/features/catalogo/duplicar-producto.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { azarDelProceso } from "@/lib/azar";
import { puedeEditarCamposSensiblesDelProducto } from "@/server/acceso/campos-sensibles-de-producto";
import { conPermisoDeEmpresa, exigirTambienPermisoDeEmpresa } from "../con-permiso";
import { error, okConId, type ResultadoConId } from "../tipos";
import { duplicarProductoCasoDeUso } from "./casos-de-uso/duplicar-producto";

/**
 * «Duplicar producto» (etapa E4 de `docs/diseno-duplicar-producto-2026-11-12.md`; decisión del dueño, 2026-11-12: «como lo tiene Pedernal»): crea un producto NUEVO con nombre propio y le copia la ficha, el precio de lista como punto de
 * partida, lo que el original admite (los mismos grupos y opciones de la biblioteca) y su receta vigente con la ficha técnica, todo en UNA transacción. Adaptador fino: permiso → guard → caso de uso
 * (`casos-de-uso/duplicar-producto.ts`) → `aResultadoAccion`, y si salió bien el id y el nombre del producto nuevo (`okConId`: la pantalla lo lleva a su ficha).
 *
 * El permiso de cada cosa que se copia lo resuelve el servidor, nunca el pedido: `alta_producto` para crear (el envoltorio), `guardar_receta` si se pide copiar la receta y `producto_opciones_admitidas` si se piden las opciones
 * (las dos, DENTRO del envoltorio y antes de formatear o leer nada, con `exigirTambienPermisoDeEmpresa`). Si falta alguno se rechaza el pedido ENTERO: no se copia «lo que se pueda». El precio lo decide `producto_campos_sensibles`
 * (`puedeEditarCamposSensiblesDelProducto`, la fuente única): sin la clave el producto nace con precio 0 y sin disponibilidad. La condición `=== true` es la misma que acepta el guard: lo que llega a copiarse fue verificado.
 *
 * Nunca recibe la empresa ni el permiso: salen de la sesión. `duplicadoId` lo genera la pantalla al abrir el diálogo (es el id del producto nuevo: el doble clic y el reintento caen sobre el mismo producto).
 */
export async function duplicarProducto(entrada: {
  duplicadoId: unknown;
  origenId: unknown;
  nombre: unknown;
  copiarReceta: unknown;
  copiarOpciones: unknown;
  sucursalDeLaRecetaId?: unknown;
  precioVenta?: unknown;
}): Promise<ResultadoConId> {
  return conPermisoDeEmpresa("alta_producto", async (ctx) => {
    const pedido = typeof entrada === "object" && entrada !== null ? entrada : null;
    if (pedido?.copiarReceta === true) {
      const tambien = await exigirTambienPermisoDeEmpresa(ctx, "guardar_receta");
      if (!tambien.ok) return error(tambien.mensaje);
    }
    if (pedido?.copiarOpciones === true) {
      const tambien = await exigirTambienPermisoDeEmpresa(ctx, "producto_opciones_admitidas");
      if (!tambien.ok) return error(tambien.mensaje);
    }
    const comando = guardComandoDuplicarProducto({
      duplicadoId: pedido?.duplicadoId,
      origenId: pedido?.origenId,
      nombre: pedido?.nombre,
      copiarReceta: pedido?.copiarReceta,
      copiarOpciones: pedido?.copiarOpciones,
      sucursalDeLaRecetaId: pedido?.sucursalDeLaRecetaId,
      precioVenta: pedido?.precioVenta,
    });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await duplicarProductoCasoDeUso(ctx, comando.valor, azarDelProceso, await puedeEditarCamposSensiblesDelProducto(ctx));
    const base = aResultadoAccion(resultado);
    return resultado.ok ? okConId(base.mensaje, resultado.datos.productoId, resultado.datos.nombre) : error(base.mensaje);
  });
}
