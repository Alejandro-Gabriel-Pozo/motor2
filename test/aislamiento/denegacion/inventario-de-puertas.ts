import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { contextoDeAccion, type AccionClave } from "../../../src/core/permisos/acciones";
import { inventariarFuente } from "../../arquitectura/guardas/inventario";
import { CONTEXTO_DECLARADO } from "./excepciones";

/**
 * El INVENTARIO de TODAS las puertas de datos del servidor para la matriz de denegación por defecto (GT-3b, T15 del plan de endurecimiento de seguridad; fila O.88 de `docs/pureza-integracion.md`).
 * Una «puerta» es cualquier función por la que el cliente (o una página) llega a datos de una empresa:
 *  - `accion`: toda export de un archivo `"use server"` de `src/server/actions/**` (un endpoint HTTP: se invoca a mano, sin pasar por la pantalla);
 *  - `consulta`: toda export de `src/server/consultas/**` (la lectura que una página llama después de su propia guarda; recibe `db` y ids explícitos);
 *  - `lectura`: toda export de `src/server/lecturas/**` (ayudantes de lectura que usan los casos de uso y las consultas, siempre con el `db` de la empresa).
 *
 * Por AST, sin `ts.Program` (como `guardas/inventario.ts`): nombre de la función, parámetros (nombre, tipo escrito, opcional o con valor por defecto), la guarda que la abre (la PRIMERA llamada a un
 * envoltorio o `requerirVer*` del cuerpo; si no hay, la de la función del mismo archivo a la que delega), la clave que lleva y el contexto de esa clave (empresa o sucursal).
 * Es la entrada de `matriz.ts` (los generadores de argumentos) y del test de cobertura: una puerta que aparece acá y no tiene fila ni argumentos derivables pone la matriz en rojo (falla cerrado).
 */
export type TipoDePuerta = "accion" | "consulta" | "lectura";

export interface ParametroDePuerta {
  nombre: string;
  /** El tipo tal como está escrito en el código (`string`, `boolean`, `Db`, `DatosProducto`…); vacío si no lo declara. */
  tipo: string;
  /** Opcional (`?`) o con valor por defecto. */
  opcional: boolean;
}

export type GuardaDePuerta =
  | "conPermiso"
  | "conPermisoDeEmpresa"
  | "conEdicionDePermisos"
  | "requerirVer"
  | "requerirVerDeEmpresa"
  | "requerirVerEnSucursal"
  | "requerirVerAlguna"
  | "requerirVerAlgunaEnSucursal"
  | "obtenerContextoUsuario"
  | "ninguna";

export interface PuertaInventariada {
  /** `<tipo>|<archivo desde src/server>|<función>`; es la clave de todas las listas de la matriz. */
  clave: string;
  tipo: TipoDePuerta;
  /** Desde `src/server`, con `/`. */
  archivo: string;
  nombre: string;
  parametros: ParametroDePuerta[];
  guarda: GuardaDePuerta;
  /** Las claves literales de la guarda (vacío si no hay guarda o la clave no es un literal). */
  claves: string[];
  /** `sucursal` / `empresa` según el contexto de las claves; `mixto` si una lista mezcla; `desconocido` si no hay clave literal. */
  contexto: "sucursal" | "empresa" | "mixto" | "desconocido";
  /** Una mutación (`conPermiso*`, `conEdicionDePermisos`) o una lectura/otra cosa. */
  mutacion: boolean;
  /** Solo consultas y lecturas: las páginas o componentes de `src/app` y `src/components` que la importan. */
  consumidores: string[];
}

const RAIZ = join(__dirname, "../../..");
const SERVER = join(RAIZ, "src/server");

const GUARDAS: ReadonlySet<string> = new Set<GuardaDePuerta>([
  "conPermiso",
  "conPermisoDeEmpresa",
  "conEdicionDePermisos",
  "requerirVer",
  "requerirVerDeEmpresa",
  "requerirVerEnSucursal",
  "requerirVerAlguna",
  "requerirVerAlgunaEnSucursal",
  "obtenerContextoUsuario",
]);
const MUTACIONES: ReadonlySet<string> = new Set(["conPermiso", "conPermisoDeEmpresa", "conEdicionDePermisos"]);
/** Posición del argumento que lleva la clave (o el arreglo de claves) en cada guarda. */
const POSICION_DE_CLAVE: Readonly<Record<string, number>> = {
  conPermiso: 0,
  conPermisoDeEmpresa: 0,
  conEdicionDePermisos: 0,
  requerirVer: 0,
  requerirVerDeEmpresa: 0,
  requerirVerEnSucursal: 1,
  requerirVerAlguna: 0,
  requerirVerAlgunaEnSucursal: 1,
};

