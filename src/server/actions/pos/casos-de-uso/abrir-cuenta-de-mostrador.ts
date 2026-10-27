import "server-only";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import type { ResultadoAbrirCuentaDeMostrador } from "@/core/features/cuentas/cuenta-apertura.schema";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { exito, fracaso } from "@/core/resultado-caso";
import { abrirCuentaDeMostrador } from "@/server/persistencia/pos/cuenta";

/**
 * Caso de uso «abrir la cuenta del mostrador» (ADR-039, M1.4c): deja abierta la cuenta del puesto mostrador de la sucursal activa, sin comensales, y devuelve su id. NO es `abrirCuenta`
 * (esa conserva su firma `(mesaId, comensales)` y con el id del mostrador responde `MESA_NO_ENCONTRADA`): el mostrador no se elige por id ni lleva comensales, la sucursal es la del contexto.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (eso ya lo hizo `conPermiso("pos_abrir_cuenta")`) ni valida formato (no recibe nada del navegador).
 *
 * En UNA transacción SERIALIZABLE (`conTransaccionSerializable`, con `tambienChoqueDeUnico`): 1. el puesto de ESTA sucursal (sin él, `MOSTRADOR_NO_HABILITADO`); 2. si ya tiene una cuenta abierta → ok con
 * ESA cuenta, sin escribir (doble clic y dos cajeros comparten la cuenta; ni mira el límite ni la sucursal activa: reabrir lo que ya está abierto nunca falla); 3. la sucursal tiene que estar activa
 * (`SUCURSAL_INACTIVA`); 4. la cuenta nueva. El mostrador NO cuenta para el límite de mesas abiertas. La carrera la arbitra la transacción SERIALIZABLE y, de respaldo, el índice único parcial
 * `Cuenta_una_abierta_por_mesa_key`: el que pierde repite, ve la cuenta del ganador y responde con ella.
 *
 * @contract Deja abierta la cuenta del mostrador de la sucursal activa y devuelve su id (la que ya estaba abierta, si la había); rechaza si el mostrador no está habilitado o la sucursal está desactivada.
 * @idempotency Por estado — si el puesto ya tiene su cuenta abierta responde ok con esa misma cuenta, sin escribir; la transacción serializable y el índice único parcial arbitran la carrera (M2 sumará la clave de apertura).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, también ante el choque del índice único): el puesto, la sucursal, la cuenta abierta y la cuenta nueva, todo adentro.
 * @sideEffects Ninguno (la cuenta es su propio documento). Refrescar la vista lo hace el cliente (`router.refresh()`).
 * @ficha permiso=pos_abrir_cuenta transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function abrirCuentaDeMostradorCasoDeUso(actor: Pick<ContextoUsuario, "usuarioId" | "sucursalId" | "transaccion">): Promise<ResultadoAbrirCuentaDeMostrador> {
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoAbrirCuentaDeMostrador> => {
      const puesto = await tx.mesa.findFirst({ where: { sucursalId: actor.sucursalId, tipo: "MOSTRADOR" }, include: { sucursal: { select: { nombre: true, activo: true } } } });
      if (!puesto) return fracaso("MOSTRADOR_NO_HABILITADO", "El mostrador de esta sucursal todavía no está habilitado: pedile a un administrador que lo habilite.");

      const abierta = await tx.cuenta.findFirst({ where: { mesaId: puesto.id, cerradaEn: null }, select: { id: true } });
      if (abierta) return exito("El mostrador ya tenía una cuenta abierta.", { cuentaId: abierta.id, creada: false });

      if (!puesto.sucursal.activo) return fracaso("SUCURSAL_INACTIVA", `La sucursal «${puesto.sucursal.nombre}» está desactivada: no se pueden abrir cuentas.`);

      const cuentaId = await abrirCuentaDeMostrador(tx, { mesaId: puesto.id, abiertaPorId: actor.usuarioId });
      return exito("Cuenta del mostrador abierta.", { cuentaId, creada: true });
    },
    undefined,
    undefined,
    true,
  );
}
