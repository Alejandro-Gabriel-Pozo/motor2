import { prisma } from "./test-db";

/**
 * La versión más nueva de la serie de recetas de un producto (`0` si no tiene ninguna): la que la pantalla mostraría hoy y que las acciones puntuales de la receta piden de vuelta
 * (`versionVista`, H7). `sucursalId` null = la receta CENTRAL; con una sucursal, su receta PROPIA (aunque hoy esté deshabilitada).
 */
export async function versionVigenteDeReceta(productoId: string, sucursalId: string | null = null): Promise<number> {
  const ultima = await prisma.recetaVersion.findFirst({ where: { productoId, sucursalId }, orderBy: { version: "desc" }, select: { version: true } });
  return ultima?.version ?? 0;
}
