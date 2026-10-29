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

/**
 * INTERRUPTOR de «Sumar un lugar» de lista en el formulario de cupos de una promo (decisión del dueño, 2026-10-28: «es algo obsoleto: es más fácil agregar la sección del otro lado y tildarla»; en
 * producción hay 0 lugares de lista y 0 del día, solo cupos de sección). Mismo patrón que `MENU_DEL_DIA_VISIBLE` (`menu-del-dia.ts`): una sola constante. Con `false`, la pantalla no ofrece sumar
 * un lugar de LISTA nuevo; los lugares que ya existieran se siguen mostrando y editando, y NO se toca el servidor ni se borra nada (el formulario de «Sumar un lugar» aparece solo si alguno de los
 * dos interruptores ofrece un tipo). Para volver a encenderlo: poner `true`. Lo comprueba `test/carta/sumar-lugar-interruptor.test.tsx` (los dos estados).
 */
export const SUMAR_LUGAR_DE_LISTA_VISIBLE: boolean = false;

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

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// GO-3b (ADR-032, paso D3): la administración de los cupos deja de BORRAR. Cada cupo tiene una CLAVE NATURAL estable dentro de su promo —la sección en un cupo SECCION, el nombre sin
// mayúsculas en un LISTA o DEL_DIA (el índice único `PromoCartaCupo_nombre_lower_key`)— y guardar la lista de cupos es llevar las filas al estado pedido: lo que sigue se cambia en el
// lugar, lo que vuelve se reactiva, lo que no vino se da de baja (`activo = false`) y lo nuevo se crea. Así las entradas de una lista y los platos del día de un cupo nunca quedan colgando
// de una fila borrada, y la auditoría del cupo de sección sigue con su `entidadId` de siempre (`${promoCartaId}:${seccionCartaId}`). Puro: sin Prisma.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** El largo máximo del nombre de un lugar (el CHECK `PromoCartaCupo_nombre_chk`). */
export const LARGO_MAXIMO_NOMBRE_DE_CUPO = 80;

/** Un cupo tal como se lo pide guardar (ya validado de forma): de sección (con `seccionCartaId`) o de entradas (con `nombre`). */
export interface CupoPedido {
  tipo: TipoDeCupo;
  seccionCartaId: string | null;
  nombre: string | null;
  cantidadMinima: number;
  cantidadMaxima: number;
  orden: number;
}

/** Un cupo de la base, activo o dado de baja. */
export interface CupoExistente extends CupoPedido {
  id: string;
  activo: boolean;
}

/** La clave natural de un cupo dentro de su promo: la sección en un SECCION; el nombre en minúsculas (sin los espacios de las puntas) en un LISTA o DEL_DIA. */
export function claveNaturalDeCupo(c: Pick<CupoPedido, "tipo" | "seccionCartaId" | "nombre">): string {
  return c.tipo === "SECCION" ? `S:${c.seccionCartaId ?? ""}` : `N:${(c.nombre ?? "").trim().toLowerCase()}`;
}

/** Lo que hay que escribir para llevar los cupos de una promo a la lista pedida. */
export interface DiferenciaDeCupos {
  /** Los cupos nuevos (no había ninguna fila con esa clave). */
  crear: CupoPedido[];
  /** Los que ya existían (activos o dados de baja) y quedan ACTIVOS con estos valores; `estaba` es la fila de antes. Solo los que cambian algo. */
  cambiar: { estaba: CupoExistente; queda: CupoPedido }[];
  /** Los activos que no vinieron en la lista: se dan de baja. */
  darDeBaja: CupoExistente[];
}

export type ResultadoDiferenciaDeCupos = { ok: true; diferencia: DiferenciaDeCupos } | { ok: false; mensaje: string };

/**
 * La diferencia entre los cupos que hay (todos, activos y dados de baja) y la lista pedida, por clave natural. Un nombre que ya usa un lugar de OTRO tipo (aunque esté dado de baja: el
 * nombre sigue ocupado, el índice único es por nombre sin importar el tipo) se rechaza: el tipo es parte de lo que el lugar es (las entradas de una lista no son platos del día).
 */
export function diferenciaDeCupos(existentes: readonly CupoExistente[], pedidos: readonly CupoPedido[]): ResultadoDiferenciaDeCupos {
  const porClave = new Map(existentes.map((c) => [claveNaturalDeCupo(c), c]));
  const pedidas = new Set<string>();
  const crear: CupoPedido[] = [];
  const cambiar: DiferenciaDeCupos["cambiar"] = [];
  for (const p of pedidos) {
    const clave = claveNaturalDeCupo(p);
    pedidas.add(clave);
    const estaba = porClave.get(clave);
    if (!estaba) {
      crear.push(p);
      continue;
    }
    if (estaba.tipo !== p.tipo) return { ok: false, mensaje: `Ya hay un lugar «${estaba.nombre ?? ""}» de otro tipo en esta promo (aunque esté dado de baja): usá otro nombre.` };
    const igual =
      estaba.activo && estaba.cantidadMinima === p.cantidadMinima && estaba.cantidadMaxima === p.cantidadMaxima && estaba.orden === p.orden && (p.tipo === "SECCION" || estaba.nombre === p.nombre);
    if (!igual) cambiar.push({ estaba, queda: p });
  }
  const darDeBaja = existentes.filter((c) => c.activo && !pedidas.has(claveNaturalDeCupo(c)));
  return { ok: true, diferencia: { crear, cambiar, darDeBaja } };
}