function archivosFuente(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivosFuente(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

function esUseServer(sf: ts.SourceFile): boolean {
  const primera = sf.statements[0];
  return !!primera && ts.isExpressionStatement(primera) && ts.isStringLiteral(primera.expression) && primera.expression.text === "use server";
}

function exportada(st: ts.Node): boolean {
  return ts.canHaveModifiers(st) && !!ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

interface FuncionDelArchivo {
  nombre: string;
  parametros: readonly ts.ParameterDeclaration[];
  cuerpo: ts.Node;
  exportada: boolean;
}

/** Todas las funciones de primer nivel del archivo (declaradas o como `const f = (…) =>`), con su cuerpo; los overloads (sin cuerpo) no cuentan. */
function funcionesDe(sf: ts.SourceFile): FuncionDelArchivo[] {
  const salida: FuncionDelArchivo[] = [];
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && st.body) {
      salida.push({ nombre: st.name.text, parametros: st.parameters, cuerpo: st.body, exportada: exportada(st) });
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const init = d.initializer;
        if (ts.isIdentifier(d.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          salida.push({ nombre: d.name.text, parametros: init.parameters, cuerpo: init.body, exportada: exportada(st) });
        }
      }
    }
  }
  return salida;
}

function sinEnvoltorios(expr: ts.Expression): ts.Expression {
  let actual = expr;
  while (ts.isAsExpression(actual) || ts.isSatisfiesExpression(actual) || ts.isParenthesizedExpression(actual) || ts.isNonNullExpression(actual)) actual = actual.expression;
  return actual;
}

interface GuardaEncontrada {
  guarda: GuardaDePuerta;
  claves: string[];
}

/**
 * TODAS las guardas que alcanza la función: las de su cuerpo y las de las funciones del mismo archivo a las que delega (recursivo, sin repetir). La principal es la primera en orden de fuente, SALVO que alguna
 * sea de mutación (`conPermiso*`): una puerta que puede escribir se trata siempre como mutación, aunque antes lea con un `requerirVer*` (`actualizarCabeceraDeReceta` lee la receta vigente y después guarda).
 */
function guardasDe(funcion: FuncionDelArchivo, porNombre: ReadonlyMap<string, FuncionDelArchivo>, visitadas = new Set<string>()): GuardaEncontrada[] {
  visitadas.add(funcion.nombre);
  const encontradas: GuardaEncontrada[] = [];
  const delegadas: string[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const nombre = n.expression.text;
      if (GUARDAS.has(nombre)) {
        const pos = POSICION_DE_CLAVE[nombre];
        const claves: string[] = [];
        const arg = pos === undefined ? undefined : n.arguments[pos];
        if (arg) {
          const sin = sinEnvoltorios(arg);
          const candidatos = ts.isArrayLiteralExpression(sin) ? [...sin.elements] : [sin];
          for (const c of candidatos) if (ts.isStringLiteralLike(c)) claves.push(c.text);
        }
        encontradas.push({ guarda: nombre as GuardaDePuerta, claves });
      } else if (porNombre.has(nombre) && !visitadas.has(nombre)) delegadas.push(nombre);
    }
    ts.forEachChild(n, visitar);
  };
  visitar(funcion.cuerpo);
  for (const d of delegadas) {
    const f = porNombre.get(d);
    if (f && !visitadas.has(d)) encontradas.push(...guardasDe(f, porNombre, visitadas));
  }
  return encontradas;
}

function guardaPrincipal(funcion: FuncionDelArchivo, porNombre: ReadonlyMap<string, FuncionDelArchivo>): GuardaEncontrada {
  const todas = guardasDe(funcion, porNombre);
  return todas.find((g) => MUTACIONES.has(g.guarda)) ?? todas[0] ?? { guarda: "ninguna", claves: [] };
}

function contextoDe(claves: readonly string[], guarda: GuardaDePuerta): PuertaInventariada["contexto"] {
  if (claves.length === 0) {
    // `conPermiso`/`requerirVer*` sin clave literal son de sucursal por tipo; `conPermisoDeEmpresa`/`requerirVerDeEmpresa`, de empresa.
    if (guarda === "conPermiso" || guarda === "requerirVer" || guarda === "requerirVerEnSucursal") return "sucursal";
    if (guarda === "conPermisoDeEmpresa" || guarda === "conEdicionDePermisos" || guarda === "requerirVerDeEmpresa") return "empresa";
    return "desconocido";
  }
  const contextos = new Set(claves.map((c) => contextoDeAccion(c as AccionClave)));
  return contextos.size > 1 ? "mixto" : [...contextos][0];
}

