import { ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE, claveEnCatalogo, nivelMinimoDeAccion } from "./acciones";
import { esRolAdmin, etiquetaDelPiso, nivelAlcanzaElPiso, nivelDe, nivelDelRolFrenteAlPiso, rolAlcanzaLaAccion, type PersonaParaJerarquia } from "./jerarquia";

/** Lo único que la matriz necesita saber de un rol: su clave (el nombre es de la empresa y se puede cambiar). */
export type RolDeMatriz = { clave: string | null };

/**
 * Reglas de la matriz de permisos (rol × acción), compartidas por la pantalla y por el guardado en el servidor para que no puedan divergir:
 * - «Ver ⊇ Editar»: quien puede editar, puede ver (Core.js:1534). Se hace cumplir al ESCRIBIR, no al leer.
 * - Salvaguarda (Core.js:1529-1531): «gestion_permisos», «gestion_usuarios» y las claves de administración de gente en que se partieron
 *   (`ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE`) siempre conservan Editar para el rol administrador (clave «admin»); si no, un admin podría desconfigurar esto y dejar a
 *   todo el mundo sin forma de volver a corregirlo.
 */
export interface EstadoPermiso {
  puedeVer: boolean;
  puedeEditar: boolean;
}

/** Sin fila en la base, el rol no tiene ese permiso. */
export const SIN_PERMISO: EstadoPermiso = { puedeVer: false, puedeEditar: false };

/** El Editar de esta celda no se puede quitar (rol administrador sobre una acción de gestión de accesos). */
export function esCeldaFija(rol: RolDeMatriz, accionClave: string): boolean {
  return esRolAdmin(rol) && (ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE as readonly string[]).includes(accionClave);
}

/**
 * ¿La acción está POR ENCIMA del nivel del rol (su piso es más alto)? Esa celda no se puede dar: el servidor rechaza el guardado y el gate ignora
 * la fila. Una clave fuera del catálogo no se evalúa acá (la rechaza el guardado por otro motivo).
 */
export function esCeldaFueraDeNivel(rol: RolDeMatriz, accionClave: string): boolean {
  return claveEnCatalogo(accionClave) && !rolAlcanzaLaAccion(rol, accionClave);
}

/**
 * Piso y nivel del rol, para los mensajes: «una acción de nivel administrador de sistema, y el rol es de nivel operario». Devuelve las ETIQUETAS para mostrar
 * (`etiquetaDelPiso`, ADR-027), no los valores: quien arma el mensaje (el caso de uso de `guardarPermisos`) no tiene que saber cómo se escribe cada piso.
 */
export function nivelesDeLaCelda(rol: RolDeMatriz, accionClave: string): { piso: string; delRol: string } | null {
  return claveEnCatalogo(accionClave) ? { piso: etiquetaDelPiso(nivelMinimoDeAccion(accionClave)), delRol: etiquetaDelPiso(nivelDelRolFrenteAlPiso(rol)) } : null;
}

const MENSAJE_MATRIZ_SOLO_DEL_GERENTE = "Solo el gerente de la empresa puede editar los permisos del rol administrador. No se guardó nada.";

/**
 * D13/D14 (aprobado por el dueño el 2026-10-08; ADR-027): ¿la matriz de este rol la edita SOLO el gerente? Sí la de todo rol que, frente al piso de una acción,
 * alcanza el nivel administrador: hoy el rol `admin` (administrador de sistema, rango 3) y, cuando exista `Rol.nivel` (F3), los de rango 2. Si no, un
 * administrador que no es el gerente le recortaba acciones al gerente (que usa el mismo rol) o se agrandaba a sí mismo y a sus pares editando su propio rol.
 * Los roles de nivel operario (`operador` y los personalizados de hoy) los sigue editando quien tiene `gestion_permisos`.
 */
export function laMatrizDelRolLaEditaSoloElGerente(rol: RolDeMatriz): boolean {
  return nivelAlcanzaElPiso(nivelDelRolFrenteAlPiso(rol), "administrador");
}

/**
 * D13/D14: el rechazo de `guardarPermisos` cuando quien actúa NO es el gerente de la empresa (`rolEmpresa`, medido desde la base) y el guardado cambia la matriz
 * de un rol que solo edita el gerente. Pura: quien actúa lo mide el caso de uso; acá no se lee nada.
 */
export function mensajeSiNoPuedeEditarLaMatrizDelRol(actor: PersonaParaJerarquia, rol: RolDeMatriz): string | null {
  return laMatrizDelRolLaEditaSoloElGerente(rol) && nivelDe(actor) !== "gerente" ? MENSAJE_MATRIZ_SOLO_DEL_GERENTE : null;
}

const MENSAJE_CAPACIDADES_SOLO_DEL_GERENTE = "Solo el gerente de la empresa puede cambiar las capacidades de una sucursal. No se guardó nada.";

/**
 * O.41 (decisión del dueño del 2026-10-08, «esa perilla solo del gerente»; ADR-027, «Casos que D13/D14 deja abiertos»): la otra vía, hermana de D13/D14, para
 * recortarle acciones al gerente. Las capacidades por sucursal (`CapacidadSucursal`, la matriz acción × sucursal) se aplican también a las acciones de empresa de
 * piso no gerente (`decision-de-acceso.ts`; `capacidades-sucursal.ts` exime solo a las de `ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE` y a `capacidades_sucursal`):
 * un administrador que no es el gerente, con `capacidades_sucursal`, apagaba `renombrar_rol`, `alta_sucursal`, `activar_sucursal`, `renombrar_sucursal` o
 * `ver_auditoria` en todas las sucursales y con eso se las sacaba también al gerente. Desde O.41 cambiar una capacidad (cualquiera, de una sucursal o la fila
 * default) es SOLO del gerente de la empresa; lo que el gerente apague sigue pudiendo alcanzar al gobierno, y es decisión suya.
 *
 * Es el rechazo de `actualizarCapacidad` cuando quien actúa NO es el gerente (`rolEmpresa`, medido desde la base dentro de la transacción). Pura: quien actúa lo
 * mide el caso de uso; acá no se lee nada. El permiso de la pantalla (`capacidades_sucursal`) no cambia: la matriz de acceso queda igual.
 */
export function mensajeSiNoPuedeCambiarCapacidades(actor: PersonaParaJerarquia): string | null {
  return nivelDe(actor) !== "gerente" ? MENSAJE_CAPACIDADES_SOLO_DEL_GERENTE : null;
}

/** El estado que realmente se guarda: aplica «Ver ⊇ Editar» y la salvaguarda del admin. */
export function normalizarPermiso(rol: RolDeMatriz, accionClave: string, deseado: EstadoPermiso): EstadoPermiso {
  const puedeEditar = esCeldaFija(rol, accionClave) ? true : deseado.puedeEditar;
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
