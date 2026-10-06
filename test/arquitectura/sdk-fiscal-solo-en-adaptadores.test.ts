import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura (Fase 0 del plan de pureza, PR 0.5): UN SDK FISCAL SOLO SE IMPORTA DESDE `src/server/adaptadores/fiscal/`.
 *
 * El plan fiscal (`comparacion-sdks-arca-y-recomendacion.md`, §2.1) es un puerto único (`EmisorFiscal`) con adaptadores intercambiables: simulado,
 * SDK de TypeScript (`@arcasdk/core`), SDK de PHP como apoyo y un proveedor externo. Para poder desenganchar el sistema de cualquier SDK, o delegar todo el
 * proceso a un tercero, el SDK tiene que estar detrás del puerto: nada del dominio, de las acciones ni de las pantallas puede importarlo. Hoy no hay ninguno
 * instalado (0 importadores); la regla deja el lugar reservado y hace que el primero que se instale nazca en el sitio correcto.
 *
 * Qué comprueba (AST, fuera de los comentarios): ningún `import`, `export … from`, `import()` ni `require()` de un paquete de SDK fiscal en `src/` ni en
 * `plataforma/src/`, salvo dentro de `src/server/adaptadores/fiscal/`. La lista de paquetes son los SDK conocidos de ARCA/AFIP; sumar uno es una línea.
 */
const RAIZ = join(__dirname, "../..");
const CARPETA_DE_ADAPTADORES = "src/server/adaptadores/fiscal/";
const PAQUETES_DE_SDK_FISCAL = /^(@arcasdk\/|arcasdk(\/|$)|@afipsdk\/|afip(\.js|\.ts)?(\/|$)|@ramiidv\/|facturajs(\/|$))/;

function modulosImportados(codigo: string, ruta: string): string[] {
  const fuente = ts.createSourceFile(ruta, codigo, ts.ScriptTarget.Latest, true, ruta.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const modulos: string[] = [];
  const visitar = (nodo: ts.Node): void => {
    if ((ts.isImportDeclaration(nodo) || ts.isExportDeclaration(nodo)) && nodo.moduleSpecifier && ts.isStringLiteral(nodo.moduleSpecifier)) modulos.push(nodo.moduleSpecifier.text);
    if (ts.isCallExpression(nodo) && nodo.arguments.length > 0 && ts.isStringLiteralLike(nodo.arguments[0])) {
      const esImportDinamico = nodo.expression.kind === ts.SyntaxKind.ImportKeyword;
      const esRequire = ts.isIdentifier(nodo.expression) && nodo.expression.text === "require";
      if (esImportDinamico || esRequire) modulos.push(nodo.arguments[0].text);
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
  return modulos;
}

function archivosDe(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return nombre === "node_modules" || nombre === ".next" ? [] : archivosDe(ruta);
    return /\.tsx?$/.test(nombre) && !nombre.endsWith(".d.ts") ? [ruta] : [];
  });
}

describe("SDK fiscal solo en adaptadores: el detector ve las violaciones (la regla no puede quedar ciega)", () => {
  const sdk = (codigo: string) => modulosImportados(codigo, "x.ts").filter((m) => PAQUETES_DE_SDK_FISCAL.test(m));

  it("detecta import, reexport, import dinámico y require de un SDK fiscal", () => {
    expect(sdk('import { Arca } from "@arcasdk/core";')).toEqual(["@arcasdk/core"]);
    expect(sdk('import type { X } from "@arcasdk/pdf";')).toEqual(["@arcasdk/pdf"]);
    expect(sdk('export { Arca } from "arcasdk";')).toEqual(["arcasdk"]);
    expect(sdk('export const f = () => import("@afipsdk/afip.js");')).toEqual(["@afipsdk/afip.js"]);
    expect(sdk('const a = require("afip.js");')).toEqual(["afip.js"]);
    expect(sdk('import x from "arcasdk/lib/algo";')).toEqual(["arcasdk/lib/algo"]);
  });

  it("no marca otros paquetes ni nombres parecidos, ni un texto que nombra el SDK", () => {
    expect(sdk('import { z } from "zod";\nimport p from "afipxyz";\nimport o from "./arcasdk-local";')).toEqual([]);
    expect(sdk('// import { Arca } from "@arcasdk/core"\nexport const t = "@arcasdk/core";')).toEqual([]);
  });
});

describe("SDK fiscal solo en adaptadores: el código del repositorio", () => {
  const archivos = ["src", "plataforma/src"].flatMap((c) => archivosDe(join(RAIZ, c)));

  it("encuentra el código de src/ y plataforma/src/ (si deja de encontrarse, la regla quedó vacía)", () => {
    expect(archivos.length).toBeGreaterThan(500);
  });

  it("ningún archivo fuera de src/server/adaptadores/fiscal/ importa un SDK fiscal", () => {
    const violaciones = archivos.flatMap((absoluta) => {
      const ruta = relative(RAIZ, absoluta).split(sep).join("/");
      if (ruta.startsWith(CARPETA_DE_ADAPTADORES)) return [];
      return modulosImportados(readFileSync(absoluta, "utf8"), ruta)
        .filter((m) => PAQUETES_DE_SDK_FISCAL.test(m))
        .map((m) => `${ruta}  importa  ${m}`);
    });
    expect(violaciones, `Un SDK fiscal va detrás del puerto EmisorFiscal: importalo solo desde ${CARPETA_DE_ADAPTADORES}\n${violaciones.join("\n")}`).toEqual([]);
  });
});
