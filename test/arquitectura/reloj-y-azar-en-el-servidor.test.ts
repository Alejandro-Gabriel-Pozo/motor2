import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { analizarFuente, delegadosDeModelos } from "../../scripts/arquitectura/analizar-fuente";

/**
 * La hora y el azar entran por parámetro también en las capas del servidor que NO son casos de uso (Pureza 1.2 y 1.5 → trabajo 1.12 de la rama `pureza-integracion`).
 *
 * `ficha-de-caso-de-uso.test.ts` vigila que un caso de uso no lea el reloj, pero solo mira su propio archivo: una función de `server/persistencia` que llama a `new Date()` o a
 * `randomUUID` por su cuenta esconde la hora o el azar detrás de un valor por defecto (la auditoría de las Fases 0 y 1 lo encontró en `upsert-proveedor-por-producto.ts`:
 * `fechaCompra ?? new Date()` y `crypto.randomUUID()`, hoy resueltos por la base). Dos reglas:
 *  1. `server/persistencia` no lee el reloj ni el azar. Sin excepciones.
 *  2. `server/consultas`, `server/lecturas` y `server/acceso` no leen el reloj ni el azar, SALVO las que hoy lo hacen: lista de `RELOJ_EN_CONSULTAS`, que solo se achica (trabajo D.3/O.22:
 *     `ahora` pasa a ser un parámetro obligatorio de cada reporte, fijado en el borde de la pantalla). Revisada en las dos direcciones.
 *
 * Cómo se controla: AST con el mismo analizador que el inventario de pureza (detecta también las REFERENCIAS: `ahora = Date.now`).
 */
const RAIZ = join(__dirname, "..", "..");
const DELEGADOS = delegadosDeModelos(readFileSync(join(RAIZ, "prisma", "schema.prisma"), "utf8"));

const MOTIVO_AHORA_OBLIGATORIO = "Lee la hora por su cuenta: el plan de la Fase 3 (C1) pedía `ahora` obligatorio, fijado en el borde de la pantalla. Se corrige en el trabajo D.3/O.22 de la rama `pureza-integracion`; la lista solo se achica.";
export const RELOJ_EN_CONSULTAS: Record<string, string> = Object.fromEntries(
  [
    "src/server/lecturas/carta/menu.ts",
    "src/server/lecturas/carta/publica.ts",
    "src/server/consultas/pos/detalle-de-mesa.ts",
    "src/server/consultas/pos/mesas.ts",
    "src/server/consultas/pos/tickets.ts",
    "src/server/consultas/reportes/devoluciones.ts",
    "src/server/consultas/reportes/diferencias-ajustes.ts",
    "src/server/consultas/reportes/perdidas.ts",
    "src/server/consultas/reportes/periodo-margen.ts",
    "src/server/consultas/reportes/periodo-precios.ts",
    "src/server/consultas/reportes/vencimientos.ts",
  ].map((ruta) => [ruta, MOTIVO_AHORA_OBLIGATORIO]),
);

function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name);
    return e.isDirectory() ? archivos(ruta) : /\.tsx?$/.test(e.name) ? [ruta] : [];
  });
}
const rutaRelativa = (a: string) => relative(RAIZ, a).split(sep).join("/");
const senales = (ruta: string) => analizarFuente(readFileSync(join(RAIZ, ruta), "utf8"), ruta, DELEGADOS);
const conRelojOAzar = (ruta: string) => {
  const s = senales(ruta);
  return s.reloj || s.azar;
};

describe("el detector ve el reloj y el azar de una capa del servidor", () => {
  it("una función que lee la hora o el azar, también como valor por defecto, se marca", () => {
    const marca = (codigo: string) => {
      const s = analizarFuente(codigo, "x.ts", DELEGADOS);
      return s.reloj || s.azar;
    };
    expect(marca("export const f = (d?: Date) => d ?? new Date();")).toBe(true);
    expect(marca("export const f = () => crypto.randomUUID();")).toBe(true);
    expect(marca("export const f = (ahora = Date.now) => ahora();")).toBe(true);
    expect(marca("export const f = (d: Date) => d.getTime();")).toBe(false);
  });
});

describe("server/persistencia no lee el reloj ni el azar", () => {
  const todos = archivos(join(RAIZ, "src", "server", "persistencia")).map(rutaRelativa);

  it("encuentra los archivos (si no, la regla está vacía)", () => {
    expect(todos.length).toBeGreaterThan(30);
  });

  it("ninguno, sin excepciones: la hora la trae el caso de uso (`actor.ahora`) y los ids los pone la base", () => {
    const infractores = todos.filter(conRelojOAzar);
    expect(infractores, `La persistencia no lee la hora ni el azar: recibe la fecha por parámetro y deja el id a la base (gen_random_uuid()):\n${infractores.join("\n")}`).toEqual([]);
  });
});

describe("server/consultas, server/lecturas y server/acceso: el reloj, solo donde la lista lo declara (y la lista solo se achica)", () => {
  const todos = ["consultas", "lecturas", "acceso"].flatMap((capa) => archivos(join(RAIZ, "src", "server", capa))).map(rutaRelativa);

  it("encuentra los archivos (si no, la regla está vacía)", () => {
    expect(todos.length).toBeGreaterThan(50);
  });

  it("ninguno lee la hora o el azar sin estar en RELOJ_EN_CONSULTAS", () => {
    const infractores = todos.filter((ruta) => conRelojOAzar(ruta) && !(ruta in RELOJ_EN_CONSULTAS));
    expect(infractores, `Recibí \`ahora\` por parámetro en vez de leer el reloj:\n${infractores.join("\n")}`).toEqual([]);
  });

  it("toda entrada de la lista sigue haciendo falta (al resolver una, se saca de acá)", () => {
    const sobran = Object.keys(RELOJ_EN_CONSULTAS).filter((ruta) => !todos.includes(ruta) || !conRelojOAzar(ruta));
    expect(sobran, `Estas ya no leen la hora ni el azar: sacalas de RELOJ_EN_CONSULTAS:\n${sobran.join("\n")}`).toEqual([]);
  });
});
