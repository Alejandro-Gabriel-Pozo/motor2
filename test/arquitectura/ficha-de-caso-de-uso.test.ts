import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { descubrirCasosDeUsoReales } from "./guardas/casos-de-uso";
import { ESCRITURAS_FUERA_DE_PERSISTENCIA } from "./escrituras-fuera-de-persistencia";
import { analizarFuente, delegadosDeModelos } from "../../scripts/arquitectura/analizar-fuente";

/**
 * Regla de arquitectura (Fase 0 del plan de pureza, PR 0.6): LA FICHA DE CADA CASO DE USO SE VERIFICA CONTRA EL CÓDIGO.
 *
 * Los 4 tags de contrato (`@contract/@idempotency/@transaction/@sideEffects`, `casos-de-uso-con-tags-de-contrato.test.ts`) son prosa: se leen, pero ningún test
 * los cruza con el código, así que podían mentir sin que nada fallara. La ficha es la versión MECÁNICA: una línea `@ficha` en el docstring de cada caso de uso, con
 * cinco campos de vocabulario cerrado, y este test comprueba que lo declarado es lo que el archivo hace:
 *
 *   @ficha permiso=<acción> transaccion=<SERIALIZABLE|SIMPLE|NINGUNA> idempotencia=<I3|POR_ESTADO|OPTIMISTA|NO_APLICA> auditoria=<REGISTRO_AUDITORIA|DOCUMENTO_PROPIO> reloj=<INYECTADO|NEW_DATE> periodo=<VERIFICA_CIERRE|NO_APLICA>
 *
 *  - `permiso`: la acción (de `ACCIONES`) con la que la Server Action que lo envuelve lo protege (`conPermiso*("clave", …)`), o `POR_PROCESO` si la elige en ejecución, o `SISTEMA` si
 *    corre SIN usuario (un cron o el atajo del encabezado): lo envuelve un archivo que NO es `"use server"` (no es un endpoint) y que ningún `conPermiso*` protege. Quién puede importar esos
 *    envoltorios lo vigila `sincronizaciones-solo-desde-crons-y-shell.test.ts`. `SIN_PERMISO` si lo envuelve un ENDPOINT (`"use server"`) que no usa ningún `conPermiso*` porque todavía no
 *    hay sesión ni membresía (aceptar una invitación: la autoridad es el token del enlace, no un permiso). Es un agujero deliberado en la matriz de permisos: por eso hay una LISTA CERRADA
 *    (`CASOS_SIN_PERMISO`, abajo) con el motivo de cada uno, revisada en las dos direcciones (D-7 del plan de la Fase 4).
 *  - `transaccion`: `SERIALIZABLE` si llama a `conTransaccionSerializable` (o a `conGobierno`, mientras `con-gobierno.ts` la llame: se deriva del código); `SIMPLE` si abre
 *    una transacción común; `NINGUNA` si no abre ninguna.
 *  - `idempotencia`: `I3` si y solo si llama a `chequearIdempotencia` (clave + hash del payload); `POR_ESTADO` (el estado del documento arbitra el reintento),
 *    `OPTIMISTA` (versión esperada) y `NO_APLICA` no pueden llamarla.
 *  - `auditoria`: `REGISTRO_AUDITORIA` si llama a `registrarCambioAuditado` (él o un paso compartido que importa de su misma carpeta `casos-de-uso/`, `./<archivo>`);
 *    `DOCUMENTO_PROPIO` si no (el documento que escribe lleva su usuario y su fecha).
 *  - `periodo` (decisión del dueño, 2026-10-08): `VERIFICA_CIERRE` si el caso de uso llama a `verificarPeriodoAbierto` (la verificación del cierre de períodos que va a traer la Etapa A en
 *    `core/periodos`: sin esto el cierre no tiene forma mecánica de alcanzar TODAS las escrituras con fecha de imputación); `NO_APLICA` si no la llama. HOY ningún caso de uso la llama porque la
 *    función todavía no existe: todos declaran `NO_APLICA`. Cuando nazca, este test ya obliga a que cada caso de uso que la use lo declare, y un caso de uso que escribe un documento con fecha
 *    de imputación y la omite se verá en la revisión como `NO_APLICA` explícito.
 *  - `reloj`: `INYECTADO` si el archivo no lee la hora actual (`new Date()` sin argumentos, `Date.now()`); `NEW_DATE` si la lee. NINGÚN caso de uso lee el reloj (Pureza 1.2):
 *    la hora entra por `actor.ahora`, que `conPermiso` fija una vez por pedido (`ContextoDeAccion`). Un test fija la hora, y el cierre de períodos y `fechaImputacion` la necesitan.
 *
 * QUÉ NO ES UN CASO DE USO (queda FUERA de la ficha, a propósito): los flujos de la consola de plataforma (`plataforma/src/servidor/*`) y las operaciones de plataforma por script
 * (`src/server/operaciones-de-plataforma/*`). No los envuelve una Server Action con `conPermiso*` de la app de empresas (los llama la consola, con su propio ingreso por código y TOTP, o un
 * script con la conexión del rol de plataforma), así que `permiso`, `periodo` y `reloj` no se aplican como en un caso de uso de empresa. No quedan sin vigilar: cada archivo de esas
 * carpetas que escribe la base está en la lista `ESCRITURAS_FUERA_DE_PERSISTENCIA` con su fase («Consola») y su motivo, y el test de abajo lo comprueba en las dos direcciones.
 *
 * Qué NO verifica: la prosa de los tags, ni qué modelos escribe (eso lo hace `escrituras-auditadas.test.ts` y `kardex-solo-agrega.test.ts`), ni que la idempotencia
 * funcione (la prueban los tests concurrentes de cada caso). Sí evita que la ficha diga una cosa y el código otra, y que un caso de uso nuevo nazca sin ficha.
 */
