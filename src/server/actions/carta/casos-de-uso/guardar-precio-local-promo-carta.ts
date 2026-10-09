import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { mensajePisoDePromo, pisoDePrecioDePromo } from "@/core/carta/piso-de-promo";
import { seleccionDeSucursalDePromo } from "@/core/carta/promo-sucursal";
import type { ComandoGuardarPrecioLocalPromoCarta, ResultadoGuardarPrecioLocalPromoCarta } from "@/core/features/carta/promos.schema";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { fijarPrecioLocalDePromo } from "@/server/persistencia/carta/promos";

/**
 * Caso de uso «fijar el precio de una promo en la sucursal activa» (Hito 4 de la pureza, bloque 4.2, paso H4C-2 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo
 * que antes vivía en línea en la Server Action `guardarPrecioLocalPromoCarta` (`src/server/actions/carta/promos.ts`), movido TAL CUAL: la promo (con sus cupos)
 * se lee con la base del contexto FUERA de la transacción; el precio se valida DESPUÉS (una promo inexistente gana sobre un precio inválido: por eso no hay
 * guard), con el mismo piso de $0,01 por unidad del peor caso que el precio de la empresa (`core/carta/piso-de-promo.ts`); y dentro de UNA transacción se lee
 * el precio anterior (por la relación de la promo, con el embudo `seleccionDeSucursalDePromo`), se escribe el nuevo y, SOLO si cambió, su fila de auditoría.
 * La Server Action quedó como adaptador (`conPermiso("carta_promo_precio_local")` → este caso de uso → `revalidarCartasPublicas` si salió bien →
 * `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (`conPermiso`).
 *
 * `null` o vacío = vuelve al precio de la empresa. Si la sucursal todavía no la ofrece, la fila se crea APAGADA (`fijarPrecioLocalDePromo`): el precio queda
 * guardado pero no la prende (prender es otra acción, con su propia clave).
 *
 * @contract Deja el precio de la promo en la sucursal activa (o ninguno), con su registro de auditoría si cambió: los dos o ninguno.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo precio (sin fila de auditoría nueva: se compara con el anterior).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento; M14 / S-51): la promo con sus cupos, el piso, el precio anterior, la escritura y su auditoría, todo junto.
 * @sideEffects registrarCambioAuditado (PromoCartaSucursal.precioLocal, del anterior al nuevo), en la misma transacción. La revalidación de la carta pública la
 *   hace la Server Action cuando sale bien.
 * @ficha permiso=carta_promo_precio_local transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarPrecioLocalPromoCartaCasoDeUso(
  actor: Pick<ContextoUsuario, "transaccion" | "usuarioId" | "sucursalId">,
  comando: ComandoGuardarPrecioLocalPromoCarta,
): Promise<ResultadoGuardarPrecioLocalPromoCarta> {
  const { promoCartaId, precio } = comando;
  // M14 (S-51): la promo con sus cupos, el piso, el precio anterior, la escritura y la auditoría van en UNA transacción SERIALIZABLE (antes la promo y sus cupos se leían con `actor.db`, afuera):
  // si `guardarCuposPromoCarta` cambia los cupos a la vez, uno de los dos aborta (40001) y el reintento relee. Los rechazos devuelven ANTES de escribir.
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoGuardarPrecioLocalPromoCarta> => {
    const promo = await tx.promoCarta.findUnique({ where: { id: promoCartaId }, include: { cupos: { select: { cantidadMaxima: true } } } });
    if (!promo) return fracaso("PROMO_NO_ENCONTRADA", "No se encontró la promo.");

    // S-52: el formato y el rango del precio los decidió `guardComandoGuardarPrecioLocalPromoCarta` (la acción lo calculó con lo que mandó el cliente); su rechazo se aplica ACÁ, después de leer
    // la promo: una promo inexistente gana sobre un precio inválido.
    if (!precio.ok) return fracaso("PRECIO_INVALIDO", precio.mensaje);
    const valor = precio.valor.precioLocal;
    if (valor !== null) {
      const piso = pisoDePrecioDePromo(promo.cupos);
      if (piso !== null && valor < piso.minimo) return fracaso("BAJO_EL_PISO", mensajePisoDePromo(promo.titulo, valor, piso));
    }
    // El precio anterior se lee por la relación de la promo (el embudo `seleccionDeSucursalDePromo`, ver promo-sucursal-en-un-solo-lugar.test.ts), en la misma transacción que lo cambia.
    const previa = await tx.promoCarta.findUnique({ where: { id: promoCartaId }, select: { sucursales: seleccionDeSucursalDePromo(actor.sucursalId) } });
    const precioAnterior = previa?.sucursales[0]?.precioLocal != null ? Number(previa.sucursales[0].precioLocal) : null;
    await fijarPrecioLocalDePromo(tx, { promoCartaId, sucursalId: actor.sucursalId, precioLocal: valor });
    if (precioAnterior !== valor) {
      await registrarCambioAuditado(tx, {
        entidad: "PromoCartaSucursal",
        entidadId: `${promoCartaId}:${actor.sucursalId}`,
        campo: "precioLocal",
        descripcion: `Promo "${promo.titulo}": precio en esta sucursal`,
        valorAnterior: precioAnterior,
        valorNuevo: valor,
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });
    }
    return exito(valor === null ? `"${promo.titulo}" vuelve al precio de la empresa en esta sucursal.` : `Precio de "${promo.titulo}" en esta sucursal: $${valor}.`, null);
  });
}
