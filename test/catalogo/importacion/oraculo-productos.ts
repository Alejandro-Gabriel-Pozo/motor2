/**
 * ORÁCULO DE PRODUCTO del importador del catálogo (regla del dueño «Combinaciones»; ADENDA v2 A.8 del diseño). Escrito APARTE del código, como una tabla de reglas que se lee de arriba abajo:
 * la PRIMERA regla que se cumple decide. Lo recorre COMPLETO (72 combinaciones) `planificar-productos.test.ts` contra el planificador puro.
 *
 * Escenario de cada combinación: un SKU con precio en Huinganco y Los Miches (y en Las Ovejas cuando los precios son distintos) y, en Varvarco, la dimensión «disponible».
 *  - Precios ÚNICOS: todos $1.000.
 *  - Precios DISTINTOS: Huinganco $1.000, Los Miches $1.200, Las Ovejas $1.200 (y Varvarco $1.000 si tiene fila): la regla da $1.200 (el más frecuente; si empatan, el mayor).
 *  - Con CORRECCIÓN: el dueño fijó $900 (manda sobre la regla).
 */
export const DIMENSIONES_DE_PRODUCTO = {
  existencia: ["NO_EXISTE", "EXISTE_IGUAL", "EXISTE_DISTINTO"],
  precios: ["UNICOS", "DISTINTOS_CON_CORRECCION", "DISTINTOS_CON_REGLA", "DISTINTOS_SIN_REGLA"],
  disponibleEnVarvarco: ["TRUE", "FALSE", "SIN_FILA"],
  alcanceDelActor: ["SI", "NO"],
} as const;

export interface CombinacionDeProducto {
  existencia: (typeof DIMENSIONES_DE_PRODUCTO.existencia)[number];
  precios: (typeof DIMENSIONES_DE_PRODUCTO.precios)[number];
  disponibleEnVarvarco: (typeof DIMENSIONES_DE_PRODUCTO.disponibleEnVarvarco)[number];
  alcanceDelActor: (typeof DIMENSIONES_DE_PRODUCTO.alcanceDelActor)[number];
}

export interface ResultadoEsperadoDeProducto {
  accion: "CREAR" | "SIN_CAMBIOS" | "ERROR";
  codigo: string | null;
  /** El precio único en pesos (o null si no se puede decidir). */
  precio: number | null;
  origen: "UNICO_EN_EL_EXCEL" | "CORRECCION" | "REGLA" | null;
  /** Local → disponible, de las filas de disponibilidad que el plan escribiría (o compara). */
  disponibilidad: Record<string, boolean>;
}

/** La tabla de reglas de la ACCIÓN: la primera que se cumple. */
const REGLAS_DE_ACCION: { cuando: (c: CombinacionDeProducto) => boolean; accion: ResultadoEsperadoDeProducto["accion"]; codigo: string | null; porque: string }[] = [
  { cuando: (c) => c.alcanceDelActor === "NO", accion: "ERROR", codigo: "SIN_PERMISO", porque: "sin la clave en un local del SKU no se escribe nada (A.6, falla cerrado)" },
  { cuando: (c) => c.precios === "DISTINTOS_SIN_REGLA", accion: "ERROR", codigo: "PRECIO_UNICO_PENDIENTE", porque: "precios distintos sin corrección ni regla aceptada: el dueño tiene que decidir" },
  { cuando: (c) => c.existencia === "EXISTE_DISTINTO", accion: "ERROR", codigo: "EXISTE_DISTINTO", porque: "no hay camino de actualización (D1, I4)" },
  { cuando: (c) => c.existencia === "EXISTE_IGUAL", accion: "SIN_CAMBIOS", codigo: null, porque: "idempotencia por estado (I3)" },
  { cuando: () => true, accion: "CREAR", codigo: null, porque: "el SKU no existe" },
];

/** La tabla del PRECIO ÚNICO (no depende de la acción: también se informa en un error). */
const PRECIO: Record<CombinacionDeProducto["precios"], { precio: number | null; origen: ResultadoEsperadoDeProducto["origen"] }> = {
  UNICOS: { precio: 1000, origen: "UNICO_EN_EL_EXCEL" },
  DISTINTOS_CON_CORRECCION: { precio: 900, origen: "CORRECCION" },
  DISTINTOS_CON_REGLA: { precio: 1200, origen: "REGLA" },
  DISTINTOS_SIN_REGLA: { precio: null, origen: null },
};

/** La DISPONIBILIDAD: una fila por local con fila en el Excel, con su TRUE/FALSE; sin fila = sin fila (no disponible, ADR-009). */
function disponibilidadEsperada(c: CombinacionDeProducto): Record<string, boolean> {
  const filas: Record<string, boolean> = { Huinganco: true, "Los Miches": true };
  if (c.precios !== "UNICOS") filas["Las Ovejas"] = true;
  if (c.disponibleEnVarvarco !== "SIN_FILA") filas.Varvarco = c.disponibleEnVarvarco === "TRUE";
  return filas;
}

export function resultadoEsperadoDeProducto(c: CombinacionDeProducto): ResultadoEsperadoDeProducto {
  const regla = REGLAS_DE_ACCION.find((r) => r.cuando(c))!;
  return { accion: regla.accion, codigo: regla.codigo, ...PRECIO[c.precios], disponibilidad: disponibilidadEsperada(c) };
}

export function todasLasCombinacionesDeProducto(): CombinacionDeProducto[] {
  const d = DIMENSIONES_DE_PRODUCTO;
  return d.existencia.flatMap((existencia) =>
    d.precios.flatMap((precios) => d.disponibleEnVarvarco.flatMap((disponibleEnVarvarco) => d.alcanceDelActor.map((alcanceDelActor) => ({ existencia, precios, disponibleEnVarvarco, alcanceDelActor })))),
  );
}
