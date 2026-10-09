import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { MENSAJE_GRUPO_NO_ENCONTRADO, MENSAJE_INSUMO_NO_ENCONTRADO } from "@/core/features/catalogo/insumos.guard";
import type { ComandoActualizarGrupoDeInsumo, ResultadoActualizarGrupoDeInsumo } from "@/core/features/catalogo/insumos.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { fijarGrupoDeInsumo } from "@/server/persistencia/catalogo/insumos";

/**
 * Caso de uso «cambiar el grupo de un insumo» (Hito 4 de la pureza, bloque 4.3, paso H4C-9 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en
 * línea en la Server Action `actualizarGrupoDeInsumo` (`src/server/actions/catalogo/insumos.ts`): una sola escritura con la base del contexto, sin transacción
 * ni auditoría. La Server Action quedó como adaptador (`conPermisoDeEmpresa("grupos_familia")` → este caso de uso → si salió bien, `refrescarVistaSiHaceFalta`
 * → `aResultadoAccion`).
 *
 * O.44b (Hito 4, bloque E1; arreglo chico aprobado por el principio de fallo cerrado, CAMBIA COMPORTAMIENTO): un id roto ya no hace lanzar a Prisma (un 500).
 * La persistencia descarta lo que no es texto, mira que el grupo pedido exista en la empresa y escribe con `updateMany`: un insumo que no existe, ajeno o que no
 * es texto devuelve `INSUMO_NO_ENCONTRADO` («No se encontró el insumo.»); un grupo así, `GRUPO_NO_ENCONTRADO` («No se encontró el grupo.»). Sin escribir nada y
 * sin refrescar (la acción solo refresca si salió bien). El orden permiso → formato → existencia no cambia (no hay guard: el formato de los ids lo mira la
 * persistencia antes de leer o escribir).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * @contract Deja el insumo en el grupo pedido (o sin grupo), si los dos existen en la empresa.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo grupo.
 * @transaction Ninguna: una sola escritura con `actor.db` (más la lectura del grupo pedido), como antes.
 * @sideEffects Ninguno (sin auditoría). El refresco de la vista lo hace la Server Action.
 * @ficha permiso=grupos_familia transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarGrupoDeInsumoCasoDeUso(actor: Pick<ContextoUsuario, "db">, comando: ComandoActualizarGrupoDeInsumo): Promise<ResultadoActualizarGrupoDeInsumo> {
  const resultado = await fijarGrupoDeInsumo(actor.db, { id: comando.insumoId, grupoId: comando.grupoId });
  if (resultado === "sin-insumo") return fracaso("INSUMO_NO_ENCONTRADO", MENSAJE_INSUMO_NO_ENCONTRADO);
  if (resultado === "sin-grupo") return fracaso("GRUPO_NO_ENCONTRADO", MENSAJE_GRUPO_NO_ENCONTRADO);
  return exito("Grupo del insumo actualizado.", null);
}
