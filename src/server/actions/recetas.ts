"use server";

import { prisma } from "@/lib/db";
import { esErrorDeUnicidad } from "@/core/catalogo/generar-codigo";
import { conPermiso } from "./con-permiso";
import { error, ok, type ResultadoAccion } from "./tipos";

export interface IngredienteInput {
  insumoProductoId: string;
  cantidad: number;
  unidadId: string;
  mermaPorcentaje?: number;
  observaciones?: string;
}

/** Equivalente de construirMapaRecetas_ (Catalogo.js:1549-1596): vigente = MAX(version), siempre derivado. */
export async function obtenerRecetaVigente(productoId: string) {
  return prisma.recetaVersion.findFirst({
    where: { productoId },
    orderBy: { version: "desc" },
    include: { ingredientes: { include: { insumoProducto: true, unidad: true } } },
  });
}

async function validarIngredientes(items: IngredienteInput[]) {
  if (!items.length) return "La receta necesita al menos un ingrediente.";
  for (const item of items) {
    if (!(Number(item.cantidad) > 0)) return "Cada ingrediente necesita una cantidad mayor a 0.";
    if (Number(item.mermaPorcentaje ?? 0) < 0) return "La merma no puede ser negativa.";
    const mp = await prisma.producto.findUnique({ where: { id: item.insumoProductoId } });
    if (!mp || mp.tipo !== "MP" || !mp.activo) {
      return `Cada ingrediente tiene que ser una materia prima (MP) activa (${mp?.nombre ?? item.insumoProductoId} no lo es).`;
    }
  }
  return null;
}

/**
 * Equivalente de guardarReceta (Catalogo.js:1711-1779): versionado
 * append-only real — NUNCA pisa ni borra una versión vieja. `version` se
 * calcula de forma optimista (MAX(version)+1); el
 * `@@unique([productoId, version])` es el árbitro final ante dos
 * ediciones simultáneas de la misma receta (se reintenta el cálculo).
 */
export async function guardarReceta(productoId: string, items: IngredienteInput[]): Promise<ResultadoAccion> {
  return conPermiso("guardar_receta", async () => {
    const producto = await prisma.producto.findUnique({ where: { id: productoId } });
    if (!producto) return error("No se encontró el producto.");

    const elegible = producto.tipo === "PV" || (producto.tipo === "MP" && producto.seProduce);
    if (!elegible) {
      return error(`"${producto.nombre}" no es elegible para tener receta — tiene que ser PV, o MP con "Se produce" activado.`);
    }

    const invalido = await validarIngredientes(items);
    if (invalido) return error(invalido);

    const maxIntentos = 5;
    for (let intento = 0; intento < maxIntentos; intento++) {
      const ultima = await prisma.recetaVersion.findFirst({ where: { productoId }, orderBy: { version: "desc" } });
      const version = (ultima?.version ?? 0) + 1;
      try {
        await prisma.recetaVersion.create({
          data: {
            productoId,
            version,
            ingredientes: {
              create: items.map((it) => ({
                insumoProductoId: it.insumoProductoId,
                cantidad: it.cantidad,
                unidadId: it.unidadId,
                mermaPorcentaje: it.mermaPorcentaje ?? 0,
                observaciones: it.observaciones,
              })),
            },
          },
        });
        return ok(`Receta de "${producto.nombre}" guardada como versión ${version}.`);
      } catch (e) {
        if (esErrorDeUnicidad(e) && intento < maxIntentos - 1) continue;
        throw e;
      }
    }
    return error("No se pudo guardar la receta tras varios intentos (choque de versión concurrente).");
  });
}

/**
 * Equivalente de agregarIngredienteAReceta (Catalogo.js:1817-1843): NO hace
 * un guardado parcial — lee la receta vigente completa, rechaza si el
 * insumo ya está, arma la unión, y delega en guardarReceta (que genera la
 * próxima versión con TODOS los ingredientes juntos).
 */
export async function agregarIngredienteAReceta(
  productoId: string,
  ingrediente: IngredienteInput
): Promise<ResultadoAccion> {
  const vigente = await obtenerRecetaVigente(productoId);
  const existentes = vigente?.ingredientes ?? [];

  if (existentes.some((i) => i.insumoProductoId === ingrediente.insumoProductoId)) {
    return error("Ese insumo ya está en la receta.");
  }

  const items: IngredienteInput[] = [
    ...existentes.map((i) => ({
      insumoProductoId: i.insumoProductoId,
      cantidad: Number(i.cantidad),
      unidadId: i.unidadId,
      mermaPorcentaje: Number(i.mermaPorcentaje),
      observaciones: i.observaciones ?? undefined,
    })),
    ingrediente,
  ];

  return guardarReceta(productoId, items);
}