const VOCABULARIO = {
  transaccion: ["SERIALIZABLE", "SIMPLE", "NINGUNA"],
  idempotencia: ["I3", "POR_ESTADO", "OPTIMISTA", "NO_APLICA"],
  auditoria: ["REGISTRO_AUDITORIA", "DOCUMENTO_PROPIO"],
  reloj: ["INYECTADO", "NEW_DATE"],
  periodo: ["VERIFICA_CIERRE", "NO_APLICA"],
} as const;
const CAMPOS = ["permiso", "transaccion", "idempotencia", "auditoria", "reloj", "periodo"] as const;

interface Observado {
  transaccion: string;
  llamaAChequearIdempotencia: boolean;
  auditoria: string;
  reloj: string;
  periodo: string;
}

/** Las funciones que el código llama (por nombre o por la última propiedad: `ctx.transaccion(…)` → `transaccion`) y si lee el reloj (AST, fuera de los comentarios). */
function llamadasDe(codigo: string): { llamadas: Set<string>; reloj: boolean } {
  const fuente = ts.createSourceFile("caso.ts", codigo, ts.ScriptTarget.Latest, true);
  const llamadas = new Set<string>();
  let reloj = false;
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      if (ts.isIdentifier(n.expression)) llamadas.add(n.expression.text);
      if (ts.isPropertyAccessExpression(n.expression)) {
        llamadas.add(n.expression.name.text);
        if (ts.isIdentifier(n.expression.expression) && n.expression.expression.text === "Date" && n.expression.name.text === "now") reloj = true;
      }
    }
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "Date" && (n.arguments?.length ?? 0) === 0) reloj = true;
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return { llamadas, reloj };
}

/**
 * Las funciones que abren una transacción SERIALIZABLE: `conTransaccionSerializable` y, mientras `server/actions/con-gobierno.ts` la llame (Hito 3, paso 0.5),
 * `conGobierno` (la transacción de gobierno de usuarios, roles y sucursales: serializable con reintento). Se DERIVA del código de `con-gobierno.ts`, no se
 * declara: si `conGobierno` dejara de ser serializable, un caso de uso que lo usa y declara `transaccion=SERIALIZABLE` pasaría a mentir y este test lo vería.
 */
function serializablesDelRepositorio(fuenteDeConGobierno: string): ReadonlySet<string> {
  const serializables = new Set(["conTransaccionSerializable"]);
  if (llamadasDe(fuenteDeConGobierno).llamadas.has("conTransaccionSerializable")) serializables.add("conGobierno");
  return serializables;
}
const SERIALIZABLES = serializablesDelRepositorio(readFileSync(join(__dirname, "../../src/server/actions/con-gobierno.ts"), "utf8"));

