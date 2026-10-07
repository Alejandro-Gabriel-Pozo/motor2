import type { Db } from "@/lib/db-tipos";
import { tuvoRolAdminEnLaEmpresa } from "./gerencia";
import { filtroMembresiaConAutoridadDeAdmin, filtroRolAdmin } from "./filtros";
import { esRolAdmin, nivelDe, puedeAsignarRol, puedeGestionarA, SELECCION_DE_ROL_PARA_JERARQUIA, type PersonaParaJerarquia } from "./jerarquia";

/**
 * Bloque G, G2: el techo de privilegio de la gestión de usuarios, en un solo lugar. Las acciones de `server/actions/auth/usuarios.ts` no miran
 * roles ni comparan nombres: arman a quien actúa y a quien se toca (`actorEn…`, `objetivoEn…`) y preguntan acá. Cada función devuelve el mensaje
 * de rechazo, o `null` si se puede. El permiso de la acción (`gestion_usuarios`, …) lo evalúa el guard aparte: esto es solo el techo.
 */

const MENSAJE_SOLO_EL_GERENTE_TOCA_AL_GERENTE = "Solo el gerente de la empresa puede modificar al gerente.";
const MENSAJE_TECHO_DE_ADMIN = "Solo un administrador o el gerente de la empresa puede dar el rol de administrador o modificar a un administrador.";
const MENSAJE_SOLO_EL_GERENTE_REACTIVA_ADMIN = "Solo el gerente de la empresa puede reactivar a un administrador.";
const MENSAJE_GERENTE_NO_APAGA_SU_CUENTA = "El gerente no puede desactivar su propia cuenta: traspasá la gerencia antes.";

/** Lo que de quien actúa sale del contexto de la sesión (`ContextoUsuario`): su rol de empresa y en qué sucursales es administrador. */
export interface ActorDelContexto {
  rolEmpresa: string | null;
  membresias: { sucursalId: string; esAdmin: boolean }[];
}

/** Quien actúa, medido en la sucursal donde se va a tocar a alguien: ahí es administrador si su membresía de esa sucursal lo es. */
export function actorEnSucursal(ctx: ActorDelContexto, sucursalId: string): PersonaParaJerarquia {
  return { rolEmpresa: ctx.rolEmpresa, esAdminEnElContexto: ctx.membresias.some((m) => m.sucursalId === sucursalId && m.esAdmin) };
}

/** Quien actúa en una acción de contexto empresa: es administrador si lo es en CUALQUIER sucursal (no depende de dónde esté parado). */
export function actorEnLaEmpresa(ctx: ActorDelContexto): PersonaParaJerarquia {
  return { rolEmpresa: ctx.rolEmpresa, esAdminEnElContexto: ctx.membresias.some((m) => m.esAdmin) };
}

async function rolEmpresaDe(db: Db, empresaId: string, usuarioId: string | null): Promise<string | null> {
  if (!usuarioId) return null;
  const fila = await db.usuarioEmpresa.findUnique({ where: { usuarioId_empresaId: { usuarioId, empresaId } }, select: { rolEmpresa: true } });
  return fila?.rolEmpresa ?? null;
}

/** Quien OTORGÓ el acceso a una sucursal, medido desde la base (E8: se revalida su techo al aceptar una invitación, cuando ya no hay sesión suya): administrador si su membresía de esa sucursal lo es. */
export async function actorDesdeLaBase(db: Db, empresaId: string, usuarioId: string, sucursalId: string): Promise<PersonaParaJerarquia> {
  const admin = await db.usuarioSucursal.findFirst({ where: { ...filtroMembresiaConAutoridadDeAdmin(empresaId, usuarioId), sucursalId }, select: { id: true } });
  return { rolEmpresa: await rolEmpresaDe(db, empresaId, usuarioId), esAdminEnElContexto: admin !== null };
}

/** A quien se toca por su membresía en una sucursal: administrador si el rol de ESA membresía lo es (sin membresía o sin usuario todavía, operario). */
export async function objetivoEnSucursal(db: Db, empresaId: string, usuarioId: string | null, rolDeLaMembresia: { clave: string | null } | null): Promise<PersonaParaJerarquia> {
  return { rolEmpresa: await rolEmpresaDe(db, empresaId, usuarioId), esAdminEnElContexto: rolDeLaMembresia !== null && esRolAdmin(rolDeLaMembresia) };
}

/** A quien se toca por su cuenta en la empresa: administrador si tiene una membresía activa con un rol admin activo en cualquier sucursal. */
export async function objetivoEnLaEmpresa(db: Db, empresaId: string, usuarioId: string): Promise<PersonaParaJerarquia> {
  const esAdmin = await db.usuarioSucursal.findFirst({ where: filtroMembresiaConAutoridadDeAdmin(empresaId, usuarioId), select: { id: true } });
  return { rolEmpresa: await rolEmpresaDe(db, empresaId, usuarioId), esAdminEnElContexto: esAdmin !== null };
}

/** El rol «admin» de la empresa, buscado por su CLAVE técnica (el nombre se puede cambiar: bloque G3), con la selección de la jerarquía (C3). `null` si la empresa no lo tiene. */
export async function buscarRolAdmin(db: Db, empresaId: string) {
  return db.rol.findFirst({ where: filtroRolAdmin(empresaId), select: SELECCION_DE_ROL_PARA_JERARQUIA });
}

