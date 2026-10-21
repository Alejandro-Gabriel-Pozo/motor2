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
      l = sinComentarios(this.fuente(ruta), ruta);
      this.limpias.set(ruta, l);
    }
    return l;
  }

  arbol(ruta: string): ts.SourceFile {
    let a = this.arboles.get(ruta);
    if (a === undefined) {
      a = arbolDe(this.fuente(ruta), ruta);
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
      c = cadenasDeClases(this.arbol(ruta), this.fuente(ruta));
      this.cadenasMemo.set(ruta, c);
    }
    return c;
  }

  reglas(ruta: string): ReglaCss[] {
    let r = this.reglasMemo.get(ruta);
    if (r === undefined) {
      r = leerReglas(this.limpia(ruta));
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
