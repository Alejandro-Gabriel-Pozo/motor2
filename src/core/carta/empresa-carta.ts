import type { Db } from "@/lib/db-tipos";

/**
 * ADR-006 (`docs/adr/ADR-006-carta-como-modulo-interno.md`) y ADR-007 (A3): la empresa de la carta pública sale de la tabla
 * `Empresa`, no de una variable de entorno. Solo resuelve empresas `ACTIVE`: una suspendida o en alta da el mismo `null` que un
 * slug inexistente (la página responde 404 sin distinguir cuál caso es).
 */

export interface EmpresaCarta {
  id: string;
  slug: string;
}

const SELECCION_EMPRESA = { id: true, slug: true } as const;

/** La empresa ACTIVE con ese slug (comparación exacta, sensible a mayúsculas: el slug de la URL llega ya en minúsculas). */
export async function resolverEmpresaCarta(slug: string, db: Db): Promise<EmpresaCarta | null> {
  return db.empresa.findFirst({ where: { slug, estado: "ACTIVE" }, select: SELECCION_EMPRESA });
}

/** La empresa dueña de una sucursal (`Sucursal.empresaId` es fijo, ADR-001). Lo usa el admin para armar los links "Ver la carta de motor2". */
export async function empresaDeSucursalCarta(sucursalId: string, db: Db): Promise<EmpresaCarta | null> {
  const sucursal = await db.sucursal.findUnique({ where: { id: sucursalId }, select: { empresa: { select: SELECCION_EMPRESA } } });
  return sucursal?.empresa ?? null;
}