/**
 * Los PASOS COMPARTIDOS que un caso de uso importa de su misma carpeta `casos-de-uso/` (`import … from "./<archivo>"`), recorridos de forma transitiva: la
 * auditoría de un caso de uso puede vivir en un paso compartido (Fase I del Hito 3: la gerencia, las invitaciones de usuario), y sin seguirlo la ficha tendría que
 * mentir `DOCUMENTO_PROPIO`. `leer(nombre)` devuelve la fuente del hermano `nombre` (sin extensión), o `null` si no existe.
 */
function pasosCompartidos(codigo: string, leer: (nombre: string) => string | null, vistos: Set<string> = new Set()): string[] {
  const fuente = ts.createSourceFile("caso.ts", codigo, ts.ScriptTarget.Latest, true);
  const pasos: string[] = [];
  for (const stmt of fuente.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const m = /^\.\/([^/]+?)(?:\.tsx?)?$/.exec(stmt.moduleSpecifier.text);
    if (!m || vistos.has(m[1])) continue;
    vistos.add(m[1]);
    const hermano = leer(m[1]);
    if (hermano === null) continue;
    pasos.push(hermano, ...pasosCompartidos(hermano, leer, vistos));
  }
  return pasos;
}

/** Lee un hermano de la carpeta `dir` (`<nombre>.ts` o `.tsx`), o `null`. */
const leerHermanoDe =
  (dir: string) =>
  (nombre: string): string | null => {
    for (const ext of [".ts", ".tsx"]) {
      const ruta = join(dir, `${nombre}${ext}`);
      if (existsSync(ruta)) return readFileSync(ruta, "utf8");
    }
    return null;
  };

/** Lo que el código del caso de uso HACE (AST, fuera de los comentarios). La auditoría también cuenta si la hace un paso compartido (`pasos`). */
function observar(codigo: string, opciones: { serializables?: ReadonlySet<string>; pasos?: readonly string[] } = {}): Observado {
  const { llamadas, reloj } = llamadasDe(codigo);
  const serializables = opciones.serializables ?? SERIALIZABLES;
  const auditaUnPaso = (opciones.pasos ?? []).some((p) => llamadasDe(p).llamadas.has("registrarCambioAuditado"));
  return {
    transaccion: [...serializables].some((f) => llamadas.has(f)) ? "SERIALIZABLE" : llamadas.has("transaccion") || llamadas.has("$transaction") ? "SIMPLE" : "NINGUNA",
    llamaAChequearIdempotencia: llamadas.has("chequearIdempotencia"),
    auditoria: llamadas.has("registrarCambioAuditado") || auditaUnPaso ? "REGISTRO_AUDITORIA" : "DOCUMENTO_PROPIO",
    reloj: reloj ? "NEW_DATE" : "INYECTADO",
    periodo: llamadas.has("verificarPeriodoAbierto") ? "VERIFICA_CIERRE" : "NO_APLICA",
  };
}

/**
 * Los envoltorios de permiso de una Server Action: `conPermiso`, `conPermisoDeEmpresa` y `conEdicionDePermisos` (el de la matriz y los roles, que además exige la
 * política de plataforma). Hito 3, paso 0.5: antes solo se reconocía `/^conPermiso/`, y un caso de uso de roles o de la matriz habría salido `SIN_PERMISO`.
 */
const ES_ENVOLTORIO_DE_PERMISO = /^(?:conPermiso\w*|conEdicionDePermisos)$/;

/** Los permisos con los que la Server Action que envuelve al caso de uso lo protege (`conPermiso*("clave", …)` alrededor de la llamada); `POR_PROCESO` si ninguno es literal. */
function permisosObservados(fuenteDelCaso: string, envolventes: string[]): string {
  const funciones = [...fuenteDelCaso.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1]);
  const permisos = new Set<string>();
  let sinUsuario = false;
  let sinConPermiso = false;
  let conConPermisoVariable = false;
  for (const codigo of envolventes) {
    const esEndpoint = /^\s*["']use server["']/m.test(codigo);
    const fuente = ts.createSourceFile("accion.ts", codigo, ts.ScriptTarget.Latest, true);
    const buscar = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && funciones.includes(n.expression.text)) {
        let protegida = false;
        for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
          if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && ES_ENVOLTORIO_DE_PERMISO.test(p.expression.text)) {
            protegida = true;
            if (p.arguments[0] && ts.isStringLiteralLike(p.arguments[0])) permisos.add(p.arguments[0].text);
            else conConPermisoVariable = true;
            break;
          }
        }
        // Sin ningún conPermiso* alrededor de la llamada: si el archivo no es un endpoint (`"use server"`), el caso de uso corre sin usuario.
        if (!protegida && !esEndpoint) sinUsuario = true;
        if (!protegida && esEndpoint) sinConPermiso = true;
      }
      ts.forEachChild(n, buscar);
    };
    buscar(fuente);
  }
  if (permisos.size > 0) return [...permisos].sort().join("|");
  if (sinUsuario) return "SISTEMA";
  if (conConPermisoVariable) return "POR_PROCESO";
  // Un endpoint sin ningún `conPermiso*` alrededor de la llamada (ni literal ni variable) no protege nada: SIN_PERMISO.
  return sinConPermiso ? "SIN_PERMISO" : "POR_PROCESO";
}

