/**
 * ORÁCULO DE LA CARTA del importador del catálogo (regla del dueño «Combinaciones»; ADENDA v2 A.8 del diseño). Escrito APARTE del código, como una tabla de reglas que se lee de arriba
 * abajo: la PRIMERA que se cumple decide. Lo recorre COMPLETO (1.296 combinaciones) `planificar-carta.test.ts` contra la regla pura de una fila (`planificarFilaDeCarta`).
 *
 * Dimensión que NO cambia el resultado (declarada, regla «Poda»): `disponible`. Un no disponible lleva igual su contenido visible (A.2: los 7 no disponibles de Huinganco con sección); la
 * carta y el POS lo ocultan por la disponibilidad, no por el contenido.
 */
export const DIMENSIONES_DE_CARTA = {
  accionDelProducto: ["CREAR", "SIN_CAMBIOS", "ERROR"],
  categoria: ["CON_SECCION", "SIN_SECCION"],
  seccion: ["ACTIVA", "APAGADA", "NO_EXISTE"],
  disponible: ["TRUE", "FALSE"],
  precio: ["SI", "NO"],
  descripcion: ["VALIDA", "AUSENTE", "INVALIDA"],
  contenidoExistente: ["NO", "IGUAL", "DISTINTO"],
  permisoDeCartaEnElLocal: ["SI", "NO"],
} as const;

type D = typeof DIMENSIONES_DE_CARTA;
export type CombinacionDeCarta = { [K in keyof D]: D[K][number] };

export interface ResultadoEsperadoDeCarta {
  accion: "CREAR" | "SIN_CAMBIOS" | "FUERA_DE_CARTA" | "NO_SE_EVALUA" | "ERROR";
  codigo: string | null;
  /** Solo en `CREAR`: lo que se escribe (visible, en la sección, con la descripción si es válida). */
  escribe: { visibleEnCarta: true; conSeccion: true; conDescripcion: boolean } | null;
}

const REGLAS: { cuando: (c: CombinacionDeCarta) => boolean; accion: ResultadoEsperadoDeCarta["accion"]; codigo: string | null; porque: string }[] = [
  { cuando: (c) => c.accionDelProducto === "ERROR", accion: "NO_SE_EVALUA", codigo: null, porque: "el error del producto ya bloquea la importación" },
  { cuando: (c) => c.categoria === "SIN_SECCION", accion: "FUERA_DE_CARTA", codigo: "SIN_SECCION", porque: "Minutas, Menú Infantil, Viandas y Confitería no tienen sección (A.2)" },
  { cuando: (c) => c.precio === "NO", accion: "FUERA_DE_CARTA", codigo: "SIN_PRECIO", porque: "sin precio no se muestra (Ventus: a $0 no)" },
  { cuando: (c) => c.seccion === "NO_EXISTE", accion: "ERROR", codigo: "SECCION_INEXISTENTE", porque: "nunca se crea una sección (I10)" },
  { cuando: (c) => c.seccion === "APAGADA", accion: "ERROR", codigo: "SECCION_APAGADA", porque: "en una sección apagada no saldría (I7)" },
  { cuando: (c) => c.permisoDeCartaEnElLocal === "NO", accion: "ERROR", codigo: "SIN_PERMISO_CARTA", porque: "gate de carta en cada local (A.6)" },
  { cuando: (c) => c.descripcion === "INVALIDA", accion: "ERROR", codigo: "DESCRIPCION_INVALIDA", porque: "mismo validador que la carta (I11)" },
  { cuando: (c) => c.contenidoExistente === "IGUAL", accion: "SIN_CAMBIOS", codigo: null, porque: "idempotencia por estado (I4)" },
  { cuando: (c) => c.contenidoExistente === "DISTINTO", accion: "ERROR", codigo: "CONTENIDO_DISTINTO", porque: "no se pisa lo que alguien cargó (I4)" },
  { cuando: () => true, accion: "CREAR", codigo: null, porque: "carta mínima por secciones (A.2)" },
];

export function resultadoEsperadoDeCarta(c: CombinacionDeCarta): ResultadoEsperadoDeCarta {
  const regla = REGLAS.find((r) => r.cuando(c))!;
  return { accion: regla.accion, codigo: regla.codigo, escribe: regla.accion === "CREAR" ? { visibleEnCarta: true, conSeccion: true, conDescripcion: c.descripcion === "VALIDA" } : null };
}

export function todasLasCombinacionesDeCarta(): CombinacionDeCarta[] {
  let combinaciones: Partial<CombinacionDeCarta>[] = [{}];
  for (const [dimension, valores] of Object.entries(DIMENSIONES_DE_CARTA)) combinaciones = combinaciones.flatMap((c) => valores.map((v) => ({ ...c, [dimension]: v })));
  return combinaciones as CombinacionDeCarta[];
}
