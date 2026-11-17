import "server-only";
import { decidirConVersion, identificadorExternoValido, nombreDeConfiguracionValido, sucursalEnAlcanceDeEscritura } from "@/core/caja/public";
import type { ComandoEditarCuentaDeCobro, ResultadoEditarCuentaDeCobro } from "@/core/features/caja/caja.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cargarCuentaDeCobro, cargarCuentaPorNombre, editarCuentaEnBase, esChoqueDeUnaActivaPorSucursal, existeSucursal, hayOtraCuentaActivaEnSucursal } from "@/server/persistencia/caja/configuracion";

/**
 * Caso de uso «editar una cuenta de cobro» (etapa C3; Pedernal `editarCuentaDeCobro`): cambia el nombre, el identificador externo o la sucursal; el TIPO no cambia nunca (la base lo impide). Lo ya cobrado no se toca.
 *
 * `import "server-only"` y SIN `"use server"`. Valida la forma y en UNA transacción SERIALIZABLE: la cuenta existe (`CUENTA_DE_COBRO_NO_ENCONTRADA`); el actor escribe en su sucursal actual y en la nueva
 * (`SUCURSAL_FUERA_DE_ALCANCE`); si lo pedido ya es lo que hay → ok sin escribir ni auditar (aunque la versión sea vieja: repetir una edición ya aplicada no es un conflicto); si no, la versión esperada tiene que ser la vigente
 * (`VERSION_DESACTUALIZADA`); otra cuenta con ese nombre → `CUENTA_DUPLICADA`; la sucursal nueva existe; si la cuenta está ACTIVA y se la pasa a otra sucursal que ya tiene otra cuenta activa → `SUCURSAL_YA_TIENE_CUENTA_ACTIVA` (una sola activa por sucursal, decisión del dueño 2026-11-16; el choque del índice se traduce al mismo rechazo). Audita solo lo que cambió y nunca el valor del identificador externo.
 *
 * @contract Cambia la cuenta una sola vez por versión, o no escribe nada.
 * @idempotency Por estado y por versión: repetir la edición ya aplicada devuelve la versión vigente sin escribir; dos ediciones a la vez con la misma versión: una gana y la otra ve `VERSION_DESACTUALIZADA`.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, también ante el choque de índice único).
 * @sideEffects registrarCambioAuditado (un registro por campo que cambió).
 * @ficha permiso=caja_cuenta_de_cobro_editar transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function editarCuentaDeCobroCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "empresaId" | "transaccion" | "ahora" | "alcance">,
  comando: ComandoEditarCuentaDeCobro,
): Promise<ResultadoEditarCuentaDeCobro> {
  const nombre = nombreDeConfiguracionValido(comando.nombre);
  if (!nombre.ok) return fracaso("NOMBRE_DE_CUENTA_INVALIDO", "El nombre de la cuenta no es válido.");
  const identificador = identificadorExternoValido(comando.identificadorExterno);
  if (!identificador.ok) return fracaso(identificador.error, "El identificador de la cuenta no es válido.");

  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoEditarCuentaDeCobro> => {
      const actual = await cargarCuentaDeCobro(tx, actor.empresaId, comando.cuentaDeCobroId);
      if (!actual) return fracaso("CUENTA_DE_COBRO_NO_ENCONTRADA", "No se encontró la cuenta de cobro.");
      for (const donde of new Set([actual.sucursalId, comando.sucursalId])) {
        if (!sucursalEnAlcanceDeEscritura(actor.alcance, donde)) return fracaso("SUCURSAL_FUERA_DE_ALCANCE", "No tenés acceso a esa sucursal.");
      }

      const igual = actual.nombre === nombre.valor && actual.identificadorExterno === identificador.valor && actual.sucursalId === comando.sucursalId;
      const decision = decidirConVersion(igual, actual.version, comando.versionEsperada);
      if (!decision.ok) return fracaso("VERSION_DESACTUALIZADA", "La cuenta cambió: volvé a abrirla antes de editarla.");
      if (decision.valor === "SIN_CAMBIOS") return exito("La cuenta ya estaba así.", { version: actual.version });

      if (comando.sucursalId !== actual.sucursalId && !(await existeSucursal(tx, actor.empresaId, comando.sucursalId))) return fracaso("SUCURSAL_NO_ENCONTRADA", "No se encontró la sucursal.");
      const conEseNombre = await cargarCuentaPorNombre(tx, actor.empresaId, nombre.valor);
      if (conEseNombre && conEseNombre.id !== actual.id) return fracaso("CUENTA_DUPLICADA", "Ya hay una cuenta de cobro con ese nombre.");

      if (actual.activa && comando.sucursalId !== actual.sucursalId && (await hayOtraCuentaActivaEnSucursal(tx, actor.empresaId, comando.sucursalId, actual.id))) return fracaso("SUCURSAL_YA_TIENE_CUENTA_ACTIVA", "Esa sucursal ya tiene una cuenta de cobro activa: desactivala antes de activar o crear otra.");

      const escribio = await editarCuentaEnBase(tx, { empresaId: actor.empresaId, id: actual.id, versionEsperada: actual.version, ahora: actor.ahora, nombre: nombre.valor, identificadorExterno: identificador.valor, sucursalId: comando.sucursalId });
      if (!escribio) return fracaso("VERSION_DESACTUALIZADA", "La cuenta cambió: volvé a abrirla antes de editarla.");

      const auditar = (campo: string, descripcion: string, anterior: unknown, nuevo: unknown, sucursalId: string) =>
        registrarCambioAuditado(tx, { entidad: "CuentaDeCobro", entidadId: actual.id, descripcion, campo, valorAnterior: anterior, valorNuevo: nuevo, actorId: actor.usuarioId, sucursalId });
      if (actual.nombre !== nombre.valor) await auditar("nombre", "Cuenta de cobro: nombre", actual.nombre, nombre.valor, comando.sucursalId);
      if (actual.sucursalId !== comando.sucursalId) await auditar("sucursalId", `Cuenta de cobro ${nombre.valor}: sucursal`, actual.sucursalId, comando.sucursalId, comando.sucursalId);
      if (actual.identificadorExterno !== identificador.valor) {
        // Nunca el valor: solo si tenía y si tiene.
        const texto = (valor: string | null) => (valor === null ? "sin identificador" : "con identificador");
        await auditar("identificadorExterno", `Cuenta de cobro ${nombre.valor}: identificador externo`, texto(actual.identificadorExterno), actual.identificadorExterno !== null && identificador.valor !== null ? "con identificador (cambió)" : texto(identificador.valor), comando.sucursalId);
      }
      return exito("Cuenta de cobro actualizada.", { version: actual.version + 1 });
    },
    undefined,
    undefined,
    true,
  ).catch((e: unknown) => {
    if (esChoqueDeUnaActivaPorSucursal(e)) return fracaso("SUCURSAL_YA_TIENE_CUENTA_ACTIVA" as const, "Esa sucursal ya tiene una cuenta de cobro activa: desactivala antes de activar o crear otra.");
    throw e;
  });
}
