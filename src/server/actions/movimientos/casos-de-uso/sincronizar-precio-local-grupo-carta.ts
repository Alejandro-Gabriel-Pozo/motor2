import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoSincronizarPrecioLocalGrupoCarta, ResultadoSincronizarPrecioLocalGrupoCarta } from "@/core/features/movimientos/precio-local.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { resolverGrupoDeProducto } from "@/server/lecturas/carta/grupo-de-producto";
import { guardarPrecioLocalEnTx } from "./guardar-precio-local-en-tx";

/**
 * Caso de uso «aplicar el mismo precio local a los productos de UN ítem agrupado de la carta» (Hito 4 de la pureza, bloque 4.2, paso H4C-4 —
 * `docs/plan-hito-4-pureza.md` §3; el paso que ofrece `setPrecioLocalProducto` con `sincronizable`, docs/plan-agrupacion-items-carta-2026-09-24.md, D11/M8). Es
 * el cuerpo que antes vivía en línea en la Server Action `sincronizarPrecioLocalGrupoCarta` (`src/server/actions/movimientos/precio-local.ts`), movido TAL CUAL:
 * el ítem agrupado del primer producto y los productos se leen con la base del contexto FUERA de la transacción; todos tienen que ser opciones del mismo ítem
 * agrupado en la sucursal activa; y en UNA transacción, producto por producto en orden de nombre, el paso compartido `guardarPrecioLocalEnTx` (mismo upsert y
 * misma auditoría que fijarlo a mano en cada uno). La Server Action quedó como adaptador (`conPermiso("precio_local")` →
 * `guardComandoSincronizarPrecioLocalGrupoCarta` → este caso de uso → `revalidarCartasPublicas` si salió bien → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato (el guard: la sucursal de la pantalla, el precio, la lista).
 *
 * @contract Deja el mismo precio local en todos los productos del ítem agrupado (en la sucursal activa), con su auditoría: o quedan todos, o ninguno.
 * @idempotency No aplica — repetir el pedido vuelve a escribir los mismos precios (sin filas de auditoría nuevas).
 * @transaction `actor.transaccion` (READ COMMITTED): todos los precios y su auditoría juntos (Task #41, M10); el ítem y los productos se leen antes con `actor.db`.
 * @sideEffects registrarCambioAuditado (PrecioLocalProducto.precio y .habilitado de cada producto), en la misma transacción, por el paso compartido. La revalidación
 *   de la carta pública la hace la Server Action.
 * @ficha permiso=precio_local transaccion=SIMPLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function sincronizarPrecioLocalGrupoCartaCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "transaccion" | "usuarioId" | "sucursalId" | "sucursalNombre">,
  comando: ComandoSincronizarPrecioLocalGrupoCarta,
): Promise<ResultadoSincronizarPrecioLocalGrupoCarta> {
  const { productoIds: ids, precio, habilitado } = comando;
  const grupo = await resolverGrupoDeProducto(ids[0], actor.sucursalId, actor.db);
  const delGrupo = new Set(grupo ? [ids[0], ...grupo.hermanos.map((h) => h.productoId)] : []);
  if (!grupo || ids.some((id) => !delGrupo.has(id))) return fracaso("NO_SON_DEL_MISMO_ITEM", "Esos productos no están todos en el mismo ítem agrupado de la carta.");

  const productos = await actor.db.producto.findMany({ where: { id: { in: ids } }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } });
  // Todo el grupo en UNA transacción (Task #41, M10): o quedan todos los precios locales con su auditoría, o ninguno.
  await actor.transaccion(async (tx) => {
    for (const p of productos) await guardarPrecioLocalEnTx(tx, actor, p, precio, habilitado);
  });
  return exito(`Precio local de ${productos.map((p) => `"${p.nombre}"`).join(", ")} fijado en ${precio} en "${actor.sucursalNombre}" («${grupo.nombreItem}»).`, null);
}
