import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La consola de plataforma (`plataforma/`, E4, ADR-012, ADR-019) es otra aplicación que administra la instalación a la que apunta SU conexión.
 * Lo que este archivo cuida, en texto (lo estructural, las fronteras entre carpetas, lo cuida dependency-cruiser):
 *  - nunca lee `DATABASE_URL` ni `DIRECT_URL` (cerrado por defecto: sin `PLATAFORMA_DATABASE_URL` no hay conexión);
 *  - una sola conexión, creada en un solo lugar (`plataforma/src/db.ts`);
 *  - las reglas de dependency-cruiser que la aíslan siguen en `error`;
 *  - la cookie de sesión es la propia, `__Host-`, httpOnly y SameSite=Strict.
 */
const RAIZ = join(__dirname, "../..");
const CONSOLA = join(RAIZ, "plataforma/src");

function archivos(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) archivos(ruta, salida);
    else if (/\.(ts|tsx)$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

const rel = (ruta: string) => relative(RAIZ, ruta).replace(/\\/g, "/");
const codigoDeLaConsola = archivos(CONSOLA).map((ruta) => ({ archivo: rel(ruta), texto: readFileSync(ruta, "utf8") }));
/** Sin comentarios: la prosa puede nombrar `DATABASE_URL` para explicar por qué no se usa. */
const sinComentarios = (texto: string) => texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("consola de plataforma: la conexión", () => {
  it("el detector ve archivos de verdad (sanidad: no pasa en vacío)", () => {
    const nombres = codigoDeLaConsola.map((f) => f.archivo);
    expect(nombres).toEqual(expect.arrayContaining(["plataforma/src/db.ts", "plataforma/src/entorno.ts", "plataforma/src/servidor/ingreso.ts", "plataforma/src/proxy.ts"]));
  });

  it("ningún archivo de la consola lee DATABASE_URL ni DIRECT_URL (solo PLATAFORMA_DATABASE_URL)", () => {
    // Mutación: poner `process.env.DATABASE_URL ?? ...` en db.ts o entorno.ts pone este test en rojo.
    const infractores = codigoDeLaConsola.filter(({ texto }) => /(?<![A-Z_])(DATABASE_URL|DIRECT_URL)\b/.test(sinComentarios(texto))).map((f) => f.archivo);
    expect(infractores).toEqual([]);
  });

  it("solo plataforma/src/db.ts crea el cliente de Prisma o un adaptador", () => {
    const creadores = codigoDeLaConsola.filter(({ texto }) => /new\s+(PrismaClient|PrismaPg|PrismaNeon)\b|from\s+["']@prisma\/adapter-/.test(sinComentarios(texto))).map((f) => f.archivo);
    expect(creadores).toEqual(["plataforma/src/db.ts"]);
  });

  it("db.ts toma la URL de entornoDePlataforma() y no de process.env directo", () => {
    const db = codigoDeLaConsola.find((f) => f.archivo === "plataforma/src/db.ts")!;
    expect(sinComentarios(db.texto)).toContain("entornoDePlataforma().PLATAFORMA_DATABASE_URL");
    expect(sinComentarios(db.texto)).not.toMatch(/process\.env/);
  });
});

describe("consola de plataforma: las reglas de dependency-cruiser que la aíslan", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const configuracion = require("../../.dependency-cruiser.cjs") as { forbidden: Array<{ name: string; severity: string }> };

  it.each(["app-sin-consola-de-plataforma", "consola-sin-lo-interno-de-la-app", "core-plataforma-solo-desde-la-consola"])("%s existe y es de severidad error", (nombre) => {
    const regla = configuracion.forbidden.find((r) => r.name === nombre);
    expect(regla, `falta la regla ${nombre} en .dependency-cruiser.cjs`).toBeDefined();
    expect(regla!.severity).toBe("error");
  });
});

describe("consola de plataforma: la cookie de sesión", () => {
  const sesion = sinComentarios(readFileSync(join(CONSOLA, "servidor/sesion.ts"), "utf8"));

  it("lleva el prefijo __Host- en https y no se llama como la cookie de Auth.js", () => {
    expect(sesion).toContain('"__Host-plataforma.sesion"');
    expect(sesion).not.toMatch(/authjs|next-auth/i);
  });

  it("se pone httpOnly, SameSite=Strict, Path=/ y sin Domain", () => {
    expect(sesion).toMatch(/httpOnly:\s*true/);
    expect(sesion).toMatch(/sameSite:\s*"strict"/);
    expect(sesion).toMatch(/path:\s*"\/"/);
    expect(sesion).not.toMatch(/domain\s*:/i);
  });

  it("vence con la sesión (expires), no es una cookie de sesión de navegador sin tope", () => {
    expect(sesion).toMatch(/expires:\s*vence/);
  });
});
