/**
 * ORÁCULO de la carta «B» (decisión del dueño, 2026-11-04; `docs/diseno-descripcion-de-opciones-y-carta-b-2026-11-04.md`, §10): la tabla de lo que DEBE verse, escrita A MANO y aparte del código. Convención
 * `docs/diseno-arnes-de-matrices-2026-11-03.md`, «Convención vigente (E0)»: no importa nada de `src/` y no se genera ejecutando lo que se prueba; si el código cambia de opinión, este archivo no lo sigue.
 *
 * LA ESCENA (la misma para todas las combinaciones): una sección «Platos principales» con dos platos y UN grupo libre «Guarnición» (una INCLUIDA, sin precio, de 1 a 1):
 *  - «Bife» (P1) es el plato bajo prueba: incluye el grupo en todas sus opciones, en un subconjunto o no lo incluye;
 *  - «Milanesa» (P2) siempre incluye todas las opciones que el grupo ofrece hoy (es el que arma el bloque completo).
 *  Las opciones definidas del grupo son «Puré» y, si el grupo es de 2 o más, también «Ensalada» y «Papas fritas» (en ese orden); la que se apaga en la sucursal es la ÚLTIMA («Papas fritas»).
 *  El subconjunto de P1 son todas las opciones MENOS la última definida («puré o ensalada»).
 *
 * LAS DIMENSIONES (las que cambian lo que ve el comensal):
 *  - visible:  el grupo se muestra en la carta de ese plato («Mostrar este grupo en la carta» prendido) o está oculto;
 *  - opcion:   todas las opciones están activas y encendidas, o la última está apagada en la sucursal;
 *  - incluye:  P1 admite todas las opciones del grupo, solo un subconjunto, o no lo incluye;
 *  - cantidad: el grupo tiene 1 opción definida o 3 («2 o más»);
 *  - limites:  P1 elige lo mismo que P2 (de 1 a 1) o tiene límites propios (de 1 a 2);
 *  - descripcion: (E3) la opción «Papas fritas» (la última definida, la que puede apagarse o quedar fuera del subconjunto) no tiene descripción, o tiene «papas rústicas con cáscara»;
 *  - canal:    pública, impresa (las dos arman la SECCIÓN con los dos platos), vista previa del producto y «Va a mostrar» (las dos miran SOLO a P1).
 *
 * LAS REGLAS (cada combinación cae en una sola fila; el test lo comprueba):
 *  1. Un grupo oculto no se dibuja: ni línea «Incluye», ni bloque, ni descripciones, en ningún canal.
 *  2. Un grupo con una sola opción no es una elección: ni línea ni bloque.
 *  3. Con un plato que no incluye el grupo: ese plato no dice «Incluye». En la sección, P2 sigue diciéndolo y el bloque existe; mirado solo, no hay nada.
 *  4. «elegís N» es del bloque cuando todos los platos del bloque coinciden; si no, el bloque no lo dice y CADA plato lo aclara entre paréntesis.
 *  5. Un plato con menos opciones que el bloque las nombra («Incluye guarnición: puré o ensalada»); el que ofrece todas las del bloque solo dice «Incluye guarnición». Con la última opción apagada, el
 *     «subconjunto» de P1 ya es todo lo que el grupo ofrece hoy, así que no nombra nada.
 *  6. Las opciones del bloque van sin repetirse, en el orden del grupo, separadas por « · ».
 */

export const VISIBLE = ["visible", "oculto"] as const;
export const OPCION = ["todas-encendidas", "ultima-apagada"] as const;
export const INCLUYE = ["todas", "subconjunto", "no"] as const;
export const CANTIDAD = [1, 3] as const;
export const LIMITES = ["iguales", "distintos"] as const;
export const CANAL = ["publica", "impresa", "vista-previa", "va-a-mostrar"] as const;
export const DESCRIPCION = ["ninguna", "texto"] as const;

/** Cuántas combinaciones tiene el producto de las dimensiones: 2 × 2 × 3 × 2 × 2 × 4 × 2. Si una dimensión gana un valor, este número y el test dejan de coincidir. */
export const TAMANO_DEL_PRODUCTO = 2 * 2 * 3 * 2 * 2 * 4 * 2;

