import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoGuardarPortalEmpresa, ResultadoGuardarPortalEmpresa } from "@/core/features/carta/portal-empresa.schema";
import { exito } from "@/core/resultado-caso";
import { guardarValoresDelPortal } from "@/server/persistencia/carta/portal-empresa";

/**
 * Caso de uso «guardar la apariencia del portal de la empresa» (ADR-006; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1). Es el cuerpo que antes vivía en línea en
 * la Server Action `guardarPortalEmpresa` (`src/server/actions/carta/portal-empresa.ts`), movido TAL CUAL: reemplaza TODO lo guardado por los valores que llegan (el
 * formulario manda todas las claves) con un `upsert` por `empresaId`, así que guardar dos veces lo mismo es idempotente. La Server Action quedó como adaptador
 * (`conPermisoDeEmpresa("carta_portal")` → `guardComandoGuardarPortalEmpresa` → este caso de uso → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato (el guard). NO revalida la carta pública, a propósito (el portal
 * público lee la fila en cada pedido, sin caché): la Server Action tampoco.
 *
 * @contract Deja la apariencia del portal de la empresa activa con exactamente los valores pedidos; devuelve cuántos valores quedaron cargados (el resto usa el default).
 * @idempotency Por estado — es un `upsert` por empresa: repetir el pedido deja la misma fila.
 * @transaction Ninguna: un solo `upsert` con `actor.db`, como antes.
 * @sideEffects Ninguno (la apariencia no es plata: sin auditoría; y no se invalida la carta pública).
 * @ficha permiso=carta_portal transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarPortalEmpresaCasoDeUso(actor: Pick<ContextoUsuario, "db" | "empresaId">, comando: ComandoGuardarPortalEmpresa): Promise<ResultadoGuardarPortalEmpresa> {
  await guardarValoresDelPortal(actor.db, { empresaId: actor.empresaId, valores: comando.valores });
  const cantidad = Object.keys(comando.valores).length;
  return exito(`Apariencia del portal guardada (${cantidad} ${cantidad === 1 ? "valor cargado" : "valores cargados"}; el resto usa el default). El portal la toma al recargarlo.`, { cantidad });
}