/**
 * Los casos de uso que corren SIN permiso a propósito (un endpoint sin sesión), con el motivo de cada uno. Lista CERRADA: un caso de uso nuevo con `permiso=SIN_PERMISO` que no esté acá falla,
 * y una entrada que ningún caso de uso real usa también (no se acumulan permisos fantasma). Hoy está vacía: B3 (Fase 4) suma las dos aceptaciones de invitación.
 */
export const CASOS_SIN_PERMISO: Record<string, string> = {};

/** Los casos de uso que declaran `permiso=SIN_PERMISO` y no están en la lista cerrada, y las entradas de la lista que ningún caso real usa. */
export function problemasDeSinPermiso(declarados: string[], lista: Record<string, string>): string[] {
  const problemas: string[] = [];
  for (const ruta of declarados) if (!(ruta in lista)) problemas.push(`${ruta}: declara permiso=SIN_PERMISO y no está en CASOS_SIN_PERMISO (con su motivo)`);
  for (const ruta of Object.keys(lista)) if (!declarados.includes(ruta)) problemas.push(`${ruta}: está en CASOS_SIN_PERMISO pero ningún caso de uso real declara permiso=SIN_PERMISO con esa ruta`);
  return problemas;
}

/** La línea `@ficha` del docstring, como `{campo: valor}`; `null` si no hay (o hay más de una). */
function leerFicha(codigo: string): Record<string, string> | null {
  const lineas = [...codigo.matchAll(/^\s*\*\s*@ficha\s+(.+)$/gm)];
  if (lineas.length !== 1) return null;
  return Object.fromEntries(lineas[0][1].trim().split(/\s+/).map((par) => [par.split("=")[0], par.split("=").slice(1).join("=")]));
}

