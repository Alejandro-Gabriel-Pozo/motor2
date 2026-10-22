import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { listarArchivos } from "../../cercos/trinquete";
import { coincidenciasDeClases, coincidenciasPorToken, primeraClase } from "../adaptadores/clases-tsx";
import { prueba, type Coincidencia } from "../adaptadores/coincidencia";
import { coincidenciasDeCss, primeraReglaConClase, reglaDelAncla, variablesDefinidas } from "../adaptadores/css";
import { coincidenciasDeTs, importaElAncla } from "../adaptadores/ts";
import { Indice, esCss, esTs } from "../indice";
import type { Contrato, Detector } from "../tipos";

/**
 * Qué archivos USAN cada contrato (paso G3). El motor (`motor.ts`) devuelve hallazgos, no los consumidores; esta consulta arma, SIN tocar el motor y con sus mismos
 * adaptadores públicos (`adaptadores/` e `indice.ts`), lo que `areas.ts` necesita para comparar la declaración de cada área con el código:
 *  - `declara`: el archivo declara la dependencia con la forma del contrato (importa el ancla, lleva la clase compañera, usa un nombre que la fuente define);
 *  - `senales`: cuántas señales crudas tiene (lo que el contrato regula), declaradas o no.
 * Un archivo «usa» el contrato si declara o tiene señales. La fuente no se cuenta (el motor tampoco la mira como consumidor).
 *
 * Es la misma lógica de declaración que `revisarContrato` del motor, repetida a propósito en lo mínimo (el motor no la expone). Si `Declaracion` gana un tipo nuevo,
 * el `switch` exhaustivo de abajo deja de compilar: no hay forma de que un contrato nuevo se compare con menos rigor que el motor.
 */

export interface UsoEnArchivo {
  /** Ruta relativa a la raíz del repo, con `/`. */
  ruta: string;
  declara: boolean;
  senales: number;
  /** Dónde está el primer rastro (la declaración, o la primera señal si no declara); 1-based. */
  linea: number;
  columna: number;
}

export interface UsosDeContrato {
  id: string;
  /** El archivo de la fuente: el área que lo contiene está eximida de declarar el contrato. */
  fuente: string;
  /** Solo los archivos que usan el contrato (declaran o tienen señales), ordenados por ruta. */
  archivos: readonly UsoEnArchivo[];
  /** Cuántos archivos del alcance se miraron (un alcance vacío no es «sin usos»). */
  mirados: number;
}

/** Lo que un detector encuentra en un archivo (los adaptadores que no aplican a la extensión del archivo no encuentran nada). Igual que el motor. */
function coincidenciasDe(d: Detector, ruta: string, indice: Indice, prefijoDeNombre: string | null): Coincidencia[] {
  if (d.adaptador === "css") return esCss(ruta) ? coincidenciasDeCss(indice.reglas(ruta), d) : [];
  if (!esTs(ruta)) return [];
  if (d.adaptador === "clases") return prefijoDeNombre === null ? coincidenciasDeClases(indice.cadenas(ruta), d.token) : coincidenciasPorToken(indice.cadenas(ruta), d.token, prefijoDeNombre);
  if (d.tipo === "codigo" && !prueba(d.patron, indice.fuente(ruta))) return [];
  return coincidenciasDeTs(indice.archivoTs(ruta), d);
}

/**
 * Los archivos del alcance del contrato (carpetas recorridas, archivos sueltos incluidos), sin la fuente. `recorridos` guarda lo que ya se listó para un mismo alcance en esta consulta: los
 * contratos de las primitivas de `src/ui` comparten raíces y extensiones, y cada recorrido del disco se hacía una vez por contrato y por corrida del arnés de mutaciones.
 */
