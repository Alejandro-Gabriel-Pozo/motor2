import { texto, validarTextoCatalogo } from "@/core/texto";
import { CLAVE_ROL_ADMIN, CLAVE_ROL_OPERADOR } from "./jerarquia";

/**
 * Bloque G, G3: qué nombre puede llevar un rol. El nombre es una etiqueta que la empresa cambia a gusto; lo que identifica a un rol de sistema es
 * su clave (`Rol.clave`), que ningún renombrado toca. Para que una etiqueta no se confunda con otra, los nombres «de fábrica» están reservados:
 * solo los lleva el rol que tiene esa clave, y «gerente» no lo lleva ningún rol (la gerencia es `UsuarioEmpresa.rolEmpresa`, no un rol).
 * La regla rige al crear y al renombrar; no es retroactiva (un rol que ya se llama así no se toca).
 */
const SIN_ROL_DUENO = "";
const NOMBRES_RESERVADOS: Readonly<Record<string, string>> = {
  admin: CLAVE_ROL_ADMIN,
  administrador: CLAVE_ROL_ADMIN,
  operador: CLAVE_ROL_OPERADOR,
  operario: CLAVE_ROL_OPERADOR,
  gerente: SIN_ROL_DUENO,
};

/** Recorta, pasa a minúscula y junta los espacios repetidos: «  Jefe   de  Sala » y «jefe de sala» son el mismo nombre. */
export function normalizarNombreDeRol(nombre: unknown): string {
  return texto(nombre).toLowerCase().replace(/\s+/g, " ");
}

/** El mensaje de rechazo del nombre (ya normalizado) para un rol con esa `clave` (`null` si se crea a mano), o `null` si se puede usar. */
export function mensajeSiNombreDeRolNoPermitido(nombre: string, clave: string | null): string | null {
  if (!nombre) return "El nombre del rol no puede estar vacío.";
  const invalido = validarTextoCatalogo(nombre, "El nombre del rol");
  if (invalido) return invalido;
  if (Object.hasOwn(NOMBRES_RESERVADOS, nombre) && NOMBRES_RESERVADOS[nombre] !== clave) return `El nombre «${nombre}» está reservado: no se puede usar en este rol.`;
  return null;
}

/**
 * Lo mismo, para un rol que ya existe (renombrarlo): recibe el ROL y lee su clave acá. Contrato C4 del RBAC (O.35; Hito 3, Fase II, II.2): un caso de uso no lee
 * `rol.clave` (regla 4 de `acceso-solo-por-el-guard` en `casos-de-uso/` y `server/persistencia`); le pasa el rol entero a `core/permisos`.
 */
export function mensajeSiNombreNoPermitidoParaElRol(nombre: string, rol: { clave: string | null }): string | null {
  return mensajeSiNombreDeRolNoPermitido(nombre, rol.clave);
}
