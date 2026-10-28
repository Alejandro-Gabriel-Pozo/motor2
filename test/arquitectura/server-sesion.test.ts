import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { analizarFuente, delegadosDeModelos, type SenalesDeFuente } from "../../scripts/arquitectura/analizar-fuente";

/**
 * `src/server/sesion/` es una lista CERRADA de archivos (Hito 3, B3-2 de `docs/plan-hito-3-pureza.md`; O.24 de `docs/pureza-integracion.md`): la capa del LOGIN, previa al contexto de
 * empresa (el gate de `signIn`, la lectura de una invitación por su token, la vinculación de la cuenta de Google). Nace en B3 con `acceso.ts` (antes `core/auth/acceso.ts`, que no era
 * núcleo: lee la base, el reloj y el entorno). Un archivo nuevo ahí es una decisión de seguridad (¿lee la base sin contexto? ¿por qué empresa?), no un cajón. Tres reglas:
 *  1. son exactamente los archivos de `PERMITIDOS`;
 *  2. todos abren con `import "server-only"`: el login nunca puede llegar al navegador;
 *  3. el reloj, el azar y el entorno que lean están DECLARADOS acá, archivo por archivo, con su motivo y en las dos direcciones (una declaración que sobra también falla). O.24: lo
 *     que quedaba (el `new Date()` del gate) se fue en la Fase 6, tramo c (O.227): el callback `signIn` lee la hora UNA vez y se la pasa al gate, hoy sin reloj. El entorno (`ALLOWED_EMAIL_DOMAINS`) se fue en S-17/D5: la capa ya no lee ninguna variable.
 * Lo que la capa no puede importar lo fija la regla `sesion-capa` de `.dependency-cruiser.cjs`.
 * Fase 6, tramo 6a: se le suman, sin tocar su código, los cinco archivos de la sesión del pedido y la base por empresa que vivían en `core/auth/` (`MUDADOS_DE_CORE_AUTH`): llegan
 * con lo que ya declaraban en el núcleo (el entorno, el `let` de `base.ts`, la falta de `server-only` en los que alcanzan los scripts con tsx), cada cosa declarada abajo con su motivo.
 */
const RAIZ = join(__dirname, "../..");
const CARPETA = join(RAIZ, "src/server/sesion");
/**
 * Fase 6, tramo 6a: `base`, `contexto`, `ir-al-login`, `rol-de-ejecucion` y `session` llegan de `core/auth/` (D-4 del plan de la Fase 4: la sesión del pedido y la base por empresa
 * se mudan UNA vez y sin tocar su código). No son el login previo al contexto: son el contexto mismo, y sus reglas propias (quién importa `base`, quién lee la sesión) ya las fijan
 * `base-solo-desde-lista`, `lib-auth-solo-desde-sus-puntos` y el analizador de guardas.
 */
const MUDADOS_DE_CORE_AUTH = ["base.ts", "contexto.ts", "ir-al-login.ts", "rol-de-ejecucion.ts", "session.ts"];
/**
 * Importador del catálogo (docs/diseno-importador-de-catalogo-2026-10-28.md §8, «punto delicado»): `contexto-de-comando.ts` arma el contexto del `--actor` del comando de un solo uso, SIN sesión.
 * Es una decisión de seguridad declarada: quién la importa (solo `scripts/importar-catalogo.ts` y su prueba) lo fija `contexto-de-comando-solo-desde-el-importador.test.ts`.
 */
const PARA_COMANDOS = ["contexto-de-comando.ts"];
const PERMITIDOS = ["acceso.ts", "invitacion.ts", "vincular-cuenta.ts", ...MUDADOS_DE_CORE_AUTH, ...PARA_COMANDOS];

/** Los que NO abren con `import "server-only"` (vinieron de `core/auth` sin la marca y se mudaron sin tocar su código), con su motivo. Revisada en las dos direcciones. */
const SIN_SERVER_ONLY: Record<string, string> = {
  "base.ts": "La importan scripts que corren con tsx (scripts/demo-seed/cliente.ts: dbDeEmpresa), donde `import \"server-only\"` revienta; la del navegador la ataja ui-sin-prisma (lib/db).",
  "rol-de-ejecucion.ts": "Solo la importa base.ts (misma razón: la alcanzan los scripts con tsx); lee el rol con el `db` que recibe.",
  "ir-al-login.ts": "Usa next/headers y next/navigation (redirect), que solo existen en el servidor; vino de core/auth sin la marca y se mudó sin tocar su código.",
};

