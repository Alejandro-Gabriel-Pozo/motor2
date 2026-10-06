/**
 * Analizador de pureza de UN archivo fuente (Fase 0 del plan de pureza, PR 0.1: docs/linea-de-base-pureza-2026-10-06.md).
 *
 * Lee el código con la API del compilador de TypeScript (AST, no texto plano) y devuelve las SEÑALES de impureza de ese archivo y su
 * nivel de pureza. No importa nada de `src/` ni toca la base: es una función pura sobre un texto, así la usan igual el inventario
 * (`scripts/arquitectura/inventario.ts`) y los tests (y, cuando se activen, las reglas de pureza por carpeta).
 *
 * Niveles (los del informe de auditoría, `auditoria-pureza-fronteras-y-escalado-motor2.md`, D1):
 *   P0  puro: ni valores externos al dominio, ni reloj, azar, entorno, red, disco o base.
 *   P1  puro salvo TIPOS de Prisma (`import type`), que no existen en ejecución.
 *   P2  usa valores de Prisma (p. ej. `Prisma.Decimal`), el reloj, el azar o el entorno: no hace I/O, pero no es determinista o está atado al ORM.
 *   P3  consulta o escribe la base, usa red o disco, o importa el cliente (`lib/db`, `core/auth/base`).
 *   P4  depende del servidor o del framework (`server-only`, `react`, `next/*`).
 *
 * Es una aproximación SINTÁCTICA (sin el verificador de tipos): un import «de valor» solo cuenta como valor si el nombre se usa fuera de
 * posiciones de tipo. No sigue imports transitivos (de eso se ocupa dependency-cruiser) ni detecta accesos a la base hechos por una
 * variable que no se llame como un modelo de `prisma/schema.prisma`.
 */
import ts from "typescript";

export type NivelDePureza = "P0" | "P1" | "P2" | "P3" | "P4";

export interface SenalesDeFuente {
  /** Módulos importados como valor Y usados como valor (incluye `import "x"` de efecto y reexportaciones). */
  importsDeValor: string[];
  /** Módulos importados solo como tipo (o como valor declarado pero usado solo en posiciones de tipo). */
  importsDeTipo: string[];
  prismaDeValor: boolean;
  prismaDeTipo: boolean;
  serverOnly: boolean;
  reactONext: boolean;
  /** Importa el cliente de base (`lib/db`) o la fábrica de bases por empresa (`core/auth/base`) como valor. */
  importaCliente: boolean;
  /** Llamadas de lectura sobre un modelo (`x.producto.findMany`) o SQL crudo de lectura. */
  leeLaBase: boolean;
  /** Llamadas de escritura sobre un modelo, `$executeRaw*` o `$transaction`. */
  escribeEnLaBase: boolean;
  reloj: boolean;
  azar: boolean;
  entorno: boolean;
  red: boolean;
  disco: boolean;
}

const OPERACIONES_DE_LECTURA = new Set([
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);
const OPERACIONES_DE_ESCRITURA = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "upsert", "delete", "deleteMany"]);
const SQL_CRUDO_DE_LECTURA = new Set(["$queryRaw", "$queryRawUnsafe"]);
const SQL_CRUDO_DE_ESCRITURA = new Set(["$executeRaw", "$executeRawUnsafe", "$transaction"]);
const FUNCIONES_DE_AZAR = new Set(["randomUUID", "randomBytes", "randomInt", "getRandomValues"]);