export interface Combinacion {
  visible: (typeof VISIBLE)[number];
  opcion: (typeof OPCION)[number];
  incluye: (typeof INCLUYE)[number];
  cantidad: (typeof CANTIDAD)[number];
  limites: (typeof LIMITES)[number];
  canal: (typeof CANAL)[number];
  descripcion: (typeof DESCRIPCION)[number];
}

/** Lo que se ve de la escena. `null` = no hay línea (o no hay bloque). En un canal que mira solo a P1, `milanesa` no se mira. */
export interface Esperado {
  bife: string | null;
  milanesa: string | null;
  bloque: { titulo: string; opciones: string; paraLosPlatos: string } | null;
}

type Condicion = { [K in keyof Combinacion]?: readonly Combinacion[K][] };

interface Regla {
  /** Para leer el fallo: qué regla es. */
  nombre: string;
  /** Cuándo aplica (todas las claves; una clave ausente = cualquier valor). */
  si: Condicion;
  entonces: Esperado;
}

const SECCION = ["publica", "impresa"] as const;
const SOLO = ["vista-previa", "va-a-mostrar"] as const;
const NADA: Esperado = { bife: null, milanesa: null, bloque: null };
const PARA = "Con los platos que dicen «Incluye guarnición»";
const TRES = "puré · ensalada · papas fritas";
const DOS = "puré · ensalada";

/** El bloque de la guarnición (con o sin «elegís …» en el título). */
const bloque = (titulo: string, opciones: string) => ({ titulo, opciones, paraLosPlatos: PARA });

