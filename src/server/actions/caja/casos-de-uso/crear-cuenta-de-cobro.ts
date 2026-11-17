import "server-only";
import { decidirAltaDeCuenta, identificadorExternoValido, nombreDeConfiguracionValido, sucursalEnAlcanceDeEscritura, tipoDeCuentaValido } from "@/core/caja/public";
import type { ComandoCrearCuentaDeCobro, ResultadoCrearCuentaDeCobro } from "@/core/features/caja/caja.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cargarCuentaPorNombre, esChoqueDeUnaActivaPorSucursal, existeSucursal, hayOtraCuentaActivaEnSucursal, insertarCuentaDeCobro } from "@/server/persistencia/caja/configuracion";

/**
 * Caso de uso «crear una cuenta de cobro» (etapa C3; Pedernal `crearCuentaDeCobro`): una terminal, un QR o una cuenta bancaria de UNA sucursal, por donde entra el dinero electrónico. Nace activa. Nada se borra: se desactiva.
 *
 * `import "server-only"` y SIN `"use server"`: la Server Action ya pidió el permiso (no existe todavía: zona restringida de otro turno). Valida la forma (lista de permitidos) y en UNA transacción SERIALIZABLE:
 *  1. la sucursal existe y está en el alcance de escritura del actor (`SUCURSAL_NO_ENCONTRADA` / `SUCURSAL_FUERA_DE_ALCANCE`);
 *  2. el nombre (sin distinguir mayúsculas, en toda la empresa) puede ya existir: la MISMA cuenta activa (tipo, identificador y sucursal) → `yaExistia` sin escribir ni auditar (doble clic o reintento); cualquier otra cosa con ese
 *     nombre, o la misma desactivada → `CUENTA_DUPLICADA`;
 *  3. si la sucursal ya tiene OTRA cuenta activa → `SUCURSAL_YA_TIENE_CUENTA_ACTIVA` (decisión del dueño, 2026-11-16, Q-C3-6: una sola cuenta de cobro activa por sucursal; se desactiva una y se crea otra);
 *  4. inserta y audita. La auditoría no lleva el identificador externo, solo si tiene uno.
 * Segunda barrera: el índice único parcial «una activa por sucursal» (`CuentaDeCobro_una_activa_por_sucursal_key`; su choque, si llegara hasta acá tras los reintentos, se traduce al MISMO rechazo y no sale como error), el índice único del nombre sin mayúsculas, los CHECK de tipo, nombre e identificador, y la RLS de sucursal (un INSERT fuera de alcance da 42501).
 *
 * @contract Deja exactamente una cuenta activa por nombre, o no escribe nada.
 * @idempotency Por estado (como Pedernal): la misma cuenta activa ya creada devuelve `yaExistia`; dos altas iguales a la vez dejan una (la perdedora, tras el reintento serializable, ve la primera).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, también ante el choque de índice único).
 * @sideEffects registrarCambioAuditado (el alta, sin el identificador externo).
 * @ficha permiso=caja_cuenta_de_cobro_crear transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function crearCuentaDeCobroCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "empresaId" | "transaccion" | "ahora" | "alcance">,
  comando: ComandoCrearCuentaDeCobro,
  azar: FuenteDeAzar,
): Promise<ResultadoCrearCuentaDeCobro> {
  const tipo = tipoDeCuentaValido(comando.tipo);
  if (!tipo.ok) return fracaso(tipo.error, "El tipo de cuenta no es válido.");
  const nombre = nombreDeConfiguracionValido(comando.nombre);
  if (!nombre.ok) return fracaso("NOMBRE_DE_CUENTA_INVALIDO", "El nombre de la cuenta no es válido.");
  const identificador = identificadorExternoValido(comando.identificadorExterno);
  if (!identificador.ok) return fracaso(identificador.error, "El identificador de la cuenta no es válido.");
  const pedido = { tipo: tipo.valor, identificadorExterno: identificador.valor, sucursalId: comando.sucursalId };

  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoCrearCuentaDeCobro> => {
      if (!(await existeSucursal(tx, actor.empresaId, comando.sucursalId))) return fracaso("SUCURSAL_NO_ENCONTRADA", "No se encontró la sucursal.");
      if (!sucursalEnAlcanceDeEscritura(actor.alcance, comando.sucursalId)) return fracaso("SUCURSAL_FUERA_DE_ALCANCE", "No tenés acceso a esa sucursal.");

      const existente = await cargarCuentaPorNombre(tx, actor.empresaId, nombre.valor);
      const decision = decidirAltaDeCuenta(pedido, existente);
      if (!decision.ok) return fracaso(decision.error, "Ya hay una cuenta de cobro con ese nombre.");
      if (decision.valor === "YA_EXISTIA") {
        if (existente === null) throw new Error("crearCuentaDeCobro: ya existía una cuenta nula.");
        return exito("La cuenta de cobro ya estaba creada.", { cuentaDeCobroId: existente.id, yaExistia: true });
      }

      if (await hayOtraCuentaActivaEnSucursal(tx, actor.empresaId, comando.sucursalId, null)) return fracaso("SUCURSAL_YA_TIENE_CUENTA_ACTIVA", "Esa sucursal ya tiene una cuenta de cobro activa: desactivala antes de activar o crear otra.");

      const id = azar.uuid();
      await insertarCuentaDeCobro(tx, { id, empresaId: actor.empresaId, sucursalId: comando.sucursalId, tipo: tipo.valor, nombre: nombre.valor, identificadorExterno: identificador.valor, ahora: actor.ahora });
      await registrarCambioAuditado(tx, {
        entidad: "CuentaDeCobro",
        entidadId: id,
        descripcion: `Cuenta de cobro creada: ${nombre.valor} (${tipo.valor})${identificador.valor === null ? "" : ", con identificador externo"}`,
        campo: "alta",
        valorAnterior: null,
        valorNuevo: "activa",
        actorId: actor.usuarioId,
        sucursalId: comando.sucursalId,
      });
      return exito("Cuenta de cobro creada.", { cuentaDeCobroId: id, yaExistia: false });
    },
    undefined,
    undefined,
    true,
  ).catch((e: unknown) => {
    if (esChoqueDeUnaActivaPorSucursal(e)) return fracaso("SUCURSAL_YA_TIENE_CUENTA_ACTIVA" as const, "Esa sucursal ya tiene una cuenta de cobro activa: desactivala antes de activar o crear otra.");
    throw e;
  });
}