/** Nombres de los delegados de Prisma (`producto`, `movimientoStock`…) a partir de los `model X {` de `prisma/schema.prisma`. */
export function delegadosDeModelos(schemaPrisma: string): Set<string> {
  const delegados = new Set<string>();
  for (const m of schemaPrisma.matchAll(/^model\s+(\w+)\s*\{/gm)) {
    const nombre = m[1];
    delegados.add(nombre.charAt(0).toLowerCase() + nombre.slice(1));
  }
  return delegados;
}

const esModuloPrisma = (modulo: string) => modulo.startsWith("@prisma/client") || modulo.endsWith("/lib/db-tipos");
const esModuloDeCliente = (modulo: string) => /(^|\/)lib\/db$/.test(modulo) || /(^|\/)core\/auth\/base$/.test(modulo);
const esModuloReactONext = (modulo: string) => /^(next|react|react-dom)(\/|$)/.test(modulo);
const esModuloDeDisco = (modulo: string) => /^(node:)?fs(\/promises)?$/.test(modulo);

function estaEnPosicionDeTipo(nodo: ts.Node): boolean {
  for (let padre = nodo.parent; padre; padre = padre.parent) {
    if (ts.isTypeNode(padre)) return true;
    if (ts.isStatement(padre)) return false;
  }
  return false;
}

function esNombreNoReferencia(id: ts.Identifier): boolean {
  const padre = id.parent;
  if (ts.isPropertyAccessExpression(padre) && padre.name === id) return true;
  if ((ts.isPropertyAssignment(padre) || ts.isPropertyDeclaration(padre) || ts.isMethodDeclaration(padre) || ts.isPropertySignature(padre)) && padre.name === id) {
    return true;
  }
  if (ts.isBindingElement(padre) && padre.propertyName === id) return true;
  if (ts.isQualifiedName(padre) && padre.right === id) return true;
  return false;
}

export interface LlamadaALaBase {
  clase: "lectura" | "escritura";
  /** `producto.findMany`, `$queryRaw`, `$transaction`… */
  nombre: string;
  linea: number;
}

function encontrarLlamadasALaBase(archivo: ts.SourceFile, delegados: ReadonlySet<string>): LlamadaALaBase[] {
  const llamadas: LlamadaALaBase[] = [];
  const linea = (nodo: ts.Node) => archivo.getLineAndCharacterOfPosition(nodo.getStart(archivo)).line + 1;
  const sqlCrudo = (nodo: ts.Node, nombre: string) => {
    if (SQL_CRUDO_DE_LECTURA.has(nombre)) llamadas.push({ clase: "lectura", nombre, linea: linea(nodo) });
    if (SQL_CRUDO_DE_ESCRITURA.has(nombre)) llamadas.push({ clase: "escritura", nombre, linea: linea(nodo) });
  };
  const visitar = (nodo: ts.Node): void => {
    if (ts.isCallExpression(nodo) && ts.isPropertyAccessExpression(nodo.expression)) {
      const operacion = nodo.expression.name.text;
      const dueño = nodo.expression.expression;
      if (ts.isPropertyAccessExpression(dueño) && delegados.has(dueño.name.text)) {
        const nombre = `${dueño.name.text}.${operacion}`;
        if (OPERACIONES_DE_LECTURA.has(operacion)) llamadas.push({ clase: "lectura", nombre, linea: linea(nodo) });
        if (OPERACIONES_DE_ESCRITURA.has(operacion)) llamadas.push({ clase: "escritura", nombre, linea: linea(nodo) });
      }
      sqlCrudo(nodo, operacion);
    }
    // SQL crudo con plantilla etiquetada: db.$queryRaw`select …` (no es una CallExpression).
    if (ts.isTaggedTemplateExpression(nodo) && ts.isPropertyAccessExpression(nodo.tag)) sqlCrudo(nodo, nodo.tag.name.text);
    ts.forEachChild(nodo, visitar);
  };
  visitar(archivo);
  return llamadas;
}

/**
 * Las llamadas a la base de un archivo: `x.<modelo>.<operación>` (el modelo sale de `delegadosDeModelos`) y el SQL crudo
 * (`$queryRaw*`, `$executeRaw*`, `$transaction`, por llamada o por plantilla etiquetada). Es la fuente única de «esto toca la base»:
 * la usan el inventario de pureza y las reglas de arquitectura (consultas solo de lectura, UI sin acceso a la base).
 */
export function llamadasALaBase(codigo: string, ruta: string, delegados: ReadonlySet<string>): LlamadaALaBase[] {
  const archivo = ts.createSourceFile(ruta, codigo, ts.ScriptTarget.Latest, true, ruta.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  return encontrarLlamadasALaBase(archivo, delegados);
}

export function analizarFuente(codigo: string, ruta: string, delegados: ReadonlySet<string>): SenalesDeFuente {
  const tsx = ruta.endsWith(".tsx");
  const archivo = ts.createSourceFile(ruta, codigo, ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  // 1) Imports declarados: módulo → nombres locales que se importan como valor (vacío = solo tipo).
  const declaradosComoValor: { modulo: string; nombres: Set<string> }[] = [];
  const soloTipo = new Set<string>();
  const valorDeEfecto = new Set<string>();
  for (const sentencia of archivo.statements) {
    if (ts.isImportDeclaration(sentencia) && ts.isStringLiteral(sentencia.moduleSpecifier)) {
      const modulo = sentencia.moduleSpecifier.text;
      const clausula = sentencia.importClause;
      if (!clausula) {
        valorDeEfecto.add(modulo);
        continue;
      }
      if (clausula.isTypeOnly) {
        soloTipo.add(modulo);
        continue;
      }
      const nombres = new Set<string>();
      if (clausula.name) nombres.add(clausula.name.text);
      const enlaces = clausula.namedBindings;
      if (enlaces && ts.isNamespaceImport(enlaces)) nombres.add(enlaces.name.text);
      if (enlaces && ts.isNamedImports(enlaces)) {
        for (const e of enlaces.elements) if (!e.isTypeOnly) nombres.add(e.name.text);
      }
      if (nombres.size === 0) soloTipo.add(modulo);
      else declaradosComoValor.push({ modulo, nombres });
    } else if (ts.isExportDeclaration(sentencia) && sentencia.moduleSpecifier && ts.isStringLiteral(sentencia.moduleSpecifier)) {
      if (sentencia.isTypeOnly) soloTipo.add(sentencia.moduleSpecifier.text);
      else valorDeEfecto.add(sentencia.moduleSpecifier.text);
    }
  }

  // 2) Qué nombres importados se usan como valor, y las señales de impureza (un solo recorrido del AST).
  const usadosComoValor = new Set<string>();
  let reloj = false;
  let azar = false;
  let entorno = false;
  let red = false;

  const visitar = (nodo: ts.Node): void => {
    if (ts.isImportDeclaration(nodo)) return;
    if (ts.isIdentifier(nodo) && !esNombreNoReferencia(nodo) && !estaEnPosicionDeTipo(nodo)) usadosComoValor.add(nodo.text);

    if (ts.isCallExpression(nodo)) {
      const llamada = nodo.expression;
      if (ts.isPropertyAccessExpression(llamada)) {
        const operacion = llamada.name.text;
        const dueño = llamada.expression;
        if (ts.isIdentifier(dueño) && dueño.text === "Date" && operacion === "now") reloj = true;
        if (ts.isIdentifier(dueño) && dueño.text === "Math" && operacion === "random") azar = true;
        if (FUNCIONES_DE_AZAR.has(operacion)) azar = true;
      } else if (ts.isIdentifier(llamada)) {
        if (llamada.text === "fetch") red = true;
        if (FUNCIONES_DE_AZAR.has(llamada.text)) azar = true;
      }
    }
    if (ts.isNewExpression(nodo) && ts.isIdentifier(nodo.expression) && nodo.expression.text === "Date" && (nodo.arguments?.length ?? 0) === 0) reloj = true;
    if (ts.isPropertyAccessExpression(nodo) && ts.isIdentifier(nodo.expression) && nodo.expression.text === "process" && nodo.name.text === "env") entorno = true;

    ts.forEachChild(nodo, visitar);
  };
  visitar(archivo);
  const llamadasALaBase = encontrarLlamadasALaBase(archivo, delegados);
  const leeLaBase = llamadasALaBase.some((l) => l.clase === "lectura");
  const escribeEnLaBase = llamadasALaBase.some((l) => l.clase === "escritura");

  // 3) Resolver cuáles imports declarados como valor lo son de verdad.
  const importsDeValor = new Set<string>(valorDeEfecto);
  const importsDeTipo = new Set<string>(soloTipo);
  for (const { modulo, nombres } of declaradosComoValor) {
    const seUsa = [...nombres].some((n) => usadosComoValor.has(n));
    if (seUsa) importsDeValor.add(modulo);
    else importsDeTipo.add(modulo);
  }

  const valores = [...importsDeValor];
  const tipos = [...importsDeTipo].filter((m) => !importsDeValor.has(m));
  return {
    importsDeValor: valores.sort(),
    importsDeTipo: tipos.sort(),
    prismaDeValor: valores.some(esModuloPrisma),
    prismaDeTipo: tipos.some(esModuloPrisma),
    serverOnly: importsDeValor.has("server-only"),
    reactONext: valores.some(esModuloReactONext),
    importaCliente: valores.some(esModuloDeCliente),
    leeLaBase,
    escribeEnLaBase,
    reloj,
    azar,
    entorno,
    red,
    disco: valores.some(esModuloDeDisco),
  };
}

export function nivelDePureza(s: SenalesDeFuente): NivelDePureza {
  if (s.serverOnly || s.reactONext) return "P4";
  if (s.importaCliente || s.leeLaBase || s.escribeEnLaBase || s.red || s.disco) return "P3";
  if (s.prismaDeValor || s.reloj || s.azar || s.entorno) return "P2";
  if (s.prismaDeTipo) return "P1";
  return "P0";
}

/** Capa de un archivo según su ruta (relativa a la raíz del repo, con `/`). El orden importa: la primera que coincide gana. */
export function capaDeArchivo(ruta: string): string {
  const reglas: [RegExp, string][] = [
    [/^src\/server\/actions\/[^/]+\/casos-de-uso\//, "server/casos-de-uso"],
    [/^src\/server\/actions\//, "server/actions"],
    [/^src\/server\/consultas\//, "server/consultas"],
    [/^src\/server\/persistencia\//, "server/persistencia"],
    [/^src\/core\/features\//, "core/features"],
    [/^src\/core\//, "core"],
    [/^src\/app\//, "app"],
    [/^src\/components\//, "components"],
    [/^src\/lib\//, "lib"],
    [/^plataforma\/src\/app\//, "plataforma/app"],
    [/^plataforma\/src\/servidor\//, "plataforma/servidor"],
  ];
  return reglas.find(([patron]) => patron.test(ruta))?.[1] ?? "otros";
}
