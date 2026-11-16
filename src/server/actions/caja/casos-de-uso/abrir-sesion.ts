import "server-only";
import { textoDeCentavos } from "@/core/caja/public";
import type { ComandoAbrirSesion, ResultadoAbrirSesion } from "@/core/features/caja/caja.schema";
import { calcularPayloadHash } from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { diaDeCalendario, fechaDeColumnaDate } from "@/core/tiempo/zona-horaria";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { asegurarCaja, asegurarMedioEfectivo, cargarCajaDeSucursal, cargarMedioEfectivo, cargarSesionSinCerrarDeCaja, cargarSesionDeClave, insertarMovimiento, insertarSesion } from "@/server/persistencia/caja/caja";

/**
 * Caso de uso «abrir la sesión de caja» (etapa C1, docs/diseno-caja-y-cobro-paridad-pedernal-escalera-2026-11-16.md, CU3). Abre la caja de la sucursal activa con un fondo inicial (puede ser $0).
 *
 * `import "server-only"` y SIN `"use server"`: la Server Action ya pidió el permiso y validó el formato. La caja y el medio EFECTIVO «nacen solos» la primera vez (ON CONFLICT DO NOTHING: dos aperturas a la vez nunca duplican).
 * Todo en UNA transacción SERIALIZABLE:
 *  1. la clave de reintento (única por empresa): misma clave y mismo pedido → la sesión ya abierta (`yaExistia`, sin escribir ni auditar de nuevo); misma clave con otro pedido → `CLAVE_REUTILIZADA`. La clave se mira ANTES que el estado;
 *  2. la sucursal existe y está activa;
 *  3. asegura la caja y el efectivo; si la caja ya tiene una sesión sin cerrar (ABIERTA o EN_CIERRE) → `CAJA_YA_ABIERTA { sesionId }`;
 *  4. sella el día de negocio con la zona de la empresa del contexto (`empresaZonaHoraria`; corte 00:00 en C1: la hora de corte llega con la etapa C2), inserta la sesión, el movimiento FONDO_INICIAL y la auditoría.
 * Segunda barrera: los índices únicos `SesionCaja_una_sin_cerrar_por_caja_key` y `SesionCaja_empresaId_claveIdempotencia_key`.
 *
 * @contract Deja exactamente una sesión abierta por caja y por clave, con su fondo, o no escribe nada.
 * @idempotency Clave de reintento única por empresa más la huella del pedido, dentro de la misma transacción; además los índices únicos.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, también ante el choque de índice único).
 * @sideEffects registrarCambioAuditado (apertura con su fondo).
 * @ficha permiso=caja_abrir_sesion transaccion=SERIALIZABLE idempotencia=POR_CLAVE auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function abrirSesionCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "empresaId" | "empresaZonaHoraria" | "transaccion" | "ahora">,
  comando: ComandoAbrirSesion,
  azar: FuenteDeAzar,
): Promise<ResultadoAbrirSesion> {
  const huella = calcularPayloadHash("ABRIR_SESION_DE_CAJA", actor.empresaId, { sucursalId: actor.sucursalId, fondo: textoDeCentavos(comando.fondoEnCentavos) });

  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoAbrirSesion> => {
      const conLaClave = await cargarSesionDeClave(tx, actor.empresaId, comando.claveIdempotencia);
      if (conLaClave) {
        if (conLaClave.huella !== huella) return fracaso("CLAVE_REUTILIZADA", "Esta clave de apertura ya se usó con otro pedido.");
        return exito("La caja ya estaba abierta.", { sesionId: conLaClave.id, yaExistia: true });
      }

      const sucursal = await tx.sucursal.findFirst({ where: { empresaId: actor.empresaId, id: actor.sucursalId }, select: { activo: true } });
      if (!sucursal) return fracaso("SUCURSAL_NO_ENCONTRADA", "No se encontró la sucursal.");
      if (!sucursal.activo) return fracaso("SUCURSAL_INACTIVA", "La sucursal está desactivada: no se puede abrir la caja.");

      await asegurarCaja(tx, { id: azar.uuid(), empresaId: actor.empresaId, sucursalId: actor.sucursalId, nombre: "Caja 1" });
      await asegurarMedioEfectivo(tx, { id: azar.uuid(), empresaId: actor.empresaId });
      const caja = await cargarCajaDeSucursal(tx, actor.empresaId, actor.sucursalId);
      const efectivo = await cargarMedioEfectivo(tx, actor.empresaId);
      if (!caja || !efectivo) throw new Error("abrirSesion: la caja o el efectivo no quedaron creados.");

      const sinCerrar = await cargarSesionSinCerrarDeCaja(tx, actor.empresaId, caja.id);
      // Con la sesión EN_CIERRE (se está contando) la caja tampoco se abre de nuevo: primero se cierra o se cancela el cierre.
      if (sinCerrar) return { ...fracaso("CAJA_YA_ABIERTA", "La caja ya tiene una sesión abierta."), sesionId: sinCerrar.id };

      const sesionId = azar.uuid();
      await insertarSesion(tx, {
        id: sesionId,
        empresaId: actor.empresaId,
        sucursalId: actor.sucursalId,
        cajaId: caja.id,
        fechaDeNegocio: fechaDeColumnaDate(diaDeCalendario(actor.ahora, actor.empresaZonaHoraria)),
        zonaHoraria: actor.empresaZonaHoraria,
        abiertaEn: actor.ahora,
        abiertaPorId: actor.usuarioId,
        claveIdempotencia: comando.claveIdempotencia,
        huella,
      });
      await insertarMovimiento(tx, {
        id: azar.uuid(),
        empresaId: actor.empresaId,
        sucursalId: actor.sucursalId,
        sesionId,
        clase: "FONDO_INICIAL",
        medioDePagoId: efectivo.id,
        importeEnCentavos: comando.fondoEnCentavos,
        motivo: null,
        anulaAId: null,
        claveIdempotencia: null,
        creadoPorId: actor.usuarioId,
      });
      await registrarCambioAuditado(tx, {
        entidad: "SesionCaja",
        entidadId: sesionId,
        descripcion: "Caja abierta",
        campo: "apertura",
        valorAnterior: null,
        valorNuevo: `fondo ${textoDeCentavos(comando.fondoEnCentavos)}`,
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });
      return exito("Caja abierta.", { sesionId, yaExistia: false });
    },
    undefined,
    undefined,
    true,
  );
}