describe("ficha de caso de uso: el observador ve lo que el código hace (la regla no puede quedar ciega)", () => {
  it("transacción: SERIALIZABLE, SIMPLE o NINGUNA", () => {
    expect(observar("export async function f(ctx: any) { return conTransaccionSerializable(ctx, async () => 1); }").transaccion).toBe("SERIALIZABLE");
    expect(observar("export async function f(ctx: any) { return ctx.transaccion(async () => 1); }").transaccion).toBe("SIMPLE");
    expect(observar("export async function f() { return 1; }").transaccion).toBe("NINGUNA");
  });

  it("transacción: conGobierno es SERIALIZABLE mientras con-gobierno.ts llame a conTransaccionSerializable (se deriva del código)", () => {
    const caso = "export async function f(ctx: any) { return conGobierno(ctx, async (tx: any) => 1); }";
    expect(SERIALIZABLES.has("conGobierno")).toBe(true);
    expect(observar(caso).transaccion).toBe("SERIALIZABLE");
    // Si con-gobierno.ts abriera una transacción común, conGobierno dejaría de contar como serializable.
    const conGobiernoComun = serializablesDelRepositorio("export async function conGobierno(ctx: any, cuerpo: any) { return ctx.transaccion(cuerpo); }");
    expect(conGobiernoComun.has("conGobierno")).toBe(false);
    expect(observar(caso, { serializables: conGobiernoComun }).transaccion).toBe("NINGUNA");
  });

  it("auditoría: cuenta si la hace un paso compartido de la misma carpeta casos-de-uso/ (también de forma transitiva)", () => {
    const hermanos: Record<string, string> = {
      "paso-que-audita": "export async function p(tx: any) { await registrarCambioAuditado(tx, {}); }",
      "paso-intermedio": 'import { p } from "./paso-que-audita";\nexport async function q(tx: any) { await p(tx); }',
      "paso-sin-auditoria": "export async function r(tx: any) { await escribir(tx); }",
    };
    const leer = (nombre: string) => hermanos[nombre] ?? null;
    const caso = (desde: string) => `import { x } from "${desde}";\nexport async function f(tx: any) { await x(tx); }`;
    const auditoria = (desde: string) => observar(caso(desde), { pasos: pasosCompartidos(caso(desde), leer) }).auditoria;
    expect(auditoria("./paso-que-audita")).toBe("REGISTRO_AUDITORIA");
    expect(auditoria("./paso-intermedio")).toBe("REGISTRO_AUDITORIA");
    expect(auditoria("./paso-sin-auditoria")).toBe("DOCUMENTO_PROPIO");
    // Solo la MISMA carpeta: un import de otra carpeta (o de un alias) no es un paso compartido del caso de uso.
    expect(pasosCompartidos(caso("../otra/paso-que-audita"), leer)).toEqual([]);
    expect(pasosCompartidos(caso("@/core/permisos/auditoria"), leer)).toEqual([]);
  });

  it("idempotencia I3 solo si llama a chequearIdempotencia; auditoría solo si llama a registrarCambioAuditado", () => {
    expect(observar("export async function f(tx: any) { await chequearIdempotencia(tx, 'k'); }").llamaAChequearIdempotencia).toBe(true);
    expect(observar("export async function f(tx: any) { await otraCosa(tx); }").llamaAChequearIdempotencia).toBe(false);
    expect(observar("export async function f(tx: any) { await registrarCambioAuditado(tx, {}); }").auditoria).toBe("REGISTRO_AUDITORIA");
    expect(observar("export async function f(tx: any) { await escribir(tx); }").auditoria).toBe("DOCUMENTO_PROPIO");
  });

  it("periodo: VERIFICA_CIERRE solo si llama a verificarPeriodoAbierto", () => {
    expect(observar("export async function f(tx: any) { await verificarPeriodoAbierto(tx, new Date(0)); }").periodo).toBe("VERIFICA_CIERRE");
    expect(observar("export async function f(tx: any) { await escribir(tx); }").periodo).toBe("NO_APLICA");
    expect(observar("// verificarPeriodoAbierto(tx)\nexport async function f() { return 1; }").periodo).toBe("NO_APLICA");
  });

  it("reloj: new Date() sin argumentos y Date.now() lo leen; new Date(x) y un texto que lo nombra no", () => {
    expect(observar("export const f = () => new Date();").reloj).toBe("NEW_DATE");
    expect(observar("export const f = () => Date.now();").reloj).toBe("NEW_DATE");
    expect(observar("export const f = (x: string) => new Date(x);").reloj).toBe("INYECTADO");
    expect(observar('// new Date()\nexport const f = "Date.now()";').reloj).toBe("INYECTADO");
  });

  it("permiso: el literal de conPermiso* que envuelve la llamada, o POR_PROCESO", () => {
    const caso = "export async function anular(ctx: any) { return 1; }";
    expect(permisosObservados(caso, ['export async function a() { return conPermiso("anular_compra", async (ctx) => anular(ctx)); }'])).toBe("anular_compra");
    expect(permisosObservados(caso, ['export async function a(x: string) { return conPermisoDeEmpresa<R>("x_y", async (ctx) => anular(ctx)); }'])).toBe("x_y");
    expect(permisosObservados(caso, ["export async function a(accion: string) { return conPermiso(accion, async (ctx) => anular(ctx)); }"])).toBe("POR_PROCESO");
    // conEdicionDePermisos (roles y matriz de permisos) también es un envoltorio de permiso, con su clave.
    expect(permisosObservados(caso, ['"use server";\nexport async function a() { return conEdicionDePermisos("gestion_roles", async (ctx) => anular(ctx)); }'])).toBe("gestion_roles");
    // SISTEMA: un envoltorio que NO es un endpoint y que no protege ningún conPermiso* (un cron). Si es un endpoint ("use server") sin permiso, sigue siendo POR_PROCESO.
    expect(permisosObservados(caso, ["export async function a(db: unknown) { return anular(db); }"])).toBe("SISTEMA");
    expect(permisosObservados(caso, ['"use server";\nexport async function a(db: unknown) { return anular(db); }'])).toBe("SIN_PERMISO");
    // Con un conPermiso* de clave variable, la clave se elige en ejecución: sigue siendo POR_PROCESO.
    expect(permisosObservados(caso, ['"use server";\nexport async function a(db: unknown, accion: string) { return conPermiso(accion, async () => anular(db)); }'])).toBe("POR_PROCESO");
    // Un endpoint con una llamada protegida por un literal y otra sin proteger: se prefiere el literal (una de las dos sí exige permiso).
    expect(permisosObservados(caso, ['"use server";\nexport async function a(db: unknown) { return conPermiso("x_y", async () => anular(db)); }\nexport async function b(db: unknown) { return anular(db); }'])).toBe("x_y");
  });

  it("problemasDeSinPermiso: la lista cerrada se revisa en las dos direcciones", () => {
    expect(problemasDeSinPermiso([], {})).toEqual([]);
    expect(problemasDeSinPermiso(["a.ts"], { "a.ts": "motivo" })).toEqual([]);
    expect(problemasDeSinPermiso(["a.ts"], {})).toEqual([expect.stringContaining("no está en CASOS_SIN_PERMISO")]);
    expect(problemasDeSinPermiso([], { "a.ts": "motivo" })).toEqual([expect.stringContaining("ningún caso de uso real declara")]);
  });

  it("leerFicha: una sola línea @ficha con sus pares; sin línea o con dos, null", () => {
    expect(leerFicha("/**\n * @ficha permiso=a_b transaccion=SERIALIZABLE idempotencia=I3 auditoria=DOCUMENTO_PROPIO reloj=INYECTADO\n */")).toEqual({
      permiso: "a_b",
      transaccion: "SERIALIZABLE",
      idempotencia: "I3",
      auditoria: "DOCUMENTO_PROPIO",
      reloj: "INYECTADO",
    });
    expect(leerFicha("/** sin ficha */")).toBeNull();
    expect(leerFicha("/**\n * @ficha permiso=a\n * @ficha permiso=b\n */")).toBeNull();
  });
});

