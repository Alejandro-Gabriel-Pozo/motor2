import type ts from "typescript";
import { arbolDe, leer, sinComentarios } from "../cercos/trinquete";
import { cadenasDeClases, type CadenaDeClases } from "./adaptadores/clases-tsx";
import { leerReglas, type ReglaCss } from "./adaptadores/css";
import { codigoSolo, type ArchivoTs } from "./adaptadores/ts";

/**
 * El índice compartido de una corrida del motor: la lista de archivos (una sola vez) y, por archivo, su fuente, su texto sin comentarios, su AST, su código y sus
 * reglas de CSS. Todo se calcula la primera vez que alguien lo pide y se reusa: cada archivo se lee una vez y se parsea una vez, sin importar cuántos contratos
 * y adaptadores lo miren. La fuente se normaliza (`\r\n` → `\n`): todas las posiciones son 0-based sobre ese texto.
 */
/**
 * Memoria ENTRE corridas, con una ranura por ruta que solo vale mientras el texto sea idéntico: el arnés de mutaciones corre el motor cientos de veces sobre el mismo árbol y
 * cambia un archivo por vez, así que lo que no cambió no se vuelve a parsear. Una sola corrida (el guardián real) no se entera: la primera vez siempre se calcula.
 */
const memoLimpia = new Map<string, { fuente: string; limpia: string }>();
const memoArbol = new Map<string, { fuente: string; arbol: ts.SourceFile }>();
const memoCadenas = new Map<string, { fuente: string; cadenas: CadenaDeClases[] }>();
const memoReglas = new Map<string, { fuente: string; reglas: ReglaCss[] }>();

/** El AST de un archivo con la memoria entre corridas: lo usan el índice y los operadores del arnés de mutaciones (que leen el árbol de la copia sin pasar por un índice). */
export function arbolMemoizado(ruta: string, fuente: string): ts.SourceFile {
  const previo = memoArbol.get(ruta);
  if (previo?.fuente === fuente) return previo.arbol;
  const arbol = arbolDe(fuente, ruta);
  memoArbol.set(ruta, { fuente, arbol });
  return arbol;
}

/** Las cadenas de clases de un archivo con la memoria entre corridas (ver `arbolMemoizado`). */
export function cadenasMemoizadas(ruta: string, fuente: string): CadenaDeClases[] {
  const previa = memoCadenas.get(ruta);
  if (previa?.fuente === fuente) return previa.cadenas;
  const cadenas = cadenasDeClases(arbolMemoizado(ruta, fuente), fuente);
  memoCadenas.set(ruta, { fuente, cadenas });
  return cadenas;
}

export const esCss = (ruta: string): boolean => ruta.endsWith(".css");
export const esTs = (ruta: string): boolean => /\.tsx?$/.test(ruta);

export class Indice {
  private readonly lista: ReadonlySet<string>;
  /** Todos los archivos listados, en orden. */
  readonly todas: string[];
  private readonly fuentes = new Map<string, string>();
  private readonly limpias = new Map<string, string>();
  private readonly arboles = new Map<string, ts.SourceFile>();
  private readonly archivosTs = new Map<string, ArchivoTs>();
  private readonly cadenasMemo = new Map<string, CadenaDeClases[]>();
  private readonly reglasMemo = new Map<string, ReglaCss[]>();
  private readonly inicios = new Map<string, number[]>();

  constructor(
    private readonly raiz: string,
    rutas: readonly string[]
  ) {
    this.lista = new Set(rutas);
    this.todas = [...this.lista].sort();
  }

  /** Cuántos archivos se leyeron de verdad hasta ahora. */
  get leidos(): number {
    return this.fuentes.size;
  }

  tiene(ruta: string): boolean {
    return this.lista.has(ruta);
  }

  fuente(ruta: string): string {
    let f = this.fuentes.get(ruta);
    if (f === undefined) {
      f = leer(this.raiz, ruta).replace(/\r\n/g, "\n");
      this.fuentes.set(ruta, f);
    }
    return f;
  }

  /** La fuente con los comentarios en blanco (mismas posiciones). */
  limpia(ruta: string): string {
    let l = this.limpias.get(ruta);
    if (l === undefined) {
      const fuente = this.fuente(ruta);
      const previa = memoLimpia.get(ruta);
      if (previa?.fuente === fuente) l = previa.limpia;
      else {
        l = sinComentarios(fuente, ruta);
        memoLimpia.set(ruta, { fuente, limpia: l });
      }
      this.limpias.set(ruta, l);
    }
    return l;
  }

  arbol(ruta: string): ts.SourceFile {
    let a = this.arboles.get(ruta);
    if (a === undefined) {
      a = arbolMemoizado(ruta, this.fuente(ruta));
      this.arboles.set(ruta, a);
    }
    return a;
  }

  archivoTs(ruta: string): ArchivoTs {
    let a = this.archivosTs.get(ruta);
    if (a === undefined) {
      const arbol = this.arbol(ruta);
      a = { fuente: this.fuente(ruta), codigo: codigoSolo(this.limpia(ruta), arbol), arbol };
      this.archivosTs.set(ruta, a);
    }
    return a;
  }

  cadenas(ruta: string): CadenaDeClases[] {
    let c = this.cadenasMemo.get(ruta);
    if (c === undefined) {
      c = cadenasMemoizadas(ruta, this.fuente(ruta));
      this.cadenasMemo.set(ruta, c);
    }
    return c;
  }

  reglas(ruta: string): ReglaCss[] {
    let r = this.reglasMemo.get(ruta);
    if (r === undefined) {
      const fuente = this.fuente(ruta);
      const previa = memoReglas.get(ruta);
      if (previa?.fuente === fuente) r = previa.reglas;
      else {
        r = leerReglas(this.limpia(ruta));
        memoReglas.set(ruta, { fuente, reglas: r });
      }
      this.reglasMemo.set(ruta, r);
    }
    return r;
  }

  /** Línea y columna (1-based) de una posición (0-based) del archivo. */
  posicion(ruta: string, desde: number): { linea: number; columna: number } {
    let inicios = this.inicios.get(ruta);
    if (inicios === undefined) {
      inicios = [0];
      const f = this.fuente(ruta);
      for (let i = 0; i < f.length; i++) if (f[i] === "\n") inicios.push(i + 1);
      this.inicios.set(ruta, inicios);
    }
    let a = 0;
    let b = inicios.length - 1;
    while (a < b) {
      const medio = (a + b + 1) >> 1;
      if (inicios[medio] <= desde) a = medio;
      else b = medio - 1;
    }
    return { linea: a + 1, columna: desde - inicios[a] + 1 };
  }
}
