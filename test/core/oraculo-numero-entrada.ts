/**
 * ORÁCULO de la regla de números de ENTRADA (dueño, 2026-11-09; docs/diseno-campo-numerico-entrada-2026-11-09.md §7). Escrito APARTE del código: es una tabla de qué tiene que pasar con cada texto, en cada contexto
 * (unidad con 0, 3 y 4 decimales, y dinero con 2), según quién lo manda (una persona que teclea, una persona que pega, el servidor). El test `campo-numerico-entrada.oraculo.test.ts` la recorre entera contra el código.
 *
 * Dimensiones que cambian lo que se guarda (cada una está acá o en `DIMENSIONES_DECLARADAS`; si aparece una nueva sin declarar, el guardián falla):
 *  - tipo del campo: importe | cantidad | entero | porcentaje (ver `TIPOS`),
 *  - decimales de la unidad: 0, 3, 4 (y el dinero, 2),
 *  - origen: tecleado | pegado (arrastrado y autocompletado cuentan como pegado),
 *  - el texto tiene «.» / tiene coma,
 *  - lado: cliente (el campo) | servidor.
 */
export interface Contexto {
  nombre: string;
  decimales: number;
}

export const CONTEXTOS: readonly Contexto[] = [
  { nombre: "entero (0 decimales)", decimales: 0 },
  { nombre: "dinero (2 decimales)", decimales: 2 },
  { nombre: "kg (3 decimales)", decimales: 3 },
  { nombre: "columna (4 decimales)", decimales: 4 },
];

/** Resultado esperado de LEER un texto: un número, vacío, o un rechazo con su código. */
export type Esperado = { valor: number | null } | { rechazo: "punto" | "formato" | "decimales" | "notacion" };

export interface Fila {
  /** Lo que escribe o pega una persona (notación de pantalla). */
  texto: string;
  tienePunto: boolean;
  tieneComa: boolean;
  /** Qué lee el CAMPO (tecleado o pegado: lo mismo, el parser no distingue; la diferencia está en la edición, ver `EDICIONES`). Por cantidad de decimales del contexto. */
  campo: Readonly<Record<number, Esperado>>;
}

const ok = (valor: number | null): Esperado => ({ valor });
const mismoEnTodos = (e: Esperado): Record<number, Esperado> => ({ 0: e, 2: e, 3: e, 4: e });

export const FILAS: readonly Fila[] = [
  { texto: "", tienePunto: false, tieneComa: false, campo: mismoEnTodos(ok(null)) },
  { texto: "1000", tienePunto: false, tieneComa: false, campo: mismoEnTodos(ok(1000)) },
  { texto: "0,5", tienePunto: false, tieneComa: true, campo: { 0: { rechazo: "decimales" }, 2: ok(0.5), 3: ok(0.5), 4: ok(0.5) } },
  { texto: ",5", tienePunto: false, tieneComa: true, campo: { 0: { rechazo: "decimales" }, 2: ok(0.5), 3: ok(0.5), 4: ok(0.5) } },
  { texto: "5,", tienePunto: false, tieneComa: true, campo: mismoEnTodos(ok(5)) },
  { texto: "0,0605", tienePunto: false, tieneComa: true, campo: { 0: { rechazo: "decimales" }, 2: { rechazo: "decimales" }, 3: { rechazo: "decimales" }, 4: ok(0.0605) } },
  { texto: "21,000", tienePunto: false, tieneComa: true, campo: { 0: { rechazo: "decimales" }, 2: { rechazo: "decimales" }, 3: ok(21), 4: ok(21) } },
  { texto: "1,2,3", tienePunto: false, tieneComa: true, campo: mismoEnTodos({ rechazo: "formato" }) },
  { texto: "abc", tienePunto: false, tieneComa: false, campo: mismoEnTodos({ rechazo: "formato" }) },
  { texto: "1e3", tienePunto: false, tieneComa: false, campo: mismoEnTodos({ rechazo: "formato" }) },
  // Con «.»: NUNCA se lee (ni como decimal ni como miles), en ningún contexto.
  { texto: "2.5", tienePunto: true, tieneComa: false, campo: mismoEnTodos({ rechazo: "punto" }) },
  { texto: "21.000", tienePunto: true, tieneComa: false, campo: mismoEnTodos({ rechazo: "punto" }) },
  { texto: "1.205", tienePunto: true, tieneComa: false, campo: mismoEnTodos({ rechazo: "punto" }) },
  { texto: "1.234,50", tienePunto: true, tieneComa: true, campo: mismoEnTodos({ rechazo: "punto" }) },
  { texto: "1,234.50", tienePunto: true, tieneComa: true, campo: mismoEnTodos({ rechazo: "punto" }) },
  { texto: "1.2.3", tienePunto: true, tieneComa: false, campo: mismoEnTodos({ rechazo: "punto" }) },
  { texto: "1..", tienePunto: true, tieneComa: false, campo: mismoEnTodos({ rechazo: "punto" }) },
  { texto: "1..2", tienePunto: true, tieneComa: false, campo: mismoEnTodos({ rechazo: "punto" }) },
];

