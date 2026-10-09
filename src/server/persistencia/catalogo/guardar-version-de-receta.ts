import "server-only";
import type { Prisma } from "@prisma/client";
import { ALCANCE_CENTRAL, alcanceDeSucursal } from "@/core/catalogo/public";
import { cargarHistorialDeVersiones, cargarRecetaVigente } from "@/server/lecturas/catalogo/recetas-vigentes";
import { type CabeceraRecetaInput, type IngredienteInput, type PasoInput } from "@/core/catalogo/public";
import { texto } from "@/core/texto";

/**
 * Persistencia de «guardar una versión nueva de la receta» (Task #41, P1 — docs/arquitectura-casos-de-uso-2026-09-27.md). Son EXACTAMENTE
 * las lecturas y escrituras de Prisma que antes hacía en línea `guardarReceta` (src/server/actions/catalogo/recetas.ts), copiadas tal
 * cual; qué hacer con lo cargado (elegibilidad, versionado, arrastre o descarte de calibraciones, auditoría) lo decide el caso de uso
 * `casos-de-uso/guardar-version-de-receta.ts`. Sin reglas de negocio.
 *
 * Contrato: el cliente es SIEMPRE el primer parámetro, obligatorio (nunca `db = prisma` por defecto). Excepción documentada respecto del
 * resto de `server/persistencia/`: `cargarProductoParaReceta` corre FUERA de la transacción (el producto no cambia el versionado y se carga una sola vez, antes de validar). Todo lo demás
 * corre DENTRO de la SERIALIZABLE (desde H7, Pureza Fase 4): `cargarUltimaVersionDeReceta`, `cargarHabilitadaDeRecetaPropia` (D.4) y `cargarIdDeVersionCentralVigente` —leer la última versión fuera de ella dejaba que una
 * calibración local confirmada entre la lectura y la escritura se perdiera—, las escrituras (`escribirVersionDeReceta`, `copiarCalibracionesLocales`) y `cargarNombresDeSucursales`.
 *
 * Los `Decimal` de las calibraciones locales NO se convierten a `number` en el borde (a diferencia del resto de la persistencia): se
 * copian tal cual a la versión nueva, y pasar por `number` podría perder precisión en la ida y vuelta.
 */

/** El producto dueño de la receta, con lo que necesita el caso de uso (elegibilidad, validación de ingredientes, mensajes). */
export interface ProductoParaReceta {
  id: string;
  nombre: string;
  tipo: string;
  seProduce: boolean;
}

/** `null` si el producto no existe. Corre FUERA de la transacción (ver el docstring del archivo). */
export async function cargarProductoParaReceta(db: Prisma.TransactionClient, productoId: string): Promise<ProductoParaReceta | null> {
  const producto = await db.producto.findUnique({ where: { id: productoId } });
  if (!producto) return null;
  return { id: producto.id, nombre: producto.nombre, tipo: producto.tipo, seProduce: producto.seProduce };
}

const INCLUDE_ULTIMA_VERSION = {
  ingredientes: { include: { rendimientosLocales: true, unidad: { select: { nombre: true } }, insumoProducto: { select: { nombre: true } } } },
} satisfies Prisma.RecetaVersionInclude;

/** La versión vigente COMPLETA, con las calibraciones locales de cada ingrediente (D3: se arrastran a la versión nueva). */
export type UltimaVersionDeReceta = Prisma.RecetaVersionGetPayload<{ include: typeof INCLUDE_ULTIMA_VERSION }>;

/**
 * La versión vigente (MAX(version)) de la serie en la que se guarda, con sus overrides locales, o `null` si esa serie todavía no tiene
 * versiones: la CENTRAL con `sucursalId` null, la PROPIA de la sucursal con su id (aunque hoy esté deshabilitada: la numeración sigue sobre
 * su historial). Corre DENTRO de la transacción, una vez por intento del reintento de `guardarReceta`
 * (`test/catalogo/recetas-concurrencia` cuenta las transacciones por intento para saber que hubo reintentos).
 */
export async function cargarUltimaVersionDeReceta(db: Prisma.TransactionClient, productoId: string, sucursalId: string | null): Promise<UltimaVersionDeReceta | null> {
  if (sucursalId === null) return cargarRecetaVigente(db, ALCANCE_CENTRAL, productoId, { include: INCLUDE_ULTIMA_VERSION });
  return (await cargarHistorialDeVersiones(db, alcanceDeSucursal(sucursalId), productoId, INCLUDE_ULTIMA_VERSION))[0] ?? null;
}

/** El id de la versión CENTRAL vigente del producto, o `null` si no tiene receta central: lo que una receta propia declara como «basada en». */
export async function cargarIdDeVersionCentralVigente(db: Prisma.TransactionClient, productoId: string): Promise<string | null> {
  return (await cargarRecetaVigente(db, ALCANCE_CENTRAL, productoId, { select: { id: true } }))?.id ?? null;
}

/**
 * Si la receta propia de la sucursal está HABILITADA para el producto hoy (`false` si no hay fila: rige la central). Dentro de la transacción: el caso de uso lo
 * compara con lo que la pantalla mostraba (D.4), porque volver a la central deshabilita la propia SIN crear una versión y el chequeo de versión no lo ve.
 */
export async function cargarHabilitadaDeRecetaPropia(tx: Prisma.TransactionClient, sucursalId: string, productoId: string): Promise<boolean> {
  const fila = await tx.recetaSucursal.findUnique({ where: { sucursalId_productoId: { sucursalId, productoId } }, select: { habilitada: true } });
  return fila?.habilitada ?? false;
}

/**
 * Deja la receta propia de la sucursal HABILITADA para el producto (crea la fila si no existía). Devuelve si ya lo estaba antes, o `null`
 * si no había fila: lo que el caso de uso audita. Dentro de la transacción.
 */
