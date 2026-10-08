import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoActualizarDisponibilidadProducto, ResultadoActualizarDisponibilidadProducto } from "@/core/features/catalogo/productos.schema";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { exito, fracaso } from "@/core/resultado-caso";
import { dependenciasParaDesactivar } from "@/server/lecturas/catalogo/dependencias-para-desactivar";
import { productoDisponibleEn } from "@/server/lecturas/catalogo/disponibilidad";
import { fijarDisponibilidadEnSucursal } from "@/server/persistencia/catalogo/productos";

/** «A, B y C» / «A, B y 2 más»: para que un mensaje de error no crezca sin límite con un catálogo grande. */
function enumerar(items: string[], tope = 4): string {
  const vistos = items.slice(0, tope);
  const resto = items.length - vistos.length;
  const cola = resto > 0 ? ` y ${resto} más` : "";
  return vistos.length > 1 && resto === 0 ? `${vistos.slice(0, -1).join(", ")} y ${vistos[vistos.length - 1]}` : `${vistos.join(", ")}${cola}`;
}

/**
 * Caso de uso «disponibilidad de un producto EN LA SUCURSAL ACTIVA» (docs/plan-disponibilidad-por-sucursal-2026-09-23.md §6.1; Hito 4 de la pureza, bloque 4.3,
 * paso H4C-11 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server Action `actualizarDisponibilidadProducto`
 * (`src/server/actions/catalogo/productos.ts`), movido TAL CUAL: desactivarlo acá lo saca de los selectores de movimiento, de Stock consolidado y de la Valuación
 * DE ESTA SUCURSAL; y si es una MP de la receta vigente de un plato disponible acá, ese plato deja de poder venderse acá. Por eso al DESACTIVAR se BLOQUEA mientras
 * algo dependa de él EN ESTA SUCURSAL (recetas vigentes de platos disponibles acá, saldo en alguna sección de esta sucursal) y el mensaje dice qué es. Reactivar
 * nunca se bloquea (ver `dependenciasParaDesactivar`). La Server Action quedó como adaptador (`conPermiso("producto_disponibilidad")` → este caso de uso →
 * `revalidarCartasPublicas` si salió bien → `aResultadoAccion`).
 *
 * HALLAZGO conocido, migrado tal cual (informado por el plan, se arregla aparte): escribe y audita SIN transacción, con la base del contexto — el valor anterior se
 * lee ANTES del upsert y la fila de auditoría se escribe DESPUÉS, por separado; si la auditoría fallara, la disponibilidad quedaría cambiada sin rastro.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos. Escribe siempre en `actor.sucursalId`.
 *
 * @contract Deja el producto disponible o no en la sucursal activa (al desactivar, solo si nada depende de él acá), con su fila de auditoría si cambió.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo estado (sin fila de auditoría nueva: no cambió).
 * @transaction Ninguna: la escritura y la auditoría van por separado con `actor.db`, como antes (no atómico: hallazgo conocido).
 * @sideEffects registrarCambioAuditado (DisponibilidadProducto.disponible, `entidadId` sucursal:producto) con `actor.db`, después de la escritura. La revalidación
 *   de la carta pública la hace la Server Action.
 * @ficha permiso=producto_disponibilidad transaccion=NINGUNA idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarDisponibilidadProductoCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "usuarioId" | "sucursalId" | "sucursalNombre">,
  comando: ComandoActualizarDisponibilidadProducto,
): Promise<ResultadoActualizarDisponibilidadProducto> {
  const { productoId, disponible } = comando;
  const existente = await actor.db.producto.findUnique({ where: { id: productoId } });
  if (!existente) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");
  if (!disponible) {
    const { recetasVigentes, saldos } = await dependenciasParaDesactivar(productoId, actor.sucursalId, actor.db);
    const motivos: string[] = [];
    if (recetasVigentes.length) motivos.push(`está en la receta vigente de ${enumerar(recetasVigentes.map((r) => r.nombre))}: sacalo de esas recetas`);
    if (saldos.length) {
      const donde = enumerar(saldos.map((s) => `${s.sucursalNombre} / ${s.seccionNombre} (${s.saldo})`));
      motivos.push(`tiene saldo en ${donde}: dejalo en cero con un ajuste`);
    }
    if (motivos.length) {
      return fracaso("TIENE_DEPENDENCIAS", `No se puede desactivar "${existente.nombre}" en "${actor.sucursalNombre}": ${motivos.join("; y ")} antes de desactivarlo.`);
    }
  }
  // El valor anterior se lee ANTES del upsert — registrarCambioAuditado necesita comparar contra el estado previo real, no
  // contra el que se está por escribir (si no, "repetir el mismo estado no deja registro" dejaría de cumplirse).
  const anterior = await productoDisponibleEn(actor.sucursalId, productoId, actor.db);
  await fijarDisponibilidadEnSucursal(actor.db, { sucursalId: actor.sucursalId, productoId, disponible });
  // Auditoría administrativa, como el cambio de activo de un rol. No-op si el valor no cambió (registrarCambioAuditado).
  await registrarCambioAuditado(actor.db, {
    entidad: "DisponibilidadProducto", entidadId: `${actor.sucursalId}:${productoId}`, campo: "disponible",
    descripcion: `Producto "${existente.nombre}" en "${actor.sucursalNombre}": disponible`,
    valorAnterior: anterior, valorNuevo: disponible, actorId: actor.usuarioId,
  });
  return exito(`Producto "${existente.nombre}" ${disponible ? "activado" : "desactivado"} en "${actor.sucursalNombre}".`, null);
}
