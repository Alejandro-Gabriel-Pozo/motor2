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

/**
 * Cómo empieza el aviso cuando OTRA persona cambió lo que se estaba editando (conflicto de negocio: en la base no está lo que se vio, hay
 * que RECARGAR la matriz). La pantalla lo usa para ofrecer «Recargar la matriz», así que el servidor y ella comparten esta constante en vez
 * de repetir un literal que un cambio de redacción podría romper sin que nadie se entere.
 */
export const PREFIJO_CONFLICTO_DE_EDICION = "Otra persona cambió estos permisos";

/**
 * Aviso cuando el guardado chocó con OTRO guardado en curso y agotó los reintentos: no es un conflicto de contenido, en la base NO cambió
 * nada, así que recargar sería el consejo equivocado (descartaría el borrador para nada). La acción correcta es reintentar. Por eso NO
 * empieza con `PREFIJO_CONFLICTO_DE_EDICION`: la pantalla distingue los dos estados y ofrece un botón distinto para cada uno.
 */
export const MENSAJE_GUARDADO_EN_CONFLICTO =
  "No se pudo guardar: había otro guardado de permisos en curso en este momento. No se guardó nada y tus cambios siguen marcados — esperá unos segundos y tocá «Reintentar».";

/** «Ver ✅ Editar ⬜» → texto corto para el resumen de cambios. */
export function textoEstado(e: EstadoPermiso): string {
  if (e.puedeEditar) return "Ver y editar";
  if (e.puedeVer) return "Solo ver";
  return "Sin acceso";
}
