import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoRenombrarSeccion, ResultadoRenombrarSeccion } from "@/core/features/movimientos/secciones.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { fijarNombreDeSeccion } from "@/server/persistencia/movimientos/secciones";

/**
 * Caso de uso «renombrar una sección de stock» (Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-18 — `docs/plan-hito-4-pureza.md` §3). Es
 * el cuerpo que antes vivía en línea en la Server Action `renombrarSeccion` (`src/server/actions/movimientos/secciones.ts`), movido TAL CUAL y en el MISMO orden:
 * la sección tiene que ser de ESTA sucursal («No se encontró la sección.»), el nombre no puede ser el de OTRA sección de la sucursal (sin distinguir mayúsculas) y
 * se reescribe con la base del contexto, sin transacción ni auditoría. El Kardex ya escrito referencia la sección por FK: renombrarla no rompe nada. La Server
 * Action quedó como adaptador (`conPermiso("secciones")` → `guardComandoRenombrarSeccion` → este caso de uso → si salió bien, refrescar la vista →
 * `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato del nombre (el guard).
 *
 * @contract Le pone el nombre nuevo a la sección de la sucursal activa, salvo que no exista o el nombre sea de otra.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo nombre.
 * @transaction Ninguna: lecturas y una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría: no es plata). El refresco de la vista lo hace la Server Action.
 * @ficha permiso=secciones transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function renombrarSeccionCasoDeUso(actor: Pick<ContextoUsuario, "db" | "sucursalId">, comando: ComandoRenombrarSeccion): Promise<ResultadoRenombrarSeccion> {
  const { seccionId, nombre } = comando;
  const seccion = await actor.db.seccion.findUnique({ where: { id: seccionId } });
  if (!seccion || seccion.sucursalId !== actor.sucursalId) return fracaso("NO_ENCONTRADA", "No se encontró la sección.");

  const existente = await actor.db.seccion.findFirst({
    where: { sucursalId: actor.sucursalId, nombre: { equals: nombre, mode: "insensitive" }, id: { not: seccionId } },
  });
  if (existente) return fracaso("NOMBRE_REPETIDO", `Ya existe una sección "${existente.nombre}" en esta sucursal.`);

  await fijarNombreDeSeccion(actor.db, { id: seccionId, nombre });
  return exito(`Sección renombrada a "${nombre}".`, null);
}
