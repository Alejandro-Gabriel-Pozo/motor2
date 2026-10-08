import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { whereCartaDeSucursal } from "@/core/carta/public";
import type { ComandoCopiarCartaDeSucursal, ResultadoCopiarCartaDeSucursal } from "@/core/features/carta/copiar-carta.schema";
import { esConflictoDeEscritura } from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { copiarContenidosDeCarta, copiarGeneroDeCarta, copiarItemAgrupadoDeCarta, copiarOpcionesDeItemAgrupado } from "@/server/persistencia/carta/copiar-carta";

/**
 * Caso de uso «copiar la carta PROPIA de otra sucursal a la sucursal activa» (ADR-009, C3/C4; decisión del dueño 2026-10-02; Hito 5, bloque D,
 * `docs/plan-hito-5-pureza.md` §6.1). Es el cuerpo que antes vivía en línea en la Server Action `copiarCartaDeSucursal` (`src/server/actions/carta/copiar-carta.ts`), movido
 * TAL CUAL: géneros, ítems agrupados con sus opciones y el contenido de cada producto (sección, descripción, orden, género…). Las secciones son de la empresa y no se
 * copian: ya están. No toca promos ni cupos. La Server Action quedó como adaptador (`conPermiso("carta_copiar_de_sucursal")` → `guardComandoCopiarCartaDeSucursal` → este caso
 * de uso → `revalidarCartasPublicas` si salió bien → `aResultadoAccion`). Antes la invalidación iba dentro del callback de la transacción, antes de confirmar: ahora la
 * hace la acción DESPUÉS de confirmar (mismo precedente que `fijarRendimientoLocal`, H4C-5), y una sola vez aunque la transacción se reintente.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni la confirmación ni que el origen sea otro (el guard). Nunca recibe el destino por
 * parámetro: siempre `actor.sucursalId`.
 *
 * Solo copia sobre una carta VACÍA (la familia es «opt-in»: una sucursal sin carta no muestra nada hasta que la arma o la copia). Nunca pisa ni mezcla con una carta ya armada:
 * si el destino tiene aunque sea un contenido, un género o un ítem propios, rechaza. La comprobación y la copia van en la MISMA transacción SERIALIZABLE, así dos copias a la vez
 * no duplican ni se mezclan; agotados los reintentos de un conflicto de escritura, responde que la carta cambió.
 *
 * Orden, igual que antes: 1. el origen existe (`No se encontró esa sucursal.`, leído FUERA de la transacción con `actor.db`); 2. DENTRO de la transacción: que el destino no tenga carta
 * propia (`Esta sucursal ya tiene carta propia…`); 3. que el origen tenga algo (`«<origen>» no tiene carta propia: no hay nada que copiar.`); 4. se copian los géneros (uno por uno),
 * los ítems agrupados con sus opciones (uno por uno, con el género reapuntado) y los contenidos (de una vez, con el género reapuntado); 5. se audita, con el `tx` del callback.
 *
 * @contract Deja en la sucursal activa una copia de la carta propia del origen (géneros, ítems agrupados con sus opciones y contenidos), solo si estaba vacía y el origen tiene algo; todo o nada; devuelve cuánto se copió.
 * @idempotency Por estado — repetir el pedido encuentra la carta ya copiada y se rechaza («ya tiene carta propia»).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento); agotados los reintentos, el conflicto vuelve como «La carta cambió mientras la copiabas; recargá e intentá de nuevo.».
 * @sideEffects registrarCambioAuditado (CartaSucursal.cartaPropia, con la cuenta de lo copiado), en la misma transacción. La invalidación de la carta pública la hace la Server Action.
 * @ficha permiso=carta_copiar_de_sucursal transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function copiarCartaDeSucursalCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "transaccion" | "usuarioId" | "sucursalId" | "sucursalNombre">,
  comando: ComandoCopiarCartaDeSucursal,
): Promise<ResultadoCopiarCartaDeSucursal> {
  const { sucursalOrigenId } = comando;
  const origen = await actor.db.sucursal.findUnique({ where: { id: sucursalOrigenId }, select: { nombre: true } });
  if (!origen) return fracaso("ORIGEN_NO_ENCONTRADO", "No se encontró esa sucursal.");

  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoCopiarCartaDeSucursal> => {
    const [contenidosPropios, generosPropios, itemsPropios] = await Promise.all([
      tx.contenidoCartaProducto.count({ where: whereCartaDeSucursal(actor.sucursalId) }),
      tx.generoCarta.count({ where: whereCartaDeSucursal(actor.sucursalId) }),
      tx.itemAgrupadoCarta.count({ where: whereCartaDeSucursal(actor.sucursalId) }),
    ]);
    if (contenidosPropios + generosPropios + itemsPropios > 0) return fracaso("CARTA_PROPIA_EXISTENTE", "Esta sucursal ya tiene carta propia: solo se puede copiar sobre una carta vacía.");

    const [generos, items, contenidos] = await Promise.all([
      tx.generoCarta.findMany({ where: whereCartaDeSucursal(sucursalOrigenId), orderBy: [{ orden: "asc" }, { creadoEn: "asc" }, { id: "asc" }] }),
      tx.itemAgrupadoCarta.findMany({ where: whereCartaDeSucursal(sucursalOrigenId), include: { opciones: { orderBy: [{ orden: "asc" }, { id: "asc" }] } }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] }),
      tx.contenidoCartaProducto.findMany({ where: whereCartaDeSucursal(sucursalOrigenId), orderBy: { id: "asc" } }),
    ]);
    if (generos.length + items.length + contenidos.length === 0) return fracaso("ORIGEN_SIN_CARTA", `«${origen.nombre}» no tiene carta propia: no hay nada que copiar.`);

    const generoNuevo = new Map<string, string>();
    for (const g of generos) {
      const nuevo = await copiarGeneroDeCarta(tx, { sucursalId: actor.sucursalId, nombre: g.nombre, orden: g.orden, activo: g.activo });
      generoNuevo.set(g.id, nuevo.id);
    }
    const remapearGenero = (id: string | null) => (id ? (generoNuevo.get(id) ?? null) : null);

    for (const it of items) {
      const nuevo = await copiarItemAgrupadoDeCarta(tx, {
        sucursalId: actor.sucursalId,
        nombre: it.nombre,
        seccionCartaId: it.seccionCartaId,
        descripcion: it.descripcion,
        tags: it.tags,
        especial: it.especial,
        orden: it.orden,
        activo: it.activo,
        generoCartaId: remapearGenero(it.generoCartaId),
      });
      if (it.opciones.length > 0) {
        await copiarOpcionesDeItemAgrupado(tx, { sucursalId: actor.sucursalId, itemAgrupadoCartaId: nuevo.id, opciones: it.opciones });
      }
    }

    if (contenidos.length > 0) {
      await copiarContenidosDeCarta(tx, {
        sucursalId: actor.sucursalId,
        contenidos: contenidos.map((c) => ({
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
      entidadId: actor.sucursalId,
      campo: "cartaPropia",
      descripcion: `Carta de «${actor.sucursalNombre}»: copiada de «${origen.nombre}» (${contenidos.length} productos, ${items.length} ítems agrupados, ${generos.length} géneros)`,
      valorAnterior: null,
      valorNuevo: `copiada de ${origen.nombre}`,
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });
    return exito(`Se copió la carta de «${origen.nombre}» a «${actor.sucursalNombre}»: ${contenidos.length} productos, ${items.length} ítems agrupados y ${generos.length} géneros.`, {
      productos: contenidos.length,
      itemsAgrupados: items.length,
      generos: generos.length,
    });
  }).catch((e): ResultadoCopiarCartaDeSucursal => {
    // conTransaccionSerializable ya reintenta un conflicto de escritura (esConflictoDeEscritura) — esto solo cubre el caso de agotar los reintentos.
    if (esConflictoDeEscritura(e)) return fracaso("CARTA_CAMBIO", "La carta cambió mientras la copiabas; recargá e intentá de nuevo.");
    throw e;
  });
}
