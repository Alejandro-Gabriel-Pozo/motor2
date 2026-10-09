import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { whereCartaDeSucursal } from "@/core/carta/public";
import type { ComandoQuitarOpcionItemAgrupadoCarta, ResultadoQuitarOpcionItemAgrupadoCarta } from "@/core/features/carta/items-agrupados.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { quitarOpcionDeItemAgrupado } from "@/server/persistencia/carta/items-agrupados";

/**
 * Caso de uso «sacar un producto de su ítem agrupado» (docs/plan-agrupacion-items-carta-2026-09-24.md, M5; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1). Es el
 * cuerpo que antes vivía en línea en la Server Action `quitarOpcionItemAgrupadoCarta` (`src/server/actions/carta/items-agrupados.ts`), movido TAL CUAL: se borra solo
 * la fila de referencia (`deleteMany`, así repetir el pedido no falla); el producto y su `ContenidoCartaProducto` no se tocan (D3). La Server Action quedó como
 * adaptador (`conPermiso("carta_items_agrupados")` → este caso de uso → `revalidarCartasPublicas` si salió bien → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos. Las opciones son PROPIAS de cada sucursal (ADR-009, C3): la lectura mira solo
 * la sucursal activa (`whereCartaDeSucursal`). Un id que no es texto hace lanzar a Prisma en la lectura, como antes (sin guard).
 *
 * @contract Deja la opción de la sucursal activa fuera de su ítem agrupado; el mensaje nombra el producto y el ítem.
 * @idempotency No aplica — repetir el pedido responde «No se encontró la opción.» (la fila ya no está), sin escribir.
 * @transaction Ninguna: una lectura y un borrado con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría). La revalidación de la carta pública la hace la Server Action cuando sale bien.
 * @ficha permiso=carta_items_agrupados transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function quitarOpcionItemAgrupadoCartaCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "sucursalId">,
  comando: ComandoQuitarOpcionItemAgrupadoCarta,
): Promise<ResultadoQuitarOpcionItemAgrupadoCarta> {
  const { opcionId } = comando;
  const opcion = await actor.db.opcionItemAgrupadoCarta.findUnique({
    where: { id: opcionId, ...whereCartaDeSucursal(actor.sucursalId) },
    select: { producto: { select: { nombre: true } }, itemAgrupadoCarta: { select: { nombre: true } } },
  });
  if (!opcion) return fracaso("OPCION_NO_ENCONTRADA", "No se encontró la opción.");
  await quitarOpcionDeItemAgrupado(actor.db, { id: opcionId });
  return exito(`«${opcion.producto.nombre}» ya no está en «${opcion.itemAgrupadoCarta.nombre}».`, null);
}
