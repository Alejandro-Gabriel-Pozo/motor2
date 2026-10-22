/** Lo que un detector encontró en UN archivo. Los tres adaptadores devuelven esto; el motor decide si está declarado. */
export interface Coincidencia {
  /** Posición (0-based) en la fuente normalizada del archivo (saltos `\n`): el motor la convierte en línea y columna. */
  desde: number;
  /** El texto que se informa y con el que se declara una excepción o una deuda (espacios colapsados). */
  fragmento: string;
  /** El nombre usado (`--x` en un `var()`, el token de clase, el nombre declarado); vacío si no aplica. */
  nombre: string;
  /** Las clases que acompañan al uso: las de su cadena de clases (clases) o las de su selector (css). Vacío en TS. */
  companeras: readonly string[];
}

/** Espacios colapsados y recortados: la forma en que se comparan los fragmentos. */
export function colapsar(texto: string): string {
  return texto.trim().replace(/\s+/g, " ");
}

/** `RegExp.test` sin el estado de `lastIndex` de las banderas `g` / `y`. */
export function prueba(patron: RegExp, texto: string): boolean {
  patron.lastIndex = 0;
  const ok = patron.test(texto);
  patron.lastIndex = 0;
  return ok;
}
