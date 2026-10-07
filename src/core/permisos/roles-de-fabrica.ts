import { ACCIONES } from "./acciones";
import { CLAVE_ROL_ADMIN, CLAVE_ROL_OPERADOR } from "./jerarquia";

/**
 * Los roles con los que nace toda empresa (el admin y el operador) y su matriz de permisos de fábrica: el dato PURO que usa la siembra (`plataforma/src/servidor/sembrar-empresa.ts`).
 * Vive en `core/permisos` porque nombra las claves de rol de sistema (`CLAVE_ROL_*`), que fuera de esta carpeta no se comparan ni se nombran (regla 4 de `acceso-solo-por-el-guard`).
 */
export const ROLES_DE_FABRICA = [
  { nombre: "admin", clave: CLAVE_ROL_ADMIN },
  { nombre: "operador", clave: CLAVE_ROL_OPERADOR },
] as const;

export type NombreDeRolDeFabrica = (typeof ROLES_DE_FABRICA)[number]["nombre"];

export interface PermisoDeFabrica {
  empresaId: string;
  rolId: string;
  accionClave: string;
  puedeEditar: boolean;
  puedeVer: boolean;
}

/**
 * Una fila de `PermisoRol` por cada (acción, rol de fábrica), en el orden del catálogo de acciones y, dentro de cada acción, admin y después operador. Editar sale de la semilla
 * de cada acción (`rolesEditarSemilla`); Ver arranca igual a Editar (mismo estado que en el seed).
 */
export function matrizDeFabrica(empresaId: string, rolIdPorNombre: Readonly<Record<NombreDeRolDeFabrica, string>>): PermisoDeFabrica[] {
  return ACCIONES.flatMap((accion) =>
    ROLES_DE_FABRICA.map(({ nombre }) => {
      const puedeEditar = (accion.rolesEditarSemilla as readonly string[]).includes(nombre);
      return { empresaId, rolId: rolIdPorNombre[nombre], accionClave: accion.clave, puedeEditar, puedeVer: puedeEditar };
    })
  );
}
