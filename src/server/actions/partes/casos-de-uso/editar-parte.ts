import "server-only";
import { columnasDeParte } from "@/core/datos/datos-de-parte";
import { documentoNormalizado } from "@/core/datos/documento-de-parte";
import type { ComandoEditarParte, ResultadoEdicionDeParte } from "@/core/features/partes/partes.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { actualizarParteConVersion, cargarParte, cargarParteDeDocumento } from "@/server/persistencia/partes/partes";

/** Los campos de la ficha que se comparan para saber qué cambió (el nombre del campo es lo que se audita; el valor NUNCA). */
const CAMPOS = ["naturaleza", "nombre", "apellido", "alias", "documentoTipo", "documentoPais", "documentoNumero", "condicionIva", "email", "telefono", "domPais", "domCalle", "domNumero", "domPiso", "domDepartamento", "domLocalidad", "domProvincia", "domCodigoPostal", "domTexto", "nota"] as const;

/**
 * Caso de uso «editar una ficha de parte» (docs/diseno-parte-2026-11-12.md §3.2, comando CU2). Reescribe los datos de identidad de la ficha con CONTROL OPTIMISTA: la pantalla manda la versión que leyó; si otra persona
 * la cambió en el medio, no se pisa nada (`VERSION_DESACTUALIZADA`, para que la pantalla recargue).
 *
 * `import "server-only"` y SIN `"use server"`: la Server Action pidió `partes_editar` y validó el formato (`guardComandoEditarParte`). Una persona que pasa a empresa con un DNI cargado no entra (la validación de los datos
 * lo rechaza: una empresa solo admite CUIT o documento extranjero).
 *
 * Pasos, dentro de UNA transacción SERIALIZABLE: lee la ficha (no existe en la empresa → `PARTE_NO_ENCONTRADA`; la RLS oculta las ajenas); compara con lo guardado y, si es lo mismo, devuelve éxito sin escribir ni auditar
 * (repetir no hace nada); si cambia el documento, que no sea de OTRA ficha (`DOCUMENTO_YA_REGISTRADO`); `UPDATE … WHERE version = esperada` (0 filas → `VERSION_DESACTUALIZADA`); una fila de auditoría por campo que
 * cambió, con el nombre del campo y sin los valores (datos personales).
 *
 * @contract Escribe los datos si la versión leída es la vigente y el documento no es de otra ficha; si no, no cambia nada.
 * @idempotency Por estado: repetir el mismo pedido ve los datos ya guardados (sin cambio) o una versión distinta (`VERSION_DESACTUALIZADA`): nunca se aplica dos veces.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, también ante el choque de índice único del documento).
 * @sideEffects registrarCambioAuditado (un campo por fila, sin valores personales).
 * @ficha permiso=partes_editar transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function editarParteCasoDeUso(actor: Pick<ContextoDeAccion, "usuarioId" | "empresaId" | "transaccion">, comando: ComandoEditarParte): Promise<ResultadoEdicionDeParte> {
  const nuevas = columnasDeParte(comando.datos);
  const claveNueva = comando.datos.documento === null ? null : documentoNormalizado(comando.datos.documento);

  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoEdicionDeParte> => {
      const actual = await cargarParte(tx, actor.empresaId, comando.parteId);
      if (!actual) return fracaso("PARTE_NO_ENCONTRADA", "No se encontró esa ficha.");
      const cambiados = CAMPOS.filter((c) => (actual[c] ?? null) !== (nuevas[c] ?? null));
      if (cambiados.length === 0) return exito("Sin cambios.", { parteId: actual.id, cambio: false, version: actual.version });
      if (actual.version !== comando.versionEsperada) return fracaso("VERSION_DESACTUALIZADA", "La ficha cambió mientras se editaba.");

      if (claveNueva !== null && claveNueva !== actual.documentoNormalizado) {
        const duenia = await cargarParteDeDocumento(tx, actor.empresaId, claveNueva);
        if (duenia && duenia.id !== actual.id) return { ...fracaso("DOCUMENTO_YA_REGISTRADO", "Ese documento ya tiene una ficha en la empresa."), parteId: duenia.id };
      }

      const escribio = await actualizarParteConVersion(tx, { empresaId: actor.empresaId, id: actual.id, versionEsperada: comando.versionEsperada, datos: comando.datos });
      if (!escribio) return fracaso("VERSION_DESACTUALIZADA", "La ficha cambió mientras se editaba.");
      for (const campo of cambiados) {
        await registrarCambioAuditado(tx, {
          entidad: "Parte",
          entidadId: actual.id,
          descripcion: `Ficha de parte: cambió ${campo}`,
          campo,
          valorAnterior: null,
          valorNuevo: "cambió",
          actorId: actor.usuarioId,
          sucursalId: null,
        });
      }
      return exito("Ficha guardada.", { parteId: actual.id, cambio: true, version: comando.versionEsperada + 1 });
    },
    undefined,
    undefined,
    true,
  );
}
