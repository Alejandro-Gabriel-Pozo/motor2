import "server-only";
import { validarFechaDeMenuDelDia } from "@/core/carta/public";
import type { ComandoCopiarMenuDelDiaAnterior, ResultadoCopiarMenuDelDiaAnterior } from "@/core/features/carta/menu-del-dia.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { diaDeCalendario, fechaDeColumnaDate, sumarDias } from "@/core/tiempo/zona-horaria";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { crearPlatoDelDia, fijarActivaDePlatoDelDia } from "@/server/persistencia/carta/combos";
import { validarPlatoDelDiaEnTx } from "./componentes-de-combo-en-tx";

/**
 * Caso de uso «copiar el menú del día anterior» en la sucursal ACTIVA (GO-3b, ADR-032, D-1, paso D5): los platos del día ACTIVOS del día anterior a `fecha` (de los lugares DEL_DIA activos) pasan a
 * ser platos del día de `fecha`, en la misma sucursal. Es una CARGA: cada plato vuelve a validarse como si se cargara a mano (receta, precio, disponibilidad, alícuotas: `validarPlatoDelDiaEnTx`), y
 * TODO O NADA: si alguno ya no puede ser plato del día (por ejemplo, perdió la receta), no se copia ninguno y el mensaje dice cuál y por qué (se arregla o se carga a mano). Los que ya estaban en
 * `fecha` no se tocan (por estado). Cada escritura con su fila de auditoría (`EntradaDelDiaDeCupo`, `activa`, con la sucursal).
 *
 * @contract Deja como platos del día de `fecha` en la sucursal activa los del día anterior (todos, con su auditoría), o ninguno.
 * @idempotency Por estado — repetir la copia no escribe ni audita nada (cada plato ya está); dos copias a la vez dejan una fila por plato (el único y el reintento).
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: las lecturas que deciden, las escrituras y la auditoría, juntas.
 * @sideEffects registrarCambioAuditado (`EntradaDelDiaDeCupo`, `activa`, con la sucursal), con el mismo `tx`.
 * @ficha permiso=promo_menu_del_dia transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function copiarMenuDelDiaAnteriorCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "sucursalNombre" | "empresaZonaHoraria" | "transaccion" | "ahora">,
  comando: ComandoCopiarMenuDelDiaAnterior,
): Promise<ResultadoCopiarMenuDelDiaAnterior> {
  const hoy = diaDeCalendario(actor.ahora, actor.empresaZonaHoraria);
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoCopiarMenuDelDiaAnterior> => {
      const enFecha = validarFechaDeMenuDelDia(comando.fecha, hoy);
      if (!enFecha.ok) return fracaso(enFecha.codigo, enFecha.mensaje);
      const anterior = sumarDias(comando.fecha, -1);
      const delAnterior = await tx.entradaDelDiaDeCupo.findMany({
        where: { sucursalId: actor.sucursalId, fecha: fechaDeColumnaDate(anterior), activa: true, cupo: { tipo: "DEL_DIA", activo: true } },
        orderBy: [{ cupoId: "asc" }, { productoId: "asc" }],
        select: { cupoId: true, productoId: true, cupo: { select: { nombre: true, promoCartaId: true, promoCarta: { select: { titulo: true } } } } },
      });
      if (delAnterior.length === 0) return fracaso("SIN_PLATOS_PARA_COPIAR", `El ${anterior} no tenía ningún plato del día cargado en «${actor.sucursalNombre}».`);

      // Todo validado ANTES de escribir: un plato que ya no puede serlo frena la copia entera.
      const aCopiar: { cupoId: string; productoId: string; nombre: string; lugar: string }[] = [];
      for (const p of delAnterior) {
        const validado = await validarPlatoDelDiaEnTx(tx, { sucursalId: actor.sucursalId, sucursalNombre: actor.sucursalNombre, promoCartaId: p.cupo.promoCartaId, productoId: p.productoId, hoy });
        if (!validado.ok) return fracaso(validado.codigo, `No se copió el menú: ${validado.mensaje}`);
        aCopiar.push({ cupoId: p.cupoId, productoId: p.productoId, nombre: validado.producto.nombre, lugar: `«${p.cupo.nombre ?? ""}» de «${p.cupo.promoCarta.titulo}» del ${comando.fecha}` });
      }

      const fecha = fechaDeColumnaDate(comando.fecha);
      let copiados = 0;
      for (const p of aCopiar) {
        const existente = await tx.entradaDelDiaDeCupo.findUnique({
          where: { cupoId_sucursalId_fecha_productoId: { cupoId: p.cupoId, sucursalId: actor.sucursalId, fecha, productoId: p.productoId } },
          select: { id: true, activa: true },
        });
        if (existente?.activa) continue;
        let platoId: string;
        if (existente) {
          await fijarActivaDePlatoDelDia(tx, { id: existente.id, activa: true, actualizadoPorId: actor.usuarioId, ahora: actor.ahora });
          platoId = existente.id;
        } else {
          platoId = (await crearPlatoDelDia(tx, { cupoId: p.cupoId, sucursalId: actor.sucursalId, fecha, productoId: p.productoId, actualizadoPorId: actor.usuarioId, ahora: actor.ahora })).id;
        }
        await registrarCambioAuditado(tx, {
          entidad: "EntradaDelDiaDeCupo",
          entidadId: platoId,
          campo: "activa",
          descripcion: `Menú del día en «${actor.sucursalNombre}» (copiado del ${anterior}): ${p.lugar}, «${p.nombre}»`,
          valorAnterior: existente ? false : null,
          valorNuevo: true,
          actorId: actor.usuarioId,
          sucursalId: actor.sucursalId,
        });
        copiados++;
      }
      return exito(
        copiados === 0 ? `El menú del ${comando.fecha} ya tenía todos los platos del ${anterior}.` : `Se copiaron ${copiados} plato(s) del día del ${anterior} al ${comando.fecha}.`,
        { copiados },
      );
    },
    undefined,
    undefined,
    true,
  );
}
