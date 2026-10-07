import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura (add-on de plataforma, ADR-008; contrato C5 del RBAC desde el Hito 3, paso 0.6): toda escritura de `PermisoRol` y de `Rol` en `src/`
 * queda detrás de un `conEdicionDePermisos(...)`, el gate que además de la clave exige que la plataforma le deje a la empresa editar permisos
 * (`politicaDeEmpresa`). Una escritura nueva sin ese gate dejaría un camino para editar permisos que el interruptor no corta. Vale de una de dos formas:
 *
 *  (i)  la escritura está, en el texto, DENTRO de la llamada a `conEdicionDePermisos(...)` (las Server Actions de hoy);
 *  (ii) la escritura está en la persistencia de permisos (`PERSISTENCIA_DE_PERMISOS`: `server/persistencia/permisos/{roles,matriz}.ts`, adonde la llevan los
 *       casos de uso de la Fase I) y ese archivo SOLO lo importan casos de uso (`server/actions/<dominio>/casos-de-uso/*`) a los que SOLO importan Server Actions
 *       de su dominio (`server/actions/<dominio>/*.ts`) que llaman a cada función del caso de uso ÚNICAMENTE dentro de `conEdicionDePermisos(...)`. Así el gate
 *       sigue delante de la escritura aunque ya no la rodee en el mismo archivo: un caso de uso de roles llamado desde `conPermisoDeEmpresa` (o desde un
 *       cron, o importado por otra capa) rompe la regla.
 *
 * Escrituras: `<algo>.permisoRol.<create|createMany|update|updateMany|upsert|delete|deleteMany>` y lo mismo sobre `<algo>.rol`.
 *
 * Excepciones, cada una con su motivo:
 *  - `plataforma/src/servidor/sembrar-empresa.ts` (la usan `crearEmpresa` y el alta de la consola; vive en la consola desde Pureza Fase 4, tramo B): el alta de una empresa siembra sus
 *    roles y permisos de fábrica; ahí todavía no existe una empresa a la que aplicarle una política (la decide la plataforma al crearla). `prisma/seed.ts` queda fuera de `src/`.
 *    Ya no está en `src/`: en `src/` NO queda ninguna excepción, y la consola (`plataforma/src`) solo puede escribir esos modelos en ese archivo (último test de este archivo).
 */
const RAIZ = join(__dirname, "../../src");
const EXCEPCIONES: string[] = [];
const CONSOLA = join(__dirname, "../../plataforma/src");
const SIEMBRA_EN_LA_CONSOLA = "servidor/sembrar-empresa.ts";
const MODELOS = new Set(["permisoRol", "rol"]);
const ESCRITURAS = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
const GATE = "conEdicionDePermisos";
/** Modo (ii): la persistencia de permisos, relativa a `src/`. Su escritura vale si el grafo de quién la llama pasa SOLO por `conEdicionDePermisos`. */
const PERSISTENCIA_DE_PERMISOS = ["server/persistencia/permisos/roles.ts", "server/persistencia/permisos/matriz.ts"];

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

function estaDentroDelGate(nodo: ts.Node): boolean {
  for (let p: ts.Node | undefined = nodo.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === GATE) return true;
  }
  return false;
}