/** El SERVIDOR lee un texto solo si es canónico (dígitos y un punto decimal): se prueba con estos textos, por contexto. */
export interface FilaDelServidor {
  texto: string;
  esperado: Readonly<Record<number, Esperado>>;
}

export const FILAS_DEL_SERVIDOR: readonly FilaDelServidor[] = [
  { texto: "", esperado: mismoEnTodos(ok(null)) },
  { texto: "1000", esperado: mismoEnTodos(ok(1000)) },
  { texto: "-3", esperado: mismoEnTodos(ok(-3)) },
  { texto: "0.5", esperado: { 0: { rechazo: "decimales" }, 2: ok(0.5), 3: ok(0.5), 4: ok(0.5) } },
  { texto: "0.0605", esperado: { 0: { rechazo: "decimales" }, 2: { rechazo: "decimales" }, 3: { rechazo: "decimales" }, 4: ok(0.0605) } },
  // «21.000» en el servidor NO es veintiún mil: son tres decimales (en un importe, un error; en kg, 21).
  { texto: "21.000", esperado: { 0: { rechazo: "decimales" }, 2: { rechazo: "decimales" }, 3: ok(21), 4: ok(21) } },
  // Lo que no es canónico se rechaza con claridad, en todos los contextos.
  { texto: "0,5", esperado: mismoEnTodos({ rechazo: "notacion" }) },
  { texto: "1.234,50", esperado: mismoEnTodos({ rechazo: "notacion" }) },
  { texto: "1,234.50", esperado: mismoEnTodos({ rechazo: "notacion" }) },
  { texto: "1e3", esperado: mismoEnTodos({ rechazo: "notacion" }) },
  { texto: " 5", esperado: mismoEnTodos({ rechazo: "notacion" }) },
  { texto: "5.", esperado: mismoEnTodos({ rechazo: "notacion" }) },
  { texto: ".5", esperado: mismoEnTodos({ rechazo: "notacion" }) },
  { texto: "0x10", esperado: mismoEnTodos({ rechazo: "notacion" }) },
  { texto: "abc", esperado: mismoEnTodos({ rechazo: "notacion" }) },
];

/**
 * La EDICIÓN (lo que pasa en el campo cuando entra un «.»): `anterior` es el texto del campo antes del cambio, `nuevo` el que dejó el navegador y `cursor` su cursor.
 * Tecleado: se ignora la tecla (el resto queda, el cursor no se corre) y se avisa. Pegado/arrastrado/autocompletado: se rechaza ENTERO, el campo queda como estaba y se avisa. Sin «.»: pasa tal cual y no se avisa.
 */
export interface Edicion {
  caso: string;
  origen: "tecleado" | "pegado";
  anterior: string;
  nuevo: string;
  cursor: number | null;
  texto: string;
  cursorFinal: number | null;
  aviso: boolean;
}

