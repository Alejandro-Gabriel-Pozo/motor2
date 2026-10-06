import { esModuloDelCatalogo, moduloDelCatalogo, type ModuloId } from "../modulos/catalogo";
import { modulosEfectivos } from "../modulos/clausura";
import { moduloDeAccion, type AccionClave } from "./acciones";
import type { Denegacion } from "./motivos";

/**
 * La parte PURA del acceso por módulo (Pureza Fase 3, tramo B): dado el registro de módulos de la empresa ya leído, qué módulos tiene y si una acción es de
 * un módulo que no tiene. La LECTURA del registro (`ModuloEmpresa`, memoizada por pedido con `cache` de React) vive en `modulos-de-empresa.ts` y es el único
 * archivo que consulta esa tabla; guard y menú salen de ahí, así no pueden discrepar.
 */

/** Una fila del registro de módulos de la empresa: el módulo y si está ACTIVO. */
export interface FilaDelRegistro {
  modulo: string;
  estado: string;
}

/** Los módulos con que cuenta la empresa: Administración, los vendibles ACTIVO del registro y todo lo que ellos requieren. */
export function modulosEfectivosDeFilas(filas: readonly FilaDelRegistro[]): ReadonlySet<string> {
  return modulosEfectivos(filas.filter((f) => f.estado === "ACTIVO").map((f) => f.modulo));
}

/**
 * Cómo está el registro de la empresa, para el aviso del shell (P8): `SIN_REGISTRO` (ni una fila: una empresa recién creada que la plataforma todavía no
 * activó, o un registro que se perdió), `SIN_VENDIBLE_ACTIVO` (hay filas pero ninguna deja un módulo vendible disponible) o `CON_MODULOS`.
 */
export type SituacionDelRegistro = "SIN_REGISTRO" | "SIN_VENDIBLE_ACTIVO" | "CON_MODULOS";

export function situacionDelRegistro(cantidadDeFilas: number, efectivos: ReadonlySet<string>): SituacionDelRegistro {
  if (cantidadDeFilas === 0) return "SIN_REGISTRO";
  const hayVendible = [...efectivos].some((id) => esModuloDelCatalogo(id) && moduloDelCatalogo(id).tipo === "vendible");
  return hayVendible ? "CON_MODULOS" : "SIN_VENDIBLE_ACTIVO";
}

/** Por qué el módulo no está disponible, o null si lo está. Un módulo `en_desarrollo` se distingue de uno simplemente apagado. */
export function denegacionDeModulo(modulo: ModuloId, efectivos: ReadonlySet<string>): Denegacion | null {
  if (efectivos.has(modulo)) return null;
  return { motivo: moduloDelCatalogo(modulo).estado === "en_desarrollo" ? "MODULO_EN_DESARROLLO" : "MODULO_NO_ACTIVO", modulo };
}

/** ¿La acción es de Administración (módulo fijo)? Esas se resuelven sin leer el registro. */
function accionEsDeModuloFijo(accion: AccionClave): boolean {
  return moduloDelCatalogo(moduloDeAccion(accion)).tipo === "fijo";
}

/** ¿Alguna de estas acciones necesita leer el registro? Falso si todas son de Administración. */
export function algunaAccionNecesitaElRegistro(claves: readonly AccionClave[]): boolean {
  return claves.some((c) => !accionEsDeModuloFijo(c));
}