/** Las escrituras de `PermisoRol`/`Rol` de un fuente que NO están dentro de `conEdicionDePermisos`: `<modelo>.<método>:<línea>`. */
function escriturasSinGate(fuente: string): string[] {
  const sf = ts.createSourceFile("x.ts", fuente, ts.ScriptTarget.Latest, true);
  const malas: string[] = [];
  const visitar = (nodo: ts.Node): void => {
    if (ts.isCallExpression(nodo) && ts.isPropertyAccessExpression(nodo.expression)) {
      const metodo = nodo.expression.name.text;
      const objeto = nodo.expression.expression;
      if (ESCRITURAS.has(metodo) && ts.isPropertyAccessExpression(objeto) && MODELOS.has(objeto.name.text) && !estaDentroDelGate(nodo)) {
        malas.push(`${objeto.name.text}.${metodo}:${sf.getLineAndCharacterOfPosition(nodo.getStart(sf)).line + 1}`);
      }
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(sf);
  return malas;
}

function escribeModelos(fuente: string): boolean {
  const sf = ts.createSourceFile("x.ts", fuente, ts.ScriptTarget.Latest, true);
  let escribe = false;
  const visitar = (nodo: ts.Node): void => {
    if (ts.isCallExpression(nodo) && ts.isPropertyAccessExpression(nodo.expression)) {
      const objeto = nodo.expression.expression;
      if (ESCRITURAS.has(nodo.expression.name.text) && ts.isPropertyAccessExpression(objeto) && MODELOS.has(objeto.name.text)) escribe = true;
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(sf);
  return escribe;
}

/** Los módulos que importa un fuente (también `import type` y `export … from`), resueltos a rutas relativas a `src/` sin extensión (`@/x` y `./x`, `../x`). */
function importados(rutaDelImportador: string, fuente: string): Set<string> {
  const sf = ts.createSourceFile("x.ts", fuente, ts.ScriptTarget.Latest, true);
  const resultado = new Set<string>();
  for (const stmt of sf.statements) {
    const spec = (ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : null;
    if (!spec) continue;
    if (spec.startsWith("@/")) resultado.add(spec.slice(2).replace(/\.tsx?$/, ""));
    else if (spec.startsWith(".")) resultado.add(posix.normalize(posix.join(posix.dirname(rutaDelImportador), spec)).replace(/\.tsx?$/, ""));
  }
  return resultado;
}

const sinExtension = (ruta: string) => ruta.replace(/\.tsx?$/, "");

/** Las funciones exportadas de un fuente (`export function`, `export async function`, `export const f = …`). */
function exportadas(fuente: string): Set<string> {
  const sf = ts.createSourceFile("x.ts", fuente, ts.ScriptTarget.Latest, true);
  const nombres = new Set<string>();
  for (const stmt of sf.statements) {
    if (!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isFunctionDeclaration(stmt) && stmt.name) nombres.add(stmt.name.text);
    if (ts.isVariableStatement(stmt)) for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name)) nombres.add(d.name.text);
  }
  return nombres;
}

/** Las llamadas (`f(…)`) a alguna de `funciones` que NO están dentro de `conEdicionDePermisos(...)`, como `<f>:<línea>`. */
function llamadasFueraDelGate(fuente: string, funciones: ReadonlySet<string>): string[] {
  const sf = ts.createSourceFile("x.ts", fuente, ts.ScriptTarget.Latest, true);
  const fuera: string[] = [];
  const visitar = (nodo: ts.Node): void => {
    if (ts.isCallExpression(nodo) && ts.isIdentifier(nodo.expression) && funciones.has(nodo.expression.text) && !estaDentroDelGate(nodo)) {
      fuera.push(`${nodo.expression.text}:${sf.getLineAndCharacterOfPosition(nodo.getStart(sf)).line + 1}`);
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(sf);
  return fuera;
}

/**
 * Modo (ii) sobre un conjunto de archivos (`ruta relativa a src/` → fuente): para cada archivo de `PERSISTENCIA_DE_PERMISOS` que exista, quién lo importa tiene
 * que ser un caso de uso; a cada caso de uso lo importan solo Server Actions de su dominio; y en ellas cada llamada a una función del caso de uso va dentro de
 * `conEdicionDePermisos`. Devuelve los problemas (vacío = la escritura de esa persistencia está detrás del gate).
 */
function problemasDeLaPersistenciaDePermisos(archivosDeSrc: ReadonlyMap<string, string>, persistencias: readonly string[] = PERSISTENCIA_DE_PERMISOS): string[] {
  const problemas: string[] = [];
  const quienesImportan = (destino: string) => [...archivosDeSrc].filter(([ruta, fuente]) => ruta !== destino && importados(ruta, fuente).has(sinExtension(destino)));
  for (const persistencia of persistencias) {
    if (!archivosDeSrc.has(persistencia)) continue;
    for (const [caso, fuenteDelCaso] of quienesImportan(persistencia)) {
      const m = /^(server\/actions\/[^/]+)\/casos-de-uso\/[^/]+\.tsx?$/.exec(caso);
      if (!m) {
        problemas.push(`${persistencia}: la importa ${caso}, que no es un caso de uso (server/actions/<dominio>/casos-de-uso/*)`);
        continue;
      }
      const funciones = exportadas(fuenteDelCaso);
      for (const [accion, fuenteDeLaAccion] of quienesImportan(caso)) {
        if (posix.dirname(accion) !== m[1]) {
          problemas.push(`${caso} (escribe permisos/roles por ${persistencia}): lo importa ${accion}, que no es una Server Action de ${m[1]}`);
          continue;
        }
        for (const llamada of llamadasFueraDelGate(fuenteDeLaAccion, funciones)) {
          problemas.push(`${accion}: llama a ${llamada} (de ${caso}, que escribe permisos/roles) fuera de ${GATE}`);
        }
      }
    }
  }
  return problemas;
}

describe("escrituras de permisos y roles: siempre dentro de conEdicionDePermisos", () => {
  const rutas = archivos(RAIZ);
  const nombreDe = (ruta: string) => relative(RAIZ, ruta).split(sep).join("/");

  it("encuentra archivos de src/", () => {
    expect(rutas.length).toBeGreaterThan(50);
  });

  it("ninguna escritura de PermisoRol/Rol queda fuera del gate (salvo las excepciones y la persistencia de permisos, que es el modo ii)", () => {
    const problemas: string[] = [];
    for (const ruta of rutas) {
      const nombre = nombreDe(ruta);
      if (EXCEPCIONES.includes(nombre) || PERSISTENCIA_DE_PERMISOS.includes(nombre)) continue;
      for (const m of escriturasSinGate(readFileSync(ruta, "utf8"))) problemas.push(`${nombre} (${m})`);
    }
    expect(problemas, `Estas escrituras de permisos/roles no pasan por conEdicionDePermisos (política de la empresa):\n${problemas.join("\n")}`).toEqual([]);
  });

  it("modo ii: la persistencia de permisos solo se alcanza desde casos de uso llamados dentro de conEdicionDePermisos", () => {
    const archivosDeSrc = new Map(rutas.map((r) => [nombreDe(r), readFileSync(r, "utf8")]));
    const problemas = problemasDeLaPersistenciaDePermisos(archivosDeSrc);
    expect(problemas, `La escritura de permisos/roles de la persistencia quedó alcanzable sin la política de la empresa:\n${problemas.join("\n")}`).toEqual([]);
  });

  it("la consola de plataforma solo escribe PermisoRol/Rol en la siembra de una empresa nueva (no hay empresa a la que aplicarle una política)", () => {
    const consola = archivos(CONSOLA).map((r) => ({ nombre: relative(CONSOLA, r).split(sep).join("/"), fuente: readFileSync(r, "utf8") }));
    expect(consola.length).toBeGreaterThan(20);
    expect(consola.filter((a) => a.nombre !== SIEMBRA_EN_LA_CONSOLA && escribeModelos(a.fuente)).map((a) => a.nombre)).toEqual([]);
    const siembra = consola.find((a) => a.nombre === SIEMBRA_EN_LA_CONSOLA);
    expect(siembra, `${SIEMBRA_EN_LA_CONSOLA} ya no existe: actualizá la excepción`).toBeDefined();
    expect(escribeModelos(siembra!.fuente), `${SIEMBRA_EN_LA_CONSOLA} ya no escribe PermisoRol/Rol: sacalo de la excepción`).toBe(true);
  });

  it("las excepciones existen y siguen escribiendo estos modelos (la lista no quedó desactualizada)", () => {
    const porNombre = new Map(rutas.map((r) => [nombreDe(r), r]));
    for (const excepcion of EXCEPCIONES) {
      const ruta = porNombre.get(excepcion);
      expect(ruta, `${excepcion} ya no existe: actualizá la lista`).toBeDefined();
      expect(escribeModelos(readFileSync(ruta!, "utf8")), `${excepcion} ya no escribe PermisoRol/Rol: sacalo de la lista`).toBe(true);
    }
  });

  it("el gate se usa de verdad: hay escrituras dentro de conEdicionDePermisos (la regla no quedó vacía)", () => {
    const conEscritura = rutas.filter((r) => !EXCEPCIONES.includes(nombreDe(r)) && escribeModelos(readFileSync(r, "utf8")));
    expect(conEscritura.map(nombreDe).sort()).toEqual(["server/actions/permisos/permisos.ts", "server/actions/permisos/roles.ts"]);
  });

  describe("el detector (con fuentes sintéticas)", () => {
    it("marca una escritura fuera del gate, también sobre una transacción", () => {
      const fuente = ["export async function a(ctx) {", "  await ctx.db.rol.create({});", "  await ctx.db.$transaction((tx) => tx.permisoRol.upsert({}));", "}"].join("\n");
      expect(escriturasSinGate(fuente)).toEqual(["rol.create:2", "permisoRol.upsert:3"]);
    });

    it("no marca la escritura dentro de conEdicionDePermisos, ni con un tipo genérico, ni una anidada en una transacción", () => {
      const fuente = [
        'export const a = () => conEdicionDePermisos("gestion_roles", async (ctx) => { await ctx.db.rol.update({}); });',
        'export const b = () => conEdicionDePermisos<R>("gestion_permisos", (ctx) => ctx.db.$transaction(async (tx) => { await tx.permisoRol.deleteMany({}); }));',
      ].join("\n");
      expect(escriturasSinGate(fuente)).toEqual([]);
    });

    it("marca la escritura dentro de OTRO gate (conPermisoDeEmpresa no alcanza)", () => {
      const fuente = 'export const a = () => conPermisoDeEmpresa("gestion_roles", async (ctx) => { await ctx.db.rol.create({}); });';
      expect(escriturasSinGate(fuente)).toEqual(["rol.create:1"]);
    });

    describe("modo ii (persistencia de permisos detrás de casos de uso)", () => {
      const PERSISTENCIA = "server/persistencia/permisos/roles.ts";
      const CASO = "server/actions/permisos/casos-de-uso/crear-rol.ts";
      const ACCION = "server/actions/permisos/roles.ts";
      const base = (accion: string, extra: [string, string][] = []) =>
        new Map<string, string>([
          [PERSISTENCIA, "export async function insertarRol(tx: any, nombre: string) { return tx.rol.create({ data: { nombre } }); }"],
          [CASO, 'import { insertarRol } from "@/server/persistencia/permisos/roles";\nexport async function crearRolCasoDeUso(tx: any, n: string) { return insertarRol(tx, n); }'],
          [ACCION, accion],
          ...extra,
        ]);
      const conGate = 'import { crearRolCasoDeUso } from "./casos-de-uso/crear-rol";\nexport async function crearRol(n: string) { return conEdicionDePermisos("gestion_roles", async (ctx) => crearRolCasoDeUso(ctx.db, n)); }';

      it("vale si el único camino a la escritura pasa por conEdicionDePermisos (con imports relativos o con alias)", () => {
        expect(problemasDeLaPersistenciaDePermisos(base(conGate))).toEqual([]);
        const conAlias = conGate.replace("./casos-de-uso/crear-rol", "@/server/actions/permisos/casos-de-uso/crear-rol");
        expect(problemasDeLaPersistenciaDePermisos(base(conAlias))).toEqual([]);
      });

      it("marca la Server Action que llama al caso de uso desde otro envoltorio (conPermisoDeEmpresa no alcanza)", () => {
        const otroGate = conGate.replace("conEdicionDePermisos", "conPermisoDeEmpresa");
        expect(problemasDeLaPersistenciaDePermisos(base(otroGate))).toEqual([`${ACCION}: llama a crearRolCasoDeUso:2 (de ${CASO}, que escribe permisos/roles) fuera de conEdicionDePermisos`]);
      });

      it("marca una segunda llamada sin gate en la misma Server Action", () => {
        const doble = `${conGate}\nexport async function otra(db: any) { return crearRolCasoDeUso(db, "x"); }`;
        expect(problemasDeLaPersistenciaDePermisos(base(doble))).toEqual([`${ACCION}: llama a crearRolCasoDeUso:3 (de ${CASO}, que escribe permisos/roles) fuera de conEdicionDePermisos`]);
      });

      it("marca que la persistencia la importe algo que no es un caso de uso, y que el caso de uso lo importe otra capa", () => {
        const cron = ["server/sincronizaciones/roles.ts", 'import { insertarRol } from "../persistencia/permisos/roles";\nexport const x = insertarRol;'] as [string, string];
        expect(problemasDeLaPersistenciaDePermisos(base(conGate, [cron]))).toEqual([
          `${PERSISTENCIA}: la importa server/sincronizaciones/roles.ts, que no es un caso de uso (server/actions/<dominio>/casos-de-uso/*)`,
        ]);
        const otraCapa = ["server/actions/auth/usuarios.ts", 'import { crearRolCasoDeUso } from "../permisos/casos-de-uso/crear-rol";'] as [string, string];
        expect(problemasDeLaPersistenciaDePermisos(base(conGate, [otraCapa]))).toEqual([
          `${CASO} (escribe permisos/roles por ${PERSISTENCIA}): lo importa server/actions/auth/usuarios.ts, que no es una Server Action de server/actions/permisos`,
        ]);
      });

      it("sin la persistencia de permisos en el repositorio no hay nada que revisar (hoy, antes de la Fase I)", () => {
        expect(problemasDeLaPersistenciaDePermisos(new Map([[ACCION, conGate]]))).toEqual([]);
      });
    });

    it("no marca lecturas, otros modelos ni un comentario", () => {
      const fuente = ["// ctx.db.rol.create({})", "await ctx.db.rol.findMany({});", "await ctx.db.permisoRol.count({});", "await ctx.db.usuario.update({});"].join("\n");
      expect(escriturasSinGate(fuente)).toEqual([]);
    });
  });
});
