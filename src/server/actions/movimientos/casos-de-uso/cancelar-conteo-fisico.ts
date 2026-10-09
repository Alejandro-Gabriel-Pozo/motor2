import "server-only";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { exito, fracaso } from "@/core/resultado-caso";
import type { ResultadoCancelarConteo } from "@/core/features/movimientos/cancelar-conteo.schema";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { evaluarPosterioresACancelarConteo } from "@/core/movimientos/public";
import { sumaAplicadaPorConteo } from "@/server/lecturas/movimientos/aplicado-por-conteo";
import { cargarConteoFisico } from "@/server/persistencia/movimientos/cargar-conteo-fisico";
import { cargarReconciliacionesPosteriores } from "@/server/persistencia/movimientos/cargar-reconciliaciones-posteriores";
import { actualizarEstadoDeConteo } from "@/server/persistencia/movimientos/escribir-conteo-fisico";
import { escribirOperacionDeStock, escribirLineasDeMovimientoStock } from "@/server/persistencia/movimientos/escribir-movimiento-de-stock";

/**
 * Caso de uso «cancelar un conteo físico» — port de `cancelarConteoFisico` (Stock.js:2097-2141, Task #41, Fase M, M13e2 —
 * docs/arquitectura-casos-de-uso-2026-09-27.md). Revierte un conteo YA APLICADO (estado "Resuelto" — le ajustó el stock de verdad).
 * Nunca se edita ni se borra la fila original del Kardex — se escribe una fila de REVERSIÓN nueva con la MISMA magnitud y signo
 * contrario, enlazada al mismo ConteoFisico (FK real — en Apps Script era el mismo "ID Operación" que la fila original, correlación
 * por string).
 *
 * `import "server-only"` y SIN `"use server"`, mismo criterio que `resolver-conteo-pendiente.ts`: no chequea permisos (ya lo hizo
 * `conPermiso("cancelar_conteo")` en el adaptador) ni ningún formato de entrada (sin `.guard.ts` propio, ver `cancelar-conteo.schema.ts`).
 *
 * REVIERTE LO QUE EL CONTEO APLICÓ, no lo que registró (S-04 del plan de endurecimiento de seguridad, tanda T5, K2 del informe B). `conteo.diferencia` es contado menos el saldo del
 * sistema EL DÍA DEL CONTEO; lo que se aplicó al stock es otra cosa: un conteo pendiente cerrado como «resuelto» no aplicó nada (la diferencia se cubrió con un movimiento real), y uno
 * cerrado con «ajustar» aplicó la diferencia contra el saldo de HOY, que `diferencia` no recuerda. Cancelar a partir de `diferencia` escribía un ajuste que nunca se había aplicado
 * (stock fantasma) o uno de otro tamaño. Ahora la fuente es el Kardex: `sumaAplicadaPorConteo` (la suma con signo de las líneas con `conteoFisicoId` = este conteo, leída dentro de la
 * transacción) y se escribe su opuesto. Si el conteo no aplicó nada se cancela igual (sirve para sacarlo de los reportes) pero NO se toca el stock. La cancelación se AUDITA
 * (`ConteoFisico`, `estado`: RESUELTO → CANCELADO, con lo revertido en la descripción): antes no dejaba ninguna fila.
 *
 * Orden:
 *  1. `cargarConteoFisico` (M13e2) — si no existe o es de otra sucursal, ni sigue;
 *  2. no puede estar ya CANCELADO, y tiene que estar RESUELTO (si está PENDIENTE/DESCARTADO nunca ajustó nada, no hay nada que
 *     cancelar);
 *  2b. lo POSTERIOR (M-2 de la auditoría final, D7 decidida por el dueño el 2026-10-08): se RECHAZA (`CONTEO_POSTERIOR`) si después de este conteo hubo otro conteo físico —con o sin
 *     movimiento— o un ajuste vigente del mismo producto en la misma sección (`cargarReconciliacionesPosteriores`, la misma lectura que usa anular una venta, sin contar a este conteo ni
 *     sus propias líneas): cancelarlo revertiría un ajuste sobre un stock que el conteo posterior ya reconcilió. Se corrige con un ajuste;
 *  3. lee lo aplicado (`sumaAplicadaPorConteo`) y, si no es 0, escribe la reversión vía `escribirOperacionDeStock`/`escribirLineasDeMovimientoStock` (M13b, un
 *     array de una sola fila) con `conteoFisicoId: conteo.id`;
 *  4. cierra el conteo como CANCELADO (`actualizarEstadoDeConteo`, M13e2) y deja la fila de auditoría.
 *
 * @contract Revierte un conteo YA RESUELTO con una fila de Kardex que anula exactamente lo que ese conteo aplicó (cero si no aplicó nada) y lo marca CANCELADO — nunca edita/borra la fila original.
 * @idempotency Por estado — un conteo ya CANCELADO se rechaza explícitamente; sin claveIdempotencia/I3.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects Ninguno además de la reversión de Kardex (fila conteoFisicoId), el cambio de estado del ConteoFisico y su fila de auditoría.
 * @ficha permiso=cancelar_conteo transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function cancelarConteoFisicoCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "sucursalNombre" | "transaccion" | "ahora">,
  conteoId: string
): Promise<ResultadoCancelarConteo> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoCancelarConteo> => {
    const conteo = await cargarConteoFisico(tx, conteoId);
    if (!conteo || conteo.sucursalId !== actor.sucursalId) return fracaso("CONTEO_NO_ENCONTRADO", "No se encontró ese conteo.");
    if (conteo.estado === "CANCELADO") return fracaso("CONTEO_YA_CANCELADO", "Ese conteo ya está cancelado.");
    if (conteo.estado !== "RESUELTO") {
      return fracaso(
        "CONTEO_NO_RESUELTO",
        `Este conteo está "${conteo.estado}", no aplicó ningún ajuste al stock — no hay nada que cancelar. Si es un conteo pendiente, resolvelo en vez de cancelarlo.`
      );
    }

    // M-2 / D7 (la misma regla que anular una venta): si después de este conteo hubo OTRO conteo (con o sin movimiento) o un ajuste del mismo producto en la misma sección, cancelarlo desharía a
    // ciegas un stock que ya se reconcilió. Se RECHAZA ANTES de escribir nada y se corrige con un ajuste.
    const posteriores = evaluarPosterioresACancelarConteo(
      await cargarReconciliacionesPosteriores(tx, {
        sucursalId: actor.sucursalId,
        alcances: [{ creadoEn: conteo.creadoEn, pares: [{ productoId: conteo.productoId, seccionId: conteo.seccionId }] }],
        excluirConteoId: conteo.id,
      }),
    );
    if (!posteriores.ok) return fracaso(posteriores.motivo, posteriores.mensaje);

    const ajusteAplicado = await sumaAplicadaPorConteo(tx, conteo.id);
    if (ajusteAplicado !== 0) {
      const operacion = await escribirOperacionDeStock(tx, {
        sucursalId: actor.sucursalId,
        proceso: "CONTROL",
        fecha: actor.ahora,
        proveedorId: null,
        nroFactura: null,
        seccionDestinoId: null,
        motivoId: null,
        destinoId: null,
        detalleLibre: null,
        usuarioId: actor.usuarioId,
        claveIdempotencia: null,
        payloadHash: null,
      });
      await escribirLineasDeMovimientoStock(tx, [
        {
          operacionId: operacion.id,
          productoId: conteo.productoId,
          seccionId: conteo.seccionId,
          proceso: "CONTROL",
          cantidad: -ajusteAplicado,
          loteVencimiento: conteo.loteVencimiento,
          detalle: `Conteo físico cancelado: se revierte el ajuste de ${conSigno(ajusteAplicado)}.`,
          precioTotal: 0,
          precioPorUnidadStock: 0,
          conteoFisicoId: conteo.id,
        },
      ]);
    }

    const queSePaso = ajusteAplicado !== 0 ? `se revirtió el ajuste de ${conSigno(ajusteAplicado)}` : "no había aplicado ningún ajuste, no se tocó el stock";
    await actualizarEstadoDeConteo(tx, conteoId, {
      estado: "CANCELADO",
      detalle: `${conteo.detalle ?? ""} — cancelado, ${queSePaso}`.trim(),
    });

    // Auditoría (S-04): quién canceló qué conteo y cuánto se revirtió. Siempre cambia el estado (RESUELTO → CANCELADO), así que la fila se escribe aunque no se haya tocado el stock.
    await registrarCambioAuditado(tx, {
      entidad: "ConteoFisico",
      entidadId: conteo.id,
      campo: "estado",
      descripcion: `Conteo físico de "${conteo.productoNombre}" en "${actor.sucursalNombre}" cancelado: ${queSePaso}`,
      valorAnterior: conteo.estado,
      valorNuevo: "CANCELADO",
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });

    return exito(
      ajusteAplicado !== 0 ? `Conteo cancelado. Se revirtió el ajuste de ${conSigno(ajusteAplicado)}.` : "Conteo cancelado. No había aplicado ningún ajuste al stock: no se tocó el stock.",
      { ajusteRevertido: ajusteAplicado }
    );
  });
}

function conSigno(n: number): string {
  return `${n > 0 ? "+" : ""}${n}`;
}
