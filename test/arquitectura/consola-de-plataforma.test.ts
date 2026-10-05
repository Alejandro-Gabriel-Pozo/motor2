import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La consola de plataforma (`plataforma/`, E4, ADR-012, ADR-019) es otra aplicación que administra las instalaciones que configura su despliegue (ADR-025).
 * Lo que este archivo cuida, en texto (lo estructural, las fronteras entre carpetas, lo cuida dependency-cruiser):
 *  - nunca lee `DATABASE_URL` ni `DIRECT_URL` (cerrado por defecto: sin `PLATAFORMA_DATABASE_URL` no hay conexión);
 *  - las conexiones se crean en un solo lugar (`plataforma/src/db.ts`) y se reparten en dos clases (ADR-025): la de IDENTIDAD (administradores, sesión, ingreso) y la de la
 *    instalación OPERADA (empresas, invitaciones, módulos y su auditoría); un archivo de una clase nunca usa la otra;
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

  it("db.ts toma las URLs de la lista de instalaciones validada y no de process.env directo", () => {
    const db = codigoDeLaConsola.find((f) => f.archivo === "plataforma/src/db.ts")!;
    expect(sinComentarios(db.texto)).toContain("instalacionesConfiguradas()");
    expect(sinComentarios(db.texto)).not.toMatch(/process\.env/);
  });

  it("no queda la conexión única: dbPlataforma no existe en ningún archivo", () => {
    expect(codigoDeLaConsola.filter(({ texto }) => /\bdbPlataforma\b/.test(sinComentarios(texto))).map((f) => f.archivo)).toEqual([]);
  });

  it("el nombre de una variable de conexión se arma solo en entorno.ts y ningún process.env es dinámico", () => {
    const conVariable = codigoDeLaConsola.filter(({ texto }) => /PLATAFORMA_DATABASE_URL_/.test(sinComentarios(texto))).map((f) => f.archivo);
    expect(conVariable).toEqual(["plataforma/src/entorno.ts"]);
    expect(codigoDeLaConsola.filter(({ texto }) => /process\.env\s*\[/.test(sinComentarios(texto))).map((f) => f.archivo)).toEqual([]);
  });
});

describe("consola de plataforma: identidad y operación no se mezclan (ADR-025)", () => {
  const usa = (nombre: string, f: { texto: string }) => new RegExp(`\\b${nombre}\\b`).test(sinComentarios(f.texto));
  const delGrupo = (prefijos: string[]) => codigoDeLaConsola.filter((f) => prefijos.some((p) => f.archivo.startsWith(`plataforma/src/${p}`)));

  it("sanidad: los grupos tienen archivos", () => {
    expect(delGrupo(["servidor/sesion.ts", "servidor/auditoria.ts", "servidor/identidad.ts", "app/login/"]).length).toBeGreaterThanOrEqual(4);
    expect(delGrupo(["app/instalaciones/"]).length).toBeGreaterThan(5);
  });

  it("la sesión, la auditoría de ingreso, la identidad y el login usan SOLO la base de identidad", () => {
    // Mutación: usar dbDeInstalacion en sesion.ts pone este test en rojo.
    for (const f of delGrupo(["servidor/sesion.ts", "servidor/auditoria.ts", "servidor/identidad.ts", "app/login/"])) {
      expect(usa("dbDeInstalacion", f), `${f.archivo} usa la base de una instalación`).toBe(false);
    }
  });

  it("las pantallas y acciones de una instalación nunca nombran la base de identidad", () => {
    // Mutación: llamar a dbDeIdentidad() desde una acción pone este test en rojo.
    for (const f of delGrupo(["app/instalaciones/"])) expect(usa("dbDeIdentidad", f), `${f.archivo} usa la base de identidad`).toBe(false);
  });

  it("la lógica de operación (empresas, ciclo de vida, módulos) recibe la base por parámetro y no toca las tablas de identidad", () => {
    // Mutación: volver a leer `tx.adminPlataforma` en empresas.ts pone este test en rojo (en otra instalación esa tabla está vacía).
    for (const f of codigoDeLaConsola.filter((c) => /^plataforma\/src\/servidor\/(empresas|ciclo-de-vida|modulos)\.ts$/.test(c.archivo))) {
      for (const tabla of ["adminPlataforma", "sesionPlataforma", "codigoDeIngresoPlataforma", "codigoDeRecuperacionPlataforma"]) expect(usa(tabla, f), `${f.archivo} lee ${tabla}`).toBe(false);
      expect(/from\s+["']\.\.\/db["']/.test(sinComentarios(f.texto)), `${f.archivo} importa db.ts`).toBe(false);
    }
  });

  it("ninguna ruta de la consola está escrita a mano: todas pasan por rutas.ts", () => {
    // Mutación: un href="/empresas" en una pantalla pone este test en rojo.
    const aMano = codigoDeLaConsola.filter((f) => f.archivo.startsWith("plataforma/src/app/") && /["'`]\/empresas/.test(sinComentarios(f.texto))).map((f) => f.archivo);
    expect(aMano).toEqual([]);
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
