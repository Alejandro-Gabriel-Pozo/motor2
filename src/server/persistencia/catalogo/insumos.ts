import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras de los INSUMOS (`Insumo`, y lo que arrastra la fusión de dos: `Producto.insumoId` y los `SustitutoRecetaIngrediente`; Hito 4 de la pureza, bloque
 * 4.3, paso H4C-9 — `docs/plan-hito-4-pureza.md` §3; mismo contrato que el resto de `server/persistencia/`: el cliente es el PRIMER parámetro, `data` literal,
 * sin reglas de negocio). Son EXACTAMENTE las escrituras que antes hacía en línea `src/server/actions/catalogo/insumos.ts` (con `reapuntarSustitutosDeInsumoFusionado`
 * movida tal cual, lecturas incluidas); las llaman los casos de uso `crear-insumo.ts`, `actualizar-activo-insumo.ts`, `actualizar-grupo-de-insumo.ts` y
 * `renombrar-o-fusionar-insumo.ts`. Un insumo no es plata ni cambia el significado de una cantidad: no se exige auditoría (las de grupos están en `grupos.ts`).
 */

/** Crea el insumo con ese nombre (ya recortado y validado). Devuelve el id y el nombre guardado. */
export async function crearInsumoNuevo(db: Prisma.TransactionClient, args: { nombre: string }): Promise<{ id: string; nombre: string }> {
  const creado = await db.insumo.create({ data: { nombre: args.nombre } });
  return { id: creado.id, nombre: creado.nombre };
}

/** Activa o desactiva el insumo. Un id que no existe hace lanzar a Prisma (como antes). */
export async function fijarActivoDeInsumo(db: Prisma.TransactionClient, args: { id: string; activo: boolean }): Promise<void> {
  await db.insumo.update({ where: { id: args.id }, data: { activo: args.activo } });
}

/** Pone el insumo en un grupo (`null` = sin grupo). Un id que no existe hace lanzar a Prisma (como antes). */
export async function fijarGrupoDeInsumo(db: Prisma.TransactionClient, args: { id: string; grupoId: string | null }): Promise<void> {
  await db.insumo.update({ where: { id: args.id }, data: { grupoId: args.grupoId } });
}

/** Le cambia el nombre al insumo (el renombre sin fusión). */
export async function renombrarInsumo(db: Prisma.TransactionClient, args: { id: string; nombre: string }): Promise<void> {
  await db.insumo.update({ where: { id: args.id }, data: { nombre: args.nombre } });
}

/** Fusión, paso 1: todos los productos del insumo de origen pasan al de destino. Devuelve cuántos se movieron. */
export async function reasignarProductosDeInsumo(db: Prisma.TransactionClient, args: { origenId: string; destinoId: string }): Promise<number> {
  const { count } = await db.producto.updateMany({ where: { insumoId: args.origenId }, data: { insumoId: args.destinoId } });
  return count;
}

/** Fusión, paso 3: borra el insumo de origen (DESPUÉS de reapuntar los sustitutos: la FK es RESTRICT). */
export async function borrarInsumo(db: Prisma.TransactionClient, args: { id: string }): Promise<void> {
  await db.insumo.delete({ where: { id: args.id } });
}

/**
 * Fusión, paso 2. D9 (docs/plan-sustitucion-insumos-receta-2026-09-26.md): antes de borrar el Insumo `origenId` en una fusión, reapunta cada
 * `SustitutoRecetaIngrediente` que lo declaraba como sustituto hacia `destinoId` — la FK es RESTRICT, así que sin esto la fusión de
 * un Insumo usado como sustituto en alguna receta fallaba en vez de arrastrarlo (mismo criterio que ya aplica
 * `producto.updateMany` con `Producto.insumoId` unas líneas arriba). Por cada línea de receta afectada:
 * - si YA tenía un sustituto apuntando a `destinoId` (duplicado tras la fusión), se borra el del origen y se conserva el otro;
 * - si el destino termina siendo el mismo Insumo que el propio ingrediente principal de esa línea (redundante — D8 nunca lo
 *   permitiría al guardar), se borra;
 * - se renumera `orden` de lo que quede, sin huecos.
 *
 * Movida TAL CUAL desde `src/server/actions/catalogo/insumos.ts` (H4C-9), con sus lecturas: corre dentro de la transacción de la fusión.
 */
export async function reapuntarSustitutosDeInsumoFusionado(tx: Prisma.TransactionClient, origenId: string, destinoId: string): Promise<void> {
  const afectados = await tx.sustitutoRecetaIngrediente.findMany({
    where: { insumoSustitutoId: { in: [origenId, destinoId] } },
    include: { recetaIngrediente: { include: { insumoProducto: true } } },
  });
  const porIngrediente = new Map<string, typeof afectados>();
  for (const fila of afectados) {
    const lista = porIngrediente.get(fila.recetaIngredienteId) ?? [];
    lista.push(fila);
    porIngrediente.set(fila.recetaIngredienteId, lista);
  }

  for (const [, filas] of porIngrediente) {
    const principalInsumoId = filas[0].recetaIngrediente.insumoProducto.insumoId;
    // Como mucho una fila por (ingrediente, insumo) — el UNIQUE ya lo garantiza — así que hay a lo sumo una del origen y una del
    // destino. La del destino (si existía) sobrevive tal cual; si no, sobrevive la del origen, reapuntada.
    const delDestino = filas.find((f) => f.insumoSustitutoId === destinoId);
    const delOrigen = filas.find((f) => f.insumoSustitutoId === origenId);
    const sobrevive = delDestino ?? delOrigen;
    const aBorrar = filas.filter((f) => f.id !== sobrevive?.id);
    if (aBorrar.length) await tx.sustitutoRecetaIngrediente.deleteMany({ where: { id: { in: aBorrar.map((f) => f.id) } } });

    if (!sobrevive) continue;
    if (destinoId === principalInsumoId) {
      // Redundante: el destino de la fusión ES el Insumo del propio ingrediente principal — ya no tiene sentido como sustituto.
      await tx.sustitutoRecetaIngrediente.delete({ where: { id: sobrevive.id } });
      continue;
    }
    if (sobrevive.insumoSustitutoId !== destinoId) {
      await tx.sustitutoRecetaIngrediente.update({ where: { id: sobrevive.id }, data: { insumoSustitutoId: destinoId } });
    }
  }

  // Renumerar sin huecos — en orden ascendente para no chocar nunca con el UNIQUE (recetaIngredienteId, orden) a mitad de camino.
  for (const recetaIngredienteId of porIngrediente.keys()) {
    const restantes = await tx.sustitutoRecetaIngrediente.findMany({ where: { recetaIngredienteId }, orderBy: { orden: "asc" } });
    for (let i = 0; i < restantes.length; i++) {
      if (restantes[i].orden !== i + 1) await tx.sustitutoRecetaIngrediente.update({ where: { id: restantes[i].id }, data: { orden: i + 1 } });
    }
  }
}
