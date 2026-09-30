import type { Db } from "@/lib/db-tipos";

/**
 * ADR-006 (`docs/adr/ADR-006-carta-como-modulo-interno.md`) y ADR-007 (A3): la empresa de la carta pública sale de la tabla
 * `Empresa`, no de una variable de entorno. Solo resuelve empresas `ACTIVE`: una suspendida o en alta da el mismo `null` que un
 * slug inexistente (la página responde 404 sin distinguir cuál caso es).
 */

export interface EmpresaCarta {
  id: string;
  slug: string;
  nombre: string;
}

const SELECCION_EMPRESA = { id: true, slug: true, nombre: true } as const;

/** La empresa ACTIVE con ese slug (comparación exacta, sensible a mayúsculas: el slug de la URL llega ya en minúsculas). */
export async function resolverEmpresaCarta(slug: string, db: Db): Promise<EmpresaCarta | null> {
  return db.empresa.findFirst({ where: { slug, estado: "ACTIVE" }, select: SELECCION_EMPRESA });
}
