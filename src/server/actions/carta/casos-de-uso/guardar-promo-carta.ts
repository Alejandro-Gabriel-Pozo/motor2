import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { mensajePisoDePromo, pisoDePrecioDePromo } from "@/core/carta/piso-de-promo";
import type { ComandoGuardarPromoCarta, ResultadoGuardarPromoCarta } from "@/core/features/carta/promos.schema";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { requierePermiso } from "@/server/acceso/gate";
import { cambiarDatosDePromo, crearPromoEnSucursal } from "@/server/persistencia/carta/promos";

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
 * Orden: 1. la sección de carta («No se encontró la sección de carta.»); 2a. edición (`id`): la promo («No se encontró la promo.», leída con sus cupos), el piso
 * de sus cupos y, en UNA transacción, sus cinco datos y, SOLO si el precio cambió, la fila de auditoría del precio (del anterior al nuevo); 2b. alta: en UNA
 * transacción la promo, su fila de la sucursal activa (prendida si quien la crea tiene `carta_promo_activar` ALLÍ —S-10/D1, O.59—, apagada si no) y la fila de auditoría del precio
 * (de `null` al pedido; una promo nueva no tiene cupos: sin piso).
 *
 * O.42 (Hito 4, bloque D; CAMBIA COMPORTAMIENTO, aprobado por el dueño el 2026-10-08): la edición mira el piso de $0,01 por unidad del peor caso de los cupos
 * VIGENTES de la promo (`pisoDePrecioDePromo`/`mensajePisoDePromo`, `core/carta/piso-de-promo.ts`, los mismos que usan los cupos y el precio local) y rechaza con
 * el mismo mensaje (`BAJO_EL_PISO`, con el título que se está guardando) sin escribir nada. Antes, el precio de la empresa de una promo con 3 unidades de cupo
 * podía bajar a $0,01 (hallazgo que fijaba la huella de dinero del tramo C). Sin cupos no hay piso. Red: `test/carta/promo-edicion-piso.test.ts`.
 *
 * @contract Deja la promo (nueva, con su fila en la sucursal activa prendida solo si quien la crea puede prenderla allí, o la existente con sus datos nuevos, con el precio en o sobre el piso de sus cupos) con el registro de auditoría de su precio si cambió: los dos o ninguno.
 * @idempotency No aplica — un alta repetida crea otra promo (no se deduplica por título, como antes); repetir una edición vuelve a escribir los mismos datos (sin fila de auditoría nueva).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento; M14 / S-51): las lecturas (sección, promo con sus cupos), el piso, la escritura y su auditoría, todo junto. La clave de prender (un gate) se lee con `actor.db` (M19).
 * @sideEffects registrarCambioAuditado (PromoCarta.precio, del anterior —o `null` en el alta— al nuevo), en la misma transacción. La revalidación de la carta
 *   pública la hace la Server Action cuando sale bien.
 * @ficha permiso=carta_promo_definir transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarPromoCartaCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "transaccion" | "usuarioId" | "sucursalId">,
  comando: ComandoGuardarPromoCarta,
): Promise<ResultadoGuardarPromoCarta> {
  // M14 (S-51): TODO va en UNA transacción SERIALIZABLE —la sección, la promo con sus cupos, el piso, la escritura y la auditoría—. Antes las lecturas iban con `actor.db`,
  // afuera: dos pedidos a la vez (este contra `guardarCuposPromoCarta` o el precio local) leían cada uno el estado viejo del otro y el precio podía quedar bajo el piso de los cupos nuevos. Ahora
  // Postgres aborta a uno de los dos (40001), el reintento repite y la relectura rechaza. Los rechazos devuelven ANTES de escribir; el cuerpo puede reintentarse: no tiene efectos fuera de la base.
  const prendida = comando.id ? false : (await requierePermiso(actor.usuarioId, actor.sucursalId, "carta_promo_activar", actor.db)).ok;
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoGuardarPromoCarta> => {
    const seccion = await tx.seccionCarta.findUnique({ where: { id: comando.seccionCartaId } });
    if (!seccion) return fracaso("SECCION_NO_ENCONTRADA", "No se encontró la sección de carta.");

    const datos = { seccionCartaId: seccion.id, titulo: comando.titulo, descripcion: comando.descripcion, precio: comando.precio, orden: comando.orden };
    if (comando.id) {
      const existente = await tx.promoCarta.findUnique({ where: { id: comando.id }, include: { cupos: { select: { cantidadMaxima: true } } } });
      if (!existente) return fracaso("PROMO_NO_ENCONTRADA", "No se encontró la promo.");
      // O.42: el MISMO piso que rige al guardar los cupos y el precio local (peor caso: todos los cupos en su máximo), contra los cupos vigentes. Sin cupos, sin piso.
      const piso = pisoDePrecioDePromo(existente.cupos);
      if (piso !== null && comando.precio < piso.minimo) return fracaso("BAJO_EL_PISO", mensajePisoDePromo(comando.titulo, comando.precio, piso));
      // El cambio y su rastro van juntos (Pureza 0.7): un precio de promo cambiado sin dejar quién ni cuándo no puede existir.
      await cambiarDatosDePromo(tx, { id: existente.id, ...datos });
      if (Number(existente.precio) !== comando.precio) await auditarPrecioDePromo(tx, actor.usuarioId, existente.id, comando.titulo, Number(existente.precio), comando.precio);
      return exito(`Promo "${comando.titulo}" guardada.`, null);
    }
    // S-10/D1 (O.59): definir la promo es de la EMPRESA (`carta_promo_definir`, vale con la membresía de cualquier sucursal); PRENDERLA en una sucursal es de ESA sucursal
    // (`carta_promo_activar`). La sucursal desde la que se crea la ofrece desde el primer momento SOLO si quien la crea puede prenderla allí; si no, la fila de esa sucursal nace
    // APAGADA (la promo existe y la prende quien pueda). Las demás la prenden cuando quieran (opt-in, sin fila = no la ofrecen). La clave es un permiso (el gate de `server/acceso` solo habla con la
    // base del contexto, no con un `tx`): se lee con `actor.db`, como todo gate, y es del conjunto declarado de M19 (los gates se leen fuera de la transacción de escritura), no del piso de la promo.
    const creada = await crearPromoEnSucursal(tx, { ...datos, sucursalId: actor.sucursalId, prendida });
    await auditarPrecioDePromo(tx, actor.usuarioId, creada.id, comando.titulo, null, comando.precio);
    return exito(
      prendida
        ? `Promo "${comando.titulo}" creada en "${seccion.nombre}" y prendida en esta sucursal.`
        : `Promo "${comando.titulo}" creada en "${seccion.nombre}". Queda apagada en esta sucursal: la prende quien tenga el permiso de prender promos.`,
      null,
    );
  });
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
