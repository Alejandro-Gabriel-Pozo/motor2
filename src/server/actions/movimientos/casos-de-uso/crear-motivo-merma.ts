import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoCrearMotivo, ResultadoCrearMotivo } from "@/core/features/movimientos/motivos.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { crearMotivoMermaNuevo } from "@/server/persistencia/movimientos/motivos";

/**
 * Caso de uso «alta de un motivo de merma» (catálogo GLOBAL administrable, plan del 2026-09-23 P5/P6; Hito 4 de la pureza, bloque C de la pieza
 * carta/catálogo/stock, paso H4C-17 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server Action `crearMotivoMerma`
 * (`src/server/actions/movimientos/motivos.ts`), movido TAL CUAL: un nombre ya usado (sin distinguir mayúsculas) se RECHAZA —no se reusa, a diferencia de
 * `crearCategoriaProducto`: nadie más lo llama desde un alta rápida—; si no, se crea con la base del contexto, sin transacción ni auditoría. La Server Action quedó
 * como adaptador (`conPermisoDeEmpresa("motivos_merma")` → `guardComandoCrearMotivoMerma` → este caso de uso → si salió bien, refrescar la vista →
 * `aResultadoAccion` y el id y el nombre para su `ResultadoConId`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato (el guard).
 *
 * @contract Crea el motivo de merma, salvo que ya haya uno con ese nombre; devuelve su id y su nombre.
 * @idempotency Por estado — repetir el pedido encuentra el motivo ya creado y se rechaza: no crea otro.
 * @transaction Ninguna: una lectura y una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (un motivo no es plata: sin auditoría). El refresco de la vista lo hace la Server Action.
 * @ficha permiso=motivos_merma transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function crearMotivoMermaCasoDeUso(actor: Pick<ContextoUsuario, "db">, comando: ComandoCrearMotivo): Promise<ResultadoCrearMotivo> {
  const existente = await actor.db.motivoMerma.findFirst({ where: { nombre: { equals: comando.nombre, mode: "insensitive" } } });
  if (existente) return fracaso("NOMBRE_REPETIDO", `Ya existe un motivo "${existente.nombre}" (no distingue mayúsculas/espacios).`);

  const creado = await crearMotivoMermaNuevo(actor.db, { nombre: comando.nombre, descripcion: comando.descripcion });
  return exito(`Motivo "${creado.nombre}" creado.`, { id: creado.id, nombre: creado.nombre });
}
