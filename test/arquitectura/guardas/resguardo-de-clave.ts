import { ACCIONES, ACCIONES_QUE_DA_SOLO_EL_GERENTE, nivelMinimoDeAccion, type AccionClave, type NivelDeAccion } from "../../../src/core/permisos/acciones";
import { nivelAlcanzaElPiso } from "../../../src/core/permisos/jerarquia";

/**
 * PISOS-65 (2026-11-17): desde que las 65 acciones bajaron del piso «administrador» a «operario», el piso ya no dice cuánto protege una clave. El resguardo de una clave se deduce de tres datos del
 * catálogo: su piso, su semilla (`rolesEditarSemilla`) y la lista `ACCIONES_QUE_DA_SOLO_EL_GERENTE`:
 *  - «libre»: piso operario y de fábrica la tiene el operador;
 *  - «delegable»: piso operario y de fábrica solo `admin`, sin estar en la lista (la da quien tiene `gestion_permisos`);
 *  - «la_da_solo_el_gerente»: piso operario, de fábrica solo `admin` y en la lista (la da SOLO el gerente: DEC-0024);
 *  - «gobierno»: piso de administrador de sistema o de gerente (no se delega nunca a un rol de nivel operario).
 * Los guardianes que protegían un dato de dinero o de proveedor con «piso administrador» exigen ahora, como mínimo, «la_da_solo_el_gerente».
 */
export type Resguardo = "libre" | "delegable" | "la_da_solo_el_gerente" | "gobierno";

const ORDEN: readonly Resguardo[] = ["libre", "delegable", "la_da_solo_el_gerente", "gobierno"];

export function resguardoDe(clave: string): Resguardo {
  const accion = ACCIONES.find((a) => a.clave === clave);
  if (!accion) throw new Error(`«${clave}» no está en el catálogo`);
  const piso = nivelMinimoDeAccion(clave as AccionClave);
  if (piso === "administrador_sistema" || piso === "gerente") return "gobierno";
  if ((ACCIONES_QUE_DA_SOLO_EL_GERENTE as readonly string[]).includes(clave)) return "la_da_solo_el_gerente";
  const soloAdmin = (accion.rolesEditarSemilla as readonly string[]).every((r) => r === "admin");
  if (piso === "administrador") return "la_da_solo_el_gerente";
  return soloAdmin ? "delegable" : "libre";
}

/** ¿La clave protege al menos tanto como `minimo`? */
export function resguardoAlcanza(clave: string, minimo: Resguardo): boolean {
  return ORDEN.indexOf(resguardoDe(clave)) >= ORDEN.indexOf(minimo);
}

/**
 * ¿La clave alcanza el resguardo que un campo declaraba como `piso`? Para un campo de piso «administrador» acepta una clave de la lista (`la_da_solo_el_gerente`) o una de piso al menos administrador;
 * para los demás pisos, el piso de la clave tiene que alcanzar al del campo (como antes).
 */
export function alcanzaElResguardo(clave: string, piso: NivelDeAccion): boolean {
  if (piso === "administrador") return resguardoAlcanza(clave, "la_da_solo_el_gerente");
  return nivelAlcanzaElPiso(nivelMinimoDeAccion(clave as AccionClave), piso);
}
