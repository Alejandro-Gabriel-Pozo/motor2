import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura (add-on de plataforma, ADR-008): toda escritura de `PermisoRol` y de `Rol` en `src/` ocurre DENTRO de un
 * `conEdicionDePermisos(...)`, el gate que además de la clave exige que la plataforma le deje a la empresa editar permisos
 * (`politicaDeEmpresa`). Una escritura nueva sin ese gate dejaría un camino para editar permisos que el interruptor no corta.
 *
 * Escrituras: `<algo>.permisoRol.<create|createMany|update|updateMany|upsert|delete|deleteMany>` y lo mismo sobre `<algo>.rol`.
 *
 * Excepciones, cada una con su motivo:
 *  - `core/features/empresa/sembrar-empresa.ts` (la usan `crearEmpresa` y el alta de la consola): el alta de una empresa siembra sus roles y permisos de fábrica; ahí todavía no existe una
 *    empresa a la que aplicarle una política (la decide la plataforma al crearla). `prisma/seed.ts` queda fuera de `src/`.
 */
const RAIZ = join(__dirname, "../../src");
const EXCEPCIONES = ["core/features/empresa/sembrar-empresa.ts"];
const MODELOS = new Set(["permisoRol", "rol"]);
const ESCRITURAS = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
const GATE = "conEdicionDePermisos";

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

describe("escrituras de permisos y roles: siempre dentro de conEdicionDePermisos", () => {
  const rutas = archivos(RAIZ);
  const nombreDe = (ruta: string) => relative(RAIZ, ruta).split(sep).join("/");

  it("encuentra archivos de src/", () => {
    expect(rutas.length).toBeGreaterThan(50);
  });

  it("ninguna escritura de PermisoRol/Rol queda fuera del gate (salvo las excepciones)", () => {
    const problemas: string[] = [];
    for (const ruta of rutas) {
      const nombre = nombreDe(ruta);
      if (EXCEPCIONES.includes(nombre)) continue;
      for (const m of escriturasSinGate(readFileSync(ruta, "utf8"))) problemas.push(`${nombre} (${m})`);
    }
    expect(problemas, `Estas escrituras de permisos/roles no pasan por conEdicionDePermisos (política de la empresa):\n${problemas.join("\n")}`).toEqual([]);
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

    it("no marca lecturas, otros modelos ni un comentario", () => {
      const fuente = ["// ctx.db.rol.create({})", "await ctx.db.rol.findMany({});", "await ctx.db.permisoRol.count({});", "await ctx.db.usuario.update({});"].join("\n");
      expect(escriturasSinGate(fuente)).toEqual([]);
    });
  });
});
