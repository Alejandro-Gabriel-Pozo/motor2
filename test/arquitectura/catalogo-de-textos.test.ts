import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOGO } from "@/core/textos/catalogo";
import { normalizarValor, revisarCatalogo, type ContextoDelCatalogo, type EntradaDelCatalogo } from "./guardas/catalogo-de-textos";

/**
 * Guardián del catálogo de textos de interfaz (tramo T1 del diseño `docs/diseno-textos-en-codigo-2026-11-16.md`; reglas C1 a C5 en `guardas/catalogo-de-textos.ts`).
 * El primer bloque mira el catálogo real; el segundo ejerce cada regla con una violación inyectada sobre un catálogo de juguete: pasa de verde a rojo con SU violación y vuelve a verde al revertirla.
 * Sin analizador de pantallas ni cerco de texto a mano (T2 y T3).
 */
const RAIZ = join(__dirname, "../..");
const REGISTRO = readFileSync(join(RAIZ, "docs/registro-de-decisiones.md"), "utf8");
/** Línea base de `HEREDADO`: vacía en T1 (el catálogo nace sin textos heredados) y solo puede bajar. */
const HEREDADOS: readonly string[] = [];

const leerEnElRepo = (ruta: string): string | null => (existsSync(join(RAIZ, ruta)) ? readFileSync(join(RAIZ, ruta), "utf8") : null);

describe("catálogo de textos: el catálogo real", () => {
  it("cumple todas las reglas (C1 a C5)", () => {
    const problemas = revisarCatalogo(CATALOGO as Readonly<Record<string, EntradaDelCatalogo>>, { registro: REGISTRO, leerArchivo: leerEnElRepo, heredados: HEREDADOS });
    expect(problemas, problemas.join("\n")).toEqual([]);
  });

  it("no pasa en vacío: tiene entradas, la DEC de su fuente existe y los archivos de sus usos se leen", () => {
    const claves = Object.keys(CATALOGO);
    expect(claves).toContain("rechazo.PRESENTACION_AMBIGUA");
    expect(REGISTRO).toContain("### DEC-0013");
    for (const clave of claves) for (const uso of CATALOGO[clave as keyof typeof CATALOGO].usos) expect(leerEnElRepo(uso.archivo), `${clave}: ${uso.archivo}`).not.toBeNull();
  });
});

// ---- violaciones inyectadas ----
const REGISTRO_DE_JUGUETE = `### DEC-0001
- **Estado:** ACEPTADA

### DEC-0002
- **Estado:** PENDIENTE_DE_OK

### DEC-0003
- **Estado:** REVOCADA

### DEC-0004
- **Estado:** CORREGIDA
`;
const CODIGO_DE_JUGUETE: Record<string, string> = {
  "src/a.ts": 'export function uno() { return textoDe("rechazo.NO_HAY_STOCK"); }\nexport const DOS = () => textoDe("aviso.saludo", { nombre: "x" });',
  "src/b.ts": "export function otro() { return 1; }",
};
const contexto = (extra: Partial<ContextoDelCatalogo> = {}): ContextoDelCatalogo => ({
  registro: REGISTRO_DE_JUGUETE,
  leerArchivo: (ruta) => CODIGO_DE_JUGUETE[ruta] ?? null,
  heredados: [],
  ...extra,
});
const base = (): Record<string, EntradaDelCatalogo> => ({
  "rechazo.NO_HAY_STOCK": { porDefecto: "No hay stock", usos: [{ archivo: "src/a.ts", nombre: "uno" }], fuente: { decision: "DEC-0001" } },
  "aviso.saludo": { porDefecto: "Hola {nombre}", marcadores: { nombre: "texto" }, usos: [{ archivo: "src/a.ts", nombre: "DOS" }], fuente: { decision: "DEC-0004" } },
});
const con = (clave: string, cambio: Partial<EntradaDelCatalogo>): Record<string, EntradaDelCatalogo> => ({ ...base(), [clave]: { ...base()[clave]!, ...cambio } });
const dicen = (catalogo: Record<string, EntradaDelCatalogo>, ctx = contexto()): string => revisarCatalogo(catalogo, ctx).join("\n");

