import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
 *     que queda (el `new Date()` y `ALLOWED_EMAIL_DOMAINS` del gate) se va con la Fase 6, cuando el borde de Auth.js reciba la hora y el entorno ya leídos.
 * Lo que la capa no puede importar lo fija la regla `sesion-capa` de `.dependency-cruiser.cjs`.
 */
const RAIZ = join(__dirname, "../..");
const CARPETA = join(RAIZ, "src/server/sesion");
const PERMITIDOS = ["acceso.ts", "invitacion.ts", "vincular-cuenta.ts"];

type Impureza = "reloj" | "azar" | "entorno";
const MOTIVO_FASE_6_RELOJ =
  "Fase 6: el callback `signIn` de Auth.js (lib/auth.ts) no recibe la hora; el gate la lee UNA vez (vence la sesión abierta de otra cuenta y pasa la misma hora a la invitación)";
const MOTIVO_FASE_6_ENTORNO = "Fase 6: ALLOWED_EMAIL_DOMAINS (la vía 1 del gate, dominios de Google Workspace) se lee acá hasta que el borde de Auth.js reciba el entorno validado (src/env.ts)";

/** `archivo` → la impureza que tiene declarada y por qué. Lo que no está acá, el archivo NO lo puede leer. */
const DECLARADAS: Record<string, Partial<Record<Impureza, string>>> = {
  "acceso.ts": { reloj: MOTIVO_FASE_6_RELOJ, entorno: MOTIVO_FASE_6_ENTORNO },
  // B3-3 los muda tal cual: todavía tienen `ahora = new Date()` como valor por defecto. B3-9 (O.24) vuelve `ahora` obligatorio y saca estas dos declaraciones.
  "invitacion.ts": { reloj: "B3-9: `ahora` con valor por defecto `new Date()` en invitacionDelToken, invitacionHabilitaElIngreso y las dos aceptaciones; pasa a obligatorio" },
  "vincular-cuenta.ts": { reloj: "B3-9: `ahora` con valor por defecto `new Date()` en vincularCuentaConInvitacion; pasa a obligatorio" },
};

const IMPUREZAS: Impureza[] = ["reloj", "azar", "entorno"];

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
 * B3-4: de qué función de `server/sesion` sale cada base de `core/auth/base` (frontera multiempresa del login). Desde un token de invitación, la base de SU empresa solo la da
 * `invitacionConSuBase` (la empresa sale de la invitación leída por el hash, nunca de un id del llamador); la base por hash, solo `invitacionDelToken`; el gate solo mira las
 * pertenencias del propio usuario. Una llamada a una fábrica de bases desde otra función (o a una que no está acá) falla.
 */
const PUERTAS_A_LA_BASE: Record<string, Record<string, string[]>> = {
  dbDeInvitacion: { "invitacion.ts": ["invitacionDelToken"] },
  dbDeEmpresa: { "invitacion.ts": ["invitacionConSuBase"], "acceso.ts": ["tieneSucursalActiva"] },
  transaccionDeLaEmpresa: { "invitacion.ts": ["invitacionConSuBase"] },
  dbDeUsuario: { "acceso.ts": ["tieneSucursalActiva"] },
  transaccionDeEmpresa: {},
  baseDeEmpresa: {},
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
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text in PUERTAS_A_LA_BASE) {
      const fabrica = n.expression.text;
      if (!(PUERTAS_A_LA_BASE[fabrica][archivo] ?? []).includes(dentro)) problemas.push(`${archivo}:${dentro || "(módulo)"} → ${fabrica}`);
    }
    ts.forEachChild(n, (h) => visitar(h, dentro));
  };
  visitar(fuente, "");
  return problemas;
}

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
  });

  const archivos = readdirSync(CARPETA).filter((f) => /\.tsx?$/.test(f)).sort();
  const delegados = delegadosDeModelos(readFileSync(join(RAIZ, "prisma", "schema.prisma"), "utf8"));

  it("son exactamente los archivos permitidos (ni uno más, ni uno menos)", () => {
    expect(archivos).toEqual([...PERMITIDOS].sort());
  });

  it('todos abren con import "server-only"', () => {
    const sinMarca = archivos.filter((f) => !/^import "server-only";/m.test(readFileSync(join(CARPETA, f), "utf8")));
    expect(sinMarca).toEqual([]);
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
