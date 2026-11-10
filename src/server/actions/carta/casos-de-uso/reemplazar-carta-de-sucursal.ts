import "server-only";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import { cartaCopiadaPara, cartaTieneAlgo, cuentaDeCarta, decidirCopiaDeCarta, firmaDeCarta, fotoDeCartaEliminada } from "@/core/features/carta/reemplazar-carta";
import type { ComandoReemplazarCartaDeSucursal, ResultadoReemplazarCartaDeSucursal } from "@/core/features/carta/copiar-carta.schema";
import { esConflictoDeEscritura } from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { conAlcanceEnSucursal } from "@/server/acceso/alcance";
import { leerOrigenDeCopia } from "@/server/acceso/origen-de-copia";
import { borrarCartaPropiaDeSucursal } from "@/server/persistencia/carta/copiar-carta";
import { escribirCartaCopiada, leerCartaDeSucursal, titulosDePromoDeLaSucursal } from "./copiar-carta-de-sucursal";

/**
 * Caso de uso «reemplazar la carta PROPIA de la sucursal activa con la de otra sucursal» (pedido del dueño, 2026-11-10; `docs/diseno-reemplazar-carta-de-sucursal-2026-11-10.md`). Hermano de
 * `copiar-carta-de-sucursal.ts` (que solo copia sobre una carta VACÍA y sigue igual): reutiliza su lectura de la carta (`leerCartaDeSucursal`) y su escritura (`escribirCartaCopiada`, que usa
 * `copiarGeneroDeCarta`, `copiarItemAgrupadoDeCarta`, `copiarOpcionesDeItemAgrupado` y `copiarContenidosDeCarta`) y suma el borrado de lo que el destino tenía.
 *
 * Se reemplazan los géneros, los ítems agrupados (con sus opciones) y los contenidos de producto del destino por los del origen. NO se tocan promos, cupos, secciones, tema, descuentos, disponibilidad,
 * precios, recetas ni ninguna otra sucursal; el origen solo se lee. Nada de dinero, stock ni comprobantes se borra: ninguna tabla referencia las filas de carta (ver el diseño, N5).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni la confirmación escrita ni que el origen sea otro (el guard `guardComandoReemplazarCartaDeSucursal`, dentro del
 * `conPermiso`). Nunca recibe el destino por parámetro: siempre `actor.sucursalId`. El origen se lee SOLO con membresía y `carta_ver` en esa sucursal (`leerOrigenDeCopia`, S-07/O.56) y, recién después,
 * la transacción lo lee con el alcance ensanchado A SU LECTURA (M.3-A5).
 *
 * Orden: 1. el origen existe, está activo y se puede ver; 2. DENTRO de la transacción SERIALIZABLE: se leen el destino y el origen; 3. `decidirCopiaDeCarta`: un origen sin carta rechaza sin tocar nada; un
 * destino que ya queda igual (misma firma por contenido, con la regla del nombre en carta aplicada) no cambia nada ni audita; 4. se AUDITA con la foto completa de lo que se elimina (para reconstruirlo a
 * mano; no hay «deshacer» en pantalla), se borra la carta del destino y se escribe la copia, todo en la misma transacción.
 *
 * @contract Deja en la sucursal activa la carta propia del origen (géneros, ítems agrupados con sus opciones y contenidos) y elimina la que tenía; todo o nada; devuelve cuánto se eliminó y cuánto se copió.
 * @idempotency Por estado — si el destino ya es igual al origen (por contenido) no escribe ni audita; repetir el pedido con el origen sin cambios no duplica nada.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento): dos reemplazos a la vez no se mezclan (el segundo relee y ve la carta ya igual); agotados los reintentos, «La carta cambió mientras la reemplazabas; recargá e intentá de nuevo.».
 * @sideEffects registrarCambioAuditado (CartaSucursal.cartaPropia: quién, cuándo, origen, cuentas y la foto de lo eliminado), en la misma transacción. La invalidación de la carta pública la hace la Server Action DESPUÉS de confirmar y solo si hubo cambio.
 * @ficha permiso=carta_copiar_de_sucursal transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function reemplazarCartaDeSucursalCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "transaccion" | "usuarioId" | "sucursalId" | "sucursalNombre" | "empresaId" | "membresias" | "alcance">,
  comando: ComandoReemplazarCartaDeSucursal,
): Promise<ResultadoReemplazarCartaDeSucursal> {
  const { sucursalOrigenId } = comando;
  const lectura = await leerOrigenDeCopia(actor, sucursalOrigenId, "carta_ver");
  if (!lectura.ok) return fracaso(lectura.codigo === "SIN_ACCESO" ? "ORIGEN_SIN_ACCESO" : "ORIGEN_NO_ENCONTRADO", lectura.mensaje);
  const origen = { nombre: lectura.nombre };
  const conOrigen = conAlcanceEnSucursal(actor, sucursalOrigenId, "LECTURA");

  return conTransaccionSerializable(conOrigen.transaccion, async (tx): Promise<ResultadoReemplazarCartaDeSucursal> => {
    const [destino, origenLeido] = await Promise.all([leerCartaDeSucursal(tx, actor.sucursalId), leerCartaDeSucursal(tx, sucursalOrigenId)]);
    const { carta, sinCopiarElNombre } = cartaCopiadaPara(origenLeido, await titulosDePromoDeLaSucursal(tx, actor.sucursalId));
    const decision = decidirCopiaDeCarta({
      modo: "REEMPLAZAR",
      destinoTieneCarta: cartaTieneAlgo(destino),
      origenTieneCarta: cartaTieneAlgo(origenLeido),
      sonIguales: firmaDeCarta(destino) === firmaDeCarta(carta),
    });
    if (decision === "ORIGEN_SIN_CARTA") return fracaso("ORIGEN_SIN_CARTA", `«${origen.nombre}» no tiene carta propia: no hay nada que copiar.`);
    const copiado = cuentaDeCarta(carta);
    if (decision === "SIN_CAMBIO") {
      return exito(`La carta de «${actor.sucursalNombre}» ya era igual a la de «${origen.nombre}»: no hay nada que reemplazar.`, { huboCambio: false, eliminado: { productos: 0, itemsAgrupados: 0, generos: 0 }, copiado });
    }
    // `decidirCopiaDeCarta` en REEMPLAZAR solo devuelve esas tres.
    if (decision !== "APLICAR") throw new Error(`reemplazarCartaDeSucursal: decisión inesperada ${decision}`);

    const eliminado = cuentaDeCarta(destino);
    // La foto de lo que se elimina (con el nombre de cada producto) se arma ANTES de borrar y se guarda en la auditoría (la escribe `escribirCartaCopiada`), en la misma transacción.
    const nombres = new Map<string, string>();
    const idsDeProducto = [...new Set([...destino.contenidos.map((c) => c.productoId), ...destino.items.flatMap((i) => i.opciones.map((o) => o.productoId))])];
    if (idsDeProducto.length > 0) for (const p of await tx.producto.findMany({ where: { id: { in: idsDeProducto } }, select: { id: true, nombre: true } })) nombres.set(p.id, p.nombre);
    await borrarCartaPropiaDeSucursal(tx, { sucursalId: actor.sucursalId });
    await escribirCartaCopiada(tx, {
      sucursalId: actor.sucursalId,
      carta,
      auditoria: {
        descripcion: `Carta de «${actor.sucursalNombre}»: reemplazada con la de «${origen.nombre}» (eliminó ${eliminado.productos} productos, ${eliminado.itemsAgrupados} ítems agrupados, ${eliminado.generos} géneros; copió ${copiado.productos} productos, ${copiado.itemsAgrupados} ítems agrupados, ${copiado.generos} géneros)`,
        valorAnterior: cartaTieneAlgo(destino) ? fotoDeCartaEliminada(destino, nombres) : null,
        valorNuevo: `reemplazada con la de ${origen.nombre} (sucursal ${sucursalOrigenId})`,
        actorId: actor.usuarioId,
      },
    });

    const aviso = sinCopiarElNombre.length > 0 ? ` No se copió el nombre en la carta de ${sinCopiarElNombre.length} plato(s) porque una promo de esta sucursal ya se llama igual: ${sinCopiarElNombre.map((c) => `«${c.nombreEnCarta}»`).join(", ")}.` : "";
    return exito(
      `Se reemplazó la carta de «${actor.sucursalNombre}» con la de «${origen.nombre}»: se eliminaron ${eliminado.productos} productos, ${eliminado.itemsAgrupados} ítems agrupados y ${eliminado.generos} géneros; se copiaron ${copiado.productos} productos, ${copiado.itemsAgrupados} ítems agrupados y ${copiado.generos} géneros.${aviso}`,
      { huboCambio: true, eliminado, copiado },
    );
  }).catch((e): ResultadoReemplazarCartaDeSucursal => {
    if (esConflictoDeEscritura(e)) return fracaso("CARTA_CAMBIO", "La carta cambió mientras la reemplazabas; recargá e intentá de nuevo.");
    throw e;
  });
}
