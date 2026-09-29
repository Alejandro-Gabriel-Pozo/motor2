import type { Prisma, PrismaClient } from "@prisma/client";
import { armarRegistroTenants, type RegistroTenantsV1 } from "./registro-tenants";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Capa de LECTURA del registro de tenants del portal (docs/plan-registro-tenants-2026-09-24.md, M3), separada de
 * `registro-tenants.ts` (puro) igual que `menu-consulta.ts` de `armar-menu.ts`. NUNCA ESCRIBE (lo fija
 * test/arquitectura/carta-solo-lectura.test.ts).
 *
 * Una sola consulta: todas las filas de `SucursalPublica` con su sucursal. Sin fila = la sucursal no está en el registro de
 * motor2 (opt-in, D3). Las no publicadas o de una sucursal inactiva salen igual, con `activo: false` (D4, D7).
 */
export async function resolverRegistroTenants(db: Db, ahora: Date = new Date()): Promise<RegistroTenantsV1> {
  const filas = await db.sucursalPublica.findMany({
    select: {
      slug: true,
      etiqueta: true,
      dominio: true,
      subtituloPortal: true,
      posX: true,
      posY: true,
      posW: true,
      posH: true,
      orden: true,
      publicada: true,
      menuDesdeMotor2: true,
      sheetId: true,
      sheetMenuNombre: true,
      // El tema aplicado (temaDesdeMotor2, docs/plan-tema-carta-2026-09-24.md, M6) viaja en el mismo select: sigue siendo UNA consulta.
      sucursal: { select: { id: true, nombre: true, activo: true, temaCarta: { select: { aplicarEnCarta: true } } } },
    },
  });
  return armarRegistroTenants(filas, ahora);
}
