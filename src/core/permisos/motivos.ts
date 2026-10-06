import { moduloDelCatalogo, type ModuloId } from "../modulos/catalogo";
import { MENSAJE_PERMISOS_DE_PLATAFORMA } from "./politica-de-empresa";

// Por qué el guard le niega algo a un usuario (ADR-011, nota de dependencias §11). El guard evalúa módulo → capacidad → rol y devuelve un
// MOTIVO TIPADO; el texto que ve el usuario se arma en UN solo lugar (`textoDeDenegacion`), así la interfaz y los tests pueden distinguir un
// módulo apagado de un permiso faltante sin leer frases. Los textos de SIN_CAPACIDAD y SIN_PERMISO son los de siempre, palabra por palabra.

/** Qué intentaba el usuario: una acción que cambia datos (`editar`) o solo mirar una sección (`ver`). */
export type PropositoDeAcceso = "editar" | "ver";

export type Denegacion =
  | { motivo: "MODULO_EN_DESARROLLO"; modulo: ModuloId }
  | { motivo: "MODULO_NO_ACTIVO"; modulo: ModuloId }
  | { motivo: "SIN_CAPACIDAD"; accion: string; alcance: "sucursal" | "sucursales_del_usuario" }
  | { motivo: "SIN_PERMISO"; caso: "SIN_ACCESO_A_SUCURSAL" | "SIN_ACCESO_A_EMPRESA" | "POLITICA_DE_PLATAFORMA" }
  | { motivo: "SIN_PERMISO"; caso: "ROL_SIN_LA_ACCION"; para: PropositoDeAcceso; accion: string; rol: string }
  | { motivo: "SIN_PERMISO"; caso: "ROLES_SIN_LA_ACCION"; para: PropositoDeAcceso; accion: string; roles: readonly string[] }
  | { motivo: "SIN_PERMISO"; caso: "SOLO_GERENTE"; para: PropositoDeAcceso };

/** El texto para el usuario de una denegación. Único lugar donde se escriben estas frases. */
export function textoDeDenegacion(d: Denegacion): string {
  switch (d.motivo) {
    case "MODULO_EN_DESARROLLO":
      return `El módulo "${moduloDelCatalogo(d.modulo).nombre}" todavía está en desarrollo.`;
    case "MODULO_NO_ACTIVO":
      return `Tu empresa no tiene activado el módulo "${moduloDelCatalogo(d.modulo).nombre}".`;
    case "SIN_CAPACIDAD":
      return d.alcance === "sucursal" ? `La Central no habilitó "${d.accion}" para esta sucursal.` : `La Central no habilitó "${d.accion}" para tus sucursales.`;
    case "SIN_PERMISO":
      switch (d.caso) {
        case "SIN_ACCESO_A_SUCURSAL":
          return "No tenés acceso a esta sucursal, o tu usuario está inactivo.";
        case "SIN_ACCESO_A_EMPRESA":
          return "No tenés acceso a esta empresa, o tu usuario está inactivo.";
        case "POLITICA_DE_PLATAFORMA":
          return MENSAJE_PERMISOS_DE_PLATAFORMA;
        case "ROL_SIN_LA_ACCION":
          return d.para === "editar"
            ? `No tenés permiso para esta acción. Tu rol ("${d.rol}") no tiene "${d.accion}" habilitado. Pedile a un admin que te lo habilite.`
            : `No tenés permiso para ver esta sección. Tu rol ("${d.rol}") no tiene "${d.accion}" habilitado.`;
        case "ROLES_SIN_LA_ACCION": {
          const roles = d.roles.map((r) => `"${r}"`).join(", ");
          return d.para === "editar"
            ? `No tenés permiso para esta acción. Ninguno de tus roles (${roles}) tiene "${d.accion}" habilitado. Pedile a un admin que te lo habilite.`
            : `No tenés permiso para ver esta sección. Ninguno de tus roles (${roles}) tiene "${d.accion}" habilitado.`;
        }
        case "SOLO_GERENTE":
          return d.para === "editar"
            ? "No tenés permiso para esta acción: solo la hace el gerente de la empresa."
            : "No tenés permiso para ver esta sección: solo la ve el gerente de la empresa.";
      }
  }
}
