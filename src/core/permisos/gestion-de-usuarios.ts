import { esRolAdmin, nivelDe, puedeAsignarRol, puedeGestionarA, type PersonaParaJerarquia } from "./jerarquia";

/**
 * Bloque G, G2: el techo de privilegio de la gestión de usuarios, en un solo lugar. Los casos de uso de usuarios no miran roles ni comparan nombres:
 * miden a quien actúa y a quien se toca (`actorDesdeLaBase`, `objetivoEn…`) y preguntan acá. Cada función devuelve el mensaje de rechazo, o `null` si se
 * puede. El permiso de la acción (`gestion_usuarios`, …) lo evalúa el guard aparte: esto es solo el techo.
 *
 * Desde O35-B (O.35, Hito 3) a quien actúa ya no se lo mide con el contexto de la sesión (`ctx.rolEmpresa`, `ctx.membresias`; se fueron `actorEnSucursal`,
 * `actorEnLaEmpresa` y `ActorDelContexto`): los casos de uso lo releen de la base dentro de su transacción, como a quien se toca. La equivalencia fuera de las
 * carreras (y la única diferencia, la sucursal inactiva) la fija `test/permisos/actor-desde-la-base-equivalencia.test.ts`.
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
 * Quien actúa o a quien se toca, con QUIÉN es (O35-D, la regla de «uno mismo»): las lecturas que los miden desde la base (`actorDesdeLaBase`,
 * `objetivoEnSucursal`) devuelven también su `usuarioId`. `null`: alguien que todavía no tiene cuenta (la persona de una invitación), que nunca es «uno mismo».
 */
export interface PersonaIdentificada extends PersonaParaJerarquia {
  usuarioId: string | null;
}

const MENSAJE_UNO_MISMO_POR_ENCIMA = "No podés darte a vos mismo un rol por encima del que tenés en esta sucursal: pedíselo a un administrador o al gerente de la empresa.";

/**
 * O35-D (O.35; regla aprobada en el plan del Hito 3): nadie se da a SÍ MISMO un rol por encima de su rango en el contexto, salvo el gerente de la empresa. «Uno
 * mismo» es el mismo `usuarioId` en quien actúa y en quien recibe el rol; el rango del rol frente al de la persona es el del techo (`puedeAsignarRol`).
 *
 * Hoy no cambia ninguna aceptación ni rechazo: darse un rol por encima del propio ya lo frena el techo del rol (`mensajeSiNoPuedeAsignarRol`) y por las acciones
 * no se llega (para darse un rol en una sucursal hay que tener ahí `gestion_usuarios`, de piso administrador de sistema). Lo que cambia es el MENSAJE de ese caso,
 * y que la regla queda escrita por su nombre: cuando exista el rango 2 (F3, ADR-027) y el techo del rol cambie, «uno mismo por encima» sigue cerrado.
 * Media regla privada: se aplica solo dentro de `mensajeSiNoPuedeDarRolA`.
 */
function mensajeSiSeDaASiMismoPorEncima(actor: PersonaIdentificada, rol: { clave: string | null }, objetivo: PersonaIdentificada): string | null {
  const unoMismo = actor.usuarioId !== null && actor.usuarioId === objetivo.usuarioId;
  if (!unoMismo || nivelDe(actor) === "gerente") return null;
  return puedeAsignarRol(actor, rol) ? null : MENSAJE_UNO_MISMO_POR_ENCIMA;
}

/**
 * Contrato C2 del RBAC (O.35; Hito 3, Fase II, II.2): DAR un rol a una persona. Tres chequeos, en este orden: la regla de «uno mismo» (O35-D: nadie se da un rol
 * por encima de su rango, salvo el gerente), el techo del rol que se da (`mensajeSiNoPuedeAsignarRol`: el rol administrador lo da un administrador o el gerente)
 * y el de gestión sobre quien lo recibe (`mensajeSiNoPuedeGestionar`: nadie toca a quien está por encima). Reemplaza la composición
 * `mensajeSiNoPuedeAsignarRol(…) ?? mensajeSiNoPuedeGestionar(…)` que estaba copiada en tres lugares (alta de usuario, en sus dos ramas, y aceptación de una
 * invitación de usuario): mismo resultado para todo actor, rol y persona SALVO «uno mismo por encima de su rango», que antes rechazaba con el techo del rol y
 * ahora con su propio mensaje (`test/permisos/dar-rol-a.propiedades.test.ts`); el orden de los mensajes queda escrito una vez.
 */
export function mensajeSiNoPuedeDarRolA(actor: PersonaIdentificada, rol: { clave: string | null }, objetivo: PersonaIdentificada): string | null {
  return mensajeSiSeDaASiMismoPorEncima(actor, rol, objetivo) ?? mensajeSiNoPuedeAsignarRol(actor, rol) ?? mensajeSiNoPuedeGestionar(actor, objetivo);
}

/**
 * La variante DECLARADA de dar un rol sin el techo de gestión sobre quien lo recibe: solo el techo del rol. Hay dos lugares, y solo esos (lista cerrada en
 * `test/arquitectura/techo-de-dar-un-rol.test.ts`, con su motivo): el alta de una sucursal con su primer admin (contrato C6, I.4b: un administrador tiene que poder
 * nombrar al gerente primer admin de una sucursal nueva) y el chequeo de una invitación de usuario pendiente (quien la revoca o la reenvía tiene que poder dar
 * cada rol que ofrece; la persona todavía no es miembro: no hay a quién medir).
 *
 * No lleva la regla de «uno mismo» (O35-D), y no hace falta: en el alta de sucursal el rol que se da es SIEMPRE el administrador y quien actúa se mide en la
 * empresa, así que «darse a sí mismo un rol por encima del propio» es exactamente «no ser administrador ni gerente», que el techo del rol ya rechaza (y crearse una
 * sucursal y nombrarse primer admin siendo administrador sigue permitido: caso (a) de `caracterizacion-supuestos-rbac`); en la invitación pendiente la persona
 * todavía no tiene cuenta en la empresa, no es «uno mismo».
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
