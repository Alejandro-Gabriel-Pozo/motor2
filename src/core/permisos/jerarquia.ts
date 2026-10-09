import { nivelMinimoDeAccion, type AccionClave, type NivelDeAccion } from "./acciones";
import { esGerenteDeEmpresa } from "./rol-empresa";

/**
 * Bloque G, G2: la única definición de «quién es administrador» y de «quién puede gestionar a quién». Un rol es el administrador por su CLAVE
 * (`Rol.clave`), nunca por su nombre: el nombre se va a poder cambiar (G3). Fuera de `core/permisos` nadie lee la clave ni compara un nombre.
 */
export const CLAVE_ROL_ADMIN = "admin";
export const CLAVE_ROL_OPERADOR = "operador";

/**
 * Los tres niveles de una PERSONA, de menor a mayor (el techo de gestión: quién toca a quién y quién da qué rol). Todavía no tiene el escalón
 * «administrador de sistema» de `NivelDeAccion` (ADR-027): mientras nadie tenga rango 2 (`Rol.nivel` no existe), el administrador de una persona y el
 * administrador de sistema son la misma gente, y el rango de persona con cuatro escalones llega con F3.
 */
export type NivelDePersona = "operario" | "administrador" | "gerente";

const ORDEN: Record<NivelDePersona, number> = { operario: 1, administrador: 2, gerente: 3 };

/**
 * ADR-027 (Hito 3, 3.4): los rangos de los pisos de una acción, el ÚNICO lugar que los ordena. operario < administrador < administrador de sistema <
 * gerente. Nadie compara pisos por su texto fuera de `core/permisos` (regla 1 de `acceso-solo-por-el-guard`): se pregunta con `nivelAlcanzaElPiso`.
 */
const RANGO_DE_PISO: Readonly<Record<NivelDeAccion, number>> = { operario: 1, administrador: 2, administrador_sistema: 3, gerente: 4 };

/** ¿Quien tiene este nivel llega al piso? Pura: el piso manda sobre la matriz, y un nivel alcanza su piso y todos los de abajo. */
export function nivelAlcanzaElPiso(nivel: NivelDeAccion, piso: NivelDeAccion): boolean {
  return RANGO_DE_PISO[nivel] >= RANGO_DE_PISO[piso];
}

const ETIQUETA_DEL_PISO: Readonly<Record<NivelDeAccion, string>> = {
  operario: "operario",
  administrador: "administrador",
  administrador_sistema: "administrador de sistema",
  gerente: "gerente",
};

/** Cómo se muestra un piso o un nivel en la pantalla y en los mensajes («Piso: administrador de sistema»). Un solo lugar para el texto. */
export function etiquetaDelPiso(nivel: NivelDeAccion): string {
  return ETIQUETA_DEL_PISO[nivel];
}

/**
 * Contrato C3 del RBAC (O.35; Hito 3, Fase II, II.2): la ÚNICA selección de un rol que alimenta el techo de privilegio. De un rol, la jerarquía necesita su clave
 * (`nivelDeRolPorClave`), y quien lo usa, su id, su nombre (mensajes y auditoría) y si está activo. Toda lectura de un rol para ubicar a quien actúa, a quien se toca
 * o el rol que se da (`select: { rol: { select: SELECCION_DE_ROL_PARA_JERARQUIA } }`) lo pide con esto: un caso de uso o una persistencia no escribe `clave` en un
 * `select` ni en un `where` (regla 4 de `acceso-solo-por-el-guard`, contrato C4), así que no puede leer de un rol más ni menos que lo que la jerarquía mira.
 */
export const SELECCION_DE_ROL_PARA_JERARQUIA = { id: true, nombre: true, clave: true, activo: true } as const;

export function esRolAdmin(rol: { clave: string | null }): boolean {
  return rol.clave === CLAVE_ROL_ADMIN;
}

/**
 * Un rol de sucursal es administrador (la clave «admin») u operario (todo lo demás), para el TECHO de personas (`puedeAsignarRol`). Ningún rol es gerente:
 * eso es `UsuarioEmpresa.rolEmpresa`. Frente al piso de una acción, el mismo rol «admin» es el administrador de sistema: `nivelDelRolFrenteAlPiso`.
 */
export function nivelDeRolPorClave(rol: { clave: string | null }): "administrador" | "operario" {
  return esRolAdmin(rol) ? "administrador" : "operario";
}

/**
 * ADR-027: el nivel de un rol frente al PISO de una acción. El rol de clave «admin» es el administrador de sistema (rango 3: alcanza los pisos administrador y
 * administrador de sistema); cualquier otro rol (`operador` y los creados a mano) es operario (rango 1). Nadie tiene rango 2 hasta que exista `Rol.nivel`
 * (F2/F3, con migración): por eso este escalón nuevo no cambia ninguna respuesta de acceso.
 */
export function nivelDelRolFrenteAlPiso(rol: { clave: string | null }): "administrador_sistema" | "operario" {
  return esRolAdmin(rol) ? "administrador_sistema" : "operario";
}

/** ¿El rol llega al piso de la acción? Si no, ninguna fila de `PermisoRol` le da acceso: el piso manda sobre la matriz. */
export function rolAlcanzaLaAccion(rol: { clave: string | null }, accion: AccionClave): boolean {
  return nivelAlcanzaElPiso(nivelDelRolFrenteAlPiso(rol), nivelMinimoDeAccion(accion));
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
