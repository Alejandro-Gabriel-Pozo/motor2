import "server-only";
import { validarFechaDeMenuDelDia } from "@/core/carta/public";
import type { ComandoAgregarPlatoDelDia, ResultadoAgregarPlatoDelDia } from "@/core/features/carta/menu-del-dia.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { diaDeCalendario, fechaDeColumnaDate } from "@/core/tiempo/zona-horaria";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { crearPlatoDelDia, fijarActivaDePlatoDelDia } from "@/server/persistencia/carta/combos";
import { validarPlatoDelDiaEnTx } from "./componentes-de-combo-en-tx";

/**
 * Caso de uso «que este producto sea plato del día de este lugar, en esta fecha, en la sucursal ACTIVA» (GO-3b, ADR-032, D-1 y D-5, paso D5). El encargado (o quien tenga `promo_menu_del_dia`)
 * ELIGE un producto de venta que ya existe —para cocinar algo nuevo se da de alta el PV y se arma su receta (D-9)—; no hay texto libre. Escribe SOLO en `actor.sucursalId` (el guard ya comparó el eco
 * de la pantalla con la activa; las políticas por sucursal son la segunda barrera).
 *
 * Dentro de UNA transacción SERIALIZABLE, sin escribir nada hasta el final:
 *  1. la fecha: de hoy a hoy + 13, con «hoy» de la zona de la empresa (`diaDeCalendario(actor.ahora, …)`: a las 23:30 del 13/10 en Buenos Aires ya es 14/10 en UTC, pero hoy es el 13);
 *  2. el lugar: existe (la RLS oculta el de otra empresa), es un DEL_DIA y está activo;
 *  3. el producto como plato del día (`validarPlatoDelDiaEnTx`): PV, no ancla, sin opciones obligatorias, precio de referencia de la sucursal (D-8), receta vigente en la sucursal o stock propio
 *     (D-9), disponible en la sucursal y sin mezclar alícuotas con los demás componentes del menú (D-2);
 *  4. «llevar al estado activo»: si ya es plato del día de esa fecha, no se escribe ni se audita; si estaba quitado, se vuelve a poner; si no, se crea.
 * Cada escritura con su fila de auditoría (`EntradaDelDiaDeCupo`, `activa`, con la sucursal), en la misma transacción.
 *
 * @contract Deja el producto como plato del día de ese lugar, en esa fecha y en la sucursal activa, con su auditoría, si puede serlo; si no, no escribe nada.
 * @idempotency Por estado — si ya es plato del día de esa fecha no se escribe ni se audita; dos encargados con el mismo plato a la vez dejan UNA fila (el único `(cupoId, sucursalId, fecha, productoId)` y el reintento).
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: las lecturas que deciden, la escritura y la auditoría, juntas.
 * @sideEffects registrarCambioAuditado (`EntradaDelDiaDeCupo`, `activa`, con la sucursal), con el mismo `tx`.
 * @ficha permiso=promo_menu_del_dia transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function agregarPlatoDelDiaCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "sucursalNombre" | "empresaZonaHoraria" | "transaccion" | "ahora">,
  comando: ComandoAgregarPlatoDelDia,
): Promise<ResultadoAgregarPlatoDelDia> {
  const hoy = diaDeCalendario(actor.ahora, actor.empresaZonaHoraria);
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoAgregarPlatoDelDia> => {
      const enFecha = validarFechaDeMenuDelDia(comando.fecha, hoy);
      if (!enFecha.ok) return fracaso(enFecha.codigo, enFecha.mensaje);
      const cupo = await tx.promoCartaCupo.findFirst({ where: { id: comando.cupoId }, select: { id: true, tipo: true, activo: true, nombre: true, promoCartaId: true, promoCarta: { select: { titulo: true } } } });
      if (!cupo) return fracaso("CUPO_NO_ENCONTRADO", "No se encontró ese lugar del menú.");
      if (cupo.tipo !== "DEL_DIA") return fracaso("CUPO_INVALIDO", "Ese lugar de la promo no es un plato del día.");
      if (!cupo.activo) return fracaso("CUPO_INVALIDO", `«${cupo.nombre ?? ""}» está dado de baja en la promo.`);

      const validado = await validarPlatoDelDiaEnTx(tx, { sucursalId: actor.sucursalId, sucursalNombre: actor.sucursalNombre, promoCartaId: cupo.promoCartaId, productoId: comando.productoId, hoy });
      if (!validado.ok) return validado;
      const { producto } = validado;

      const fecha = fechaDeColumnaDate(comando.fecha);
      const existente = await tx.entradaDelDiaDeCupo.findUnique({
        where: { cupoId_sucursalId_fecha_productoId: { cupoId: cupo.id, sucursalId: actor.sucursalId, fecha, productoId: producto.id } },
        select: { id: true, activa: true },
      });
      const lugar = `«${cupo.nombre ?? ""}» de «${cupo.promoCarta.titulo}» del ${comando.fecha}`;
      if (existente?.activa) return exito(`«${producto.nombre}» ya era ${lugar}.`, { platoId: existente.id, huboCambio: false });
      let platoId: string;
      if (existente) {
        await fijarActivaDePlatoDelDia(tx, { id: existente.id, activa: true, actualizadoPorId: actor.usuarioId, ahora: actor.ahora });
        platoId = existente.id;
      } else {
        platoId = (await crearPlatoDelDia(tx, { cupoId: cupo.id, sucursalId: actor.sucursalId, fecha, productoId: producto.id, actualizadoPorId: actor.usuarioId, ahora: actor.ahora })).id;
      }
      await registrarCambioAuditado(tx, {
        entidad: "EntradaDelDiaDeCupo",
        entidadId: platoId,
        campo: "activa",
        descripcion: `Menú del día en «${actor.sucursalNombre}»: ${lugar}, «${producto.nombre}»`,
        valorAnterior: existente ? false : null,
        valorNuevo: true,
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });
      return exito(`«${producto.nombre}» quedó como ${lugar}.`, { platoId, huboCambio: true });
    },
    undefined,
    undefined,
    true,
  );
}
