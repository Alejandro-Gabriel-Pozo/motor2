import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Candado de «el acceso lo decide SOLO el guard» (ADR-011, nota de dependencias §11). Cada acción declara su `modulo`, `contexto`, `nivelMinimo`
 * y `rolesEditarSemilla` en `src/core/permisos/acciones.ts`, y quien evalúa módulo → capacidad → rol es `conPermiso*` / `requierePermiso*`.
 * Fuera de `src/core/permisos/` nada decide el acceso por su cuenta; si no, una pantalla con un `if (rol === "admin")` abre o cierra cosas
 * por una regla que la matriz de permisos, el menú y la consola de plataforma no ven.
 *
 *  1. Comparación de rol o de nivel (`rol === "admin"`, `ctx.rolNombre !== …`, `nivelMinimoDeAccion(x) === "gerente"`).
 *  2. Lectura directa del registro de módulos (el modelo `ModuloEmpresa`, o `modulosEfectivos` de `core/modulos/clausura`).
 *  3. Evaluar a mano lo que el guard ya evalúa: `esGerenteDeEmpresa` (el piso gerente) y leer `PermisoRol` / `CapacidadSucursal`.
 *
 * Una excepción es un archivo con su motivo, y se discute antes de agregarla. La regla 3 es una aproximación estática: no puede probar que
 * ninguna otra decisión de acceso exista, solo cierra las formas concretas de saltearse el guard que hoy existen.
 */
const RAIZ = join(__dirname, "../../src");

const ROLES = new Set(["admin", "operador", "gerente", "operario", "administrador"]);
const PROPIEDADES_DE_ROL = new Set(["rol", "rolNombre", "rolEmpresa", "nivel", "nivelMinimo"]);
const FUNCIONES_DE_NIVEL = new Set(["nivelMinimoDeAccion", "nivelDeRolPorClave", "nivelesDeLaCelda"]);
const MODELOS_DE_ACCESO = new Set(["permisoRol", "capacidadSucursal"]);

/** Dónde vive el guard (no se analiza) y, para la regla 2, el módulo que implementa el registro. */
const CARPETA_DEL_GUARD = "core/permisos/";
const CARPETA_DEL_REGISTRO = "core/modulos/";

interface Excepcion {
  /** `permanente`: el archivo administra o muestra la matriz, no decide acceso. `deuda`: se elimina en el bloque G (rol por clave técnica). */
  tipo: "permanente" | "deuda";
  motivo: string;
  /** Hallazgos EXACTOS (reglas 1 y 3). Uno más rompe el test; uno menos también: la deuda que se paga se baja acá a propósito. */
  esperados: number;
}

/** Archivo → excepción. Regla 1 y 3. Ninguna se agrega ni se sube de cantidad sin que el dueño la vea. */
const EXCEPCIONES_DE_ROL_Y_GUARD: Record<string, Excepcion> = {
  "server/actions/permisos/permisos.ts": { tipo: "permanente", motivo: "administra la matriz de permisos (PermisoRol): es su trabajo.", esperados: 3 },
  "server/actions/permisos/capacidades-sucursal.ts": { tipo: "permanente", motivo: "administra las capacidades por sucursal (CapacidadSucursal): es su trabajo.", esperados: 4 },
  "core/features/empresa/sembrar-empresa.ts": { tipo: "permanente", motivo: "siembra los roles de sistema (con su clave técnica) y la matriz de permisos al crear la empresa.", esperados: 5 },
  "core/auth/bootstrap.ts": { tipo: "permanente", motivo: "da el primer admin de una empresa nueva: es quien identifica el rol por su clave al arrancar.", esperados: 2 },
  "core/auth/contexto.ts": { tipo: "permanente", motivo: "arma el contexto de la sesión: marca cada membresía como admin o no por la clave de su rol, una sola vez, para que nadie más lo calcule.", esperados: 2 },
  "app/(app)/administracion/permisos/permisos-matriz.tsx": { tipo: "permanente", motivo: "solo MUESTRA la columna «Piso» de la matriz; no decide acceso.", esperados: 1 },
};
/** Archivo → motivo. Regla 2: la consola de plataforma muestra el estado de los módulos de cada empresa; se declara acá cuando exista. */
const EXCEPCIONES_DEL_REGISTRO_DE_MODULOS: Record<string, string> = {
  "core/features/empresa/cambiar-modulos-de-empresa.ts": "es QUIEN ESCRIBE el registro, y solo lo llama scripts/modulos-empresa.ts (regla `modulos-solo-desde-plataforma` de dependency-cruiser); no decide acceso.",
};

