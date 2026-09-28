import "server-only";
import type { Prisma } from "@prisma/client";
import type { CabeceraRecetaInput, IngredienteInput, PasoInput } from "@/core/catalogo/public-servidor";
import { texto } from "@/core/texto";

/**
 * Persistencia de «guardar una versión nueva de la receta» (Task #41, P1 — docs/arquitectura-casos-de-uso-2026-09-27.md). Son EXACTAMENTE
 * las lecturas y escrituras de Prisma que antes hacía en línea `guardarReceta` (src/server/actions/catalogo/recetas.ts), copiadas tal
 * cual; qué hacer con lo cargado (elegibilidad, versionado, arrastre o descarte de calibraciones, auditoría) lo decide el caso de uso
 * `casos-de-uso/guardar-version-de-receta.ts`. Sin reglas de negocio.
 *
 * Contrato: el cliente es SIEMPRE el primer parámetro, obligatorio (nunca `db = prisma` por defecto). Excepción documentada respecto del
 * resto de `server/persistencia/`: `cargarProductoParaReceta` y `cargarUltimaVersionDeReceta` corrían FUERA de la transacción en
 * `guardarReceta` (la versión se calcula de forma optimista ANTES de abrir la SERIALIZABLE, y el `@@unique([productoId, version])` es el
 * árbitro — ver el caso de uso), y así se mantiene: el caso de uso les pasa el cliente global a propósito. Las escrituras
 * (`escribirVersionDeReceta`, `copiarCalibracionesLocales`) y `cargarNombresDeSucursales` corren dentro de la transacción.
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
 * La versión vigente (MAX(version)) con sus overrides locales, o `null` si el producto todavía no tiene receta. Corre FUERA de la
 * transacción, una vez por intento del reintento de `guardarReceta` (ver el docstring del archivo; `test/catalogo/recetas-concurrencia`
 * cuenta estas lecturas para saber que hubo reintentos).
 */
export async function cargarUltimaVersionDeReceta(db: Prisma.TransactionClient, productoId: string): Promise<UltimaVersionDeReceta | null> {
  return db.recetaVersion.findFirst({
    where: { productoId },
    orderBy: { version: "desc" },
    include: INCLUDE_ULTIMA_VERSION,
  });
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
  args: { productoId: string; version: number; items: IngredienteInput[]; pasos: PasoInput[]; cabecera: CabeceraRecetaInput }
): Promise<VersionDeRecetaEscrita> {
  const { productoId, version, items, pasos, cabecera } = args;
  const creada = await tx.recetaVersion.create({
    data: {
      productoId,
      version,
      rendimientoCantidad: cabecera.rendimientoCantidad,
      rendimientoUnidadId: cabecera.rendimientoUnidadId || null,
      racionesCantidad: cabecera.racionesCantidad,
      racionTamano: cabecera.racionTamano,
      racionUnidadId: cabecera.racionUnidadId || null,
      tiempoPreparacionMinutos: cabecera.tiempoPreparacionMinutos,
      tiempoCoccionMinutos: cabecera.tiempoCoccionMinutos,
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
          observaciones: it.observaciones,
          sustitutos: it.insumoSustitutoIds?.length
            ? { create: it.insumoSustitutoIds.map((insumoSustitutoId, i) => ({ insumoSustitutoId, orden: i + 1 })) }
            : undefined,
        })),
      },
      pasos: {
        create: pasos.map((p) => ({
          orden: p.orden,
          nombre: texto(p.nombre ?? "") || null,
          instruccion: p.instruccion,
          minutos: p.minutos,
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