describe("ficha de caso de uso: lo que queda fuera (la consola y las operaciones de plataforma) está declarado con motivo", () => {
  const RAIZ = join(__dirname, "..", "..");
  const CARPETAS_FUERA_DE_LA_FICHA = ["plataforma/src/servidor", "src/server/operaciones-de-plataforma"];
  const delegados = delegadosDeModelos(readFileSync(join(RAIZ, "prisma", "schema.prisma"), "utf8"));
  const archivos = CARPETAS_FUERA_DE_LA_FICHA.flatMap((carpeta) =>
    readdirSync(join(RAIZ, carpeta))
      .filter((n) => /\.tsx?$/.test(n))
      .map((n) => `${carpeta}/${n}`),
  );

  it("encuentra los archivos de esas carpetas (si no, el test no mira nada)", () => {
    expect(archivos.length).toBeGreaterThan(10);
  });

  it("todo archivo de esas carpetas que escribe la base figura en ESCRITURAS_FUERA_DE_PERSISTENCIA (con su motivo)", () => {
    const sinDeclarar = archivos.filter((ruta) => analizarFuente(readFileSync(join(RAIZ, ruta), "utf8"), ruta, delegados).escribeEnLaBase && !(ruta in ESCRITURAS_FUERA_DE_PERSISTENCIA));
    expect(sinDeclarar, `Una escritura nueva en la consola o en las operaciones de plataforma se declara en test/arquitectura/escrituras-fuera-de-persistencia.ts, con su motivo:\n${sinDeclarar.join("\n")}`).toEqual([]);
  });

  it("ninguno de esos archivos lleva @ficha (la ficha es de los casos de uso de la app de empresas; si uno la lleva, hay que decidir qué es)", () => {
    const conFicha = archivos.filter((ruta) => /@ficha\b/.test(readFileSync(join(RAIZ, ruta), "utf8")));
    expect(conFicha.map((r) => relative(RAIZ, join(RAIZ, r)).split(sep).join("/"))).toEqual([]);
  });
});