export const REGLAS: readonly Regla[] = [
  // 1 y 2: nada que dibujar.
  { nombre: "R1 grupo oculto", si: { visible: ["oculto"] }, entonces: NADA },
  { nombre: "R2 una sola opción no es una elección", si: { visible: ["visible"], cantidad: [1] }, entonces: NADA },

  // ---- Canales de SECCIÓN (pública, impresa): Bife y Milanesa, con el bloque completo ----
  // P1 no incluye el grupo: solo Milanesa lo dice, y como es la única, sus límites coinciden con los del bloque.
  {
    nombre: "R3 sección, Bife no incluye, todas las opciones",
    si: { visible: ["visible"], cantidad: [3], canal: SECCION, incluye: ["no"], opcion: ["todas-encendidas"] },
    entonces: { bife: null, milanesa: "Incluye guarnición", bloque: bloque("Guarnición · elegís 1", TRES) },
  },
  {
    nombre: "R3b sección, Bife no incluye, última apagada",
    si: { visible: ["visible"], cantidad: [3], canal: SECCION, incluye: ["no"], opcion: ["ultima-apagada"] },
    entonces: { bife: null, milanesa: "Incluye guarnición", bloque: bloque("Guarnición · elegís 1", DOS) },
  },
  // Bife incluye todas las del bloque.
  {
    nombre: "R4 sección, Bife todas, límites iguales, todas las opciones",
    si: { visible: ["visible"], cantidad: [3], canal: SECCION, incluye: ["todas"], limites: ["iguales"], opcion: ["todas-encendidas"] },
    entonces: { bife: "Incluye guarnición", milanesa: "Incluye guarnición", bloque: bloque("Guarnición · elegís 1", TRES) },
  },
  {
    nombre: "R4b sección, Bife todas, límites iguales, última apagada",
    si: { visible: ["visible"], cantidad: [3], canal: SECCION, incluye: ["todas"], limites: ["iguales"], opcion: ["ultima-apagada"] },
    entonces: { bife: "Incluye guarnición", milanesa: "Incluye guarnición", bloque: bloque("Guarnición · elegís 1", DOS) },
  },
  {
    nombre: "R5 sección, Bife todas, límites distintos, todas las opciones",
    si: { visible: ["visible"], cantidad: [3], canal: SECCION, incluye: ["todas"], limites: ["distintos"], opcion: ["todas-encendidas"] },
    entonces: { bife: "Incluye guarnición (elegís de 1 a 2)", milanesa: "Incluye guarnición (elegís 1)", bloque: bloque("Guarnición", TRES) },
  },
  {
    nombre: "R5b sección, Bife todas, límites distintos, última apagada",
    si: { visible: ["visible"], cantidad: [3], canal: SECCION, incluye: ["todas"], limites: ["distintos"], opcion: ["ultima-apagada"] },
    entonces: { bife: "Incluye guarnición (elegís de 1 a 2)", milanesa: "Incluye guarnición (elegís 1)", bloque: bloque("Guarnición", DOS) },
  },
  // Bife incluye un subconjunto (puré o ensalada): con todas las opciones, lo nombra; con la última apagada, ya es todo lo que hay.
  {
    nombre: "R6 sección, Bife subconjunto, límites iguales, todas las opciones",
    si: { visible: ["visible"], cantidad: [3], canal: SECCION, incluye: ["subconjunto"], limites: ["iguales"], opcion: ["todas-encendidas"] },
    entonces: { bife: "Incluye guarnición: puré o ensalada", milanesa: "Incluye guarnición", bloque: bloque("Guarnición · elegís 1", TRES) },
  },
  {
    nombre: "R6b sección, Bife subconjunto, límites iguales, última apagada",
    si: { visible: ["visible"], cantidad: [3], canal: SECCION, incluye: ["subconjunto"], limites: ["iguales"], opcion: ["ultima-apagada"] },
    entonces: { bife: "Incluye guarnición", milanesa: "Incluye guarnición", bloque: bloque("Guarnición · elegís 1", DOS) },
  },
  {
    nombre: "R7 sección, Bife subconjunto, límites distintos, todas las opciones",
    si: { visible: ["visible"], cantidad: [3], canal: SECCION, incluye: ["subconjunto"], limites: ["distintos"], opcion: ["todas-encendidas"] },
    entonces: { bife: "Incluye guarnición: puré o ensalada (elegís de 1 a 2)", milanesa: "Incluye guarnición (elegís 1)", bloque: bloque("Guarnición", TRES) },
  },
  {
    nombre: "R7b sección, Bife subconjunto, límites distintos, última apagada",
    si: { visible: ["visible"], cantidad: [3], canal: SECCION, incluye: ["subconjunto"], limites: ["distintos"], opcion: ["ultima-apagada"] },
    entonces: { bife: "Incluye guarnición (elegís de 1 a 2)", milanesa: "Incluye guarnición (elegís 1)", bloque: bloque("Guarnición", DOS) },
  },

  // ---- Canales que miran SOLO a Bife (vista previa del producto, «Va a mostrar»): una sección de uno ----
  { nombre: "R8 solo, Bife no incluye", si: { visible: ["visible"], cantidad: [3], canal: SOLO, incluye: ["no"] }, entonces: NADA },
  {
    nombre: "R9 solo, Bife todas, límites iguales, todas las opciones",
    si: { visible: ["visible"], cantidad: [3], canal: SOLO, incluye: ["todas"], limites: ["iguales"], opcion: ["todas-encendidas"] },
    entonces: { bife: "Incluye guarnición", milanesa: null, bloque: bloque("Guarnición · elegís 1", TRES) },
  },
  {
    nombre: "R9b solo, Bife todas, límites iguales, última apagada",
    si: { visible: ["visible"], cantidad: [3], canal: SOLO, incluye: ["todas"], limites: ["iguales"], opcion: ["ultima-apagada"] },
    entonces: { bife: "Incluye guarnición", milanesa: null, bloque: bloque("Guarnición · elegís 1", DOS) },
  },
  {
    nombre: "R10 solo, Bife todas, límites distintos, todas las opciones",
    si: { visible: ["visible"], cantidad: [3], canal: SOLO, incluye: ["todas"], limites: ["distintos"], opcion: ["todas-encendidas"] },
    entonces: { bife: "Incluye guarnición", milanesa: null, bloque: bloque("Guarnición · elegís de 1 a 2", TRES) },
  },
  {
    nombre: "R10b solo, Bife todas, límites distintos, última apagada",
    si: { visible: ["visible"], cantidad: [3], canal: SOLO, incluye: ["todas"], limites: ["distintos"], opcion: ["ultima-apagada"] },
    entonces: { bife: "Incluye guarnición", milanesa: null, bloque: bloque("Guarnición · elegís de 1 a 2", DOS) },
  },
  // Mirado solo, el bloque lista las opciones de ESE plato: con un subconjunto, solo puré y ensalada (no hay otro plato que sume la última), y el plato no nombra nada porque es todo el bloque.
  {
    nombre: "R11 solo, Bife subconjunto, límites iguales",
    si: { visible: ["visible"], cantidad: [3], canal: SOLO, incluye: ["subconjunto"], limites: ["iguales"] },
    entonces: { bife: "Incluye guarnición", milanesa: null, bloque: bloque("Guarnición · elegís 1", DOS) },
  },
  {
    nombre: "R12 solo, Bife subconjunto, límites distintos",
    si: { visible: ["visible"], cantidad: [3], canal: SOLO, incluye: ["subconjunto"], limites: ["distintos"] },
    entonces: { bife: "Incluye guarnición", milanesa: null, bloque: bloque("Guarnición · elegís de 1 a 2", DOS) },
  },
];

