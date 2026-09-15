import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Sube de hijo a raíz siguiendo grupoPadreId — equivalente de
 * obtenerCadenaDeGrupos_ (Catalogo.js:2463-2474). Corta si repite un id ya
 * visto, como protección extra contra un ciclo colado a mano en la base.
 * Devuelve los NOMBRES, del grupo dado hacia la raíz (el propio grupo va
 * primero).
 */
export async function cadenaDeGrupos(grupoId: string, db: PrismaClient = prisma): Promise<string[]> {
  const cadena: string[] = [];
  const vistos = new Set<string>();
  let actualId: string | null = grupoId;

  while (actualId && !vistos.has(actualId)) {
    vistos.add(actualId);
    const grupo: { nombre: string; grupoPadreId: string | null } | null = await db.grupo.findUnique({
      where: { id: actualId },
      select: { nombre: true, grupoPadreId: true },
    });
    if (!grupo) break;
    cadena.push(grupo.nombre);
    actualId = grupo.grupoPadreId;
  }
  return cadena;
}

/** Breadcrumb legible "Bebidas > Bebidas sin alcohol" (raíz primero) — equivalente de textoCadenaDeGrupos_ (Catalogo.js:2477-2480). */
export async function textoCadenaDeGrupos(grupoId: string, db: PrismaClient = prisma): Promise<string> {
  const cadena = await cadenaDeGrupos(grupoId, db);
  return cadena.reverse().join(" > ");
}

/**
 * Equivalente de creariaCicloGrupo_ (Catalogo.js:2483-2489): un grupo no
 * puede ser su propio ancestro. Cubre auto-referencia directa
 * (`padreNuevoId === grupoId`) y ciclo indirecto (el padre propuesto ya
 * desciende de este grupo).
 */
export async function creariaCiclo(
  grupoId: string,
  padreNuevoId: string | null,
  db: PrismaClient = prisma
): Promise<boolean> {
  if (!padreNuevoId) return false; // sin padre = pasa a ser raíz, nunca hay ciclo
  if (padreNuevoId === grupoId) return true;

  const vistos = new Set<string>();
  let actualId: string | null = padreNuevoId;
  while (actualId && !vistos.has(actualId)) {
    if (actualId === grupoId) return true;
    vistos.add(actualId);
    const grupo: { grupoPadreId: string | null } | null = await db.grupo.findUnique({
      where: { id: actualId },
      select: { grupoPadreId: true },
    });
    actualId = grupo?.grupoPadreId ?? null;
  }
  return false;
}
