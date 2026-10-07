import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Guardián de `Rol.nivel` (O35-1 de `docs/plan-hito-3-pureza.md` §9; ADR-027, fases F2 y F3). La columna `Rol.nivel` TODAVÍA NO EXISTE (es [MIG], fuera de
 * esta rama y con autorización expresa del dueño), y cuando exista va a ser el dato que decide quién tiene rango 2 («encargado»): escribirla es subir o
 * bajar el rango de todos los que tienen ese rol. Por eso, desde ANTES de que exista, nadie la escribe salvo el caso de uso que F3 cree para cambiar el
 * nivel de un rol (con su acción, su techo, su limpieza de filas y su auditoría), y ese archivo se declara acá, con motivo.
 *
 * Qué mira (AST, los comentarios no cuentan), en `src/`, `plataforma/src/` y `prisma/seed.ts` (este último solo se LEE):
 *  1. Una escritura de Rol (`<algo>.rol.<create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert>(…)`) que lleva la clave `nivel`
 *     en lo que escribe (`data`, o `create`/`update` del upsert, a cualquier profundidad salvo `where`/`select`/`include`/`omit`/`orderBy`), o cuyo
 *     contenido no se puede verificar (un `data` que no es un objeto literal, o con un `...spread`): una escritura de Rol se escribe a la vista.
 *  2. Una escritura ANIDADA de un rol desde otro modelo (`rol: { create: { …, nivel } }`, `roles: { update: … }`) que lleva la clave `nivel`.
 *  3. SQL crudo (cualquier texto o plantilla) que nombra la tabla `"Rol"` y menciona `nivel`.
 *
 * Lista de permitidos VACÍA hasta F3: el caso de uso de cambiar el nivel de un rol la usará (y el test de abajo que la exige vacía se edita a propósito
 * en ese commit).
 */
const RAIZ = join(__dirname, "../..");
const CARPETAS = ["src", "plataforma/src"];
const ARCHIVOS_SUELTOS = ["prisma/seed.ts"];

/** Archivo (relativo a la raíz del repo) → motivo. VACÍA hasta F3. */
const PERMITIDOS: Record<string, string> = {};

const ESCRITURAS = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert"]);
const NO_ESCRIBEN = new Set(["where", "select", "include", "omit", "orderBy"]);
const RELACIONES_DE_ROL = new Set(["rol", "roles"]);

interface Hallazgo {
  linea: number;
  que: string;
}

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

function nombreDe(nombre: ts.PropertyName): string | undefined {
  return ts.isIdentifier(nombre) || ts.isStringLiteral(nombre) ? nombre.text : undefined;
}

/** ¿Este objeto (o arreglo de objetos) escribe la clave `nivel`, a cualquier profundidad, salvo en lo que no se escribe? `"opaco"` si no se puede saber. */
function escribeNivel(expr: ts.Expression, estricto: boolean): "nivel" | "opaco" | null {
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) return escribeNivel(expr.expression, estricto);
  if (ts.isArrayLiteralExpression(expr)) {
    for (const e of expr.elements) {
      const r = escribeNivel(e as ts.Expression, estricto);
      if (r) return r;
    }
    return null;
  }
  if (!ts.isObjectLiteralExpression(expr)) return estricto ? "opaco" : null;
  for (const p of expr.properties) {
    if (ts.isSpreadAssignment(p)) {
      if (estricto) return "opaco";
      continue;
    }
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === "nivel") return "nivel";
    if (!ts.isPropertyAssignment(p)) continue;
    const nombre = nombreDe(p.name);
    if (nombre === "nivel") return "nivel";
    if (nombre && NO_ESCRIBEN.has(nombre)) continue;
    if (ts.isObjectLiteralExpression(p.initializer) || ts.isArrayLiteralExpression(p.initializer)) {
      const r = escribeNivel(p.initializer, false);
      if (r) return r;
    }
  }
  return null;
}

/** El texto de un literal o una plantilla (sin las expresiones interpoladas). */
function textoDe(nodo: ts.Node): string | undefined {
  if (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) return nodo.text;
  if (ts.isTemplateExpression(nodo)) return [nodo.head.text, ...nodo.templateSpans.map((s) => s.literal.text)].join(" ");
  return undefined;
}

