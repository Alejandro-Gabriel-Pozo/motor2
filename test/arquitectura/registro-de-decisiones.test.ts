import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ESTADOS, parsearRegistro, revisarRegistro, rutasDeDonde, TOPE_DE_PENDIENTES } from "./guardas/registro-de-decisiones";

/**
 * Guardián del registro de decisiones de los agentes (regla «Lo que el dueño no pidió no entra», 2026-11-11; diseño `docs/diseno-aceptacion-del-dueno-2026-11-11.md`, etapa E2; reglas en
 * `guardas/registro-de-decisiones.ts`). El primer test mira el repo real; los demás ejercen la función con registros y código inyectados: cada regla pasa de verde a rojo con SU violación y
 * vuelve a verde al revertirla (la mutación demostrada que pide el diseño).
 */
const RAIZ = join(__dirname, "../..");
const RUTA_DEL_REGISTRO = "docs/registro-de-decisiones.md";

/** Los dos archivos del guardián nombran la palabra a propósito (la regex y los casos de prueba): no se escanean a sí mismos. */
const ARCHIVOS_DEL_GUARDIAN = new Set(["test/arquitectura/registro-de-decisiones.test.ts", "test/arquitectura/guardas/registro-de-decisiones.ts"]);
const RAICES = ["src", "plataforma", "test", "scripts", "prisma", ".github"];
const EXTENSIONES = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".sql", ".css", ".sh", ".yml", ".yaml", ".prisma"];
const CARPETAS_IGNORADAS = new Set(["node_modules", ".next", ".git", "test-results", "playwright-report", "coverage"]);

function codigoDelRepo(): Record<string, string> {
  const codigo: Record<string, string> = {};
  const recorrer = (relativa: string) => {
    for (const entrada of readdirSync(join(RAIZ, relativa), { withFileTypes: true })) {
      const ruta = `${relativa}/${entrada.name}`;
      if (entrada.isDirectory()) {
        if (!CARPETAS_IGNORADAS.has(entrada.name)) recorrer(ruta);
      } else if (EXTENSIONES.some((e) => entrada.name.endsWith(e)) && !ARCHIVOS_DEL_GUARDIAN.has(ruta)) {
        codigo[ruta] = readFileSync(join(RAIZ, ruta), "utf8");
      }
    }
  };
  for (const raiz of RAICES) if (existsSync(join(RAIZ, raiz))) recorrer(raiz);
  return codigo;
}

const existeEnElRepo = (ruta: string) => existsSync(join(RAIZ, ruta));

describe("registro de decisiones de los agentes: el repo real", () => {
  it("el registro existe, tiene entradas y todo cierra con el código (SUPUESTO registrado, ids existentes, tope de pendientes)", () => {
    expect(existsSync(join(RAIZ, RUTA_DEL_REGISTRO)), `falta ${RUTA_DEL_REGISTRO}`).toBe(true);
    const registro = readFileSync(join(RAIZ, RUTA_DEL_REGISTRO), "utf8");
    expect(parsearRegistro(registro).length).toBeGreaterThan(0);
    const problemas = revisarRegistro(registro, codigoDelRepo(), existeEnElRepo);
    expect(problemas, problemas.join("\n")).toEqual([]);
  });

  it("el código escaneado incluye lo que tiene que incluir (si el recorrido quedara vacío, el guardián no vigilaría nada)", () => {
    const rutas = Object.keys(codigoDelRepo());
    expect(rutas).toContain("src/server/actions/catalogo/casos-de-uso/dar-de-alta-producto.ts");
    expect(rutas).toContain("test/catalogo/campos-sensibles-del-alta.test.ts");
    expect(rutas.some((r) => r.startsWith("scripts/"))).toBe(true);
    expect(rutas.some((r) => r.startsWith("prisma/"))).toBe(true);
    expect(rutas.some((r) => r.startsWith(".github/"))).toBe(true);
    expect(rutas.some((r) => r.startsWith("plataforma/src/"))).toBe(true);
    expect(rutas.every((r) => !ARCHIVOS_DEL_GUARDIAN.has(r) && !r.includes("node_modules"))).toBe(true);
  });
});

