import { MODULOS } from "@/core/modulos/catalogo";

/**
 * El plan de TRANSICIÓN de la migración `20261117100000_planes_versionados`: el plan «actual», versión 1, asignado a toda empresa existente para que ninguna pierda un módulo cuando el techo se
 * conecte al guard (M1b). Decisión del dueño (q4, 2026-11-16): «Todos los módulos disponibles». ⚠ SE VUELVE A PREGUNTAR AL DUEÑO ANTES DE APLICAR A NINGUNA BASE REAL: «todos» abre a toda empresa
 * existente módulos que quizá no usa. El contenido vive en ESTA constante y en la lista de la migración (un test las compara): si el dueño cambia de idea, se cambian las dos y no hay más que tocar.
 */
export const CODIGO_DEL_PLAN_DE_TRANSICION = "actual";

export const MODULOS_DEL_PLAN_DE_TRANSICION: readonly string[] = MODULOS.filter((m) => m.tipo === "vendible" && m.estado === "disponible")
  .map((m) => m.id as string)
  .sort();