function archivosDelAlcance(raiz: string, c: Contrato, recorridos: Map<string, readonly string[]>): string[] {
  const clave = JSON.stringify([c.alcance.raices, c.alcance.extensiones]);
  let listados = recorridos.get(clave);
  if (listados === undefined) {
    const salida = new Set<string>();
    const carpetas: string[] = [];
    for (const r of c.alcance.raices) {
      const absoluta = join(raiz, ...r.split("/"));
      if (!existsSync(absoluta)) continue;
      if (statSync(absoluta).isDirectory()) carpetas.push(r);
      else if (c.alcance.extensiones.some((e) => r.endsWith(e))) salida.add(r);
    }
    for (const r of listarArchivos(raiz, carpetas, c.alcance.extensiones)) salida.add(r);
    listados = [...salida].sort();
    recorridos.set(clave, listados);
  }
  return listados.filter((r) => r !== c.fuente.archivo);
}

/** Los nombres que define la fuente (`--x`): CSS, las propiedades personalizadas de la regla ancla; TS, todo `--x` escrito en el código. */
function nombresDeLaFuente(c: Contrato, indice: Indice): ReadonlySet<string> {
  const ruta = c.fuente.archivo;
  if (!indice.tiene(ruta)) return new Set();
  if (esCss(ruta)) {
    const reglas = indice.reglas(ruta);
    const regla = reglaDelAncla(reglas, c.fuente.ancla);
    return regla === null ? new Set() : new Set(variablesDefinidas(reglas, regla).keys());
  }
  return new Set([...indice.limpia(ruta).matchAll(/--[A-Za-z][\w-]*/g)].map((m) => m[0]));
}

/** Para cada contrato, los archivos de su alcance que lo usan. Un solo `Indice` compartido: cada archivo se lee y se parsea una vez. */
export function usosDeContratos(raiz: string, contratos: readonly Contrato[]): UsosDeContrato[] {
  const recorridos = new Map<string, readonly string[]>();
  const porContrato = contratos.map((c) => ({ c, rutas: archivosDelAlcance(raiz, c, recorridos) }));
  const fuentes = contratos.map((c) => c.fuente.archivo);
  const indice = new Indice(raiz, [...new Set([...porContrato.flatMap((p) => p.rutas), ...fuentes.filter((f) => existsSync(join(raiz, ...f.split("/"))))])]);

  return porContrato.map(({ c, rutas }) => {
    const declaracion = c.declaracion;
    const definidos = declaracion.tipo === "nombre-definido-en-la-fuente" ? nombresDeLaFuente(c, indice) : new Set<string>();
    const prefijoDeNombre = declaracion.tipo === "nombre-definido-en-la-fuente" ? declaracion.prefijoDeNombre : null;
    const archivos: UsoEnArchivo[] = [];
    for (const ruta of rutas) {
      const coincidencias = c.senales.flatMap((s) => coincidenciasDe(s, ruta, indice, prefijoDeNombre));
      let declaraDesde: number | null = null;
      switch (declaracion.tipo) {
        case "importar-ancla": {
          const imp = esTs(ruta) && (c.fuente.ancla === "default" || indice.fuente(ruta).includes(c.fuente.ancla)) ? importaElAncla(indice.arbol(ruta), ruta, c.fuente.archivo, c.fuente.ancla) : null;
          declaraDesde = imp === null ? null : imp.desde;
          break;
        }
        case "clase-companera":
          declaraDesde = esCss(ruta) ? primeraReglaConClase(indice.reglas(ruta), declaracion.clase) : primeraClase(indice.cadenas(ruta), declaracion.clase);
          break;
        case "nombre-definido-en-la-fuente": {
          const primera = coincidencias.find((k) => definidos.has(k.nombre));
          declaraDesde = primera === undefined ? null : primera.desde;
          break;
        }
        default: {
          const inalcanzable: never = declaracion;
          throw new Error(`Tipo de declaración desconocido: ${JSON.stringify(inalcanzable)}`);
        }
      }
      if (declaraDesde === null && coincidencias.length === 0) continue;
      const desde = declaraDesde ?? Math.min(...coincidencias.map((k) => k.desde));
      archivos.push({ ruta, declara: declaraDesde !== null, senales: coincidencias.length, ...indice.posicion(ruta, desde) });
    }
    return { id: c.id, fuente: c.fuente.archivo, archivos, mirados: rutas.length };
  });
}
