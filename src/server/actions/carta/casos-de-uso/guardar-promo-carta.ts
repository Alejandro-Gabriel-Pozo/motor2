import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoGuardarPromoCarta, ResultadoGuardarPromoCarta } from "@/core/features/carta/promos.schema";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { exito, fracaso } from "@/core/resultado-caso";
import { cambiarDatosDePromo, crearPromoPrendidaEnSucursal } from "@/server/persistencia/carta/promos";

/**
 * Caso de uso «guardar una promo de la empresa» (alta o edición; Hito 4 de la pureza, bloque 4.2, paso H4C-2 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que
 * antes vivía en línea en la Server Action `guardarPromoCarta` (`src/server/actions/carta/promos.ts`), movido TAL CUAL: las mismas lecturas (con la base del
 * contexto, FUERA de la transacción), el mismo orden de chequeos, los mismos mensajes y la misma fila de auditoría del precio dentro de la transacción del
 * cambio. La Server Action quedó como adaptador (`conPermisoDeEmpresa("carta_promo_definir")` → `guardComandoGuardarPromoCarta` → este caso de uso →
 * `revalidarCartasPublicas` si salió bien → `aResultadoAccion`). El criterio de negocio (la promo es de la empresa; cada sucursal la prende y le pone su precio)
 * está documentado en la Server Action.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato de los datos (el guard).
 *
 * Orden, igual que antes: 1. la sección de carta («No se encontró la sección de carta.»); 2a. edición (`id`): la promo («No se encontró la promo.»), y en UNA
 * transacción sus cinco datos y, SOLO si el precio cambió, la fila de auditoría del precio (del anterior al nuevo); 2b. alta: en UNA transacción la promo
 * prendida en la sucursal activa y la fila de auditoría del precio (de `null` al pedido). Hallazgo fijado por la huella de dinero del tramo C y NO cambiado acá:
 * la edición no mira el piso de los cupos de la promo (un precio de la empresa por debajo de $0,01 por unidad del peor caso se guarda igual).
 *
 * @contract Deja la promo (nueva, prendida en la sucursal activa, o la existente con sus datos nuevos) con el registro de auditoría de su precio si cambió: los dos o ninguno.
 * @idempotency No aplica — un alta repetida crea otra promo (no se deduplica por título, como antes); repetir una edición vuelve a escribir los mismos datos (sin fila de auditoría nueva).
 * @transaction `actor.transaccion` (READ COMMITTED): la escritura y su auditoría juntas; las lecturas previas (sección, promo) van con `actor.db`, como antes.
 * @sideEffects registrarCambioAuditado (PromoCarta.precio, del anterior —o `null` en el alta— al nuevo), en la misma transacción. La revalidación de la carta
 *   pública la hace la Server Action cuando sale bien.
 * @ficha permiso=carta_promo_definir transaccion=SIMPLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarPromoCartaCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "transaccion" | "usuarioId" | "sucursalId">,
  comando: ComandoGuardarPromoCarta,
): Promise<ResultadoGuardarPromoCarta> {
  const seccion = await actor.db.seccionCarta.findUnique({ where: { id: comando.seccionCartaId } });
  if (!seccion) return fracaso("SECCION_NO_ENCONTRADA", "No se encontró la sección de carta.");

  const datos = { seccionCartaId: seccion.id, titulo: comando.titulo, descripcion: comando.descripcion, precio: comando.precio, orden: comando.orden };
  if (comando.id) {
    const existente = await actor.db.promoCarta.findUnique({ where: { id: comando.id } });
    if (!existente) return fracaso("PROMO_NO_ENCONTRADA", "No se encontró la promo.");
    // El cambio y su rastro van en UNA transacción (Pureza 0.7): un precio de promo cambiado sin dejar quién ni cuándo no puede existir.
    await actor.transaccion(async (tx) => {
      await cambiarDatosDePromo(tx, { id: existente.id, ...datos });
      if (Number(existente.precio) !== comando.precio) await auditarPrecioDePromo(tx, actor.usuarioId, existente.id, comando.titulo, Number(existente.precio), comando.precio);
    });
    return exito(`Promo "${comando.titulo}" guardada.`, null);
  }
  // La sucursal desde la que se crea la ofrece desde el primer momento; las demás la prenden cuando quieran (opt-in, sin fila = no la ofrecen).
  await actor.transaccion(async (tx) => {
    const creada = await crearPromoPrendidaEnSucursal(tx, { ...datos, sucursalId: actor.sucursalId });
    await auditarPrecioDePromo(tx, actor.usuarioId, creada.id, comando.titulo, null, comando.precio);
  });
  return exito(`Promo "${comando.titulo}" creada en "${seccion.nombre}" y prendida en esta sucursal.`, null);
}

/** Deja en la auditoría quién cambió (o definió) el precio de una promo de la empresa y cuándo; va dentro de la transacción del cambio. */
async function auditarPrecioDePromo(tx: Parameters<typeof registrarCambioAuditado>[0], actorId: string, promoCartaId: string, titulo: string, anterior: number | null, nuevo: number) {
  await registrarCambioAuditado(tx, {
    entidad: "PromoCarta",
    entidadId: promoCartaId,
    campo: "precio",
    descripcion: `Promo "${titulo}": precio`,
    valorAnterior: anterior,
    valorNuevo: nuevo,
    actorId,
  });
}
