import { ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE } from "./acciones";

/**
 * Reglas de la matriz de permisos (rol × acción), compartidas por la pantalla y por el guardado en el servidor para que no puedan divergir:
 * - «Ver ⊇ Editar»: quien puede editar, puede ver (Core.js:1534). Se hace cumplir al ESCRIBIR, no al leer.
 * - Salvaguarda (Core.js:1529-1531): «gestion_permisos» y «gestion_usuarios» siempre conservan Editar para el rol «admin»; si no, un admin podría
 *   desconfigurar esto y dejar a todo el mundo sin forma de volver a corregirlo.
 */
export interface EstadoPermiso {
  puedeVer: boolean;
  puedeEditar: boolean;
}

/** Sin fila en la base, el rol no tiene ese permiso. */
export const SIN_PERMISO: EstadoPermiso = { puedeVer: false, puedeEditar: false };

/** El Editar de esta celda no se puede quitar (rol «admin» sobre una acción de gestión de accesos). */
export function esCeldaFija(rolNombre: string, accionClave: string): boolean {
  return rolNombre === "admin" && (ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE as readonly string[]).includes(accionClave);
}

/** El estado que realmente se guarda: aplica «Ver ⊇ Editar» y la salvaguarda del admin. */
export function normalizarPermiso(rolNombre: string, accionClave: string, deseado: EstadoPermiso): EstadoPermiso {
  const puedeEditar = esCeldaFija(rolNombre, accionClave) ? true : deseado.puedeEditar;
  return { puedeEditar, puedeVer: deseado.puedeVer || puedeEditar };
}

export function mismoEstado(a: EstadoPermiso, b: EstadoPermiso): boolean {
  return a.puedeVer === b.puedeVer && a.puedeEditar === b.puedeEditar;
}

/** Un cambio pedido: lo que la persona VIO al abrir la edición (`anterior`) y lo que quiere dejar (`nuevo`). */
export interface CambioPermiso {
  rolId: string;
  accionClave: string;
  anterior: EstadoPermiso;
  nuevo: EstadoPermiso;
}

/** «Ver ✅ Editar ⬜» → texto corto para el resumen de cambios. */
export function textoEstado(e: EstadoPermiso): string {
  if (e.puedeEditar) return "Ver y editar";
  if (e.puedeVer) return "Solo ver";
  return "Sin acceso";
}
