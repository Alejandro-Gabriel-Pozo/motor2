import "server-only";
import { filtroAdminEfectivo, filtroDelGerente } from "@/core/permisos/filtros";
import { mensajeSiElRolTieneUsuariosActivos, type EstadoDeGobierno } from "@/core/permisos/invariantes";
import type { Db } from "@/lib/db-tipos";

/**
 * Las LECTURAS de decisión de las invariantes de gobierno (Bloque G, G2; Hito 3, Fase II, II.3 de `docs/plan-hito-3-pureza.md`, contrato B4a). Vivían en
 * `core/permisos/invariantes.ts` junto con las reglas; se mudaron TAL CUAL, con el MISMO nombre y la MISMA firma (ADR-026 §5: `db` primero, como estaban), para que la
 * mudanza solo cambiara la ruta del import. En `core` quedó lo puro: los mensajes, el `EstadoDeGobierno`, las invariantes (a), (b), (f) y (c) que comparan dos estados o
 * miran un rol, el mensaje de (e) y `InvarianteViolada`. Quien mide antes y después (`conInvariantesDeGobierno`) vive en `server/actions/con-gobierno.ts`.
 *
 * Capa `server/lecturas` (ADR-026): solo lectura, sin guarda propia (la pone la acción o el caso de uso que llama, antes), la importan casos de uso, acciones y la
 * persistencia, nunca la UI. Las corren DENTRO de la transacción serializable de la escritura (`tx`): así dos pedidos simultáneos no se sacan el último admin.
 * La clave del rol no se nombra acá: los predicados de «admin efectivo» y del gerente son los filtros puros de `core/permisos/filtros.ts` (C1).
 */

/** D1 — cuántas membresías de «admin efectivo» tiene la empresa (`filtroAdminEfectivo`: la definición ESTRICTA, «queda alguien que pueda entrar»). */
export async function contarAdminsEfectivos(db: Db, empresaId: string): Promise<number> {
  return db.usuarioSucursal.count({ where: filtroAdminEfectivo(empresaId) });
}

/** ¿`usuarioId` es admin efectivo en al menos una sucursal? Lo exige quien asume la gerencia (D4) y lo mantiene el gerente (Q1). */
export async function esAdminEfectivoEnAlgunaSucursal(db: Db, empresaId: string, usuarioId: string): Promise<boolean> {
  return Boolean(await db.usuarioSucursal.findFirst({ where: { ...filtroAdminEfectivo(empresaId), usuarioId }, select: { id: true } }));
}

/** ¿Tiene al menos una membresía activa en una sucursal activa? (b) del gerente. */
async function tieneSucursalActiva(db: Db, empresaId: string, usuarioId: string): Promise<boolean> {
  return Boolean(await db.usuarioSucursal.findFirst({ where: { empresaId, usuarioId, activo: true, sucursal: { activo: true } }, select: { id: true } }));
}

/** El estado de gobierno de la empresa: cuántos admins efectivos tiene y, si tiene gerente, si conserva una sucursal activa y si es admin efectivo. */
export async function medirEstadoDeGobierno(db: Db, empresaId: string): Promise<EstadoDeGobierno> {
  const fila = await db.usuarioEmpresa.findFirst({ where: filtroDelGerente(empresaId), select: { usuarioId: true } });
  return {
    adminsEfectivos: await contarAdminsEfectivos(db, empresaId),
    gerente: fila
      ? {
          conSucursalActiva: await tieneSucursalActiva(db, empresaId, fila.usuarioId),
          adminEfectivo: await esAdminEfectivoEnAlgunaSucursal(db, empresaId, fila.usuarioId),
        }
      : null,
  };
}

/**
 * (e) Definición AMPLIA de «usuario activo» (D7): cualquier membresía activa con ese rol, sea cual sea su sucursal, su pertenencia o su cuenta.
 * «Nadie queda colgado de un rol que se apaga»: no es lo mismo que «queda alguien que pueda entrar» (a), que es la estricta.
 */
export async function contarUsuariosActivosDelRol(db: Db, rolId: string): Promise<number> {
  return db.usuarioSucursal.count({ where: { rolId, activo: true } });
}

/** (e) Un rol con usuarios activos no se desactiva sin reasignarlos antes: lee cuántos tiene y le pregunta la regla a `core/permisos/invariantes`. */
export async function invarianteRolSinUsuariosActivos(db: Db, rol: { id: string; nombre: string }): Promise<string | null> {
  return mensajeSiElRolTieneUsuariosActivos(rol, await contarUsuariosActivosDelRol(db, rol.id));
}