export interface Hallazgo {
  regla: 1 | 2 | 3 | 4;
  linea: number;
  que: string;
}

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

function nombreDePropiedad(nodo: ts.Node): string | undefined {
  if (ts.isIdentifier(nodo)) return nodo.text;
  if (ts.isPropertyAccessExpression(nodo)) return nodo.name.text;
  if (ts.isNonNullExpression(nodo) || ts.isParenthesizedExpression(nodo)) return nombreDePropiedad(nodo.expression);
  return undefined;
}

/** `rol.nombre`, `m.rol.nombre`: el nombre del rol de alguien. */
function esNombreDeRol(nodo: ts.Node): boolean {
  return ts.isPropertyAccessExpression(nodo) && nodo.name.text === "nombre" && nombreDePropiedad(nodo.expression) === "rol";
}

function esRolOLNivel(nodo: ts.Node): boolean {
  const sinOpcional = ts.isNonNullExpression(nodo) || ts.isParenthesizedExpression(nodo) ? nodo.expression : nodo;
  if (esNombreDeRol(sinOpcional)) return true;
  const nombre = nombreDePropiedad(sinOpcional);
  if (nombre && PROPIEDADES_DE_ROL.has(nombre)) return true;
  if (ts.isCallExpression(sinOpcional)) {
    const f = nombreDePropiedad(sinOpcional.expression);
    return f !== undefined && FUNCIONES_DE_NIVEL.has(f);
  }
  return false;
}

const esLiteralDeRol = (nodo: ts.Node) => ts.isStringLiteralLike(nodo) && ROLES.has(nodo.text);

