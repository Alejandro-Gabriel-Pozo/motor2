import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoActualizarActivaSeccion, ResultadoActualizarActivaSeccion } from "@/core/features/movimientos/secciones.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { fijarActivaDeSeccion } from "@/server/persistencia/movimientos/secciones";

/**
 * Caso de uso «activar o desactivar una sección de stock» (Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-18 —
 * `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server Action `actualizarActivaSeccion` (`src/server/actions/movimientos/secciones.ts`),
 * movido TAL CUAL: la sección tiene que ser de ESTA sucursal («No se encontró la sección.») y se cambia `activa` con la base del contexto, sin transacción ni
 * auditoría. No se borra: el Kardex ya escrito con esa sección sigue siendo válido, solo deja de ofrecerse para cargas nuevas. La Server Action quedó como
 * adaptador (`conPermiso("secciones")` → este caso de uso → si salió bien, refrescar la vista → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * @contract Deja la sección de la sucursal activa activa o inactiva, salvo que no exista.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo estado.
 * @transaction Ninguna: una lectura y una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría: no es plata). El refresco de la vista lo hace la Server Action.
 * @ficha permiso=secciones transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarActivaSeccionCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "sucursalId">,
  comando: ComandoActualizarActivaSeccion,
): Promise<ResultadoActualizarActivaSeccion> {
  const { seccionId, activa } = comando;
  // O.44b (fallo cerrado): un id que no es texto (`undefined`, un objeto) hacía lanzar a `findUnique` (un 500); se descarta antes de leer, con el mismo «no encontrado».
  if (typeof seccionId !== "string") return fracaso("NO_ENCONTRADA", "No se encontró la sección.");
  const seccion = await actor.db.seccion.findUnique({ where: { id: seccionId } });
  if (!seccion || seccion.sucursalId !== actor.sucursalId) return fracaso("NO_ENCONTRADA", "No se encontró la sección.");

  await fijarActivaDeSeccion(actor.db, { id: seccionId, activa });
  return exito(`Sección "${seccion.nombre}" ${activa ? "activada" : "desactivada"}.`, null);
}
