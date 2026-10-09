/**
 * Codemod de imports para las mudanzas de la pureza (D-11 del plan de la Fase 4; trabajo 1.13 de la rama `pureza-integracion`). Versiona el «script de una sola vez» que se usó en las
 * Fases 3 y 4 para reapuntar imports, y que la Fase 6 necesita (161 `vi.mock` de la sesión): mover un archivo, o unas funciones de un archivo a otro, sin tocar a mano cientos de imports.
 *
 * Dos modos:
 *   1. MÓDULO COMPLETO (`--desde` y `--hacia`): todo especificador que resuelva a `--desde` pasa a `--hacia` (imports, `export … from`, `import()` dinámico, `require` y
 *      `vi.mock`/`vi.importActual`/`vi.doMock` con un literal).
 *   2. NOMBRES (`--desde`, `--hacia` y `--nombres a,b`): solo esos nombres se sacan del import de `--desde` y se importan de `--hacia` (el resto sigue donde estaba; se conserva `type`
 *      y los alias `as`). No toca `vi.mock` (un mock de un módulo se reescribe a mano: cambia qué se intercepta).
 *
 * Reconoce los especificadores con alias (`@/core/x`) y relativos, los resuelve contra el archivo que los importa y escribe el nuevo en el MISMO estilo que tenía el original.
 *
 * Uso: `npm run reapuntar:imports -- --desde src/core/a/b.ts --hacia src/server/c/d.ts [--nombres f,g] [--escribir]`
 * Sin `--escribir` solo lista los archivos que cambiaría (simulacro). Recorre `src`, `test`, `scripts` y `plataforma/src`.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

export interface OpcionesDeReapuntado {
  /** Raíz del repositorio (para resolver el alias `@/` → `<raiz>/src/`). */
  raiz: string;
  /** Archivo de origen, relativo a la raíz y con `/` (con o sin extensión). */
  desde: string;
  /** Archivo de destino, ídem. */
  hacia: string;
  /** Si viene, solo esos nombres se reapuntan; si no, el módulo completo. */
  nombres?: readonly string[];
}

const sinExtension = (ruta: string) => ruta.replace(/\.(tsx?|mts|cts)$/, "").replace(/\/index$/, "");
const normalizar = (ruta: string) => ruta.split(sep).join("/");

/** La ruta absoluta (sin extensión) a la que apunta un especificador desde un archivo, o `null` si no es del repositorio (un paquete de `node_modules`). */
export function resolverEspecificador(especificador: string, archivo: string, raiz: string): string | null {
  if (especificador.startsWith("@/")) return normalizar(sinExtension(resolve(raiz, "src", especificador.slice(2))));
  if (especificador.startsWith(".")) return normalizar(sinExtension(resolve(dirname(archivo), especificador)));
  return null;
}

/** El especificador para llegar a `destino` (absoluta, sin extensión) desde `archivo`, en el mismo estilo que `original` (alias o relativo). */
export function escribirEspecificador(destino: string, archivo: string, raiz: string, original: string): string {
  const src = normalizar(resolve(raiz, "src"));
  if (original.startsWith("@/") && destino.startsWith(`${src}/`)) return `@/${destino.slice(src.length + 1)}`;
  const rel = normalizar(relative(dirname(archivo), destino));
  return rel.startsWith(".") ? rel : `./${rel}`;
}

interface Cambio {
  inicio: number;
  fin: number;
  texto: string;
}