/** Se gestiona a quien está en el mismo nivel o más abajo; el mensaje dice a quién protege el techo (el gerente o los administradores). */
export function mensajeSiNoPuedeGestionar(actor: PersonaParaJerarquia, objetivo: PersonaParaJerarquia): string | null {
  if (puedeGestionarA(actor, objetivo)) return null;
  return nivelDe(objetivo) === "gerente" ? MENSAJE_SOLO_EL_GERENTE_TOCA_AL_GERENTE : MENSAJE_TECHO_DE_ADMIN;
}

/**
 * Dar el rol administrador es de un administrador o del gerente. Es MEDIA regla: fuera de `core/permisos` nadie la llama sola (lo vigila
 * `test/arquitectura/techo-de-dar-un-rol.test.ts`): se da un rol con `mensajeSiNoPuedeDarRolA` o, donde no hay a quién medir, con la variante declarada.
 */
export function mensajeSiNoPuedeAsignarRol(actor: PersonaParaJerarquia, rol: { clave: string | null }): string | null {
  return puedeAsignarRol(actor, rol) ? null : MENSAJE_TECHO_DE_ADMIN;
}

/**
 * Contrato C2 del RBAC (O.35; Hito 3, Fase II, II.2): DAR un rol a una persona. Dos techos, en este orden: el del rol que se da (`mensajeSiNoPuedeAsignarRol`: el
 * rol administrador lo da un administrador o el gerente) y el de gestión sobre quien lo recibe (`mensajeSiNoPuedeGestionar`: nadie toca a quien está por encima).
 * Reemplaza la composición `mensajeSiNoPuedeAsignarRol(…) ?? mensajeSiNoPuedeGestionar(…)` que estaba copiada en tres lugares (alta de usuario, en sus dos ramas,
 * y aceptación de una invitación de usuario): mismo resultado para todo actor, rol y persona (`test/permisos/dar-rol-a.propiedades.test.ts`), y el orden de los
 * mensajes queda escrito una vez.
 */
export function mensajeSiNoPuedeDarRolA(actor: PersonaParaJerarquia, rol: { clave: string | null }, objetivo: PersonaParaJerarquia): string | null {
  return mensajeSiNoPuedeAsignarRol(actor, rol) ?? mensajeSiNoPuedeGestionar(actor, objetivo);
}

/**
 * La variante DECLARADA de dar un rol sin el techo de gestión sobre quien lo recibe: solo el techo del rol. Hay dos lugares, y solo esos (lista cerrada en
 * `test/arquitectura/techo-de-dar-un-rol.test.ts`, con su motivo): el alta de una sucursal con su primer admin (contrato C6, I.4b: un administrador tiene que poder
 * nombrar al gerente primer admin de una sucursal nueva) y el chequeo de una invitación de usuario pendiente (quien la revoca o la reenvía tiene que poder dar
 * cada rol que ofrece; la persona todavía no es miembro: no hay a quién medir).
 */
export function mensajeSiNoPuedeDarRolSinTechoDeGestion(actor: PersonaParaJerarquia, rol: { clave: string | null }): string | null {
  return mensajeSiNoPuedeAsignarRol(actor, rol);
}

/** El gerente no apaga su propia cuenta de empresa (sin ella no tendría contexto): primero traspasa la gerencia. Al gerente nadie más lo apaga (techo). */
export function mensajeSiSeApagaAlGerente(objetivo: PersonaParaJerarquia): string | null {
  return nivelDe(objetivo) === "gerente" ? MENSAJE_GERENTE_NO_APAGA_SU_CUENTA : null;
}

/**
 * ¿Lo que se pide reactiva a un administrador? Su membresía en la sucursal (apagada, con rol admin) o su cuenta en la empresa (apagada, y tiene o tuvo
 * el rol admin: pregunta histórica, `tuvoRolAdminEnLaEmpresa`, que no filtra roles inactivos — Q2). Quien tiene `gestion_usuarios` no puede deshacer
 * por esta vía lo que el gerente apagó con `apagar_cuenta_empresa`.
 */
export async function reactivaAUnAdmin(
  db: Db,
  empresaId: string,
  usuarioId: string,
  que: { membresia?: { activo: boolean; rol: { clave: string | null } } | null; cuentaDeEmpresa?: { activo: boolean } | null }
): Promise<boolean> {
  if (que.membresia && !que.membresia.activo && esRolAdmin(que.membresia.rol)) return true;
  return Boolean(que.cuentaDeEmpresa && !que.cuentaDeEmpresa.activo && (await tuvoRolAdminEnLaEmpresa(db, empresaId, usuarioId)));
}

/** Reactivar a un administrador es solo del gerente. */
export function mensajeSiReactivaAdminSinSerGerente(actor: PersonaParaJerarquia, reactivaAdmin: boolean): string | null {
  return reactivaAdmin && nivelDe(actor) !== "gerente" ? MENSAJE_SOLO_EL_GERENTE_REACTIVA_ADMIN : null;
}
