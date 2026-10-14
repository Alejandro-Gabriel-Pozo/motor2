import "server-only";
import type { ComandoGuardarVigenciaPromoCarta, ResultadoGuardarVigenciaPromoCarta } from "@/core/features/carta/combos.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { diaDeColumnaDate, fechaDeColumnaDate } from "@/core/tiempo/zona-horaria";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cambiarVigenciaDePromo } from "@/server/persistencia/carta/combos";

/**
 * Caso de uso «la vigencia de una promo» (GO-3b, ADR-032, D-7 y paso D4a): entre qué fechas (días de calendario de la zona de la empresa, rango inclusive) y qué días de la semana vale. Vacío por
 * cualquier lado = sin límite. Se evalúa al AGREGAR la promo a una cuenta (lo que ya está en una mesa no cambia).
 *
 * Control OPTIMISTA (`PromoCarta.version`, D-3): la pantalla manda la versión que vio; si otra persona cambió la vigencia entre medio, `VERSION_DESACTUALIZADA` y no se escribe nada (dos ediciones
 * a la vez nunca se pisan en silencio). Si la vigencia pedida es la que ya tiene, no se escribe ni se audita (éxito sin cambio). La escritura incrementa la versión y deja una fila de auditoría por
 * columna que cambia (`PromoCarta`, `vigenteDesde`, `vigenteHasta`, `diasDeSemana`), en la misma transacción.
 *
 * @contract Deja la vigencia pedida en la promo, con su auditoría, si nadie la cambió desde la versión vista.
 * @idempotency Por estado — la vigencia que ya tiene no se escribe ni se audita; una edición sobre una versión vieja se rechaza (`VERSION_DESACTUALIZADA`).
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `UPDATE … WHERE version = esperada`: la lectura, la escritura y la auditoría, juntas.
 * @sideEffects registrarCambioAuditado (`PromoCarta`: `vigenteDesde`, `vigenteHasta`, `diasDeSemana`), con el mismo `tx`.
 * @ficha permiso=carta_promo_definir transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarVigenciaPromoCartaCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "transaccion">,
  comando: ComandoGuardarVigenciaPromoCarta,
): Promise<ResultadoGuardarVigenciaPromoCarta> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoGuardarVigenciaPromoCarta> => {
    const promo = await tx.promoCarta.findFirst({ where: { id: comando.promoCartaId }, select: { id: true, titulo: true, version: true, vigenteDesde: true, vigenteHasta: true, diasDeSemana: true } });
    if (!promo) return fracaso("PROMO_NO_ENCONTRADA", "No se encontró la promo.");
    const desactualizada = fracaso("VERSION_DESACTUALIZADA", `Otra persona cambió «${promo.titulo}» mientras la editabas: recargá la pantalla y volvé a intentar.`);
    if (promo.version !== comando.versionEsperada) return desactualizada;

    const antes = {
      vigenteDesde: promo.vigenteDesde === null ? null : diaDeColumnaDate(promo.vigenteDesde),
      vigenteHasta: promo.vigenteHasta === null ? null : diaDeColumnaDate(promo.vigenteHasta),
      diasDeSemana: promo.diasDeSemana,
    };
    const despues = comando.vigencia;
    if (antes.vigenteDesde === despues.vigenteDesde && antes.vigenteHasta === despues.vigenteHasta && antes.diasDeSemana === despues.diasDeSemana) {
      return exito(`La vigencia de «${promo.titulo}» ya era esa.`, { huboCambio: false });
    }
    const cambiadas = await cambiarVigenciaDePromo(tx, {
      id: promo.id,
      versionEsperada: comando.versionEsperada,
      vigenteDesde: despues.vigenteDesde === null ? null : fechaDeColumnaDate(despues.vigenteDesde),
      vigenteHasta: despues.vigenteHasta === null ? null : fechaDeColumnaDate(despues.vigenteHasta),
      diasDeSemana: despues.diasDeSemana,
    });
    if (cambiadas === 0) return desactualizada;
    const columnas = [
      { campo: "vigenteDesde", etiqueta: "vale desde" },
      { campo: "vigenteHasta", etiqueta: "vale hasta" },
      { campo: "diasDeSemana", etiqueta: "días de la semana" },
    ] as const;
    for (const { campo, etiqueta } of columnas) {
      await registrarCambioAuditado(tx, {
        entidad: "PromoCarta",
        entidadId: promo.id,
        campo,
        descripcion: `Promo "${promo.titulo}": ${etiqueta}`,
        valorAnterior: antes[campo],
        valorNuevo: despues[campo],
        actorId: actor.usuarioId,
      });
    }
    return exito(`Vigencia de «${promo.titulo}» guardada.`, { huboCambio: true });
  });
}
