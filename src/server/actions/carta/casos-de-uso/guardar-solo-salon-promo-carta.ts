import "server-only";
import type { ComandoGuardarSoloSalonPromoCarta, ResultadoGuardarSoloSalonPromoCarta } from "@/core/features/carta/promos.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cambiarSoloSalonDePromo } from "@/server/persistencia/carta/promos";

/**
 * Caso de uso «dónde se ve una promo» (docs/diseno-promo-solo-salon-2026-10-26.md, paso 4): el interruptor «solo salón» de una promo de la EMPRESA. Prendido, la promo se vende desde el POS pero NO aparece en la carta pública (web, QR ni impresa);
 * apagado (lo de siempre), se ve en las dos. Lo lee el embudo `wherePromoOfrecidaEn(sucursalId, audiencia)` (`core/carta/promo-sucursal.ts`).
 *
 * Caso de uso APARTE de `guardarPromoCartaCasoDeUso` a propósito: esa edición no lleva versión y reescribe los cinco datos de la promo; si el interruptor viajara con ellos, una pantalla vieja apagaría en silencio el «solo salón» que otra persona acaba de
 * prender y la promo (con su precio pactado) quedaría pública. Acá el control es OPTIMISTA, con la misma `PromoCarta.version` que la vigencia (comparten versión: un cambio de una invalida la pantalla de la otra, un rechazo conservador y avisado).
 *
 * Orden (en UNA transacción SERIALIZABLE): 1. leer la promo por id (RLS: la de otra empresa no existe → `PROMO_NO_ENCONTRADA`); 2. si ya tiene el valor pedido → éxito sin cambio, SIN escribir ni auditar (va ANTES del chequeo de versión: un doble clic, o un
 * reintento de red, no muestra «otra persona la cambió» sobre algo que ya quedó como se pidió); 3. versión distinta de la que vio la pantalla → `VERSION_DESACTUALIZADA`; 4. `UPDATE … WHERE id AND version = esperada` incrementando la versión (0 filas →
 * `VERSION_DESACTUALIZADA`: alguien se coló entre la lectura y la escritura); 5. la fila de auditoría (`PromoCarta`, `soloSalon`, anterior y nuevo, quién), en la misma transacción. La Server Action revalida la carta pública solo si hubo cambio y
 * después de confirmar.
 *
 * @contract Deja el interruptor «solo salón» de la promo en el valor pedido, con su auditoría, si nadie la cambió desde la versión vista (o si ya estaba así).
 * @idempotency Por estado — pedir el valor que la promo ya tiene devuelve éxito sin escribir ni auditar; una edición sobre una versión vieja se rechaza (`VERSION_DESACTUALIZADA`).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento) con `UPDATE … WHERE version = esperada`: la lectura, la escritura y la auditoría, juntas. Dos pedidos a la vez: gana uno; el otro, al reintentar, encuentra el valor puesto (éxito sin cambio) o la versión nueva (`VERSION_DESACTUALIZADA`).
 * @sideEffects registrarCambioAuditado (`PromoCarta`: `soloSalon`), con el mismo `tx`. La revalidación de la carta pública la hace la Server Action cuando hubo cambio.
 * @ficha permiso=carta_promo_definir transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarSoloSalonPromoCartaCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "transaccion">,
  comando: ComandoGuardarSoloSalonPromoCarta,
): Promise<ResultadoGuardarSoloSalonPromoCarta> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoGuardarSoloSalonPromoCarta> => {
    const promo = await tx.promoCarta.findFirst({ where: { id: comando.promoCartaId }, select: { id: true, titulo: true, version: true, soloSalon: true } });
    if (!promo) return fracaso("PROMO_NO_ENCONTRADA", "No se encontró la promo.");
    if (promo.soloSalon === comando.soloSalon) return exito(`«${promo.titulo}» ya estaba ${comando.soloSalon ? "solo en el salón" : "visible también en la carta pública"}.`, { huboCambio: false });
    const desactualizada = fracaso("VERSION_DESACTUALIZADA", `Otra persona cambió «${promo.titulo}» mientras la editabas. Recargá la pantalla y volvé a intentar.`);
    if (promo.version !== comando.versionEsperada) return desactualizada;

    const cambiadas = await cambiarSoloSalonDePromo(tx, { id: promo.id, versionEsperada: comando.versionEsperada, soloSalon: comando.soloSalon });
    if (cambiadas === 0) return desactualizada;
    await registrarCambioAuditado(tx, {
      entidad: "PromoCarta",
      entidadId: promo.id,
      campo: "soloSalon",
      descripcion: `Promo "${promo.titulo}": solo salón (no se muestra en la carta pública)`,
      valorAnterior: promo.soloSalon,
      valorNuevo: comando.soloSalon,
      actorId: actor.usuarioId,
    });
    return exito(comando.soloSalon ? `«${promo.titulo}» pasó a «solo salón»: ya no se muestra en la carta pública.` : `«${promo.titulo}» vuelve a mostrarse en la carta pública.`, { huboCambio: true });
  });
}
