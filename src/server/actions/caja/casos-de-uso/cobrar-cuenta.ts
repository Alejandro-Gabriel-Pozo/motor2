import "server-only";
import { centavosDeImporte, decidirMovimiento, estadoDeSesion, repartirCobro, textoDeCentavos } from "@/core/caja/public";
import type { ComandoCobrarCuenta, ResultadoCobrarCuenta } from "@/core/features/caja/caja.schema";
import { calcularPayloadHash } from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cargarCajaDeSucursal, cargarCobranzaDeClave, cargarCobranzaDeCuenta, cargarSesionSinCerrarDeCaja, cargarTiposDeMedios, insertarCobranza, insertarCobro, insertarMovimiento } from "@/server/persistencia/caja/caja";
import { cargarCuentaParaCobrar } from "@/server/persistencia/caja/total-de-cuenta";

/**
 * Caso de uso «cobrar una cuenta cerrada» (etapa C1, CU5; el cobro es un paso APARTE de cerrar la cuenta — «Cobro aparte primero», dueño, 2026-11-16). Registra con qué medios se pagó una cuenta ya cerrada y la plata entra a
 * la sesión de caja abierta de la sucursal. La suma de los renglones tiene que dar el total de la cuenta AL CENTAVO (I-4).
 *
 * `import "server-only"` y SIN `"use server"`: la Server Action ya pidió el permiso y validó el formato. En UNA transacción SERIALIZABLE, en este orden:
 *  1. la clave de reintento se mira ANTES que el estado: misma clave y mismo pedido → el cobro ya hecho (`yaExistia`, sin escribir ni auditar de nuevo); misma clave con otro pedido → `CLAVE_REUTILIZADA`;
 *  2. la cuenta es de la sucursal activa, está cerrada y tuvo venta; si ya tiene cobro → `CUENTA_YA_COBRADA { cobranzaId }`; el total que vio quien cobra tiene que ser el actual (`TOTAL_CAMBIO`: nadie cobra un número viejo);
 *  3. hay una sesión de caja ABIERTA en la sucursal (`SIN_SESION_ABIERTA`; con la sesión EN_CIERRE → `CAJA_EN_CIERRE`) y todos los medios existen y están activos (`MEDIO_NO_HABILITADO`);
 *  4. `repartirCobro` (suma = total, ni de más ni de menos: `COBRO_NO_CUADRA` con `falta` o `sobra`);
 *  5. inserta la cobranza (con el total congelado), un movimiento COBRO por renglón y su renglón de cobro, y la auditoría. TODO o nada: la base verifica además, al confirmar, que la suma da el total (disparador diferido).
 * Segunda barrera: los únicos por cuenta y por clave de la cobranza, `Cobranza_cuadra` y los disparadores de sesión abierta y de sucursal.
 *
 * @contract Cobra una cuenta cerrada exactamente una vez, con la suma de los medios igual al total, o no escribe nada.
 * @idempotency Clave de reintento única por empresa más la huella del pedido; además único por cuenta: dos cobros de la misma cuenta a la vez dejan uno solo (el otro ve `CUENTA_YA_COBRADA`).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, también ante el choque de índice único).
 * @sideEffects registrarCambioAuditado (el cobro con su total y la cantidad de renglones; sin datos personales).
 * @ficha permiso=cobrar_cuenta transaccion=SERIALIZABLE idempotencia=POR_CLAVE auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function cobrarCuentaCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "empresaId" | "transaccion" | "ahora">,
  comando: ComandoCobrarCuenta,
  azar: FuenteDeAzar,
): Promise<ResultadoCobrarCuenta> {
  const repartoPrevio = repartirCobro(comando.renglones, comando.totalVistoEnCentavos);
  // Los renglones en orden canónico (el mismo pedido en otro orden es el mismo pedido); si el reparto no es válido se rechaza más abajo con su código.
  const canonicos = repartoPrevio.ok ? repartoPrevio.valor : [...comando.renglones];
  const huella = calcularPayloadHash("COBRAR_CUENTA", actor.empresaId, {
    cuentaId: comando.cuentaId,
    total: textoDeCentavos(comando.totalVistoEnCentavos),
    renglones: canonicos.map((r) => [r.medioDePagoId, textoDeCentavos(r.importeEnCentavos)]),
  });

  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoCobrarCuenta> => {
      const conLaClave = await cargarCobranzaDeClave(tx, actor.empresaId, comando.claveIdempotencia);
      if (conLaClave) {
        if (conLaClave.huella !== huella) return fracaso("CLAVE_REUTILIZADA", "Esta clave de cobro ya se usó con otro pedido.");
        return exito("La cuenta ya estaba cobrada.", { cobranzaId: conLaClave.id, yaExistia: true });
      }

      const cuenta = await cargarCuentaParaCobrar(tx, actor.empresaId, comando.cuentaId, actor.ahora);
      if (!cuenta || cuenta.sucursalId !== actor.sucursalId) return fracaso("CUENTA_NO_ENCONTRADA", "No se encontró la cuenta.");
      if (!cuenta.cerrada) return fracaso("CUENTA_ABIERTA", "La cuenta todavía está abierta: cerrala antes de cobrarla.");
      if (!cuenta.conVenta) return fracaso("CUENTA_SIN_VENTA", "La cuenta se cerró sin consumo: no hay nada que cobrar.");
      const ya = await cargarCobranzaDeCuenta(tx, actor.empresaId, cuenta.cuentaId);
      if (ya) return { ...fracaso("CUENTA_YA_COBRADA", "La cuenta ya está cobrada."), cobranzaId: ya.id };

      const totalActual = centavosDeImporte(cuenta.total);
      if (totalActual === null || totalActual <= BigInt(0)) return fracaso("NADA_PARA_COBRAR", "La cuenta no tiene nada para cobrar.");
      if (totalActual !== comando.totalVistoEnCentavos) return { ...fracaso("TOTAL_CAMBIO", "El total de la cuenta cambió: volvé a mirarlo antes de cobrar."), totalActualEnCentavos: totalActual };

      const caja = await cargarCajaDeSucursal(tx, actor.empresaId, actor.sucursalId);
      const sesion = caja ? await cargarSesionSinCerrarDeCaja(tx, actor.empresaId, caja.id) : null;
      if (!sesion) return fracaso("SIN_SESION_ABIERTA", "No hay una caja abierta en esta sucursal: abrila antes de cobrar.");
      // Se está contando el efectivo para cerrar: no entra ningún cobro hasta cancelar el cierre (decisión del dueño, 2026-11-16: «Frenar el cobro, como Pedernal»).
      if (decidirMovimiento(estadoDeSesion(sesion.estado)) === "CAJA_EN_CIERRE") return { ...fracaso("CAJA_EN_CIERRE", "La caja está en cierre: se está contando el efectivo."), sesionId: sesion.id };

      const medios = await cargarTiposDeMedios(tx, actor.empresaId, comando.renglones.map((r) => r.medioDePagoId));
      if (comando.renglones.some((r) => medios.get(r.medioDePagoId)?.activo !== true)) return fracaso("MEDIO_NO_HABILITADO", "Hay un medio de pago que no está habilitado.");

      const reparto = repartirCobro(comando.renglones, totalActual);
      if (!reparto.ok) {
        if (reparto.error === "COBRO_NO_CUADRA") return { ...fracaso("COBRO_NO_CUADRA", "Lo cobrado no suma el total de la cuenta."), faltaEnCentavos: reparto.diferencia.falta, sobraEnCentavos: reparto.diferencia.sobra };
        return fracaso(reparto.error, reparto.error === "IMPORTE_INVALIDO" ? "Hay un importe inválido." : "El cobro no tiene la cantidad de medios permitida.");
      }

      const cobranzaId = azar.uuid();
      await insertarCobranza(tx, { id: cobranzaId, empresaId: actor.empresaId, sucursalId: actor.sucursalId, cuentaId: cuenta.cuentaId, sesionId: sesion.id, totalEnCentavos: totalActual, claveIdempotencia: comando.claveIdempotencia, huella, creadoPorId: actor.usuarioId });
      let orden = 0;
      for (const r of reparto.valor) {
        orden += 1;
        const movimientoId = azar.uuid();
        await insertarMovimiento(tx, { id: movimientoId, empresaId: actor.empresaId, sucursalId: actor.sucursalId, sesionId: sesion.id, clase: "COBRO", medioDePagoId: r.medioDePagoId, importeEnCentavos: r.importeEnCentavos, motivo: null, anulaAId: null, claveIdempotencia: null, creadoPorId: actor.usuarioId });
        await insertarCobro(tx, { id: azar.uuid(), empresaId: actor.empresaId, sucursalId: actor.sucursalId, cobranzaId, orden, medioDePagoId: r.medioDePagoId, movimientoId, importeEnCentavos: r.importeEnCentavos });
      }
      await registrarCambioAuditado(tx, {
        entidad: "Cobranza",
        entidadId: cobranzaId,
        descripcion: `Cuenta cobrada con ${reparto.valor.length} medio(s)`,
        campo: "cobro",
        valorAnterior: null,
        valorNuevo: textoDeCentavos(totalActual),
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });
      return exito("Cuenta cobrada.", { cobranzaId, yaExistia: false });
    },
    undefined,
    undefined,
    true,
  );
}