/** `archivo (relativo a src, con /) → nombres importados` de lo que `src/app` y `src/components` toman de `@/server/consultas|lecturas`. */
function consumidoresDeLecturas(): Map<string, Set<string>> {
  const usados = new Map<string, Set<string>>();
  for (const base of ["src/app", "src/components"]) {
    for (const ruta of archivosFuente(join(RAIZ, base))) {
      const sf = ts.createSourceFile(ruta, readFileSync(ruta, "utf8"), ts.ScriptTarget.Latest, true);
      const relativa = ruta.slice(RAIZ.length + 5).replace(/\\/g, "/");
      for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
        const m = /^@\/server\/(consultas|lecturas)\/(.+)$/.exec(st.moduleSpecifier.text);
        const nombrados = st.importClause?.namedBindings;
        if (!m || !nombrados || !ts.isNamedImports(nombrados)) continue;
        for (const el of nombrados.elements) {
          const clave = `${m[1]}/${m[2]}.ts|${(el.propertyName ?? el.name).text}`;
          if (!usados.has(clave)) usados.set(clave, new Set());
          usados.get(clave)!.add(relativa);
        }
      }
    }
  }
  return usados;
}

/**
 * El contexto de una consulta o lectura (no lleva guarda propia: la pide la página que la llama) sale de las claves que piden SUS páginas consumidoras: si todas son de empresa, la lectura es de empresa
 * (la carta del portal, la ficha de un producto); si alguna es de sucursal —o no hay ninguna página que la llame—, es de sucursal (lo más estricto). Los componentes no tienen guarda propia y no cuentan.
 */
function contextoDeConsumidores(consumidores: readonly string[]): PuertaInventariada["contexto"] {
  const contextos = new Set<string>();
  for (const consumidor of consumidores) {
    if (!consumidor.startsWith("app/")) continue;
    const { usos } = inventariarFuente(consumidor, readFileSync(join(RAIZ, "src", consumidor), "utf8"));
    for (const u of usos) contextos.add(contextoDeAccion(u.clave as AccionClave));
  }
  if (contextos.size === 0) return "desconocido";
  return contextos.size > 1 ? "mixto" : (contextos.values().next().value as "empresa" | "sucursal");
}

function parametrosDe(funcion: FuncionDelArchivo, sf: ts.SourceFile): ParametroDePuerta[] {
  return funcion.parametros.map((p) => ({
    nombre: p.name.getText(sf),
    tipo: p.type ? p.type.getText(sf).replace(/\s+/g, " ") : "",
    opcional: !!p.questionToken || !!p.initializer,
  }));
}

/** El inventario completo, ordenado por clave. Sin base de datos: solo lee `src/`. */
export function inventariarPuertas(): PuertaInventariada[] {
  const consumidores = consumidoresDeLecturas();
  const salida: PuertaInventariada[] = [];
  for (const [carpeta, tipoBase] of [["actions", "accion"], ["consultas", "consulta"], ["lecturas", "lectura"]] as const) {
    for (const ruta of archivosFuente(join(SERVER, carpeta))) {
      const sf = ts.createSourceFile(ruta, readFileSync(ruta, "utf8"), ts.ScriptTarget.Latest, true);
      // Las acciones son solo las de los archivos `"use server"` (los envoltorios y limitadores de la carpeta no son endpoints).
      if (tipoBase === "accion" && !esUseServer(sf)) continue;
      const archivo = ruta.slice(SERVER.length + 1).replace(/\\/g, "/");
      const funciones = funcionesDe(sf);
      const porNombre = new Map(funciones.map((f) => [f.nombre, f]));
      for (const f of funciones) {
        if (!f.exportada) continue;
        const { guarda, claves } = guardaPrincipal(f, porNombre);
        const clave = `${tipoBase}|${archivo}|${f.nombre}`;
        const susConsumidores = [...(consumidores.get(`${archivo}|${f.nombre}`) ?? [])].sort();
        salida.push({
          clave,
          tipo: tipoBase,
          archivo,
          nombre: f.nombre,
          parametros: parametrosDe(f, sf),
          guarda,
          claves,
          contexto: Object.hasOwn(CONTEXTO_DECLARADO, clave) ? CONTEXTO_DECLARADO[clave].contexto : tipoBase === "accion" ? contextoDe(claves, guarda) : contextoDeConsumidores(susConsumidores),
          mutacion: MUTACIONES.has(guarda),
          consumidores: susConsumidores,
        });
      }
    }
  }
  return salida.sort((a, b) => (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0));
}
