/**
 * ORÁCULO del orden de los renglones de una sección de carta (etapa O1; `docs/diseno-carta-orden-permiso-y-precio-de-familia-2026-11-17.md`, nivel 10, regla de combinaciones del 2026-10-28). Escrito APARTE del código: cada fila dice,
 * en palabras y con el resultado a la vista, cómo sale una sección con un modo de orden y ciertos renglones. No importa nada de `src/`: si la regla de `orden-de-seccion.ts` cambia, la tabla no cambia sola.
 *
 * Dimensiones que cambian lo que ve el comensal: MODO (sin fila, a mano, alfabético, uno desconocido) × TIPO de renglón (producto, ítem agrupado) × EMPATES de `orden` × ★ (`especial`, que NO participa).
 * La dimensión «oculto / inactivo» NO se resuelve acá sino ANTES, en la lectura (`leerRenglonesDeSeccion`: solo productos visibles e ítems agrupados activos): la cubre el test de integración
 * `orden-de-renglones-casos-de-uso.test.ts` («lo oculto y lo apagado no entran ni cuentan»).
 */
export type ModoDelOraculo = "SIN_FILA" | "A_MANO" | "ALFABETICO" | "DESCONOCIDO";

export interface RenglonDelOraculo {
  tipo: "PRODUCTO" | "ITEM_AGRUPADO";
  nombre: string;
  orden: number;
  especial?: boolean;
}

export interface FilaDelOraculo {
  id: string;
  regla: string;
  modo: ModoDelOraculo;
  renglones: readonly RenglonDelOraculo[];
  /** Los nombres, en el orden en que tienen que salir. Los nombres de una fila son todos distintos: el resultado no depende del orden de entrada. */
  esperado: readonly string[];
}

const P = (nombre: string, orden: number, especial = false): RenglonDelOraculo => ({ tipo: "PRODUCTO", nombre, orden, especial });
const A = (nombre: string, orden: number, especial = false): RenglonDelOraculo => ({ tipo: "ITEM_AGRUPADO", nombre, orden, especial });

export const ORACULO_DE_ORDEN_DE_SECCION: readonly FilaDelOraculo[] = [
  { id: "R1", regla: "sin fila = a mano: sale por `orden`", modo: "SIN_FILA", renglones: [P("Flan", 2), P("Bife", 0), P("Milanesa", 1)], esperado: ["Bife", "Milanesa", "Flan"] },
  { id: "R2", regla: "sin fila con `orden` iguales se desempata por nombre", modo: "SIN_FILA", renglones: [P("Milanesa", 0), P("Bife", 0), P("Flan", 0)], esperado: ["Bife", "Flan", "Milanesa"] },
  { id: "R3", regla: "a mano es lo mismo que sin fila", modo: "A_MANO", renglones: [P("Flan", 2), P("Bife", 0), P("Milanesa", 1)], esperado: ["Bife", "Milanesa", "Flan"] },
  { id: "R4", regla: "alfabético IGNORA el `orden` guardado", modo: "ALFABETICO", renglones: [P("Flan", 0), P("Bife", 5), P("Milanesa", 1)], esperado: ["Bife", "Flan", "Milanesa"] },
  { id: "R5", regla: "alfabético no distingue acentos ni mayúsculas al comparar", modo: "ALFABETICO", renglones: [P("Cebolla", 0), P("árbol", 1), P("Banana", 2)], esperado: ["árbol", "Banana", "Cebolla"] },
  { id: "R6", regla: "alfabético mezcla productos e ítems agrupados en una sola lista", modo: "ALFABETICO", renglones: [P("Soda", 0), A("Gaseosa", 1), P("Agua", 2), A("Jugo", 3)], esperado: ["Agua", "Gaseosa", "Jugo", "Soda"] },
  { id: "R7", regla: "a mano: el ítem agrupado y el producto comparten la misma escala de `orden`", modo: "A_MANO", renglones: [P("Agua", 1), A("Gaseosa", 0), P("Soda", 2), A("Jugo", 3)], esperado: ["Gaseosa", "Agua", "Soda", "Jugo"] },
  { id: "R8", regla: "a mano: un ítem agrupado y un producto con el mismo `orden` se desempatan por nombre", modo: "A_MANO", renglones: [A("Gaseosa", 0), P("Agua", 0), P("Soda", 1)], esperado: ["Agua", "Gaseosa", "Soda"] },
  { id: "R9", regla: "alfabético con `orden` iguales sigue siendo por nombre", modo: "ALFABETICO", renglones: [A("Jugo", 0), P("Agua", 0), A("Gaseosa", 0)], esperado: ["Agua", "Gaseosa", "Jugo"] },
  { id: "R10", regla: "un modo desconocido NO abre nada: se ordena a mano, como siempre", modo: "DESCONOCIDO", renglones: [P("Flan", 1), P("Bife", 0), P("Agua", 2)], esperado: ["Bife", "Flan", "Agua"] },
  { id: "R11", regla: "a mano: un `orden` negativo va primero", modo: "A_MANO", renglones: [P("Bife", 0), P("Flan", -1), P("Agua", 3)], esperado: ["Flan", "Bife", "Agua"] },
  { id: "R12", regla: "★ (`especial`) no cambia el orden, ni a mano ni alfabético", modo: "ALFABETICO", renglones: [P("Flan", 0, true), P("Bife", 1), A("Agua", 2, true)], esperado: ["Agua", "Bife", "Flan"] },
  { id: "R13", regla: "★ (`especial`) no cambia el orden a mano", modo: "A_MANO", renglones: [P("Flan", 0, true), P("Bife", 1), A("Agua", 2, true)], esperado: ["Flan", "Bife", "Agua"] },
];