describe("catálogo de textos: cada regla con su violación inyectada", () => {
  it("control: el catálogo de juguete está limpio (si no, las violaciones no prueban nada)", () => {
    expect(revisarCatalogo(base(), contexto())).toEqual([]);
  });

  it("C1: clave mal formada, y dos claves que solo difieren en mayúsculas", () => {
    expect(dicen({ ...base(), "rechazo.no_hay": base()["rechazo.NO_HAY_STOCK"]! })).toContain("C1");
    expect(dicen({ ...base(), "Aviso.saludo": base()["aviso.saludo"]! })).toContain("C1");
    expect(dicen({ ...base(), "aviso.Saludo": { ...base()["aviso.saludo"]!, porDefecto: "Chau {nombre}" } })).toContain("C1");
    // una clave bien formada y distinta no dispara C1
    expect(revisarCatalogo({ ...base(), "aviso.otro": { ...base()["aviso.saludo"]!, porDefecto: "Chau {nombre}" } }, contexto()).filter((p) => p.includes("C1"))).toEqual([]);
  });

  it("C2: el mismo valor bajo dos claves falla; con `homonimoDe` y motivo se permite", () => {
    const ctx = contexto({ leerArchivo: (r) => (r === "src/a.ts" ? '"rechazo.NO_HAY_STOCK" "rechazo.SIN_EXISTENCIA" "aviso.saludo" function uno() {} const DOS = 1;' : null) });
    const copia: Record<string, EntradaDelCatalogo> = { ...base(), "rechazo.SIN_EXISTENCIA": { ...base()["rechazo.NO_HAY_STOCK"]!, porDefecto: "¡No hay stock!" } };
    expect(revisarCatalogo(copia, ctx).filter((p) => p.includes("C2")).length).toBe(2);
    const motivo = "son causas distintas que hoy se dicen igual";
    const conHomonimo: Record<string, EntradaDelCatalogo> = {
      ...copia,
      "rechazo.SIN_EXISTENCIA": { ...copia["rechazo.SIN_EXISTENCIA"], homonimoDe: { clave: "rechazo.NO_HAY_STOCK", motivo } },
      "rechazo.NO_HAY_STOCK": { ...copia["rechazo.NO_HAY_STOCK"], homonimoDe: { clave: "rechazo.SIN_EXISTENCIA", motivo } },
    };
    expect(revisarCatalogo(conHomonimo, ctx)).toEqual([]);
    expect(dicen({ ...conHomonimo, "rechazo.SIN_EXISTENCIA": { ...conHomonimo["rechazo.SIN_EXISTENCIA"], homonimoDe: { clave: "rechazo.NO_HAY_STOCK", motivo: "corto" } } }, ctx)).toContain("motivo");
    expect(dicen({ ...conHomonimo, "rechazo.SIN_EXISTENCIA": { ...conHomonimo["rechazo.SIN_EXISTENCIA"], homonimoDe: { clave: "aviso.saludo", motivo } } }, ctx)).toContain("no dice lo mismo");
  });

  it("C2: la normalización ignora tildes, mayúsculas y signos pero no palabras", () => {
    expect(normalizarValor("¡Cantidad!")).toBe(normalizarValor("cantidad"));
    expect(normalizarValor("Sección  nueva.")).toBe(normalizarValor("seccion nueva"));
    expect(normalizarValor("Cantidad")).not.toBe(normalizarValor("Cantidades"));
  });

  it("C3: sin usos, uso repetido, archivo inexistente, nombre no declarado y clave no citada", () => {
    expect(dicen(con("aviso.saludo", { usos: [] }))).toContain("ningún uso");
    expect(dicen(con("aviso.saludo", { usos: [{ archivo: "src/a.ts", nombre: "DOS" }, { archivo: "src/a.ts", nombre: "DOS" }] }))).toContain("repetido");
    expect(dicen(con("aviso.saludo", { usos: [{ archivo: "src/no-existe.ts", nombre: "DOS" }] }))).toContain("no existe");
    expect(dicen(con("aviso.saludo", { usos: [{ archivo: "src/a.ts", nombre: "renombrada" }] }))).toContain("no declara");
    expect(dicen(con("aviso.saludo", { usos: [{ archivo: "src/b.ts", nombre: "otro" }] }))).toContain("no cita la clave");
  });

  it("C4: fuente inexistente, PENDIENTE_DE_OK o REVOCADA fallan; ACEPTADA y CORREGIDA pasan; HEREDADO solo si está en la línea base", () => {
    expect(dicen(con("aviso.saludo", { fuente: { decision: `DEC-${"9999"}` } }))).toContain("no existe en docs/registro-de-decisiones.md");
    expect(dicen(con("aviso.saludo", { fuente: { decision: "DEC-0002" } }))).toContain("PENDIENTE_DE_OK");
    expect(dicen(con("aviso.saludo", { fuente: { decision: "DEC-0003" } }))).toContain("REVOCADA");
    expect(revisarCatalogo(con("aviso.saludo", { fuente: { decision: "DEC-0001" } }), contexto())).toEqual([]);
    expect(revisarCatalogo(con("aviso.saludo", { fuente: { decision: "DEC-0004" } }), contexto())).toEqual([]);
    expect(dicen(con("aviso.saludo", { fuente: "HEREDADO" }))).toContain("línea base");
    expect(revisarCatalogo(con("aviso.saludo", { fuente: "HEREDADO" }), contexto({ heredados: ["aviso.saludo"] }))).toEqual([]);
    // sin fuente (un dato que llegó sin ella): cierra
    expect(dicen(con("aviso.saludo", { fuente: undefined as unknown as EntradaDelCatalogo["fuente"] }))).toContain("C4");
  });

  it("C5: hueco sin declarar, marcador que el texto no usa, tipo inexistente, llave suelta y texto vacío", () => {
    expect(dicen(con("aviso.saludo", { porDefecto: "Hola {nombre} {apellido}" }))).toContain("{apellido}");
    expect(dicen(con("aviso.saludo", { porDefecto: "Hola" }))).toContain("no lo usa");
    expect(dicen(con("aviso.saludo", { marcadores: { nombre: "dinero" } }))).toContain("tipo que no existe");
    expect(revisarCatalogo(con("aviso.saludo", { marcadores: { nombre: "entidad" } }), contexto())).toEqual([]);
    expect(dicen(con("aviso.saludo", { porDefecto: "Hola {nombre} }" }))).toContain("suelta");
    expect(dicen(con("aviso.saludo", { porDefecto: "Hola {Nombre}", marcadores: { nombre: "texto" } }))).toContain("C5");
    expect(dicen(con("rechazo.NO_HAY_STOCK", { porDefecto: " " }))).toContain("vacío");
  });
});