/** Los hallazgos de las cuatro reglas en un fuente. Los comentarios no cuentan: se analiza el AST. */
export function analizarAcceso(fuente: string): Hallazgo[] {
  const sf = ts.createSourceFile("x.tsx", fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hallazgos: Hallazgo[] = [];
  const linea = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const visitar = (nodo: ts.Node): void => {
    if (ts.isBinaryExpression(nodo) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(nodo.operatorToken.kind)) {
      const { left, right } = nodo;
      if (esLiteralDeRol(left) || esLiteralDeRol(right) || esRolOLNivel(left) || esRolOLNivel(right)) {
        hallazgos.push({ regla: 1, linea: linea(nodo), que: `comparación de rol o de nivel: \`${nodo.getText(sf).replace(/\s+/g, " ")}\`` });
      }
    }
    if (ts.isIdentifier(nodo) && (nodo.text === "ModuloEmpresa" || nodo.text === "moduloEmpresa")) {
      hallazgos.push({ regla: 2, linea: linea(nodo), que: `lectura directa del registro de módulos (\`${nodo.text}\`)` });
    }
    if (ts.isImportDeclaration(nodo) && ts.isStringLiteral(nodo.moduleSpecifier) && /(^|\/)modulos\/clausura$/.test(nodo.moduleSpecifier.text)) {
      hallazgos.push({ regla: 2, linea: linea(nodo), que: `lectura directa de los módulos activos (import de \`${nodo.moduleSpecifier.text}\`)` });
    }
    if (ts.isCallExpression(nodo) && nombreDePropiedad(nodo.expression) === "esGerenteDeEmpresa") {
      hallazgos.push({ regla: 3, linea: linea(nodo), que: "piso gerente evaluado a mano (`esGerenteDeEmpresa`)" });
    }
    // `db.permisoRol.findMany(...)`: lectura o escritura directa de la matriz de permisos / capacidades.
    if (ts.isPropertyAccessExpression(nodo) && MODELOS_DE_ACCESO.has(nodo.name.text) && ts.isPropertyAccessExpression(nodo.parent) && nodo.parent.expression === nodo) {
      hallazgos.push({ regla: 3, linea: linea(nodo), que: `matriz de acceso leída a mano (\`${nodo.name.text}\`)` });
    }
    // Regla 4 (bloque G): qué rol es cada uno se sabe por la CLAVE técnica y solo core/permisos la lee; fuera de ahí, ni la clave ni el nombre de un rol de sistema.
    if (ts.isIdentifier(nodo) && CLAVES_DE_ROL.has(nodo.text) && !ts.isImportSpecifier(nodo.parent)) {
      hallazgos.push({ regla: 4, linea: linea(nodo), que: `clave técnica de rol leída fuera de core/permisos (\`${nodo.text}\`)` });
    }
    if (ts.isPropertyAssignment(nodo) && nombreDePropiedad(nodo.name) === "nombre" && esLiteralDeRol(nodo.initializer)) {
      hallazgos.push({ regla: 4, linea: linea(nodo), que: `rol buscado o creado por su nombre: \`${nodo.getText(sf).replace(/\s+/g, " ")}\`` });
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(sf);
  return hallazgos;
}

const CLAVES_DE_ROL = new Set(["CLAVE_ROL_ADMIN", "CLAVE_ROL_OPERADOR", "esRolAdmin"]);

const SUGERENCIA: Record<Hallazgo["regla"], string> = {
  1: "El acceso lo decide el guard: declará `contexto` / `nivelMinimo` / `rolesEditarSemilla` en la acción (src/core/permisos/acciones.ts) y protegé con `conPermiso*` (acciones) o `requierePermisoVer*` (páginas). Para mostrar u ocultar controles, `obtenerMiNivelPermiso*`.",
  2: "El módulo se declara en la acción (`modulo` en src/core/permisos/acciones.ts) y lo evalúa solo el guard. Solo la consola de plataforma puede leer el registro (EXCEPCIONES_DEL_REGISTRO_DE_MODULOS, con motivo).",
  4: "Preguntá a core/permisos (`gestion-de-usuarios`, `invariantes`, `jerarquia`): el rol se identifica por su clave técnica y el nombre se puede cambiar. No lo busques ni lo compares por nombre desde acá.",
  3: "Evaluá con `conPermiso*` / `requierePermiso*`; una acción de piso gerente se declara con `nivelMinimo: \"gerente\"` y el guard la resuelve.",
};

function formatear(archivo: string, h: Hallazgo): string {
  return `${archivo}:${h.linea}  [regla ${h.regla}] ${h.que}\n      → ${SUGERENCIA[h.regla]}`;
}

const nombreDe = (ruta: string) => relative(RAIZ, ruta).split(sep).join("/");
const rutas = archivos(RAIZ).filter((r) => !nombreDe(r).startsWith(CARPETA_DEL_GUARD));

function hallazgosDe(ruta: string): Hallazgo[] {
  const nombre = nombreDe(ruta);
  return analizarAcceso(readFileSync(ruta, "utf8")).filter((h) => !(h.regla === 2 && (nombre.startsWith(CARPETA_DEL_REGISTRO) || nombre in EXCEPCIONES_DEL_REGISTRO_DE_MODULOS)));
}

/** Los problemas de un archivo: sin excepción, todo hallazgo; con excepción, solo si la cantidad no es la declarada. */
function problemasDe(nombre: string, hallazgos: Hallazgo[]): string[] {
  const excepcion = EXCEPCIONES_DE_ROL_Y_GUARD[nombre];
  if (!excepcion) return hallazgos.map((h) => formatear(nombre, h));
  const propios = hallazgos.filter((h) => h.regla !== 2);
  const registro = hallazgos.filter((h) => h.regla === 2).map((h) => formatear(nombre, h));
  if (propios.length === excepcion.esperados) return registro;
  const detalle = propios.map((h) => formatear(nombre, h));
  return [
    `${nombre}: tiene ${propios.length} hallazgos y la excepción (${excepcion.tipo}) declara ${excepcion.esperados}. ${
      propios.length > excepcion.esperados ? "Hay decisiones de acceso NUEVAS: pasalas por el guard." : "Se pagó deuda: bajá `esperados` (o borrá la excepción si quedó en 0)."
    }`,
    ...detalle,
    ...registro,
  ];
}

describe("acceso: fuera de core/permisos nada decide el acceso por su cuenta", () => {
  it("encuentra archivos de src/", () => {
    expect(rutas.length).toBeGreaterThan(200);
  });

  it("ningún archivo compara roles o niveles, lee el registro de módulos ni evalúa a mano lo que el guard evalúa", () => {
    const problemas = rutas.flatMap((ruta) => problemasDe(nombreDe(ruta), hallazgosDe(ruta)));
    expect(problemas, `Decisiones de acceso fuera del guard:\n${problemas.join("\n")}\n`).toEqual([]);
  });

  it("toda excepción declarada apunta a un archivo que existe y con cantidad esperada positiva", () => {
    for (const nombre of [...Object.keys(EXCEPCIONES_DE_ROL_Y_GUARD), ...Object.keys(EXCEPCIONES_DEL_REGISTRO_DE_MODULOS)]) {
      expect(existsSync(join(RAIZ, nombre)), `La excepción ${nombre} no existe: borrala`).toBe(true);
    }
    for (const [nombre, e] of Object.entries(EXCEPCIONES_DE_ROL_Y_GUARD)) {
      expect(e.esperados, `La excepción ${nombre} quedó en 0: borrala`).toBeGreaterThan(0);
    }
  });

  it("la deuda del bloque G está pagada: ninguna excepción es de deuda", () => {
    const deuda = Object.entries(EXCEPCIONES_DE_ROL_Y_GUARD).filter(([, e]) => e.tipo === "deuda");
    expect(deuda.map(([n]) => n)).toEqual([]);
  });
});

describe("el analizador de acceso detecta lo que dice detectar", () => {
  const reglas = (fuente: string) => analizarAcceso(fuente).map((h) => h.regla);

  it("regla 1: compara roles y niveles, de cualquier lado y con == o ===", () => {
    expect(reglas(`if (rol === "admin") {}`)).toEqual([1]);
    expect(reglas(`if ("gerente" !== x) {}`)).toEqual([1]);
    expect(reglas(`if (ctx.rolNombre !== usuario) {}`)).toEqual([1]);
    expect(reglas(`if (m.rol.nombre === otro) {}`)).toEqual([1]);
    expect(reglas(`if (nivelMinimoDeAccion(a.clave) !== "operario") {}`)).toEqual([1]);
    expect(reglas(`const ok = ctx.rolEmpresa == null;`)).toEqual([1]);
  });

  it("regla 1: ignora comentarios, textos y comparaciones que no son de rol", () => {
    expect(reglas(`// if (rol === "admin")\nconst a = "rol === admin"; if (x === 3 && estado === "activo") {}`)).toEqual([]);
  });

  it("regla 2: el registro de módulos y los módulos activos", () => {
    expect(reglas(`const m = await db.moduloEmpresa.findMany();`)).toEqual([2]);
    expect(reglas(`import { modulosEfectivos } from "@/core/modulos/clausura";`)).toEqual([2]);
    expect(reglas(`import { MODULOS } from "@/core/modulos/catalogo";`)).toEqual([]);
  });

  it("regla 3: piso gerente a mano y matriz de acceso leída a mano", () => {
    expect(reglas(`if (!esGerenteDeEmpresa(ctx.rolEmpresa)) {}`)).toEqual([3]);
    expect(reglas(`await ctx.db.permisoRol.findMany();`)).toEqual([3]);
    expect(reglas(`await tx.capacidadSucursal.update({});`)).toEqual([3]);
  });

  it("regla 4: la clave técnica de un rol y el rol de sistema buscado por nombre", () => {
    expect(reglas(`const r = await db.rol.findFirst({ where: { clave: CLAVE_ROL_ADMIN } });`)).toEqual([4]);
    expect(reglas(`if (esRolAdmin(m.rol)) {}`)).toEqual([4]);
    expect(reglas(`await db.rol.findFirst({ where: { empresaId, nombre: "admin" } });`)).toEqual([4]);
    expect(reglas(`import { CLAVE_ROL_ADMIN } from "@/core/permisos/jerarquia";`)).toEqual([]);
    expect(reglas(`await db.rol.create({ data: { nombre: "cajero" } });`)).toEqual([]);
  });

  it("una excepción con cantidad declarada falla si aparece un hallazgo más o si se paga deuda sin bajarla", () => {
    const uno = analizarAcceso(`if (rol === "admin") {}`);
    const dos = analizarAcceso(`if (rol === "admin") {}\nif (rol.nombre === "x") {}`);
    const archivo = "app/(app)/administracion/permisos/permisos-matriz.tsx";
    expect(problemasDe(archivo, uno)).toEqual([]);
    expect(problemasDe(archivo, dos).join("\n")).toContain("NUEVAS");
    expect(problemasDe(archivo, []).join("\n")).toContain("Se pagó deuda");
    expect(problemasDe("app/otro.tsx", uno)).toHaveLength(1);
  });

  it("el mensaje dice dónde está y qué usar en su lugar", () => {
    const [h] = analizarAcceso(`\n\nif (rol === "admin") {}`);
    const mensaje = formatear("app/(app)/ejemplo/page.tsx", h);
    expect(mensaje).toContain("app/(app)/ejemplo/page.tsx:3");
    expect(mensaje).toContain("comparación de rol o de nivel");
    expect(mensaje).toContain("conPermiso");
    expect(mensaje).toContain("requierePermisoVer");
  });
});
