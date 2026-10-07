import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/**
 * Inventario AST de las guardas de permiso del código: qué clave de `AccionClave` protege cada llamada de guarda, en qué archivo y línea.
 * Reemplaza la regex de `toda-accion-se-usa.test.ts`, que no veía `conPermiso<T>("clave", …)` (16 llamadas) ni distinguía un comentario de
 * una llamada. Es la base de los guardianes de «una clave por acción» (`una-clave-por-accion.test.ts`).
 *
 * Como `analizador.ts`, no usa `ts.Program`: resuelve por NOMBRE de la función llamada (no sigue alias de import entre archivos).
 */

/** Función de guarda → posición del argumento que lleva la clave (`lista`: un arreglo de claves). */
const GUARDAS_DE_CLAVE: Readonly<Record<string, { indice: number; forma: "clave" | "lista" }>> = {
  conPermiso: { indice: 0, forma: "clave" },
  conPermisoDeEmpresa: { indice: 0, forma: "clave" },
  conEdicionDePermisos: { indice: 0, forma: "clave" },
  requerirVer: { indice: 0, forma: "clave" },
  requerirVerDeEmpresa: { indice: 0, forma: "clave" },
  requerirVerEnSucursal: { indice: 1, forma: "clave" },
  requerirVerAlguna: { indice: 0, forma: "lista" },
  requierePermiso: { indice: 2, forma: "clave" },
  requierePermisoVer: { indice: 2, forma: "clave" },
  requierePermisoDeEmpresa: { indice: 2, forma: "clave" },
  requierePermisoVerDeEmpresa: { indice: 2, forma: "clave" },
  obtenerMiNivelPermiso: { indice: 2, forma: "clave" },
  obtenerMiNivelPermisoDeEmpresa: { indice: 2, forma: "clave" },
  sucursalesDondeElUsuarioPuedeVer: { indice: 2, forma: "clave" },
  accionesQueElUsuarioPuedeVer: { indice: 2, forma: "lista" },
  accionesDelMenuQueElUsuarioPuedeVer: { indice: 3, forma: "lista" },
};

export interface UsoDeClave {
  clave: string;
  funcion: string;
  archivo: string;
  linea: number;
}

/** Una llamada de guarda cuya clave no es un literal (una variable, una expresión): no se puede inventariar, se lista aparte. */
export interface UsoDinamico {
  funcion: string;
  archivo: string;
  linea: number;
  texto: string;
}

export interface Inventario {
  usos: UsoDeClave[];
  dinamicos: UsoDinamico[];
  /** Valores del mapa `ACCION_POR_PROCESO` (la indirección real: la acción se resuelve desde una variable). */
  valoresDeMapa: UsoDeClave[];
}

function esLiteralDeTexto(nodo: ts.Node): nodo is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo);
}

/** Quita `as const`, `satisfies X`, paréntesis y `!` que envuelven la expresión. */
function sinEnvoltorios(expr: ts.Expression): ts.Expression {
  let actual = expr;
  while (ts.isAsExpression(actual) || ts.isSatisfiesExpression(actual) || ts.isParenthesizedExpression(actual) || ts.isNonNullExpression(actual)) {
    actual = actual.expression;
  }
  return actual;
}

export function inventariarFuente(archivo: string, fuente: string): Inventario {
  const sf = ts.createSourceFile(archivo, fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const inventario: Inventario = { usos: [], dinamicos: [], valoresDeMapa: [] };
  const lineaDe = (nodo: ts.Node) => sf.getLineAndCharacterOfPosition(nodo.getStart(sf)).line + 1;

  function visitar(nodo: ts.Node): void {
    if (ts.isCallExpression(nodo) && ts.isIdentifier(nodo.expression)) {
      const funcion = nodo.expression.text;
      const guarda = Object.hasOwn(GUARDAS_DE_CLAVE, funcion) ? GUARDAS_DE_CLAVE[funcion] : undefined;
      const arg = guarda ? nodo.arguments[guarda.indice] : undefined;
      if (guarda && arg) {
        const sinEnv = sinEnvoltorios(arg);
        const candidatos = guarda.forma === "lista" && ts.isArrayLiteralExpression(sinEnv) ? [...sinEnv.elements] : [sinEnv];
        for (const c of candidatos) {
          if (esLiteralDeTexto(c)) inventario.usos.push({ clave: c.text, funcion, archivo, linea: lineaDe(c) });
          else inventario.dinamicos.push({ funcion, archivo, linea: lineaDe(c), texto: c.getText(sf) });
        }
      }
    }
    if (ts.isVariableDeclaration(nodo) && ts.isIdentifier(nodo.name) && nodo.name.text === "ACCION_POR_PROCESO" && nodo.initializer) {
      const literal = sinEnvoltorios(nodo.initializer);
      if (ts.isObjectLiteralExpression(literal)) {
        for (const prop of literal.properties) {
          if (ts.isPropertyAssignment(prop) && esLiteralDeTexto(prop.initializer)) {
            inventario.valoresDeMapa.push({ clave: prop.initializer.text, funcion: "ACCION_POR_PROCESO", archivo, linea: lineaDe(prop) });
          }
        }
      }
    }
    ts.forEachChild(nodo, visitar);
  }
  visitar(sf);
  return inventario;
}

function archivosFuente(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivosFuente(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

/** Inventario de todo un directorio (`src/`). `archivo` queda relativo a `raiz`, con `/`. */
export function inventariarDirectorio(raiz: string): Inventario {
  const total: Inventario = { usos: [], dinamicos: [], valoresDeMapa: [] };
  for (const ruta of archivosFuente(raiz)) {
    const relativa = ruta.slice(raiz.length + 1).replace(/\\/g, "/");
    const parcial = inventariarFuente(relativa, readFileSync(ruta, "utf8"));
    total.usos.push(...parcial.usos);
    total.dinamicos.push(...parcial.dinamicos);
    total.valoresDeMapa.push(...parcial.valoresDeMapa);
  }
  return total;
}

/** Todas las claves que algún sitio usa como guarda (literales + valores del mapa de procesos). */
export function clavesUsadas(inventario: Inventario): Set<string> {
  return new Set([...inventario.usos, ...inventario.valoresDeMapa].map((u) => u.clave));
}
