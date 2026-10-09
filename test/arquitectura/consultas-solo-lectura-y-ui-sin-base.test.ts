import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { delegadosDeModelos, llamadasALaBase } from "../../scripts/arquitectura/analizar-fuente";

/**
 * Dos reglas de arquitectura de la Fase 0 del plan de pureza (PR 0.3), que cierran dos huecos que las reglas de dependency-cruiser no ven
 * porque no hace falta IMPORTAR nada para romperlas:
 *
 *  1. CONSULTAS SOLO DE LECTURA. Los archivos de `src/server/consultas/**` y los `src/core/**\/*-consulta.ts` leen para mostrar: no crean,
 *     no actualizan, no borran, no ejecutan SQL de escritura ni abren transacciones. Una escritura va por un caso de uso (`server/persistencia`),
 *     con su transacción y su auditoría; una «consulta» que escribe se salta todo eso sin que nada falle.
 *  2. LA UI NO TOCA LA BASE. Ningún `.tsx` de `src/app/`, `src/components/` ni `plataforma/src/app/` hace `ctx.db.<modelo>.<operación>` ni SQL crudo:
 *     la pantalla pide los datos a una consulta (`server/consultas`) o a una función del dominio. La regla `ui-sin-prisma` de dependency-cruiser
 *     solo ve los IMPORTS de Prisma; esta ve el acceso directo por el contexto, que es el camino que usó `margen-objetivo/page.tsx`.
 *
 * Qué NO cubre (a propósito, son pasos siguientes del plan): que la pantalla llame a una función de `core/` que consulta por dentro (las
 * Fases 2 y 3 sacan esas lecturas del dominio) y los archivos de acciones de la consola (`acciones.ts`), que son la capa de acciones y no la UI.
 *
 * Desde la auditoría de la Fase 0 (trabajo 1.12 de la rama `pureza-integracion`) la regla 1 también cubre `src/server/acceso/` (el guard de acceso y sus lectores: decide, no escribe).
 *
 * Cómo se controla: AST de TypeScript (no texto plano), con el mismo detector que usa el inventario de pureza
 * (`scripts/arquitectura/analizar-fuente.ts`). Sin excepciones: hoy no hace falta ninguna, y agregar una es una decisión de arquitectura.
 */
const RAIZ = join(__dirname, "../..");
const DELEGADOS = delegadosDeModelos(readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8"));

function archivosDe(dir: string, patron: RegExp): string[] {
  if (!existsSync(dir)) return []; // `server/lecturas` nace en la Fase 3: hasta su primer archivo la carpeta no existe
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return nombre === "node_modules" || nombre === ".next" ? [] : archivosDe(ruta, patron);
    return patron.test(nombre) && !nombre.endsWith(".d.ts") ? [ruta] : [];
  });
}

const relativa = (absoluta: string) => relative(RAIZ, absoluta).split(sep).join("/");

describe("consultas solo de lectura y UI sin base: el detector ve las violaciones (la regla no puede quedar ciega)", () => {
  it("una consulta que escribe, ejecuta SQL de escritura o abre una transacción se marca como escritura", () => {
    const escrituras = (codigo: string) => llamadasALaBase(codigo, "x.ts", DELEGADOS).filter((l) => l.clase === "escritura");
    expect(escrituras("export const f = (db: any) => db.producto.update({});")).toHaveLength(1);
    expect(escrituras("export const f = (db: any) => db.producto.createMany({});")).toHaveLength(1);
    expect(escrituras("export const f = (db: any) => db.producto.deleteMany({});")).toHaveLength(1);
    expect(escrituras("export const f = (db: any) => db.$executeRaw`update x set y = 1`;")).toHaveLength(1);
    expect(escrituras("export const f = (db: any) => db.$transaction(async () => 1);")).toHaveLength(1);
  });

  it("una consulta que solo lee NO se marca como escritura", () => {
    const escrituras = (codigo: string) => llamadasALaBase(codigo, "x.ts", DELEGADOS).filter((l) => l.clase === "escritura");
    expect(escrituras("export const f = (db: any) => db.producto.findMany({});")).toEqual([]);
    expect(escrituras("export const f = (db: any) => db.producto.groupBy({});")).toEqual([]);
    expect(escrituras("export const f = (db: any) => db.$queryRaw`select 1`;")).toEqual([]);
  });

  it("el acceso directo a la base desde una pantalla (ctx.db.<modelo>.<op>) y el SQL crudo se detectan, tanto de lectura como de escritura", () => {
    const tsx = 'export default async function P({ ctx }: { ctx: any }) { const x = await ctx.db.categoriaProducto.findMany({}); return <p>{x.length}</p>; }';
    expect(llamadasALaBase(tsx, "page.tsx", DELEGADOS)).toHaveLength(1);
    expect(llamadasALaBase("export const f = (ctx: any) => ctx.db.$queryRaw`select 1`;", "page.tsx", DELEGADOS)).toHaveLength(1);
  });

  it("una pantalla que usa un campo con el nombre de un modelo, o una consulta importada, no se marca", () => {
    const tsx = 'import { listarCategoriasActivas } from "@/server/consultas/catalogo/categorias";\nexport default async function P({ ctx }: { ctx: any }) { const x = await listarCategoriasActivas(ctx.db); return <p>{ctx.producto.nombre}{x.length}</p>; }';
    expect(llamadasALaBase(tsx, "page.tsx", DELEGADOS)).toEqual([]);
  });
});

describe("consultas solo de lectura (src/server/consultas y core/**/*-consulta.ts)", () => {
  const rutas = [...archivosDe(join(RAIZ, "src/server/consultas"), /\.tsx?$/), ...archivosDe(join(RAIZ, "src/server/lecturas"), /\.tsx?$/), ...archivosDe(join(RAIZ, "src/server/acceso"), /\.tsx?$/), ...archivosDe(join(RAIZ, "src/core"), /-consulta\.ts$/)];

  it("encuentra las consultas (si dejan de encontrarse, la regla quedó vacía)", () => {
    expect(rutas.length).toBeGreaterThanOrEqual(18);
  });

  it("ninguna escribe, ejecuta SQL de escritura ni abre transacciones", () => {
    const violaciones = rutas.flatMap((absoluta) =>
      llamadasALaBase(readFileSync(absoluta, "utf8"), absoluta, DELEGADOS)
        .filter((l) => l.clase === "escritura")
        .map((l) => `${relativa(absoluta)}:${l.linea}  ${l.nombre}`)
    );
    expect(violaciones, `Una consulta solo lee: escribir va por un caso de uso (server/persistencia), con transacción y auditoría.\n${violaciones.join("\n")}`).toEqual([]);
  });
});

describe("la UI no toca la base (.tsx de src/app, src/components y plataforma/src/app)", () => {
  const rutas = ["src/app", "src/components", "plataforma/src/app"].flatMap((c) => archivosDe(join(RAIZ, c), /\.tsx$/));

  it("encuentra las pantallas y componentes (si dejan de encontrarse, la regla quedó vacía)", () => {
    expect(rutas.length).toBeGreaterThan(150);
  });

  it("ninguno hace ctx.db.<modelo>.<operación> ni SQL crudo: pide los datos a una consulta (server/consultas)", () => {
    const violaciones = rutas.flatMap((absoluta) =>
      llamadasALaBase(readFileSync(absoluta, "utf8"), absoluta, DELEGADOS).map((l) => `${relativa(absoluta)}:${l.linea}  ${l.nombre}`)
    );
    expect(violaciones, `La pantalla no lee la base: creá o usá una consulta en src/server/consultas/<área>/.\n${violaciones.join("\n")}`).toEqual([]);
  });
});
