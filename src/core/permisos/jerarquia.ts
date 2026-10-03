import { esGerenteDeEmpresa } from "./rol-empresa";

/**
 * Bloque G, G2: la única definición de «quién es administrador» y de «quién puede gestionar a quién». Un rol es el administrador por su CLAVE
 * (`Rol.clave`), nunca por su nombre: el nombre se va a poder cambiar (G3). Fuera de `core/permisos` nadie lee la clave ni compara un nombre.
 */
export const CLAVE_ROL_ADMIN = "admin";
export const CLAVE_ROL_OPERADOR = "operador";

/** Los tres niveles de una persona, de menor a mayor. Coincide con `NivelDeAccion` (el piso de cada acción). */
export type NivelDePersona = "operario" | "administrador" | "gerente";

const ORDEN: Record<NivelDePersona, number> = { operario: 1, administrador: 2, gerente: 3 };

export function esRolAdmin(rol: { clave: string | null }): boolean {
  return rol.clave === CLAVE_ROL_ADMIN;
}

/** Un rol de sucursal es administrador (la clave «admin») u operario (todo lo demás). Ningún rol es gerente: eso es `UsuarioEmpresa.rolEmpresa`. */
export function nivelDeRolPorClave(rol: { clave: string | null }): "administrador" | "operario" {
  return esRolAdmin(rol) ? "administrador" : "operario";
}

/**
 * Lo mínimo que hace falta saber de alguien para ubicarlo: si es el gerente de la empresa (`rolEmpresa`) y si tiene el rol administrador en el
 * contexto que se evalúa (la sucursal de la operación, o la sucursal donde se lo va a tocar).
 */
export interface PersonaParaJerarquia {
  rolEmpresa: string | null;
  esAdminEnElContexto: boolean;
}

export function nivelDe(persona: PersonaParaJerarquia): NivelDePersona {
  if (esGerenteDeEmpresa(persona.rolEmpresa)) return "gerente";
  return persona.esAdminEnElContexto ? "administrador" : "operario";
}

/**
 * Se gestiona a quien está en el mismo nivel o más abajo: el admin toca a otro admin, pero no al gerente (solo el gerente lo toca, y a sí mismo).
 * El permiso de la acción (`gestion_usuarios`, `activar_usuario_sucursal`, …) se evalúa aparte: esto es solo el techo de privilegio.
 */
export function puedeGestionarA(actor: PersonaParaJerarquia, objetivo: PersonaParaJerarquia): boolean {
  return ORDEN[nivelDe(actor)] >= ORDEN[nivelDe(objetivo)];
}

/** Se asigna un rol de nivel igual o menor al propio: dar el rol administrador es de un administrador o del gerente. */
export function puedeAsignarRol(actor: PersonaParaJerarquia, rol: { clave: string | null }): boolean {
  return ORDEN[nivelDe(actor)] >= ORDEN[nivelDeRolPorClave(rol)];
}
