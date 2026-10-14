import "server-only";
import type { ComandoActivarEntradaDeCupo, ResultadoActivarEntradaDeCupo } from "@/core/features/carta/combos.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { diaDeCalendario } from "@/core/tiempo/zona-horaria";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { lecturaDeVerificacionEnLaEmpresa } from "@/server/acceso/alcance";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cargarLugaresActivosDePromo, sucursalesDeLaEmpresa } from "@/server/lecturas/carta/componentes-de-promo";
import { fijarActivaDeEntradaDeCupo } from "@/server/persistencia/carta/combos";
import { nombreDeLaEntrada, revisarAlicuotasEnTx, validarComponenteEnTx } from "./componentes-de-combo-en-tx";

/**
 * Caso de uso «prender o apagar una opción del lugar LISTA de una promo» (GO-3b, ADR-032, D4a). «Llevar al estado X» dentro de UNA transacción SERIALIZABLE: si la entrada ya está así, no se escribe
 * ni se audita. APAGAR no valida nada más (sacar una opción siempre se puede; si era la única de un lugar obligatorio, la promo deja de poder armarse y el POS lo dice). PRENDER vuelve a validar el
 * producto como componente con SU configuración (pudo perder la receta o el precio desde que se cargó, o cambiar lo que admite) y las alícuotas del combo, igual que al cargarla.
 *
 * @contract Deja la entrada prendida o apagada, con su auditoría; prendida solo si el producto todavía puede ser componente del combo.
 * @idempotency Por estado — si la entrada ya está en el estado pedido no se escribe ni se audita.
 * @transaction conTransaccionSerializable (SERIALIZABLE): las lecturas que deciden, la escritura y la auditoría, juntas.
 * @sideEffects registrarCambioAuditado (`EntradaDeCupo`, `activa`), con el mismo `tx`.
 * @ficha permiso=carta_promo_definir transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarActivaEntradaDeCupoCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "empresaId" | "sucursalId" | "empresaZonaHoraria" | "transaccion" | "db" | "alcance" | "ahora">,
  comando: ComandoActivarEntradaDeCupo,
): Promise<ResultadoActivarEntradaDeCupo> {
  const verificacion = await lecturaDeVerificacionEnLaEmpresa(actor);
  return conTransaccionSerializable(verificacion.transaccion, async (tx): Promise<ResultadoActivarEntradaDeCupo> => {
    const entrada = await tx.entradaDeCupo.findFirst({
      where: { id: comando.entradaId },
      select: {
        id: true,
        activa: true,
        productoId: true,
        producto: { select: { nombre: true } },
        opciones: { orderBy: [{ opcionId: "asc" }], select: { opcionId: true, cantidad: true } },
        cupo: { select: { tipo: true, activo: true, nombre: true, promoCartaId: true, promoCarta: { select: { titulo: true } } } },
      },
    });
    if (!entrada) return fracaso("ENTRADA_NO_ENCONTRADA", "No se encontró esa opción del lugar.");
    const nombre = await nombreDeLaEntrada(tx, entrada.producto.nombre, entrada.opciones.map((o) => o.opcionId));
    const lugar = entrada.cupo.nombre ?? "";
    const estado = comando.activa ? "activa" : "dada de baja";
    if (entrada.activa === comando.activa) return exito(`${nombre} ya estaba ${estado} en «${lugar}».`, { huboCambio: false });

    if (comando.activa) {
      if (entrada.cupo.tipo !== "LISTA" || !entrada.cupo.activo) return fracaso("CUPO_INVALIDO", `«${lugar}» está dado de baja en la promo: volvé a agregarlo en sus cupos.`);
      const validado = await validarComponenteEnTx(tx, { sucursalId: actor.sucursalId, productoId: entrada.productoId, opciones: entrada.opciones, etiqueta: "con esa configuración" });
      if (!validado.ok) return validado;
      const alicuotas = await revisarAlicuotasEnTx(tx, {
        lugares: await cargarLugaresActivosDePromo(tx, entrada.cupo.promoCartaId),
        desdeDia: diaDeCalendario(actor.ahora, actor.empresaZonaHoraria),
        sucursalIds: await sucursalesDeLaEmpresa(tx, actor.empresaId),
        producto: validado.componente.producto,
      });
      if (!alicuotas.ok) return alicuotas;
    }

    await fijarActivaDeEntradaDeCupo(tx, { id: entrada.id, activa: comando.activa, ahora: actor.ahora });
    await registrarCambioAuditado(tx, {
      entidad: "EntradaDeCupo",
      entidadId: entrada.id,
      campo: "activa",
      descripcion: `Promo "${entrada.cupo.promoCarta.titulo}", lugar «${lugar}»: ${nombre}`,
      valorAnterior: entrada.activa,
      valorNuevo: comando.activa,
      actorId: actor.usuarioId,
    });
    return exito(`${nombre} quedó ${estado} en «${lugar}».`, { huboCambio: true });
  });
}