/** Los módulos del LOGIN previo al contexto, los únicos cuyos importadores son lista cerrada (B3-10). Los mudados de core/auth los importa toda la app (contexto: ~200 archivos). */
const MODULOS_DEL_LOGIN = new Set(["acceso", "invitacion", "vincular-cuenta"]);

type Impureza = "reloj" | "azar" | "entorno";
/** `archivo` → la impureza que tiene declarada y por qué. Lo que no está acá, el archivo NO lo puede leer. */
const DECLARADAS: Record<string, Partial<Record<Impureza, string>>> = {
  // Fase 6, tramo c (O.227): `acceso.ts` ya no está acá: no lee el reloj, `ahora` entra por parámetro (obligatorio) desde el callback `signIn` de `lib/auth.ts`.
  // Fase 6, tramo 6a: llegan de core/auth con lo que ya leían (estaban declarados en PUREZA_HEREDADA_DEL_NUCLEO con la señal `entorno`).
  "base.ts": { entorno: "verificarRolDeEjecucionDelProceso pasa process.env a permitirRolPrivilegiado (ADR-022: el escape explícito del rol que salta el RLS)." },
  "contexto.ts": { entorno: "opcionesCookieActiva: la cookie de la sucursal/empresa activa es `secure` solo con NODE_ENV=production." },
  // acceso.ts, invitacion.ts y vincular-cuenta.ts NO leen el reloj: `ahora` es obligatorio y lo pasa el borde (el callback `signIn`, la pantalla, la acción, el caso de uso); acceso.ts desde la Fase 6, tramo c, invitacion.ts y vincular-cuenta.ts desde B3-9 (O.24).
};

const IMPUREZAS: Impureza[] = ["reloj", "azar", "entorno"];

/** `archivo` → las variables `let`/`var` de módulo que se aceptan, y por qué (la regla de `core-sin-estado-de-modulo.test.ts`, que se mudó con el archivo). */
const ESTADO_DE_MODULO_ACEPTADO: Record<string, { variables: string[]; motivo: string }> = {
  "base.ts": {
    variables: ["datosDelRolDelProceso"],
    motivo:
      "Memoriza (una vez por proceso) la lectura del rol de ejecución de la base para `verificarRolDeEjecucionDelProceso` (ADR-022). Era el único estado de módulo permitido en core; se mudó con base.ts (Fase 6, tramo 6a).",
  },
};

/** Los nombres de las variables `let`/`var` declaradas a nivel de módulo (no las de adentro de una función o un bloque). Mismo detector que `core-sin-estado-de-modulo.test.ts`. */
function variablesDeModulo(fuente: string): string[] {
  const sf = ts.createSourceFile("x.ts", fuente, ts.ScriptTarget.Latest, true);
  const nombres: string[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt) || stmt.declarationList.flags & ts.NodeFlags.Const) continue;
    for (const d of stmt.declarationList.declarations) nombres.push(d.name.getText(sf));
  }
  return nombres;
}

/** Las diferencias entre lo que el archivo hace (señales del analizador de pureza) y lo declarado, en las dos direcciones. */
function impurezasSinDeclarar(archivo: string, senales: Pick<SenalesDeFuente, Impureza>, declaradas: Partial<Record<Impureza, string>> | undefined): string[] {
  const problemas: string[] = [];
  for (const i of IMPUREZAS) {
    if (senales[i] && !declaradas?.[i]) problemas.push(`${archivo}: lee ${i} y no está declarado`);
    if (!senales[i] && declaradas?.[i]) problemas.push(`${archivo}: declara ${i} pero ya no lo lee (sacá la declaración)`);
  }
  return problemas;
}

/**
 * B3-4: de qué función de `server/sesion` sale cada base de `server/sesion/base` (frontera multiempresa del login). Desde un token de invitación, la base de SU empresa solo la da
 * `invitacionConSuBase` (la empresa sale de la invitación leída por el hash, nunca de un id del llamador); la base por hash, solo `invitacionDelToken`; el gate solo mira las
 * pertenencias del propio usuario. Una llamada a una fábrica de bases desde otra función (o a una que no está acá) falla.
 */