export async function habilitarRecetaPropia(tx: Prisma.TransactionClient, sucursalId: string, productoId: string): Promise<boolean | null> {
  const antes = await tx.recetaSucursal.findUnique({ where: { sucursalId_productoId: { sucursalId, productoId } }, select: { habilitada: true } });
  await tx.recetaSucursal.upsert({
    where: { sucursalId_productoId: { sucursalId, productoId } },
    create: { sucursalId, productoId, habilitada: true },
    update: { habilitada: true },
  });
  return antes?.habilitada ?? null;
}

/** La versión recién creada, con lo que necesita el arrastre de calibraciones y la auditoría. */
export interface VersionDeRecetaEscrita {
  id: string;
  ingredientes: { id: string; insumoProductoId: string; unidadId: string; unidad: { nombre: string } }[];
}

/**
 * Crea la versión `version` de la receta con sus ingredientes (y sustitutos), sus pasos y su cabecera, y después la tabla puente
 * paso↔ingrediente. Dentro de la transacción.
 */
export async function escribirVersionDeReceta(
  tx: Prisma.TransactionClient,
  args: { productoId: string; version: number; items: IngredienteInput[]; pasos: PasoInput[]; cabecera: CabeceraRecetaInput; sucursalId: string | null; basadaEnVersionId: string | null }
): Promise<VersionDeRecetaEscrita> {
  const { productoId, version, items, pasos, cabecera, sucursalId, basadaEnVersionId } = args;
  const creada = await tx.recetaVersion.create({
    data: {
      productoId,
      version,
      sucursalId,
      basadaEnVersionId,
      ...(cabecera.rendimientoCantidad !== undefined && { rendimientoCantidad: cabecera.rendimientoCantidad }),
      rendimientoUnidadId: cabecera.rendimientoUnidadId || null,
      ...(cabecera.racionesCantidad !== undefined && { racionesCantidad: cabecera.racionesCantidad }),
      ...(cabecera.racionTamano !== undefined && { racionTamano: cabecera.racionTamano }),
      racionUnidadId: cabecera.racionUnidadId || null,
      ...(cabecera.tiempoPreparacionMinutos !== undefined && { tiempoPreparacionMinutos: cabecera.tiempoPreparacionMinutos }),
      ...(cabecera.tiempoCoccionMinutos !== undefined && { tiempoCoccionMinutos: cabecera.tiempoCoccionMinutos }),
      comentarios: texto(cabecera.comentarios ?? "") || null,
      presentacionEmplatado: texto(cabecera.presentacionEmplatado ?? "") || null,
      notasAdicionales: texto(cabecera.notasAdicionales ?? "") || null,
      equipamientoNecesario: texto(cabecera.equipamientoNecesario ?? "") || null,
      ingredientes: {
        create: items.map((it) => ({
          insumoProductoId: it.insumoProductoId,
          cantidad: it.cantidad,
          unidadId: it.unidadId,
          mermaPorcentaje: it.mermaPorcentaje ?? 0,
          ...(it.observaciones !== undefined && { observaciones: it.observaciones }),
          ...(it.insumoSustitutoIds?.length && { sustitutos: { create: it.insumoSustitutoIds.map((insumoSustitutoId, i) => ({ insumoSustitutoId, orden: i + 1 })) } }),
        })),
      },
      pasos: {
        create: pasos.map((p) => ({
          orden: p.orden,
          nombre: texto(p.nombre ?? "") || null,
          instruccion: p.instruccion,
          ...(p.minutos !== undefined && { minutos: p.minutos }),
        })),
      },
    },
    include: { ingredientes: { include: { unidad: { select: { nombre: true } } } }, pasos: true },
  });

  // Los pasos ya existen (con id real), y también los ingredientes
  // — recién ahora se puede armar la tabla puente paso↔ingrediente
  // (no se puede anidar en el create de arriba: no hay ningún id
  // real todavía en el momento de armar ese payload).
  for (const pasoInput of pasos) {
    if (!pasoInput.insumoProductoIds?.length) continue;
    const pasoCreado = creada.pasos.find((p) => p.orden === pasoInput.orden);
    if (!pasoCreado) continue;
    for (const insumoProductoId of pasoInput.insumoProductoIds) {
      const ingredienteCreado = creada.ingredientes.find((i) => i.insumoProductoId === insumoProductoId);
      if (!ingredienteCreado) continue;
      await tx.recetaPasoIngrediente.create({
        data: { recetaPasoId: pasoCreado.id, recetaIngredienteId: ingredienteCreado.id },
      });
    }
  }

  return creada;
}

/** Nombre de cada sucursal pedida (para los textos de auditoría del descarte). Sin ids, no consulta. Dentro de la transacción. */
export async function cargarNombresDeSucursales(tx: Prisma.TransactionClient, sucursalIds: string[]): Promise<{ id: string; nombre: string }[]> {
  return sucursalIds.length ? tx.sucursal.findMany({ where: { id: { in: sucursalIds } }, select: { id: true, nombre: true } }) : [];
}

/** Copia, tal cual, las calibraciones locales de un ingrediente de la versión vieja a su par de la versión nueva. Dentro de la transacción. */
export async function copiarCalibracionesLocales(
  tx: Prisma.TransactionClient,
  recetaIngredienteId: string,
  calibraciones: { sucursalId: string; cantidad: Prisma.Decimal | null; mermaPorcentaje: Prisma.Decimal | null }[]
): Promise<void> {
  await tx.rendimientoLocalIngrediente.createMany({
    data: calibraciones.map((r) => ({
      recetaIngredienteId,
      sucursalId: r.sucursalId,
      cantidad: r.cantidad,
      mermaPorcentaje: r.mermaPorcentaje,
    })),
  });
}
