/**
 * Los TIPOS de cupo de una promo armable y la lectura TOLERANTE del primer despliegue de GO-3 (ADR-032, «expandir y contraer»). Puro: sin Prisma.
 *
 * Desde GO-3d un `PromoCartaCupo` tiene `tipo` (SECCION, el de siempre; LISTA; DEL_DIA) y `activo` (la baja lógica), y `seccionCartaId` es NULL fuera de SECCION. El código de este
 * despliegue SOLO sabe armar cupos de sección: todos sus lectores leen los de sección activos, y una promo que tiene algún cupo ACTIVO de un tipo nuevo NO se ofrece (falla cerrado:
 * nunca se arma un combo a medias, cobrando su precio entero sin el lugar que este código no conoce). Los cupos dados de baja no cuentan para nada.
 * Lo que crea los tipos nuevos llega en el segundo despliegue (GO-3 F3); volver de él a este código es seguro.
 */

/** Los tipos de cupo: el espejo del CHECK `PromoCartaCupo_tipo_chk` (lo compara `test/persistencia/migracion-go3d.test.ts`). */
export const TIPOS_DE_CUPO = ["SECCION", "LISTA", "DEL_DIA"] as const;
export type TipoDeCupo = (typeof TIPOS_DE_CUPO)[number];

/** El filtro de Prisma de los cupos que este despliegue sabe leer: de sección y activos. */
export const WHERE_CUPO_DE_SECCION_ACTIVO = { tipo: "SECCION", activo: true } as const;

/** El filtro de Prisma de una promo que tiene algún cupo activo de un tipo nuevo (para excluirla con `cupos: { none: … }`). */
export const WHERE_CUPO_ACTIVO_DE_TIPO_NUEVO = { activo: true, tipo: { not: "SECCION" } } as const;

interface CupoLeido {
  tipo: string;
  activo: boolean;
  seccionCartaId: string | null;
}

/**
 * El cupo de sección ya con la sección asegurada (el CHECK `PromoCartaCupo_seccion_solo_en_seccion_chk` lo garantiza en la base; acá se comprueba igual): `seccionCartaId` y, si se
 * leyó, la relación `seccionCarta` dejan de ser nulables.
 */
export type CupoDeSeccion<T extends CupoLeido> = T & { tipo: "SECCION"; seccionCartaId: string } & (T extends { seccionCarta: infer S } ? { seccionCarta: NonNullable<S> } : unknown);

/** Los cupos de SECCIÓN activos, en el orden recibido. Un cupo de sección sin sección (no puede pasar: CHECK) se descarta. */
export function cuposDeSeccionActivos<T extends CupoLeido>(cupos: readonly T[]): CupoDeSeccion<T>[] {
  return cupos.filter(
    (c): c is CupoDeSeccion<T> => c.activo && c.tipo === "SECCION" && c.seccionCartaId !== null && (!("seccionCarta" in c) || (c as { seccionCarta: unknown }).seccionCarta !== null),
  );
}

/** ¿La promo tiene algún cupo ACTIVO de un tipo que este despliegue no sabe armar? Si lo tiene, no se ofrece. */
export function tieneCupoActivoDeTipoNuevo(cupos: readonly CupoLeido[]): boolean {
  return cupos.some((c) => c.activo && c.tipo !== "SECCION");
}
