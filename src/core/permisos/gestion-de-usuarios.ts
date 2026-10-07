import { esRolAdmin, nivelDe, puedeAsignarRol, puedeGestionarA, type PersonaParaJerarquia } from "./jerarquia";

/**
 * Bloque G, G2: el techo de privilegio de la gestión de usuarios, en un solo lugar. Los casos de uso de usuarios no miran roles ni comparan nombres:
 * arman a quien actúa y a quien se toca (`actorEn…`, `objetivoEn…`) y preguntan acá. Cada función devuelve el mensaje de rechazo, o `null` si se
 * puede. El permiso de la acción (`gestion_usuarios`, …) lo evalúa el guard aparte: esto es solo el techo.
 *
 * Desde la Fase II del Hito 3 (II.4 de `docs/plan-hito-3-pureza.md`) este archivo es PURO (P0). Las lecturas que miden a quien actúa o a quien se toca
 * desde la base (`actorDesdeLaBase`, `objetivoEnSucursal`, `objetivoEnLaEmpresa`, `buscarRolAdmin`, `reactivaAUnAdmin`) viven en
 * `server/lecturas/permisos/gestion-de-usuarios.ts` con el mismo nombre y firma; lo que tenían de regla quedó acá (`personaEnSucursal`,
 * `reactivaLaMembresiaDeUnAdmin`).
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

/**
 * A quien se toca por su membresía en una sucursal, ya leído su rol de empresa: administrador si el rol de ESA membresía lo es (sin membresía, operario).
 * Es la regla de `objetivoEnSucursal` (`server/lecturas/permisos/gestion-de-usuarios.ts`), que lee `rolEmpresa` y le pregunta acá.
 */
export function personaEnSucursal(rolEmpresa: string | null, rolDeLaMembresia: { clave: string | null } | null): PersonaParaJerarquia {
  return { rolEmpresa, esAdminEnElContexto: rolDeLaMembresia !== null && esRolAdmin(rolDeLaMembresia) };
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
 * ¿Activar esta membresía reactiva a un administrador? Sí si está apagada y su rol es el de administrador. Es la primera mitad de `reactivaAUnAdmin`
 * (`server/lecturas/permisos/gestion-de-usuarios.ts`); la otra, la cuenta en la empresa, es una pregunta histórica a la base.
 */
export function reactivaLaMembresiaDeUnAdmin(membresia: { activo: boolean; rol: { clave: string | null } } | null | undefined): boolean {
  return Boolean(membresia && !membresia.activo && esRolAdmin(membresia.rol));
}

/** Reactivar a un administrador es solo del gerente. */
export function mensajeSiReactivaAdminSinSerGerente(actor: PersonaParaJerarquia, reactivaAdmin: boolean): string | null {
  return reactivaAdmin && nivelDe(actor) !== "gerente" ? MENSAJE_SOLO_EL_GERENTE_REACTIVA_ADMIN : null;
}
