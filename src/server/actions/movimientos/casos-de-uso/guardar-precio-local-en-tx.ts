import "server-only";
import type { Prisma } from "@prisma/client";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { escribirPrecioLocal } from "@/server/persistencia/movimientos/precio-local";

/**
 * PASO COMPARTIDO (no es un caso de uso: no lo importa ninguna Server Action, solo los casos de uso de esta carpeta) del precio local de UN producto en la
 * sucursal activa, con su auditoría (A3, Pivote 6). Hito 4 de la pureza (bloque 4.2, paso H4C-4): es el ayudante `guardarPrecioLocal` que antes vivía en
 * `src/server/actions/movimientos/precio-local.ts`, movido TAL CUAL (mismo orden: la fila anterior, el upsert —los dos en `escribirPrecioLocal`,
 * server/persistencia/movimientos/precio-local.ts—, la fila de auditoría del precio y la de `habilitado`). Lo usan `setPrecioLocalProductoCasoDeUso` (un
 * producto) y `sincronizarPrecioLocalGrupoCartaCasoDeUso` (cada producto del ítem agrupado, en la misma transacción).
 *
 * Recibe el cliente de la transacción de quien llama (Task #41, M10): el upsert y sus dos filas de auditoría quedan o todos o ninguno. Importa
 * `registrarCambioAuditado` de `@/server/auditoria/registrar-cambio-auditado`: `test/catalogo/precio-auditoria-atomica.test.ts` reemplaza ese módulo para simular la caída de la
 * auditoría y tiene que seguir interceptándola.
 */
export async function guardarPrecioLocalEnTx(
  tx: Prisma.TransactionClient,
  actor: { usuarioId: string; sucursalId: string },
  producto: { id: string; nombre: string },
  precio: number,
  habilitado: boolean,
): Promise<void> {
  const fila = await escribirPrecioLocal(tx, { sucursalId: actor.sucursalId, productoId: producto.id, precio, habilitado });

  // Auditoría administrativa (A3, Pivote 6).
  await registrarCambioAuditado(tx, {
    entidad: "PrecioLocalProducto", entidadId: fila.id, campo: "precio",
    descripcion: `Precio local de "${producto.nombre}"`,
    valorAnterior: fila.anterior ? fila.anterior.precio : null, valorNuevo: Number(precio), actorId: actor.usuarioId, sucursalId: actor.sucursalId,
  });
  await registrarCambioAuditado(tx, {
    entidad: "PrecioLocalProducto", entidadId: fila.id, campo: "habilitado",
    descripcion: `Precio local de "${producto.nombre}": habilitado`,
    valorAnterior: fila.anterior?.habilitado ?? null, valorNuevo: habilitado, actorId: actor.usuarioId, sucursalId: actor.sucursalId,
  });
}
