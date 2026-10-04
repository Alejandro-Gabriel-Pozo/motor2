import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * `"use server"` convierte una función en un endpoint que cualquiera puede invocar con un POST. Dos reglas, de lista cerrada:
 *
 * 1. Un archivo entero con `"use server"` solo existe en `src/server/actions/` (donde `acciones-con-guarda.test.ts` exige guarda a cada
 *    función exportada). En cualquier otro lado, todo lo que el archivo exporta quedaría expuesto sin guarda.
 * 2. Un closure con `"use server"` adentro de una página o un componente (`action={async () => { "use server"; ... }}`) es un endpoint
 *    suelto, SIN la guarda propia de las acciones: tiene que ser un adaptador fino que solo llama a una Server Action de
 *    `@/server/actions/**` (ahí está el permiso), más un puñado de ayudantes puros que leen el formulario. Un closure que llame a
 *    cualquier otra cosa (Prisma, una consulta, `getUsuarioActual`, un servicio) falla: movelo a una acción con `conPermiso`.
 */
const RAIZ = join(__dirname, "../../src");
const RAIZ_ACCIONES = "server/actions/";

/** Ayudantes puros (leen el formulario o formatean): solo se llaman por nombre, sin importar de dónde vengan. */
const AYUDANTES_LOCALES = new Set(["String", "Number", "campo", "datosDelFormulario", "valoresDelFormulario", "refrescarSiOk"]);
/** Métodos sin efectos sobre `FormData`/arrays/strings, para encadenar sobre `fd.get(...)`, `.map(String)`, `.trim()`. */
const METODOS_PUROS = new Set(["get", "getAll", "map", "filter", "flatMap", "trim"]);
/** Nombre → módulo del que tiene que venir. */
const IMPORTADOS_PUROS: Record<string, string> = {
  numeroDelCampo: "@/core/datos/numero-tecleado",
  secuenciaMoviendo: "@/core/catalogo/public",
  redirect: "next/navigation",
};
/** Abrir/cerrar sesión: solo en estos archivos (el login y los dos shells). */
const SESION: Record<string, string[]> = {
  signIn: ["app/login/page.tsx", "app/invitacion/page.tsx"],
  signOut: ["app/login/page.tsx", "app/invitacion/page.tsx", "components/app-shell.tsx", "components/pos-shell.tsx"],
};

function archivos(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) archivos(ruta, salida);
    else if (/\.(ts|tsx)$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

const esDirectiva = (s: ts.Statement) => ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression) && s.expression.text === "use server";

function importesPorNombre(fuente: ts.SourceFile): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const s of fuente.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue;
    const enlaces = s.importClause?.namedBindings;
    if (enlaces && ts.isNamedImports(enlaces)) for (const e of enlaces.elements) mapa.set(e.name.text, s.moduleSpecifier.text);
  }
  return mapa;
}

/** `"use server"` a nivel de archivo (primera sentencia) y llamadas no permitidas dentro de closures con `"use server"`. */
export function analizarUseServer(rel: string, codigo: string): { archivoCompleto: boolean; llamadasNoPermitidas: string[] } {
  const fuente = ts.createSourceFile(rel, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const archivoCompleto = fuente.statements.some((s, i) => esDirectiva(s) && fuente.statements.slice(0, i).every(esDirectiva));
  const importes = importesPorNombre(fuente);
  const noPermitidas: string[] = [];

  const revisarLlamada = (llamada: ts.CallExpression) => {
    const e = llamada.expression;
    const texto = e.getText(fuente);
    const donde = `${rel}:${fuente.getLineAndCharacterOfPosition(llamada.getStart(fuente)).line + 1} ${texto}()`;
    if (ts.isIdentifier(e)) {
      const modulo = importes.get(e.text);
      const deAcciones = modulo !== undefined && (modulo.startsWith("@/server/actions/") || /^(\.{1,2}\/)+server\/actions\//.test(modulo));
      if (deAcciones) return;
      if (AYUDANTES_LOCALES.has(e.text) && (modulo === undefined || modulo.startsWith("@/server/actions/"))) return;
      if (IMPORTADOS_PUROS[e.text] && modulo === IMPORTADOS_PUROS[e.text]) return;
      if (SESION[e.text] && modulo === "@/lib/auth" && SESION[e.text].includes(rel)) return;
    } else if (ts.isPropertyAccessExpression(e) && METODOS_PUROS.has(e.name.text)) return;
    noPermitidas.push(donde);
  };

  const dentroDeClosure = (n: ts.Node) => {
    if (ts.isCallExpression(n)) revisarLlamada(n);
    ts.forEachChild(n, dentroDeClosure);
  };
  const visitar = (n: ts.Node) => {
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)) && n.body && ts.isBlock(n.body) && n.body.statements.some(esDirectiva)) {
      dentroDeClosure(n.body);
      return;
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return { archivoCompleto, llamadasNoPermitidas: noPermitidas };
}

describe("\"use server\" solo donde corresponde", () => {
  it("el analizador distingue lo permitido de lo que no (sanidad: no pasa en vacío)", () => {
    const aceptado = `import { guardarX } from "@/server/actions/a/b";
export default function P() { return <form action={async (fd: FormData) => { "use server"; return guardarX(String(fd.get("n") ?? "").trim()); }} />; }`;
    expect(analizarUseServer("app/p.tsx", aceptado)).toEqual({ archivoCompleto: false, llamadasNoPermitidas: [] });

    const conPrisma = `import { prisma } from "@/lib/db";
export default function P() { return <form action={async () => { "use server"; await prisma.user.deleteMany(); }} />; }`;
    expect(analizarUseServer("app/p.tsx", conPrisma).llamadasNoPermitidas).toHaveLength(1);

    const conSesionAjena = `import { signOut } from "@/lib/auth";
export default function P() { return <form action={async () => { "use server"; await signOut(); }} />; }`;
    expect(analizarUseServer("app/otra/page.tsx", conSesionAjena).llamadasNoPermitidas).toHaveLength(1);
    expect(analizarUseServer("app/login/page.tsx", conSesionAjena).llamadasNoPermitidas).toEqual([]);

    expect(analizarUseServer("x.ts", `"use server";\nexport async function f() {}`).archivoCompleto).toBe(true);
    expect(analizarUseServer("x.ts", `// "use server"\nexport async function f() {}`).archivoCompleto).toBe(false);
  });

  it("ningún archivo con \"use server\" a nivel de archivo vive fuera de src/server/actions", () => {
    const fuera = archivos(RAIZ)
      .map((a) => relative(RAIZ, a).replace(/\\/g, "/"))
      .filter((rel) => !rel.startsWith(RAIZ_ACCIONES))
      .filter((rel) => analizarUseServer(rel, readFileSync(join(RAIZ, rel), "utf8")).archivoCompleto);
    expect(fuera, "un archivo \"use server\" expone TODO lo que exporta como endpoint: movelo a src/server/actions (con su guarda)").toEqual([]);
  });

  it("los closures \"use server\" de páginas y componentes solo llaman a Server Actions y a ayudantes puros del formulario", () => {
    const problemas = archivos(RAIZ)
      .map((a) => relative(RAIZ, a).replace(/\\/g, "/"))
      .filter((rel) => !rel.startsWith(RAIZ_ACCIONES))
      .flatMap((rel) => analizarUseServer(rel, readFileSync(join(RAIZ, rel), "utf8")).llamadasNoPermitidas);
    expect(problemas, "un closure \"use server\" es un endpoint sin guarda: que llame a una acción de @/server/actions (conPermiso) y nada más").toEqual([]);
  });
});