/** Los hallazgos de un fuente (los casos sintéticos de abajo lo llaman con un texto, sin leer archivos). */
function analizarNivelDeRol(fuente: string): Hallazgo[] {
  const sf = ts.createSourceFile("x.tsx", fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hallazgos: Hallazgo[] = [];
  const linea = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const texto = (n: ts.Node) => n.getText(sf).replace(/\s+/g, " ").slice(0, 160);

  const visitar = (nodo: ts.Node): void => {
    if (ts.isCallExpression(nodo) && ts.isPropertyAccessExpression(nodo.expression) && ESCRITURAS.has(nodo.expression.name.text)) {
      const modelo = nodo.expression.expression;
      const esDeRol = ts.isPropertyAccessExpression(modelo) && modelo.name.text === "rol";
      const [arg] = nodo.arguments;
      if (esDeRol) {
        // Regla 1: lo que se escribe en el rol, a la vista y sin `nivel`.
        if (!arg || !ts.isObjectLiteralExpression(arg)) {
          hallazgos.push({ linea: linea(nodo), que: `escritura de Rol con un argumento que no se puede verificar: \`${texto(nodo)}\`` });
        } else {
          for (const p of arg.properties) {
            const nombre = ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) ? nombreDe(p.name) : undefined;
            if (!nombre || !["data", "create", "update"].includes(nombre)) continue;
            const valor = ts.isPropertyAssignment(p) ? p.initializer : p.name;
            const r = escribeNivel(valor, true);
            if (r === "nivel") hallazgos.push({ linea: linea(nodo), que: `escritura de Rol.nivel: \`${texto(nodo)}\`` });
            if (r === "opaco") hallazgos.push({ linea: linea(nodo), que: `escritura de Rol cuyo \`${nombre}\` no se puede verificar (no es un objeto literal o tiene un spread): \`${texto(nodo)}\`` });
          }
        }
      } else if (arg && ts.isObjectLiteralExpression(arg)) {
        // Regla 2: una escritura anidada de un rol desde otro modelo.
        const buscar = (n: ts.Node): void => {
          if (ts.isPropertyAssignment(n)) {
            const nombre = nombreDe(n.name);
            if (nombre && NO_ESCRIBEN.has(nombre)) return;
            if (nombre && RELACIONES_DE_ROL.has(nombre) && escribeNivel(n.initializer, false) === "nivel") {
              hallazgos.push({ linea: linea(n), que: `escritura anidada de Rol.nivel: \`${texto(n)}\`` });
              return;
            }
          }
          ts.forEachChild(n, buscar);
        };
        buscar(arg);
      }
    }
    // Regla 3: SQL crudo sobre la tabla "Rol" que menciona nivel.
    const t = textoDe(nodo);
    if (t !== undefined && /"Rol"/.test(t) && /\bnivel\b/i.test(t)) {
      hallazgos.push({ linea: linea(nodo), que: `SQL crudo sobre "Rol" que menciona nivel: \`${texto(nodo)}\`` });
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(sf);
  return hallazgos;
}

const nombreRelativo = (ruta: string) => relative(RAIZ, ruta).split(sep).join("/");
const RUTAS = [...CARPETAS.flatMap((c) => archivos(join(RAIZ, c))), ...ARCHIVOS_SUELTOS.map((a) => join(RAIZ, a))];

describe("Rol.nivel: nadie lo escribe salvo el caso de uso de cambiar el nivel (F3); hoy, nadie", () => {
  it("recorre src/, plataforma/src/ y prisma/seed.ts", () => {
    expect(RUTAS.length).toBeGreaterThan(300);
    expect(RUTAS.map(nombreRelativo)).toContain("prisma/seed.ts");
    expect(RUTAS.some((r) => nombreRelativo(r).startsWith("plataforma/src/"))).toBe(true);
  });

  it("ninguna escritura de Rol lleva `nivel` (ni directa, ni anidada, ni por SQL crudo) fuera de los permitidos", () => {
    const problemas = RUTAS.filter((r) => !(nombreRelativo(r) in PERMITIDOS)).flatMap((r) =>
      analizarNivelDeRol(readFileSync(r, "utf8")).map((h) => `${nombreRelativo(r)}:${h.linea}  ${h.que}`),
    );
    expect(problemas, `Escrituras de Rol.nivel fuera del caso de uso de cambiar el nivel:\n${problemas.join("\n")}\n`).toEqual([]);
  });

  it("la lista de permitidos está VACÍA hasta F3 (el commit que cree el caso de uso de cambiar el nivel la edita a propósito), y lo que liste existe", () => {
    expect(Object.keys(PERMITIDOS)).toEqual([]);
    for (const archivo of Object.keys(PERMITIDOS)) expect(existsSync(join(RAIZ, archivo)), archivo).toBe(true);
  });
});

describe("el analizador de Rol.nivel detecta lo que dice detectar", () => {
  const cuenta = (fuente: string) => analizarNivelDeRol(fuente).length;

  it("una escritura directa de Rol con `nivel`, de cualquier forma", () => {
    expect(cuenta(`await tx.rol.update({ where, data: { nivel: "administrador" } });`)).toBe(1);
    expect(cuenta(`await db.rol.create({ data: { nombre, nivel } });`)).toBe(1);
    expect(cuenta(`await tx.rol.updateMany({ where: { clave: null }, data: { activo: true, nivel: x } });`)).toBe(1);
    expect(cuenta(`await tx.rol.upsert({ where, create: { nombre: "a", nivel: n }, update: {} });`)).toBe(1);
    expect(cuenta(`await tx.rol.createMany({ data: [{ nombre: "a" }, { nombre: "b", "nivel": "operario" }] });`)).toBe(1);
  });

  it("una escritura de Rol que no se puede verificar (data opaco o con spread)", () => {
    expect(cuenta(`await tx.rol.update({ where, data: cambios });`)).toBe(1);
    expect(cuenta(`await tx.rol.update({ where, data: { nombre, ...resto } });`)).toBe(1);
    expect(cuenta(`await tx.rol.update(argumentos);`)).toBe(1);
  });

  it("una escritura anidada de un rol desde otro modelo", () => {
    expect(cuenta(`await tx.usuarioSucursal.create({ data: { usuarioId, rol: { create: { nombre: "x", nivel: "administrador" } } } });`)).toBe(1);
    expect(cuenta(`await tx.empresa.update({ where, data: { roles: { updateMany: { where: {}, data: { nivel: "operario" } } } } });`)).toBe(1);
  });

  it("SQL crudo sobre \"Rol\" que menciona nivel", () => {
    expect(cuenta('await tx.$executeRaw`UPDATE "Rol" SET nivel = ${n} WHERE id = ${id}`;')).toBe(1);
    expect(cuenta(`await tx.$executeRawUnsafe('UPDATE "Rol" SET "nivel" = $1', n);`)).toBe(1);
  });

  it("no confunde: escrituras de Rol sin nivel, leer nivel, el nivel de otra cosa, SQL de Rol sin nivel, comentarios y la auditoría", () => {
    expect(cuenta(`await tx.rol.create({ data: { nombre: entrada.nombre } }); await tx.rol.update({ where: { id }, data: { activo } });`)).toBe(0);
    expect(cuenta(`await tx.rol.update({ where: { id, nivel: "operario" }, data: { nombre }, select: { nivel: true } });`)).toBe(0);
    expect(cuenta(`await tx.rol.findMany({ where: { nivel: "administrador" } }); const nivel = nivelMinimoDeAccion(a);`)).toBe(0);
    expect(cuenta(`await tx.alerta.update({ where, data: { nivel: 3 } }); await tx.usuarioSucursal.create({ data: { rolId, nivel: 1 } });`)).toBe(0);
    expect(cuenta('await tx.$queryRaw`SELECT id FROM "Rol" WHERE clave = ${c}`;')).toBe(0);
    expect(cuenta(`// tx.rol.update({ data: { nivel: "administrador" } })\nconst t = 1;`)).toBe(0);
    expect(cuenta(`await registrarCambioAuditado(tx, { entidad: "Rol", campo: "nivel", valorNuevo: "administrador" });`)).toBe(0);
  });
});
