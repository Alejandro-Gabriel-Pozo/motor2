import "server-only";
import { DATOS_DEL_COBRO, decidirConVersion, nombreDeConfiguracionValido, validarDatosQuePide, type DatoDelCobro } from "@/core/caja/public";
import type { ComandoEditarMedioDePago, ResultadoEditarMedioDePago } from "@/core/features/caja/caja.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cargarMedio, cargarMedioPorNombre, editarMedioEnBase } from "@/server/persistencia/caja/configuracion";

const lista = (datos: Readonly<Record<DatoDelCobro, boolean>>) => DATOS_DEL_COBRO.filter((d) => datos[d]).join(",") || "ninguno";

/**
 * Caso de uso «editar un medio de pago» (etapa C3; Pedernal `editarMedioDePago`, decisión 129): cambia el nombre y QUÉ DATOS pide el medio al cobrar (cupón, últimos 4, marca, cuotas, DNI; todos nacen apagados). Se manda el
 * conjunto FINAL de datos. El tipo no cambia nunca. Lo ya cobrado no se toca: lo que el medio pide rige para los cobros que vengan.
 *
 * `import "server-only"` y SIN `"use server"`. Valida el nombre (lista de permitidos) y en UNA transacción SERIALIZABLE: el medio existe (`MEDIO_NO_ENCONTRADO`); habilitar un dato que el tipo no admite →
 * `DATO_NO_ADMITIDO_POR_EL_MEDIO { dato }` aunque no haya otro cambio (techo por tipo: efectivo, QR y otro ninguno; débito cupón, últimos 4 y marca; crédito además cuotas; transferencia solo DNI); ya es lo pedido → ok sin
 * escribir ni auditar (aunque la versión sea vieja); la versión esperada no es la vigente → `VERSION_DESACTUALIZADA`; otro medio con ese nombre → `MEDIO_DUPLICADO`. Audita solo lo que cambió (nombre y/o la lista de datos pedidos).
 * Segunda barrera: `MedioDePago_datos_chk` y el índice único del nombre.
 *
 * @contract Cambia el medio una sola vez por versión, o no escribe nada.
 * @idempotency Por estado y por versión: repetir la edición ya aplicada devuelve la versión vigente sin escribir; dos ediciones a la vez con la misma versión: una gana y la otra ve `VERSION_DESACTUALIZADA`.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, también ante el choque de índice único).
 * @sideEffects registrarCambioAuditado (un registro por campo que cambió).
 * @ficha permiso=medios_de_pago_editar transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function editarMedioDePagoCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "empresaId" | "transaccion" | "ahora">,
  comando: ComandoEditarMedioDePago,
): Promise<ResultadoEditarMedioDePago> {
  let nombreNuevo: string | null = null;
  if (comando.nombre !== null) {
    const nombre = nombreDeConfiguracionValido(comando.nombre);
    if (!nombre.ok) return fracaso("NOMBRE_DE_MEDIO_INVALIDO", "El nombre del medio de pago no es válido.");
    nombreNuevo = nombre.valor;
  }

  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoEditarMedioDePago> => {
      const actual = await cargarMedio(tx, actor.empresaId, comando.medioDePagoId);
      if (!actual) return fracaso("MEDIO_NO_ENCONTRADO", "No se encontró el medio de pago.");
      const admitido = validarDatosQuePide(actual.tipo, comando.datos);
      if (!admitido.ok) return { ...fracaso("DATO_NO_ADMITIDO_POR_EL_MEDIO", "Ese tipo de medio no admite pedir ese dato."), ...(admitido.dato ? { dato: admitido.dato } : {}) };

      const cambiaNombre = actual.nombre !== nombreNuevo;
      const cambiaDatos = DATOS_DEL_COBRO.some((d) => actual.pide[d] !== comando.datos[d]);
      const decision = decidirConVersion(!cambiaNombre && !cambiaDatos, actual.version, comando.versionEsperada);
      if (!decision.ok) return fracaso("VERSION_DESACTUALIZADA", "El medio de pago cambió: volvé a abrirlo antes de editarlo.");
      if (decision.valor === "SIN_CAMBIOS") return exito("El medio de pago ya estaba así.", { version: actual.version });

      if (cambiaNombre && nombreNuevo !== null) {
        const conEseNombre = await cargarMedioPorNombre(tx, actor.empresaId, nombreNuevo);
        if (conEseNombre && conEseNombre.id !== actual.id) return fracaso("MEDIO_DUPLICADO", "Ya hay un medio de pago con ese nombre.");
      }
      const escribio = await editarMedioEnBase(tx, {
        empresaId: actor.empresaId,
        id: actual.id,
        versionEsperada: actual.version,
        ahora: actor.ahora,
        ...(cambiaNombre ? { nombre: nombreNuevo } : {}),
        ...(cambiaDatos ? { pide: comando.datos } : {}),
      });
      if (!escribio) return fracaso("VERSION_DESACTUALIZADA", "El medio de pago cambió: volvé a abrirlo antes de editarlo.");

      const auditar = (campo: string, descripcion: string, anterior: unknown, nuevo: unknown) =>
        registrarCambioAuditado(tx, { entidad: "MedioDePago", entidadId: actual.id, descripcion, campo, valorAnterior: anterior, valorNuevo: nuevo, actorId: actor.usuarioId, sucursalId: null });
      if (cambiaNombre) await auditar("nombre", `Medio de pago ${actual.tipo}: nombre`, actual.nombre, nombreNuevo);
      if (cambiaDatos) await auditar("datosQuePide", `Medio de pago ${nombreNuevo ?? actual.nombre ?? actual.tipo}: datos que pide al cobrar`, lista(actual.pide), lista(comando.datos));
      return exito("Medio de pago actualizado.", { version: actual.version + 1 });
    },
    undefined,
    undefined,
    true,
  );
}
