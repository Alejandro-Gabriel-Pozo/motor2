import "server-only";
import { filtroDelGerente, filtroTuvoRolAdmin } from "@/core/permisos/filtros";
import type { Db } from "@/lib/db-tipos";

/**
 * Las LECTURAS de decisión de la gerencia (Hito 3, Fase II, II.5 de `docs/plan-hito-3-pureza.md`, contrato B4a). Vivían en `core/permisos/gerencia.ts`; se mudaron
 * TAL CUAL, con el MISMO nombre y la MISMA firma (ADR-026 §5: `db` primero, como estaban). En `core` quedó lo puro (el resultado del traspaso y la validación del
 * destino, `mensajeSiElDestinoNoPuedeRecibirLaGerencia`). El alta del primer gerente (`incorporarPrimerGerente`), que además escribe, pasó al paso compartido
 * `server/actions/auth/casos-de-uso/incorporar-primer-gerente-en-tx.ts` con sus escrituras en `server/persistencia/auth/gerencia.ts`.
 *
 * Capa `server/lecturas` (ADR-026): solo lectura, sin guarda propia, la importan los casos de uso de gobierno (dentro de su transacción), las otras lecturas de
 * gobierno y los pasos compartidos; nunca la UI (la pantalla de traspaso lee por `server/consultas/permisos/gerencia.ts`). Los predicados del gerente y del rol
 * admin son los filtros puros de `core/permisos/filtros.ts` (C1).
 */

/** El gerente de la empresa (a lo sumo uno: lo garantiza el índice único parcial de `20261001240000_gerente_unico_indice`). */
export async function obtenerGerenteDeEmpresa(db: Db, empresaId: string) {
  return db.usuarioEmpresa.findFirst({ where: filtroDelGerente(empresaId), select: { id: true, usuarioId: true, activo: true } });
}

/** Tiene (o tuvo) el rol admin en alguna sucursal de la empresa, activa o no: la cuenta de alguien así la reactiva solo el gerente. */
export async function tuvoRolAdminEnLaEmpresa(db: Db, empresaId: string, usuarioId: string): Promise<boolean> {
  return Boolean(await db.usuarioSucursal.findFirst({ where: filtroTuvoRolAdmin(empresaId, usuarioId), select: { id: true } }));
}

/**
 * Apagar `sucursalId` deja sin contexto (core/auth/contexto.ts, que solo cuenta membresías de sucursales activas) a un gerente que no
 * tenga otra membresía activa en OTRA sucursal activa: la empresa quedaría sin quien la gestione. Devuelve los emails de esos gerentes.
 */
export async function gerentesQueQuedaranSinSucursalActiva(db: Db, empresaId: string, sucursalId: string): Promise<string[]> {
  const gerentes = await db.usuarioEmpresa.findMany({
    where: { ...filtroDelGerente(empresaId), activo: true },
    select: { usuarioId: true, usuario: { select: { email: true } } },
  });
  const sinSucursal: string[] = [];
  for (const g of gerentes) {
    const otra = await db.usuarioSucursal.findFirst({
      where: { empresaId, usuarioId: g.usuarioId, activo: true, sucursalId: { not: sucursalId }, sucursal: { activo: true } },
      select: { id: true },
    });
    if (!otra) sinSucursal.push(g.usuario.email);
  }
  return sinSucursal;
}
