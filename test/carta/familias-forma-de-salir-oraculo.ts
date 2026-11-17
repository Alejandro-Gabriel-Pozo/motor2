/**
 * ORÁCULO de la «forma de salir» de una familia de productos (etapa F1; `docs/diseno-carta-familias-niveles-6-a-10-2026-11-17.md`, §9 y nivel 10, regla de combinaciones del 2026-10-28). Escrito APARTE del código: cada fila dice, en palabras y con el
 * resultado a la vista, cómo sale una familia en la carta de una sucursal. NO importa nada de `src/`: si la regla de `forma-de-salir.ts` cambia, la tabla no cambia sola.
 *
 * FUENTE de la tabla: la de la maqueta aprobada de Pedernal (`ZuluHub-docs`, `10-ux-ui/prototipos-gastronomia/familias.html`, «Cómo se muestra una familia en la carta y en el POS», 7 casos) más la fila D7 (secciones distintas, decisión de Motor2: «Sin sección
 * propia»). NO VERIFICADO contra §6 de `familias-especificacion.md` de Pedernal (vive en una rama remota que esta sesión no pudo leer): si esa tabla trae otro caso, se suma una fila acá.
 *
 * Dimensiones que cambian lo que ve el comensal y el precio mostrado: `agruparEnCarta` × `activa` × miembros que quedan en la fila (0, 1, 2 o más) × medidas (ninguna, las mismas, distintas con alguna en común, ninguna en común, alguno sin medidas) ×
 * precios (iguales, distintos) × cantidad de medidas distintas (hasta 3, más de 3) × secciones (misma, distintas) × estado de un miembro de más (oculto, desactivado, sin precio). «Agrupar en el POS» NO participa: es otro interruptor y la carta no lo lee.
 */
export type FormaEsperada = "SUELTOS" | "UNA_LINEA" | "TABLA" | "LISTA";

export interface MiembroDelOraculo {
  precio: number | null;
  oculto?: boolean;
  desactivado?: boolean;
  seccion?: string;
  medidas?: readonly string[];
}

export interface FilaDelOraculo {
  id: string;
  regla: string;
  agruparEnCarta: boolean;
  activa?: boolean;
  miembros: readonly MiembroDelOraculo[];
  esperado: FormaEsperada;
}

const M = (precio: number | null, medidas: readonly string[] = [], extra: Omit<MiembroDelOraculo, "precio" | "medidas"> = {}): MiembroDelOraculo => ({ precio, medidas, ...extra });
const CHICO_MEDIANO_GRANDE = ["Chico", "Mediano", "Grande"] as const;

export const ORACULO_DE_FORMA_DE_SALIR: readonly FilaDelOraculo[] = [
  { id: "F1", regla: "productos con medidas, hasta 3 distintas → TABLA (filas = productos, columnas = medidas)", agruparEnCarta: true, miembros: [M(1000, CHICO_MEDIANO_GRANDE), M(1200, CHICO_MEDIANO_GRANDE), M(900, CHICO_MEDIANO_GRANDE)], esperado: "TABLA" },
  { id: "F2", regla: "TABLA aunque un producto no ofrezca una medida (esa celda se ve «—»): alcanza con una medida en común", agruparEnCarta: true, miembros: [M(1000, ["Chico", "Grande"]), M(1200, ["Chico", "Mediano", "Grande"])], esperado: "TABLA" },
  { id: "F3", regla: "más de 3 medidas distintas → LISTA (uno por línea, con sus precios)", agruparEnCarta: true, miembros: [M(1000, ["Chico", "Mediano", "Grande", "Familiar"]), M(1200, ["Chico", "Mediano", "Grande"])], esperado: "LISTA" },
  { id: "F4", regla: "sin medidas y todos al mismo precio (gaseosas) → UNA_LINEA", agruparEnCarta: true, miembros: [M(2500), M(2500), M(2500)], esperado: "UNA_LINEA" },
  { id: "F5", regla: "sin medidas y con precios distintos → SUELTOS", agruparEnCarta: true, miembros: [M(2500), M(2600)], esperado: "SUELTOS" },
  { id: "F6", regla: "medidas, pero ninguna en común → SUELTOS", agruparEnCarta: true, miembros: [M(1000, ["Chico", "Mediano"]), M(1200, ["Grande", "Familiar"])], esperado: "SUELTOS" },
  { id: "F7", regla: "un producto SIN medidas en una familia con medidas → SUELTOS", agruparEnCarta: true, miembros: [M(1000, CHICO_MEDIANO_GRANDE), M(1000, CHICO_MEDIANO_GRANDE), M(1000)], esperado: "SUELTOS" },
  { id: "F8", regla: "«Agrupar en la carta» apagado → SUELTOS (milanesas: el cliente ve cada plato), aunque todo lo demás agrupe", agruparEnCarta: false, miembros: [M(2500), M(2500)], esperado: "SUELTOS" },
  { id: "F9", regla: "un producto oculto queda FUERA de la fila: no desempata el precio ni suma una medida", agruparEnCarta: true, miembros: [M(2500), M(2500), M(9999, ["Chico"], { oculto: true })], esperado: "UNA_LINEA" },
  { id: "F10", regla: "un producto desactivado queda FUERA de la fila", agruparEnCarta: true, miembros: [M(2500), M(2500), M(100, [], { desactivado: true })], esperado: "UNA_LINEA" },
  { id: "F11", regla: "un producto sin precio queda FUERA de la fila (nunca se inventa un precio)", agruparEnCarta: true, miembros: [M(2500), M(2500), M(null)], esperado: "UNA_LINEA" },
  { id: "F12", regla: "un precio en cero es «todavía sin precio»: queda fuera", agruparEnCarta: true, miembros: [M(2500), M(2500), M(0)], esperado: "UNA_LINEA" },
  { id: "F13", regla: "queda un solo producto → no se agrupa: sale suelto", agruparEnCarta: true, miembros: [M(2500), M(2500, [], { oculto: true })], esperado: "SUELTOS" },
  { id: "F14", regla: "sin productos → SUELTOS (no hay nada que agrupar)", agruparEnCarta: true, miembros: [], esperado: "SUELTOS" },
  { id: "F15", regla: "D7: los productos que quedan están en secciones distintas → SUELTOS (la familia no tiene sección propia)", agruparEnCarta: true, miembros: [M(2500, [], { seccion: "bebidas" }), M(2500, [], { seccion: "postres" })], esperado: "SUELTOS" },
  { id: "F16", regla: "D7 solo mira a los que quedan en la fila: un producto de otra sección pero oculto no la parte", agruparEnCarta: true, miembros: [M(2500, [], { seccion: "bebidas" }), M(2500, [], { seccion: "bebidas" }), M(2500, [], { seccion: "postres", oculto: true })], esperado: "UNA_LINEA" },
  { id: "F17", regla: "familia DESACTIVADA → SUELTOS (sus miembros siguen siéndolo, pero la carta no la agrupa)", agruparEnCarta: true, activa: false, miembros: [M(2500), M(2500)], esperado: "SUELTOS" },
  { id: "F18", regla: "las medidas se comparan POR NOMBRE, sin distinguir mayúsculas ni tildes", agruparEnCarta: true, miembros: [M(1000, ["Mediána", "GRANDE"]), M(1200, ["mediana", "grande"])], esperado: "TABLA" },
  { id: "F19", regla: "el orden en que llegan los productos no cambia la forma (se prueba con CADA permutación)", agruparEnCarta: true, miembros: [M(1000, ["Chico", "Grande"]), M(1000), M(1000, ["Chico"])], esperado: "SUELTOS" },
];