/** El código con los imports reapuntados, o `null` si no cambia nada. */
export function reapuntarImports(codigo: string, archivo: string, o: OpcionesDeReapuntado): string | null {
  const desde = normalizar(sinExtension(resolve(o.raiz, o.desde)));
  const hacia = normalizar(sinExtension(resolve(o.raiz, o.hacia)));
  const fuente = ts.createSourceFile(archivo, codigo, ts.ScriptTarget.Latest, true, archivo.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const cambios: Cambio[] = [];
  const apunta = (literal: ts.StringLiteralLike) => resolverEspecificador(literal.text, archivo, o.raiz) === desde;
  const nuevo = (literal: ts.StringLiteralLike) => escribirEspecificador(hacia, archivo, o.raiz, literal.text);
  const comilla = (literal: ts.StringLiteralLike) => (codigo[literal.getStart(fuente)] === "'" ? "'" : '"');
  const reemplazarLiteral = (literal: ts.StringLiteralLike) => cambios.push({ inicio: literal.getStart(fuente), fin: literal.getEnd(), texto: `${comilla(literal)}${nuevo(literal)}${comilla(literal)}` });

  for (const sentencia of fuente.statements) {
    if (ts.isImportDeclaration(sentencia) && ts.isStringLiteral(sentencia.moduleSpecifier) && apunta(sentencia.moduleSpecifier)) {
      if (!o.nombres) {
        reemplazarLiteral(sentencia.moduleSpecifier);
        continue;
      }
      const enlaces = sentencia.importClause?.namedBindings;
      if (!enlaces || !ts.isNamedImports(enlaces)) continue;
      const mover = enlaces.elements.filter((e) => o.nombres!.includes((e.propertyName ?? e.name).text));
      if (mover.length === 0) continue;
      const quedan = enlaces.elements.filter((e) => !mover.includes(e));
      const textoDe = (e: ts.ImportSpecifier) => e.getText(fuente);
      const tipoCompleto = sentencia.importClause?.isTypeOnly ? "type " : "";
      const comillaEsp = comilla(sentencia.moduleSpecifier);
      const nuevaSentencia = `import ${tipoCompleto}{ ${mover.map(textoDe).join(", ")} } from ${comillaEsp}${nuevo(sentencia.moduleSpecifier)}${comillaEsp};`;
      const hayDefecto = !!sentencia.importClause?.name;
      if (quedan.length === 0 && !hayDefecto) {
        cambios.push({ inicio: sentencia.getStart(fuente), fin: sentencia.getEnd(), texto: nuevaSentencia });
      } else {
        const original = `import ${tipoCompleto}${hayDefecto ? `${sentencia.importClause!.name!.text}${quedan.length ? ", " : ""}` : ""}${quedan.length ? `{ ${quedan.map(textoDe).join(", ")} }` : ""} from ${comillaEsp}${sentencia.moduleSpecifier.text}${comillaEsp};`;
        cambios.push({ inicio: sentencia.getStart(fuente), fin: sentencia.getEnd(), texto: `${original}\n${nuevaSentencia}` });
      }
    } else if (!o.nombres && ts.isExportDeclaration(sentencia) && sentencia.moduleSpecifier && ts.isStringLiteral(sentencia.moduleSpecifier) && apunta(sentencia.moduleSpecifier)) {
      reemplazarLiteral(sentencia.moduleSpecifier);
    }
  }

  if (!o.nombres) {
    const visitar = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]) && apunta(n.arguments[0])) {
        const llamado = n.expression;
        const esImportDinamico = llamado.kind === ts.SyntaxKind.ImportKeyword;
        const esRequire = ts.isIdentifier(llamado) && llamado.text === "require";
        const esVi = ts.isPropertyAccessExpression(llamado) && ts.isIdentifier(llamado.expression) && llamado.expression.text === "vi" && ["mock", "doMock", "importActual", "importMock", "unmock", "doUnmock"].includes(llamado.name.text);
        if (esImportDinamico || esRequire || esVi) reemplazarLiteral(n.arguments[0]);
      }
      ts.forEachChild(n, visitar);
    };
    visitar(fuente);
  }

  if (cambios.length === 0) return null;
  let salida = codigo;
  for (const c of [...cambios].sort((a, b) => b.inicio - a.inicio)) salida = salida.slice(0, c.inicio) + c.texto + salida.slice(c.fin);
  return salida === codigo ? null : salida;
}

function archivosDe(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) return nombre === "node_modules" || nombre === ".next" ? [] : archivosDe(ruta);
    return /\.tsx?$/.test(nombre) && !nombre.endsWith(".d.ts") ? [ruta] : [];
  });
}

function argumento(args: string[], nombre: string): string | undefined {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : undefined;
}

/** El punto de entrada del comando. Devuelve los archivos que cambia (o cambiaría, en simulacro). */
export function reapuntar(args: string[], raiz: string): string[] {
  const desde = argumento(args, "--desde");
  const hacia = argumento(args, "--hacia");
  if (!desde || !hacia) throw new Error("Uso: --desde <archivo> --hacia <archivo> [--nombres a,b] [--escribir]");
  const nombres = argumento(args, "--nombres")?.split(",").map((n) => n.trim()).filter(Boolean);
  const escribir = args.includes("--escribir");
  const cambiados: string[] = [];
  for (const carpeta of ["src", "test", "scripts", "plataforma/src"]) {
    for (const archivo of archivosDe(join(raiz, carpeta))) {
      const codigo = readFileSync(archivo, "utf8");
      const nuevo = reapuntarImports(codigo, archivo, { raiz, desde, hacia, nombres });
      if (nuevo === null) continue;
      cambiados.push(normalizar(relative(raiz, archivo)));
      if (escribir) writeFileSync(archivo, nuevo, "utf8");
    }
  }
  return cambiados;
}

if (process.argv[1] && /reapuntar-imports\.ts$/.test(process.argv[1].split(sep).join("/"))) {
  const cambiados = reapuntar(process.argv.slice(2), join(__dirname, "../.."));
  const escribio = process.argv.includes("--escribir");
  console.log(`${escribio ? "Cambió" : "Cambiaría (simulacro; agregá --escribir)"} ${cambiados.length} archivo(s):\n${cambiados.join("\n")}`);
}
