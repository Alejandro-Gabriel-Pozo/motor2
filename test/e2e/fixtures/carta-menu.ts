import { prisma } from "./db";
import { resolverMenuCarta } from "../../../src/server/lecturas/carta/menu";

/**
 * El menú de la carta pública de una sucursal, leído directo de la base con el `prisma` de la suite (el rol de la app, bajo RLS: con la
 * única empresa activa de la base e2e ve lo mismo que la carta pública). Tira si la sucursal no tiene carta publicable.
 */
export async function menuCartaPublicado(sucursalId: string) {
  const carta = await resolverMenuCarta(sucursalId, prisma);
  if (!carta) throw new Error(`La sucursal ${sucursalId} no tiene carta publicable`);
  return carta;
}
