import "server-only";
import { columnasDeParte } from "@/core/datos/datos-de-parte";
import { documentoNormalizado } from "@/core/datos/documento-de-parte";
import type { ComandoAltaDeParte, ResultadoAltaDeParte } from "@/core/features/partes/partes.schema";
import { calcularPayloadHash } from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cargarParteDeClaveDeAlta, cargarParteDeDocumento, cargarPosiblesDuplicadosDeParte, insertarParte } from "@/server/persistencia/partes/partes";

/**
 * Caso de uso «alta de una ficha de parte» (ficha única de personas y empresas; docs/diseno-parte-2026-11-12.md §3.1, comando CU1). Crea la ficha de una persona o empresa con la clave de reintento que la pantalla
 * generó al abrir el formulario, o devuelve la que ya se creó con esa clave.
 *
 * `import "server-only"` y SIN `"use server"`: la Server Action pidió el permiso `partes_editar` y validó el formato (`guardComandoAltaDeParte`). El id de la ficha lo genera el servidor (`azar`, UUID).
 *
 * Pasos, dentro de UNA transacción SERIALIZABLE (con reintento también ante el choque de índice único: el perdedor de una carrera repite y ve lo que dejó el ganador):
 *  1. la clave de alta (única por empresa): misma clave y mismos datos → la ficha ya creada (`yaExistia`, sin escribir ni auditar de nuevo); misma clave con otros datos → `CLAVE_REUTILIZADA`;
 *  2. el documento (único por empresa, también entre las inactivas): de otra ficha activa → `DOCUMENTO_YA_REGISTRADO { parteId }`; de una inactiva → `PARTE_INACTIVA_CON_ESE_DOCUMENTO { parteId }` (se reactiva, no se duplica);
 *  3. inserta la ficha y la auditoría (qué cambió y quién, NUNCA los datos personales); informa las fichas que podrían ser la misma persona (nombre, correo o teléfono: aviso, no bloqueo).
 * Segunda barrera: los índices únicos `Parte_documento_uk` y `Parte_idempotenciaAlta_uk`.
 *
 * @contract Crea exactamente una ficha por clave de alta y por documento, o no escribe nada.
 * @idempotency Clave de alta única por empresa (`idempotenciaAlta`) más la huella del pedido (`payloadHash`), dentro de la misma transacción; además los índices únicos.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, también ante el choque de índice único).
 * @sideEffects registrarCambioAuditado (el alta: sin valores personales).
 * @ficha permiso=partes_editar transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function altaDeParteCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "empresaId" | "transaccion">,
  comando: ComandoAltaDeParte,
  azar: FuenteDeAzar,
): Promise<ResultadoAltaDeParte> {
  const columnas = columnasDeParte(comando.datos);
  // La huella lleva la empresa, el proceso y los datos YA validados: el mismo pedido reenviado da la misma huella; la misma clave con otros datos, otra.
  const payloadHash = calcularPayloadHash("ALTA_DE_PARTE", actor.empresaId, columnas);
  const clave = documentoNormalizadoDe(comando);

  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoAltaDeParte> => {
      const conLaClave = await cargarParteDeClaveDeAlta(tx, actor.empresaId, comando.claveIdempotencia);
      if (conLaClave) {
        if (conLaClave.payloadHash !== payloadHash) return fracaso("CLAVE_REUTILIZADA", "Esta clave de alta ya se usó con otros datos.");
        return exito("La ficha ya estaba creada.", { parteId: conLaClave.id, yaExistia: true, posiblesDuplicados: await cargarPosiblesDuplicadosDeParte(tx, actor.empresaId, conLaClave.id) });
      }

      if (clave !== null) {
        const duenia = await cargarParteDeDocumento(tx, actor.empresaId, clave);
        if (duenia) {
          const codigo = duenia.estado === "ACTIVA" ? "DOCUMENTO_YA_REGISTRADO" : "PARTE_INACTIVA_CON_ESE_DOCUMENTO";
          return { ...fracaso(codigo, "Ese documento ya tiene una ficha en la empresa."), parteId: duenia.id };
        }
      }

      const id = azar.uuid();
      await insertarParte(tx, { id, empresaId: actor.empresaId, idempotenciaAlta: comando.claveIdempotencia, payloadHash, datos: comando.datos, creadoPorId: actor.usuarioId });
      // Qué cambió y quién, sin el valor: los datos personales (nombre, documento, contacto) no entran en la auditoría; la ficha se identifica por su id.
      await registrarCambioAuditado(tx, {
        entidad: "Parte",
        entidadId: id,
        descripcion: "Ficha de parte creada",
        campo: "alta",
        valorAnterior: null,
        valorNuevo: "creada",
        actorId: actor.usuarioId,
        sucursalId: null,
      });
      return exito("Ficha creada.", { parteId: id, yaExistia: false, posiblesDuplicados: await cargarPosiblesDuplicadosDeParte(tx, actor.empresaId, id) });
    },
    undefined,
    undefined,
    true,
  );
}

function documentoNormalizadoDe(comando: ComandoAltaDeParte): string | null {
  return comando.datos.documento === null ? null : documentoNormalizado(comando.datos.documento);
}