const entrada = (id: string, extra: Partial<Record<string, string | null>> = {}): string => {
  const campos: Record<string, string | null> = {
    "Fecha": "2026-11-11",
    "Quién": "un agente en la etapa de prueba",
    "Qué decidió": "elegir la opción más chica",
    "Por qué": "era necesaria para terminar lo pedido",
    "Costo de revertir": "un cambio chico en un archivo",
    "Dónde": "`docs/registro-de-decisiones.md:1`",
    "Estado": "PENDIENTE_DE_OK",
    ...extra,
  };
  return [`### ${id}`, ...Object.entries(campos).filter(([, v]) => v !== null).map(([k, v]) => `- **${k}:** ${v}`)].join("\n");
};
const CITA = "«Sí, dale con eso» — 2026-11-12 — mensaje del dueño";
const siempreExiste = () => true;
const revisar = (registro: string, codigo: Record<string, string> = {}, existe: (r: string) => boolean = siempreExiste) => revisarRegistro(registro, codigo, existe);
const registroDe = (...entradas: string[]) => `# Registro\n\nIntroducción que no cuenta.\n\n## Decisiones\n\n${entradas.join("\n\n")}\n`;

describe("registro de decisiones: cada regla pasa de verde a rojo con su violación y vuelve a verde", () => {
  it("una entrada completa y pendiente es verde; la introducción antes de la primera no cuenta", () => {
    expect(revisar(registroDe(entrada("DEC-0001")))).toEqual([]);
    expect(parsearRegistro(registroDe(entrada("DEC-0001"), entrada("DEC-0002")))).toHaveLength(2);
  });

  it("un SUPUESTO en el código sin DEC → rojo; con su DEC registrada → verde; revertido → verde", () => {
    const registro = registroDe(entrada("DEC-0001"));
    const sinDec = { "src/a.ts": "// SUPUESTO declarado, el dueño lo corrige si no\n" };
    expect(revisar(registro, sinDec)).toEqual([expect.stringContaining("src/a.ts: dice SUPUESTO sin registrar")]);
    // con el marcador pero con un espacio antes del paréntesis tampoco cuenta como registrado
    expect(revisar(registro, { "src/a.ts": "// SUPUESTO (DEC-0001) algo" })).toHaveLength(1);
    expect(revisar(registro, { "src/a.ts": "// SUPUESTO(DEC-0001) algo" })).toEqual([]);
    expect(revisar(registro, { "src/a.ts": "// el supuesto en minúscula es prosa, y SUPUESTOS en plural también" })).toEqual([]);
    expect(revisar(registro, { "src/a.ts": "const ok = 1;\n" })).toEqual([]);
  });

  it("un SUPUESTO(DEC-n) cuya entrada no existe → rojo; el mismo texto con la entrada → verde", () => {
    const codigo = { "src/a.ts": "// SUPUESTO(DEC-0007) algo" };
    expect(revisar(registroDe(entrada("DEC-0001")), codigo)).toEqual([expect.stringContaining("nombra DEC-0007, que no está")]);
    expect(revisar(registroDe(entrada("DEC-0007")), codigo)).toEqual([]);
  });

  it("el código que nombra una DEC REVOCADA → rojo; ACEPTADA, CORREGIDA y PENDIENTE → verde", () => {
    const codigo = { "src/a.ts": "// DEC-0001 decía otra cosa" };
    const con = (estado: string) => registroDe(entrada("DEC-0001", { "Estado": estado, "Cita del dueño": estado === "PENDIENTE_DE_OK" ? null : CITA }));
    expect(revisar(con("REVOCADA"), codigo)).toEqual([expect.stringContaining("REVOCÓ")]);
    for (const estado of ["ACEPTADA", "CORREGIDA", "PENDIENTE_DE_OK"]) expect(revisar(con(estado), codigo)).toEqual([]);
  });

  it("la DEC número 11 pendiente → rojo; con 10 → verde; las aceptadas no cuentan para el tope", () => {
    const pendientes = (n: number) => Array.from({ length: n }, (_, i) => entrada(`DEC-${String(i + 1).padStart(4, "0")}`));
    expect(revisar(registroDe(...pendientes(TOPE_DE_PENDIENTES)))).toEqual([]);
    expect(revisar(registroDe(...pendientes(TOPE_DE_PENDIENTES + 1)))).toEqual([expect.stringContaining(`Hay ${TOPE_DE_PENDIENTES + 1} decisiones PENDIENTE_DE_OK`)]);
    const aceptada = entrada("DEC-0099", { "Estado": "ACEPTADA", "Cita del dueño": CITA });
    expect(revisar(registroDe(...pendientes(TOPE_DE_PENDIENTES), aceptada))).toEqual([]);
  });

  it("una entrada sin costo de revertir, sin dónde o con un campo vacío → rojo; completa → verde", () => {
    expect(revisar(registroDe(entrada("DEC-0001", { "Costo de revertir": null })))).toEqual([expect.stringContaining("falta el campo «Costo de revertir»")]);
    expect(revisar(registroDe(entrada("DEC-0001", { "Costo de revertir": "…" })))).toEqual([expect.stringContaining("está vacío o es muy corto")]);
    expect(revisar(registroDe(entrada("DEC-0001", { "Dónde": null })))).toEqual([expect.stringContaining("falta el campo «Dónde»")]);
    expect(revisar(registroDe(entrada("DEC-0001", { "Dónde": "en algún lado" })))).toEqual([expect.stringContaining("al menos un archivo")]);
    expect(revisar(registroDe(entrada("DEC-0001", { "Por qué": null, "Qué decidió": null, "Quién": null })))).toHaveLength(3);
    expect(revisar(registroDe(entrada("DEC-0001")))).toEqual([]);
  });

  it("«Dónde» nombra un archivo que no existe → rojo; con `ruta:línea` se mira la ruta", () => {
    const registro = registroDe(entrada("DEC-0001", { "Dónde": "`src/no-existe.ts:12`, `docs/registro-de-decisiones.md`" }));
    expect(revisar(registro, {}, (r) => r === "docs/registro-de-decisiones.md")).toEqual([expect.stringContaining("«src/no-existe.ts», que no existe")]);
    expect(revisar(registro)).toEqual([]);
    expect(rutasDeDonde("`a/b.ts:38`, `c.md`, `d.ts:3-9`")).toEqual(["a/b.ts", "c.md", "d.ts"]);
  });

  it("estado fuera de la lista, fecha inventada, id mal formado o repetido → rojo", () => {
    expect(revisar(registroDe(entrada("DEC-0001", { "Estado": "ACEPTADO" })))).toEqual([expect.stringContaining("«Estado» tiene que ser uno de")]);
    expect(revisar(registroDe(entrada("DEC-0001", { "Estado": null })))).toEqual([expect.stringContaining("falta el campo «Estado»")]);
    expect(revisar(registroDe(entrada("DEC-0001", { "Fecha": "2026-02-30" })))).toEqual([expect.stringContaining("no es una fecha AAAA-MM-DD real")]);
    expect(revisar(registroDe(entrada("DEC-0001", { "Fecha": null })))).toEqual([expect.stringContaining("falta el campo «Fecha»")]);
    expect(revisar(registroDe(entrada("DEC-12")))).toEqual([expect.stringContaining("cuatro dígitos")]);
    expect(revisar(registroDe(entrada("DEC-0001"), entrada("DEC-0001")))).toEqual([expect.stringContaining("el id está repetido")]);
    expect(ESTADOS).toEqual(["PENDIENTE_DE_OK", "ACEPTADA", "CORREGIDA", "REVOCADA"]);
  });

  it("un campo repetido dentro de una entrada → rojo", () => {
    const texto = `${entrada("DEC-0001")}\n- **Por qué:** otra razón distinta`;
    expect(revisar(`${texto}\n`)).toEqual([expect.stringContaining("«Por qué» está dos veces")]);
  });

  it("la cita del dueño: ACEPTADA, CORREGIDA y REVOCADA la llevan con forma; PENDIENTE_DE_OK no la lleva", () => {
    for (const estado of ["ACEPTADA", "CORREGIDA", "REVOCADA"]) {
      expect(revisar(registroDe(entrada("DEC-0001", { "Estado": estado })))).toEqual([expect.stringContaining(`una decisión ${estado} lleva «Cita del dueño»`)]);
      expect(revisar(registroDe(entrada("DEC-0001", { "Estado": estado, "Cita del dueño": CITA })))).toEqual([]);
      expect(revisar(registroDe(entrada("DEC-0001", { "Estado": estado, "Cita del dueño": "dijo que sí" })))).toEqual([expect.stringContaining("tiene que tener la forma")]);
      expect(revisar(registroDe(entrada("DEC-0001", { "Estado": estado, "Cita del dueño": "«Sí» — 2026-11-31 — mensaje" })))).toEqual([expect.stringContaining("fecha que no es real")]);
      expect(revisar(registroDe(entrada("DEC-0001", { "Estado": estado, "Cita del dueño": "«Sí» — 2026-11-12 —" })))).toEqual([expect.stringContaining("tiene que tener la forma")]);
    }
    expect(revisar(registroDe(entrada("DEC-0001", { "Cita del dueño": CITA })))).toEqual([expect.stringContaining("no lleva «Cita del dueño»")]);
  });
});