/** ¿La regla aplica a esta combinación? */
function aplica(regla: { si: Condicion }, c: Combinacion): boolean {
  return (Object.keys(regla.si) as (keyof Combinacion)[]).every((k) => (regla.si[k] as readonly unknown[]).includes(c[k]));
}

/** Todas las combinaciones del producto de las dimensiones. */
export function todasLasCombinaciones(): Combinacion[] {
  const salida: Combinacion[] = [];
  for (const visible of VISIBLE) for (const opcion of OPCION) for (const incluye of INCLUYE) for (const cantidad of CANTIDAD) for (const limites of LIMITES) for (const canal of CANAL) for (const descripcion of DESCRIPCION) salida.push({ visible, opcion, incluye, cantidad, limites, canal, descripcion });
  return salida;
}

/** La regla de una combinación: exactamente una, o el test avisa cuál falta o cuáles se pisan. */
export function reglasQueAplican(c: Combinacion): Regla[] {
  return REGLAS.filter((r) => aplica(r, c));
}

// ---- E3: la descripción de la opción («Ver detalle») ----------------------------------------------------------------------------------------------------------------------------------------
//
// REGLA DE LA DESCRIPCIÓN (I8 y la elección del dueño): el desplegable «Ver detalle ▾» existe SI Y SOLO SI el bloque existe y alguna opción QUE EL BLOQUE LISTA tiene descripción. La descripción es de «Papas fritas»:
// si esa opción está apagada en la sucursal no llega al bloque (ni su descripción); si el plato mirado solo (vista previa, «Va a mostrar») admite un subconjunto sin ella, el bloque de ese plato tampoco la lista.
// Se lee de arriba abajo y GANA LA PRIMERA fila que aplica (las condiciones se pisan a propósito: «sin bloque» ya cubre varias dimensiones a la vez); la última fila es la única que muestra el detalle.

const DETALLE_VISIBLE = "papas fritas · papas rústicas con cáscara";

interface ReglaDeDetalle {
  nombre: string;
  si: Condicion;
  /** `null` = no hay desplegable (ni lista de papel). */
  detalle: string | null;
}

export const REGLAS_DEL_DETALLE: readonly ReglaDeDetalle[] = [
  { nombre: "E1 sin descripción cargada", si: { descripcion: ["ninguna"] }, detalle: null },
  { nombre: "E2 grupo oculto: ni bloque ni detalle", si: { visible: ["oculto"] }, detalle: null },
  { nombre: "E3 una sola opción: no hay bloque", si: { cantidad: [1] }, detalle: null },
  { nombre: "E4 mirado solo y el plato no incluye el grupo: no hay bloque", si: { canal: SOLO, incluye: ["no"] }, detalle: null },
  { nombre: "E5 la opción con descripción está apagada en la sucursal: no llega al bloque", si: { opcion: ["ultima-apagada"] }, detalle: null },
  { nombre: "E6 mirado solo, el subconjunto del plato no lleva «papas fritas»: su bloque no la lista", si: { canal: SOLO, incluye: ["subconjunto"] }, detalle: null },
  { nombre: "E7 el bloque lista «papas fritas» y tiene descripción: aparece «Ver detalle»", si: {}, detalle: DETALLE_VISIBLE },
];

/** La primera regla del detalle que aplica a la combinación (la tabla termina en una regla sin condiciones, así que siempre hay una). */
export function reglaDelDetalle(c: Combinacion): ReglaDeDetalle {
  return REGLAS_DEL_DETALLE.find((r) => aplica(r, c))!;
}
