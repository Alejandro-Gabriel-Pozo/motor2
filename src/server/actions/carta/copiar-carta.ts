"use server";

import { whereCartaDeSucursal } from "@/core/carta/public";
import { esConflictoDeEscritura } from "@/core/movimientos/public-servidor";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";
import { revalidarCartasPublicas } from "./revalidar";

/**
 * Copia la carta PROPIA de otra sucursal a la sucursal activa (ADR-009, C3/C4; decisión del dueño 2026-10-02): géneros, ítems agrupados con sus
 * opciones y el contenido de cada producto (sección, descripción, orden, género…). Las secciones son de la empresa y no se copian: ya están.
 *
 * Solo copia sobre una carta VACÍA (la familia es «opt-in»: una sucursal sin carta no muestra nada hasta que la arma o la copia). Nunca pisa ni
 * mezcla con una carta ya armada: si la sucursal tiene aunque sea un contenido, un género o un ítem propios, rechaza. La comprobación y la copia
 * van en la MISMA transacción serializable, así dos copias a la vez no duplican ni se mezclan. Nunca recibe el destino por parámetro (siempre
 * `ctx.sucursalId`) y exige la confirmación explícita. Una clave propia: `carta_copiar_de_sucursal`. No toca promos ni cupos.
 */
export async function copiarCartaDeSucursal(sucursalOrigenId: string, confirmado: boolean): Promise<ResultadoAccion> {
  return conPermiso("carta_copiar_de_sucursal", async (ctx) => {
    if (!confirmado) return error("Confirmá que querés copiar la carta de otra sucursal a esta.");
    if (sucursalOrigenId === ctx.sucursalId) return error("Elegí otra sucursal: no se puede copiar de la misma.");
    const origen = await ctx.db.sucursal.findUnique({ where: { id: sucursalOrigenId }, select: { nombre: true } });
    if (!origen) return error("No se encontró esa sucursal.");

    return conTransaccionSerializable(ctx.transaccion, async (tx) => {
      const [contenidosPropios, generosPropios, itemsPropios] = await Promise.all([
        tx.contenidoCartaProducto.count({ where: whereCartaDeSucursal(ctx.sucursalId) }),
        tx.generoCarta.count({ where: whereCartaDeSucursal(ctx.sucursalId) }),
        tx.itemAgrupadoCarta.count({ where: whereCartaDeSucursal(ctx.sucursalId) }),
      ]);
      if (contenidosPropios + generosPropios + itemsPropios > 0) return error("Esta sucursal ya tiene carta propia: solo se puede copiar sobre una carta vacía.");

      const [generos, items, contenidos] = await Promise.all([
        tx.generoCarta.findMany({ where: whereCartaDeSucursal(sucursalOrigenId), orderBy: [{ orden: "asc" }, { creadoEn: "asc" }, { id: "asc" }] }),
        tx.itemAgrupadoCarta.findMany({ where: whereCartaDeSucursal(sucursalOrigenId), include: { opciones: { orderBy: [{ orden: "asc" }, { id: "asc" }] } }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] }),
        tx.contenidoCartaProducto.findMany({ where: whereCartaDeSucursal(sucursalOrigenId), orderBy: { id: "asc" } }),
      ]);
      if (generos.length + items.length + contenidos.length === 0) return error(`«${origen.nombre}» no tiene carta propia: no hay nada que copiar.`);

      const generoNuevo = new Map<string, string>();
      for (const g of generos) {
        const nuevo = await tx.generoCarta.create({ data: { sucursalId: ctx.sucursalId, nombre: g.nombre, orden: g.orden, activo: g.activo }, select: { id: true } });
        generoNuevo.set(g.id, nuevo.id);
      }
      const remapearGenero = (id: string | null) => (id ? (generoNuevo.get(id) ?? null) : null);

      for (const it of items) {
        const nuevo = await tx.itemAgrupadoCarta.create({
          data: {
            sucursalId: ctx.sucursalId,
            nombre: it.nombre,
            seccionCartaId: it.seccionCartaId,
            descripcion: it.descripcion,
            tags: it.tags,
            especial: it.especial,
            orden: it.orden,
            activo: it.activo,
            generoCartaId: remapearGenero(it.generoCartaId),
          },
          select: { id: true },
        });
        if (it.opciones.length > 0) {
          await tx.opcionItemAgrupadoCarta.createMany({
            data: it.opciones.map((o) => ({ sucursalId: ctx.sucursalId, itemAgrupadoCartaId: nuevo.id, productoId: o.productoId, orden: o.orden })),
          });
        }
      }

      if (contenidos.length > 0) {
        await tx.contenidoCartaProducto.createMany({
          data: contenidos.map((c) => ({
            sucursalId: ctx.sucursalId,
            productoId: c.productoId,
            visibleEnCarta: c.visibleEnCarta,
            seccionCartaId: c.seccionCartaId,
            descripcion: c.descripcion,
            tags: c.tags,
            especial: c.especial,
            orden: c.orden,
            generoCartaId: remapearGenero(c.generoCartaId),
          })),
        });
      }

      await registrarCambioAuditado(tx, {
        entidad: "CartaSucursal",
        entidadId: ctx.sucursalId,
        campo: "cartaPropia",
        descripcion: `Carta de «${ctx.sucursalNombre}»: copiada de «${origen.nombre}» (${contenidos.length} productos, ${items.length} ítems agrupados, ${generos.length} géneros)`,
        valorAnterior: null,
        valorNuevo: `copiada de ${origen.nombre}`,
        actorId: ctx.usuarioId,
        sucursalId: ctx.sucursalId,
      });
      revalidarCartasPublicas();
      return ok(`Se copió la carta de «${origen.nombre}» a «${ctx.sucursalNombre}»: ${contenidos.length} productos, ${items.length} ítems agrupados y ${generos.length} géneros.`);
    }).catch((e) => {
      if (esConflictoDeEscritura(e)) return error("La carta cambió mientras la copiabas; recargá e intentá de nuevo.");
      throw e;
    });
  });
}