const PUERTAS_A_LA_BASE: Record<string, Record<string, string[]>> = {
  dbDeInvitacion: { "invitacion.ts": ["invitacionDelToken"] },
  // Fase 6, tramo 6a: `base.ts` arma `baseDeEmpresa` y `transaccionDeLaEmpresa` con sus propias fábricas; `contexto.ts` (obtenerSituacionDeAcceso) lee las pertenencias
  // PROPIAS del usuario (dbDeUsuario), las sucursales de cada empresa bajo su contexto (dbDeEmpresa) y arma la base del pedido (baseDeEmpresa): es quien da `ctx.db`.
  // `contexto-de-comando.ts` (importador del catálogo): las membresías del actor bajo su empresa, las pertenencias PROPIAS del actor y la base del comando, como `obtenerSituacionDeAcceso`.
  dbDeEmpresa: { "invitacion.ts": ["invitacionConSuBase"], "acceso.ts": ["tieneSucursalActiva"], "base.ts": ["baseDeEmpresa"], "contexto.ts": ["obtenerSituacionDeAcceso"], "contexto-de-comando.ts": ["contextoDeActorParaComando"] },
  transaccionDeLaEmpresa: { "invitacion.ts": ["invitacionConSuBase"], "base.ts": ["baseDeEmpresa"] },
  // `sesionSigueVigente` (M-20): cuenta las pertenencias PROPIAS del usuario de la sesión para no expulsar al invitado que todavía no aceptó (nunca tuvo una).
  dbDeUsuario: { "acceso.ts": ["tieneSucursalActiva", "sesionSigueVigente"], "contexto.ts": ["obtenerSituacionDeAcceso"], "contexto-de-comando.ts": ["contextoDeActorParaComando"] },
  transaccionDeEmpresa: { "base.ts": ["transaccionDeLaEmpresa"] },
  baseDeEmpresa: { "contexto.ts": ["obtenerSituacionDeAcceso"], "contexto-de-comando.ts": ["contextoDeActorParaComando"] },
  baseDelContexto: {},
};

/** Las llamadas a una fábrica de bases que no salen de su puerta declarada: `archivo:funcion → fabrica`. */
function puertasNoDeclaradas(archivo: string, codigo: string): string[] {
  const fuente = ts.createSourceFile(archivo, codigo, ts.ScriptTarget.Latest, true);
  const problemas: string[] = [];
  const visitar = (n: ts.Node, funcion: string): void => {
    let dentro = funcion;
    if (ts.isFunctionDeclaration(n) && n.name) dentro = n.name.text;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) dentro = n.name.text;
    // Fase 6, tramo 6a: `export const f = cache(async () => …)` (contexto.ts) es la función `f`, no el módulo.
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isCallExpression(n.initializer) && n.initializer.arguments.some((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a))) dentro = n.name.text;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text in PUERTAS_A_LA_BASE) {
      const fabrica = n.expression.text;
      if (!(PUERTAS_A_LA_BASE[fabrica][archivo] ?? []).includes(dentro)) problemas.push(`${archivo}:${dentro || "(módulo)"} → ${fabrica}`);
    }
    ts.forEachChild(n, (h) => visitar(h, dentro));
  };
  visitar(fuente, "");
  return problemas;
}

/**
 * B3-10: QUIÉN importa `server/sesion` (lista cerrada, con motivo, revisada en las dos direcciones). El login previo al contexto lee la base sin sesión: un importador nuevo (una
 * pantalla, otra acción, una consulta) es una decisión de seguridad, no un atajo para saltear `obtenerContextoUsuario`. Los archivos de la propia carpeta no cuentan.
 */
const IMPORTADORES: Record<string, { modulos: string[]; motivo: string }> = {
  "src/lib/auth.ts": { modulos: ["acceso"], motivo: "El callback signIn de Auth.js decide el ingreso con decidirInicioDeSesion (ADR-024)." },
  "src/app/invitacion/page.tsx": { modulos: ["invitacion"], motivo: "La pantalla pública de la invitación la lee por el token de la cookie (invitacionConSuBase) y muestra sus sucursales." },
  "src/server/actions/auth/invitacion.ts": { modulos: ["invitacion"], motivo: "abrirInvitacion lee la invitación del enlace (invitacionDelToken) antes de guardar la cookie; es su guard (GUARDAS_POR_MODULO)." },
  "src/server/actions/auth/casos-de-uso/aceptar-invitacion-de-gerente.ts": { modulos: ["invitacion"], motivo: "Pide la base de la empresa de la invitación por invitacionConSuBase (B3-4/B3-5)." },
  "src/server/actions/auth/casos-de-uso/aceptar-invitacion-de-usuario.ts": { modulos: ["invitacion"], motivo: "Pide la base de la empresa de la invitación por invitacionConSuBase (B3-4/B3-7)." },
};