describe("ficha de caso de uso: los casos de uso del repositorio", () => {
  const casos = descubrirCasosDeUsoReales();
  const acciones = new Set<string>(ACCIONES.map((a) => a.clave));

  it("encuentra los casos de uso reales (si dejan de encontrarse, la regla quedó vacía)", () => {
    expect(casos.length).toBeGreaterThanOrEqual(23);
  });

  it("todo caso de uso real tiene su ficha completa y de vocabulario cerrado", () => {
    const problemas: string[] = [];
    for (const c of casos) {
      const ficha = leerFicha(c.fuente);
      if (!ficha) {
        problemas.push(`${c.ruta}: falta la línea @ficha (o hay más de una)`);
        continue;
      }
      for (const campo of CAMPOS) if (!ficha[campo]) problemas.push(`${c.ruta}: la ficha no declara ${campo}`);
      for (const [campo, valores] of Object.entries(VOCABULARIO)) {
        if (ficha[campo] && !(valores as readonly string[]).includes(ficha[campo])) problemas.push(`${c.ruta}: ${campo}=${ficha[campo]} no es uno de ${valores.join(", ")}`);
      }
      if (ficha.permiso && ficha.permiso !== "POR_PROCESO" && ficha.permiso !== "SISTEMA" && ficha.permiso !== "SIN_PERMISO") {
        for (const p of ficha.permiso.split("|")) if (!acciones.has(p)) problemas.push(`${c.ruta}: permiso=${p} no es una acción de ACCIONES`);
      }
    }
    expect(problemas, `Cada caso de uso lleva su línea @ficha (ver el docstring de este test):\n${problemas.join("\n")}`).toEqual([]);
  });

  it("lo que la ficha declara es lo que el código hace", () => {
    const mentiras: string[] = [];
    for (const c of casos) {
      const ficha = leerFicha(c.fuente);
      if (!ficha) continue;
      const visto = observar(c.fuente, { pasos: pasosCompartidos(c.fuente, leerHermanoDe(dirname(c.absoluta))) });
      if (ficha.transaccion !== visto.transaccion) mentiras.push(`${c.ruta}: la ficha dice transaccion=${ficha.transaccion} y el código hace ${visto.transaccion}`);
      if (ficha.auditoria !== visto.auditoria) mentiras.push(`${c.ruta}: la ficha dice auditoria=${ficha.auditoria} y el código hace ${visto.auditoria}`);
      if (ficha.periodo !== visto.periodo) mentiras.push(`${c.ruta}: la ficha dice periodo=${ficha.periodo} y el código hace ${visto.periodo}`);
      if (ficha.reloj !== visto.reloj) mentiras.push(`${c.ruta}: la ficha dice reloj=${ficha.reloj} y el código hace ${visto.reloj}`);
      if ((ficha.idempotencia === "I3") !== visto.llamaAChequearIdempotencia) {
        mentiras.push(`${c.ruta}: la ficha dice idempotencia=${ficha.idempotencia} y ${visto.llamaAChequearIdempotencia ? "el código llama" : "el código NO llama"} a chequearIdempotencia`);
      }
      const permiso = permisosObservados(c.fuente, c.envolventes.map((e) => e.fuente));
      if (ficha.permiso !== permiso) mentiras.push(`${c.ruta}: la ficha dice permiso=${ficha.permiso} y la Server Action lo protege con ${permiso}`);
    }
    expect(mentiras, `La ficha miente (o el código cambió y la ficha no):\n${mentiras.join("\n")}`).toEqual([]);
  });

  it("los casos de uso con permiso=SIN_PERMISO están todos en la lista cerrada CASOS_SIN_PERMISO (con su motivo)", () => {
    const declarados = casos.filter((c) => leerFicha(c.fuente)?.permiso === "SIN_PERMISO").map((c) => c.ruta);
    expect(problemasDeSinPermiso(declarados, CASOS_SIN_PERMISO)).toEqual([]);
  });

  it("ningún caso de uso lee el reloj: la hora entra por actor.ahora (Pureza 1.2)", () => {
    const leenElReloj = casos.filter((c) => leerFicha(c.fuente)?.reloj !== "INYECTADO" || observar(c.fuente).reloj !== "INYECTADO").map((c) => c.ruta);
    expect(leenElReloj, `Un caso de uso no lee la hora: recibe \`actor.ahora\` (ContextoDeAccion, src/server/actions/tipos.ts).\n${leenElReloj.join("\n")}`).toEqual([]);
  });
});