/**
 * Las CELDAS de la tabla de combinaciones (la base de cada fila de arriba): con «Agrupar en la carta» encendido, la familia activa, dos o más productos en la fila y todos en la misma sección, la forma depende SOLO de las medidas, los precios y la
 * cantidad de medidas. Escrita celda por celda (no es una fórmula): cualquier otra dimensión que se aparte de ese caso base da SUELTOS.
 */
export type MedidasDelOraculo = "NINGUNA" | "LAS_MISMAS" | "DISTINTAS_CON_ALGUNA_EN_COMUN" | "NINGUNA_EN_COMUN" | "ALGUNO_SIN_MEDIDAS";
export type PreciosDelOraculo = "IGUALES" | "DISTINTOS";
export type CantidadDeMedidasDelOraculo = "HASTA_3" | "MAS_DE_3";

export const CELDAS_DEL_CASO_BASE: Readonly<Record<`${MedidasDelOraculo}|${PreciosDelOraculo}|${CantidadDeMedidasDelOraculo}`, FormaEsperada>> = {
  "NINGUNA|IGUALES|HASTA_3": "UNA_LINEA",
  "NINGUNA|IGUALES|MAS_DE_3": "UNA_LINEA",
  "NINGUNA|DISTINTOS|HASTA_3": "SUELTOS",
  "NINGUNA|DISTINTOS|MAS_DE_3": "SUELTOS",
  "LAS_MISMAS|IGUALES|HASTA_3": "TABLA",
  "LAS_MISMAS|IGUALES|MAS_DE_3": "LISTA",
  "LAS_MISMAS|DISTINTOS|HASTA_3": "TABLA",
  "LAS_MISMAS|DISTINTOS|MAS_DE_3": "LISTA",
  "DISTINTAS_CON_ALGUNA_EN_COMUN|IGUALES|HASTA_3": "TABLA",
  "DISTINTAS_CON_ALGUNA_EN_COMUN|IGUALES|MAS_DE_3": "LISTA",
  "DISTINTAS_CON_ALGUNA_EN_COMUN|DISTINTOS|HASTA_3": "TABLA",
  "DISTINTAS_CON_ALGUNA_EN_COMUN|DISTINTOS|MAS_DE_3": "LISTA",
  "NINGUNA_EN_COMUN|IGUALES|HASTA_3": "SUELTOS",
  "NINGUNA_EN_COMUN|IGUALES|MAS_DE_3": "SUELTOS",
  "NINGUNA_EN_COMUN|DISTINTOS|HASTA_3": "SUELTOS",
  "NINGUNA_EN_COMUN|DISTINTOS|MAS_DE_3": "SUELTOS",
  "ALGUNO_SIN_MEDIDAS|IGUALES|HASTA_3": "SUELTOS",
  "ALGUNO_SIN_MEDIDAS|IGUALES|MAS_DE_3": "SUELTOS",
  "ALGUNO_SIN_MEDIDAS|DISTINTOS|HASTA_3": "SUELTOS",
  "ALGUNO_SIN_MEDIDAS|DISTINTOS|MAS_DE_3": "SUELTOS",
};
