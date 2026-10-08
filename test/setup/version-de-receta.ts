import { prisma } from "./test-db";

/**
 * La versión más nueva de la serie de recetas de un producto (`0` si no tiene ninguna): la que la pantalla mostraría hoy y que las acciones puntuales de la receta piden de vuelta
 * (`versionVista`, H7). `sucursalId` null = la receta CENTRAL; con una sucursal, su receta PROPIA (aunque hoy esté deshabilitada).
 */
export async function versionVigenteDeReceta(productoId: string, sucursalId: string | null = null): Promise<number> {
  const ultima = await prisma.recetaVersion.findFirst({ where: { productoId, sucursalId }, orderBy: { version: "desc" }, select: { version: true } });
  return ultima?.version ?? 0;
}

/**
 * Si la receta PROPIA de la sucursal está habilitada hoy para el producto (`false` sin fila): lo que la pantalla mostraría y que las acciones de la receta propia
 * piden de vuelta junto con la versión (`habilitadaVista`, D.4).
 */
export async function habilitadaDeRecetaPropia(productoId: string, sucursalId: string): Promise<boolean> {
  const fila = await prisma.recetaSucursal.findFirst({ where: { productoId, sucursalId }, select: { habilitada: true } });
  return fila?.habilitada ?? false;
}
