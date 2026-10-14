import "server-only";
import { validarFechaDeMenuDelDia } from "@/core/carta/public";
import type { ComandoQuitarPlatoDelDia, ResultadoQuitarPlatoDelDia } from "@/core/features/carta/menu-del-dia.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { diaDeCalendario, diaDeColumnaDate } from "@/core/tiempo/zona-horaria";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { fijarActivaDePlatoDelDia } from "@/server/persistencia/carta/combos";

/**
 * Caso de uso «que este plato deje de ser plato del día» en la sucursal ACTIVA (GO-3b, ADR-032, paso D5). No se borra: la fila queda inactiva (`activa = false`), con quién lo quitó y cuándo. Solo un
 * plato de la sucursal activa (uno de otra sucursal no se encuentra: se busca con la sucursal de la sesión, y la RLS por sucursal no lo deja ver) y de hoy en adelante (lo pasado no se toca). Lo que
 * ya está cargado en una mesa no cambia: si alguien está armando el menú con ese plato, su agregado lo rechaza (`ENTRADA_NO_DISPONIBLE`) y nunca cobra un plato quitado.
 *
 * @contract Deja el plato del día inactivo, con su auditoría.
 * @idempotency Por estado — si ya estaba quitado no se escribe ni se audita.
 * @transaction conTransaccionSerializable (SERIALIZABLE): la lectura, la escritura y la auditoría, juntas.
 * @sideEffects registrarCambioAuditado (`EntradaDelDiaDeCupo`, `activa`, con la sucursal), con el mismo `tx`.
 * @ficha permiso=promo_menu_del_dia transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function quitarPlatoDelDiaCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "sucursalNombre" | "empresaZonaHoraria" | "transaccion" | "ahora">,
  comando: ComandoQuitarPlatoDelDia,
): Promise<ResultadoQuitarPlatoDelDia> {
  const hoy = diaDeCalendario(actor.ahora, actor.empresaZonaHoraria);
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoQuitarPlatoDelDia> => {
    const plato = await tx.entradaDelDiaDeCupo.findFirst({
      where: { id: comando.platoId, sucursalId: actor.sucursalId },
      select: { id: true, activa: true, fecha: true, producto: { select: { nombre: true } }, cupo: { select: { nombre: true, promoCarta: { select: { titulo: true } } } } },
    });
    if (!plato) return fracaso("PLATO_NO_ENCONTRADO", "No se encontró ese plato del día.");
    const dia = diaDeColumnaDate(plato.fecha);
    const enFecha = validarFechaDeMenuDelDia(dia, hoy);
    if (!enFecha.ok) return fracaso(enFecha.codigo, enFecha.mensaje);
    const lugar = `«${plato.cupo.nombre ?? ""}» de «${plato.cupo.promoCarta.titulo}» del ${dia}`;
    if (!plato.activa) return exito(`«${plato.producto.nombre}» ya no era ${lugar}.`, { huboCambio: false });
    await fijarActivaDePlatoDelDia(tx, { id: plato.id, activa: false, actualizadoPorId: actor.usuarioId, ahora: actor.ahora });
    await registrarCambioAuditado(tx, {
      entidad: "EntradaDelDiaDeCupo",
      entidadId: plato.id,
      campo: "activa",
      descripcion: `Menú del día en «${actor.sucursalNombre}»: ${lugar}, «${plato.producto.nombre}»`,
      valorAnterior: true,
      valorNuevo: false,
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });
    return exito(`«${plato.producto.nombre}» dejó de ser ${lugar}.`, { huboCambio: true });
  });
}