/** Los módulos de `server/sesion` que importa (o reexporta) un fuente, por sus especificadores con alias o relativos. */
function modulosDeSesionImportados(rutaRelativa: string, codigo: string): string[] {
  const fuente = ts.createSourceFile(rutaRelativa, codigo, ts.ScriptTarget.Latest, true, rutaRelativa.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const modulos = new Set<string>();
  for (const st of fuente.statements) {
    if (!(ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) || !st.moduleSpecifier || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const esp = st.moduleSpecifier.text;
    const absoluto = esp.startsWith("@/") ? `src/${esp.slice(2)}` : esp.startsWith(".") ? join(rutaRelativa, "..", esp).split(sep).join("/") : null;
    const m = absoluto && /^src\/server\/sesion\/([^/]+?)(?:\.tsx?)?$/.exec(absoluto);
    if (m) modulos.add(m[1]);
  }
  return [...modulos].sort();
}

function fuentesDe(dir: string): string[] {
  return readdirSync(join(RAIZ, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    return e.isDirectory() ? fuentesDe(rel) : /\.tsx?$/.test(e.name) ? [rel] : [];
  });
}

describe("server/sesion: quién la importa (lista cerrada)", () => {
  it("los importadores de server/sesion son exactamente los declarados, con los módulos declarados", () => {
    const reales: Record<string, string[]> = {};
    for (const rel of [...fuentesDe("src"), ...fuentesDe("plataforma/src")]) {
      if (rel.startsWith("src/server/sesion/")) continue;
      const modulos = modulosDeSesionImportados(rel, readFileSync(join(RAIZ, rel), "utf8")).filter((m) => MODULOS_DEL_LOGIN.has(m));
      if (modulos.length > 0) reales[rel] = modulos;
    }
    const declarados = Object.fromEntries(Object.entries(IMPORTADORES).map(([r, d]) => [r, [...d.modulos].sort()]));
    expect(reales, "un importador nuevo de server/sesion se declara en IMPORTADORES con su motivo (y uno que ya no importa, se saca)").toEqual(declarados);
    for (const [r, d] of Object.entries(IMPORTADORES)) expect(d.motivo.trim().length, `${r} sin motivo`).toBeGreaterThan(20);
  });

  it("el detector de importadores: alias, relativo y reexportación; un comentario no cuenta", () => {
    expect(modulosDeSesionImportados("src/lib/x.ts", 'import { a } from "@/server/sesion/acceso";')).toEqual(["acceso"]);
    expect(modulosDeSesionImportados("src/server/actions/auth/x.ts", 'import { a } from "../../sesion/invitacion";')).toEqual(["invitacion"]);
    expect(modulosDeSesionImportados("src/x.ts", 'export { a } from "./server/sesion/vincular-cuenta";')).toEqual(["vincular-cuenta"]);
    expect(modulosDeSesionImportados("src/x.ts", '// import { a } from "@/server/sesion/acceso";\nimport { b } from "@/server/acceso/gate";')).toEqual([]);
  });
});

describe("server/sesion: lista cerrada, server-only y reloj/entorno declarados", () => {
  it("la base de la empresa de una invitación sale solo de invitacionConSuBase (y cada fábrica de bases, solo de su puerta)", () => {
    const problemas = readdirSync(CARPETA)
      .filter((f) => /\.tsx?$/.test(f))
      .flatMap((f) => puertasNoDeclaradas(f, readFileSync(join(CARPETA, f), "utf8")));
    expect(problemas, "pedí la base por invitacionConSuBase (B3-4), o declarala en PUERTAS_A_LA_BASE con su motivo").toEqual([]);
  });

  it("el detector de puertas: una fábrica de bases fuera de su función declarada", () => {
    expect(puertasNoDeclaradas("invitacion.ts", "export async function invitacionConSuBase(t: string) { return { db: dbDeEmpresa(t), tx: transaccionDeLaEmpresa(t) }; }")).toEqual([]);
    expect(puertasNoDeclaradas("vincular-cuenta.ts", "export async function vincular(e: string) { return transaccionDeLaEmpresa(e); }")).toEqual(["vincular-cuenta.ts:vincular → transaccionDeLaEmpresa"]);
    expect(puertasNoDeclaradas("invitacion.ts", "export const accesos = async (v: { empresaId: string }) => dbDeEmpresa(v.empresaId).x;")).toEqual(["invitacion.ts:accesos → dbDeEmpresa"]);
    expect(puertasNoDeclaradas("invitacion.ts", "const db = baseDeEmpresa('e');")).toEqual(["invitacion.ts:(módulo) → baseDeEmpresa"]);
    expect(puertasNoDeclaradas("contexto.ts", "export const otra = cache(async () => dbDeEmpresa('e'));")).toEqual(["contexto.ts:otra → dbDeEmpresa"]);
  });

  const archivos = readdirSync(CARPETA).filter((f) => /\.tsx?$/.test(f)).sort();
  const delegados = delegadosDeModelos(readFileSync(join(RAIZ, "prisma", "schema.prisma"), "utf8"));

  it("son exactamente los archivos permitidos (ni uno más, ni uno menos)", () => {
    expect(archivos).toEqual([...PERMITIDOS].sort());
  });

  it('todos abren con import "server-only" (salvo SIN_SERVER_ONLY, con motivo, que de verdad no la tienen)', () => {
    const sinMarca = archivos.filter((f) => !/^import "server-only";/m.test(readFileSync(join(CARPETA, f), "utf8")));
    expect(sinMarca).toEqual(Object.keys(SIN_SERVER_ONLY).sort());
    for (const [f, motivo] of Object.entries(SIN_SERVER_ONLY)) expect(motivo.trim().length, `${f} sin motivo`).toBeGreaterThan(20);
  });

  it("estado de módulo (let/var): solo el declarado, que vino con base.ts desde core/auth/ (Fase 6, tramo 6a; antes en ESTADO_DE_MODULO_ACEPTADO de core-sin-estado-de-modulo)", () => {
    const encontradas = Object.fromEntries(archivos.map((f) => [f, variablesDeModulo(readFileSync(join(CARPETA, f), "utf8"))] as const).filter(([, vs]) => vs.length > 0));
    expect(encontradas, "estado de módulo nuevo en server/sesion: declaralo en ESTADO_DE_MODULO_ACEPTADO con su motivo (o sacalo)").toEqual(
      Object.fromEntries(Object.entries(ESTADO_DE_MODULO_ACEPTADO).map(([f, e]) => [f, e.variables])),
    );
  });

  it("el reloj, el azar y el entorno que leen están declarados con motivo (y nada declarado sobra)", () => {
    const problemas = archivos.flatMap((f) => impurezasSinDeclarar(f, analizarFuente(readFileSync(join(CARPETA, f), "utf8"), `src/server/sesion/${f}`, delegados), DECLARADAS[f]));
    for (const f of Object.keys(DECLARADAS)) if (!archivos.includes(f)) problemas.push(`${f}: declarado y no existe`);
    expect(problemas, "server/sesion no lee la hora, el azar ni el entorno sin declararlo (O.24)").toEqual([]);
  });

  it("el detector: ve el reloj y el entorno, y una declaración de más", () => {
    const sin = { reloj: false, azar: false, entorno: false };
    expect(impurezasSinDeclarar("x.ts", { ...sin, reloj: true }, undefined)).toEqual(["x.ts: lee reloj y no está declarado"]);
    expect(impurezasSinDeclarar("x.ts", { ...sin, entorno: true }, { entorno: "m" })).toEqual([]);
    expect(impurezasSinDeclarar("x.ts", sin, { azar: "m" })).toEqual(["x.ts: declara azar pero ya no lo lee (sacá la declaración)"]);
    const senales = analizarFuente("export const f = () => [new Date(), process.env.X];", "x.ts", delegados);
    expect([senales.reloj, senales.entorno]).toEqual([true, true]);
  });
});