export const EDICIONES: readonly Edicion[] = [
  { caso: "tecla «.» al final", origen: "tecleado", anterior: "12", nuevo: "12.", cursor: 3, texto: "12", cursorFinal: 2, aviso: true },
  { caso: "tecla «.» en el medio (el cursor no se corre)", origen: "tecleado", anterior: "1234", nuevo: "12.34", cursor: 3, texto: "1234", cursorFinal: 2, aviso: true },
  { caso: "tecla «.» con el campo vacío", origen: "tecleado", anterior: "", nuevo: ".", cursor: 1, texto: "", cursorFinal: 0, aviso: true },
  { caso: "tecla de dígito", origen: "tecleado", anterior: "12", nuevo: "123", cursor: 3, texto: "123", cursorFinal: 3, aviso: false },
  { caso: "tecla de coma", origen: "tecleado", anterior: "12", nuevo: "12,", cursor: 3, texto: "12,", cursorFinal: 3, aviso: false },
  { caso: "pegado «1.234»", origen: "pegado", anterior: "7", nuevo: "71.234", cursor: 6, texto: "7", cursorFinal: null, aviso: true },
  { caso: "pegado «1.234,50» sobre el campo vacío", origen: "pegado", anterior: "", nuevo: "1.234,50", cursor: 8, texto: "", cursorFinal: null, aviso: true },
  { caso: "pegado «0.5»", origen: "pegado", anterior: "", nuevo: "0.5", cursor: 3, texto: "", cursorFinal: null, aviso: true },
  { caso: "tecla «.» repetida en el medio («1..2»: se quitan todas)", origen: "tecleado", anterior: "12", nuevo: "1..2", cursor: 3, texto: "12", cursorFinal: 1, aviso: true },
  { caso: "pegado «1.2.3»", origen: "pegado", anterior: "7", nuevo: "71.2.3", cursor: 6, texto: "7", cursorFinal: null, aviso: true },
  { caso: "pegado «1234,5» (sin punto: se acepta)", origen: "pegado", anterior: "", nuevo: "1234,5", cursor: 6, texto: "1234,5", cursorFinal: 6, aviso: false },
];

/** Cómo se muestra un valor guardado (canónico, con punto) cuando el campo no tiene el foco, por tipo. */
export const VISTAS: readonly { valor: string; tipo: "importe" | "cantidad" | "entero" | "porcentaje"; se_ve: string }[] = [
  { valor: "1000", tipo: "importe", se_ve: "1.000,00" },
  { valor: "1234.5", tipo: "importe", se_ve: "1.234,50" },
  { valor: "0", tipo: "importe", se_ve: "0,00" },
  { valor: "1234567.89", tipo: "importe", se_ve: "1.234.567,89" },
  { valor: "-1500", tipo: "importe", se_ve: "-1.500,00" },
  { valor: "60", tipo: "cantidad", se_ve: "60" },
  { valor: "1.205", tipo: "cantidad", se_ve: "1,205" },
  { valor: "21000", tipo: "cantidad", se_ve: "21.000" },
  { valor: "0.0605", tipo: "cantidad", se_ve: "0,0605" },
  { valor: "1000", tipo: "entero", se_ve: "1.000" },
  { valor: "99.99", tipo: "porcentaje", se_ve: "99,99" },
  { valor: "", tipo: "importe", se_ve: "" },
];

/**
 * Qué dimensiones DECLARA este oráculo y si cambian lo que se guarda. El guardián (`campo-numerico-entrada.oraculo.test.ts`) compara las claves con las del código: un tipo de campo o un código de rechazo
 * nuevo sin declarar acá hace fallar el test.
 */
export const TIPOS: Readonly<Record<string, string>> = {
  importe: "2 decimales, dinero exacto; la vista siempre con 2 decimales",
  cantidad: "los decimales de su unidad (0, 3, 4…)",
  entero: "0 decimales (orden, días, mínimos y máximos)",
  porcentaje: "los decimales de su columna (2 o 4)",
};

export const CODIGOS_DE_RECHAZO_DE_NUMEROS: Readonly<Record<string, string>> = {
  punto: "el «.» escrito o pegado por una persona",
  notacion: "el servidor recibió algo que no es dígitos y un punto decimal",
  formato: "no es un número (letras, dos comas, exponente)",
  decimales: "más decimales que los de la unidad o la columna",
};

/** Los códigos de `CodigoDato` que NO son de números (no cambian esta regla). */
export const CODIGOS_AJENOS_A_LOS_NUMEROS: readonly string[] = ["vacio", "negativo", "cero", "rango", "largo", "sin_alfanumerico", "caracteres", "verificador", "regla"];
