import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoActualizarRespaldoSeccion, ResultadoActualizarRespaldoSeccion } from "@/core/features/movimientos/secciones.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { fijarRespaldoDeSeccion } from "@/server/persistencia/movimientos/secciones";

/**
 * Caso de uso «¿la sección sirve de RESPALDO automático al cerrar una cuenta del salón?» (`Seccion.sirveDeRespaldoEnVentas`,
 * docs/plan-seccion-habitual-stock-2026-09-25.md, B5/C10; Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-18 —
 * `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server Action `actualizarRespaldoSeccion`
 * (`src/server/actions/movimientos/secciones.ts`), movido TAL CUAL: la sección tiene que ser de ESTA sucursal («No se encontró la sección.») y se cambia el flag con
 * la base del contexto, sin transacción ni auditoría. Con `false`, el cierre solo descuenta de acá cuando es la sección habitual de un producto; la venta de
 * mostrador no cambia. La Server Action quedó como adaptador (`conPermiso("secciones")` → `guardComandoActualizarRespaldoSeccion` → este caso de uso → si salió
 * bien, refrescar la vista → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato (el guard: el booleano y que el id sea un texto).
 *
 * @contract Deja el flag de respaldo de la sección de la sucursal activa en el valor pedido, salvo que no exista.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo estado.
 * @transaction Ninguna: una lectura y una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría: no es plata). El refresco de la vista lo hace la Server Action.
 * @ficha permiso=secciones transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarRespaldoSeccionCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "sucursalId">,
  comando: ComandoActualizarRespaldoSeccion,
): Promise<ResultadoActualizarRespaldoSeccion> {
  const { sirveDeRespaldoEnVentas } = comando;
  const seccion = await actor.db.seccion.findUnique({ where: { id: comando.seccionId } });
  if (!seccion || seccion.sucursalId !== actor.sucursalId) return fracaso("NO_ENCONTRADA", "No se encontró la sección.");

  await fijarRespaldoDeSeccion(actor.db, { id: seccion.id, sirveDeRespaldoEnVentas });
  return exito(`Sección "${seccion.nombre}" ${sirveDeRespaldoEnVentas ? "ahora sirve" : "ya no sirve"} de respaldo automático en ventas.`, null);
}
