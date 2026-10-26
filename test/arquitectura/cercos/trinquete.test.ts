import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contarCoincidencias, medirPorArchivo, revisarCerco, serializarLineaDeBase, sinComentarios, type Cerco, type OpcionesDeRevision } from "./trinquete";

/**
 * El propio trinquete de los cercos (Fase 1 de la ola «precio y carta»), probado sobre un árbol TEMPORAL (nunca el repo): un cerco de
 * juguete cuenta la palabra `PROHIBIDO` por archivo de `src/`, y se comprueba cada comportamiento del mecanismo — sube → falla; baja →
 * exige bajar la línea de base; archivo nuevo con violaciones → falla; `BAJAR_CERCOS=1` con una subida → se niega; sin subidas → baja;
 * `CREAR_CERCOS=1` solo crea; excepciones por ruta exacta con motivo, revisadas en las dos direcciones; motivos por entrada.
 */
let raiz: string;
let dirLineaDeBase: string;

function escribir(ruta: string, contenido: string): void {
  const absoluta = join(raiz, ...ruta.split("/"));
  mkdirSync(dirname(absoluta), { recursive: true });
  writeFileSync(absoluta, contenido);
}

function cerco(extra: Partial<Cerco> = {}): Cerco {
  return {
    regla: "juguete",
    meta: "0 (solo para probar el mecanismo)",
    medir: medirPorArchivo({ raices: ["src"], extensiones: [".ts", ".tsx"], contar: (f) => ({ prohibido: contarCoincidencias(f, /\bPROHIBIDO\b/g) }) }),
    ...extra,
  };
}

function opciones(extra: Partial<OpcionesDeRevision> = {}): OpcionesDeRevision {
  return { raizDelRepo: raiz, dirLineaDeBase, bajar: false, crear: false, ...extra };
}

function lineaDeBase(): { total: number; entradas: number; cuentas: Record<string, Record<string, number>> } {
  return JSON.parse(readFileSync(join(dirLineaDeBase, "juguete.json"), "utf8"));
}

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "trinquete-"));
  dirLineaDeBase = join(raiz, "linea-de-base");
  escribir("src/a.ts", "const x = 'PROHIBIDO';\nconst y = 'PROHIBIDO';\n");
  escribir("src/sub/b.tsx", "export const B = () => <p>PROHIBIDO</p>;\n");
  escribir("src/limpio.ts", "export const z = 1;\n");
  expect(revisarCerco(cerco(), opciones({ crear: true })).escritura).toBe("creada");
});

afterEach(() => {
  rmSync(raiz, { recursive: true, force: true });
});

describe("trinquete: la línea de base solo baja", () => {
  it("recién creada: verde, con las cuentas por archivo, el total y las claves ordenadas", () => {
    expect(revisarCerco(cerco(), opciones()).problemas).toEqual([]);
    const base = lineaDeBase();
    expect(base.cuentas).toEqual({ "src/a.ts": { prohibido: 2 }, "src/sub/b.tsx": { prohibido: 1 } });
    expect([base.total, base.entradas]).toEqual([3, 2]);
  });

  it("CREAR_CERCOS=1 no pisa una línea de base que ya existe", () => {
    escribir("src/a.ts", "PROHIBIDO PROHIBIDO PROHIBIDO PROHIBIDO");
    const r = revisarCerco(cerco(), opciones({ crear: true }));
    expect(r.escritura).toBe("ninguna");
    expect(r.problemas.join("\n")).toContain("SUBIÓ");
    expect(lineaDeBase().cuentas["src/a.ts"]).toEqual({ prohibido: 2 });
  });

  it("sin línea de base (y sin CREAR_CERCOS): falla pidiendo crearla", () => {
    rmSync(join(dirLineaDeBase, "juguete.json"));
    expect(revisarCerco(cerco(), opciones()).problemas.join("\n")).toContain("Falta la línea de base");
  });

  it("una cuenta que SUBE hace fallar, diciendo qué archivo y cuánto", () => {
    escribir("src/a.ts", "PROHIBIDO PROHIBIDO PROHIBIDO");
    const texto = revisarCerco(cerco(), opciones()).problemas.join("\n");
    expect(texto).toContain("SUBIÓ");
    expect(texto).toContain("src/a.ts [prohibido]: 2 → 3 (+1)");
  });

  it("un archivo NUEVO con violaciones hace fallar", () => {
    escribir("src/nuevo/c.ts", "PROHIBIDO");
    const texto = revisarCerco(cerco(), opciones()).problemas.join("\n");
    expect(texto).toContain("src/nuevo/c.ts [prohibido]: 0 → 1 (+1, entrada nueva)");
  });

  it("un archivo nuevo SIN violaciones no cambia nada", () => {
    escribir("src/nuevo/d.ts", "export const limpio = true; // PROHIBIDO en un comentario no cuenta");
    expect(revisarCerco(cerco(), opciones()).problemas).toEqual([]);
  });

  it("una cuenta que BAJA también falla, pidiendo bajar la línea de base con BAJAR_CERCOS=1", () => {
    escribir("src/a.ts", "const x = 'PROHIBIDO';\n");
    const texto = revisarCerco(cerco(), opciones()).problemas.join("\n");
    expect(texto).toContain("BAJÓ");
    expect(texto).toContain("BAJAR_CERCOS=1");
    expect(texto).toContain("src/a.ts [prohibido]: 2 → 1 (-1)");
  });

  it("un archivo que deja de tener violaciones (o se borra) cuenta como bajada", () => {
    rmSync(join(raiz, "src/sub/b.tsx"));
    expect(revisarCerco(cerco(), opciones()).problemas.join("\n")).toContain("src/sub/b.tsx [prohibido]: 1 → 0 (-1)");
  });

  it("BAJAR_CERCOS=1 sin subidas escribe la línea de base más baja y queda verde", () => {
    escribir("src/a.ts", "const x = 'PROHIBIDO';\n");
    const r = revisarCerco(cerco(), opciones({ bajar: true }));
    expect(r.escritura).toBe("bajada");
    expect(r.problemas).toEqual([]);
    expect(lineaDeBase().cuentas).toEqual({ "src/a.ts": { prohibido: 1 }, "src/sub/b.tsx": { prohibido: 1 } });
    expect(revisarCerco(cerco(), opciones()).problemas).toEqual([]);
    // y desde ahí no puede volver a subir
    escribir("src/a.ts", "PROHIBIDO PROHIBIDO");
    expect(revisarCerco(cerco(), opciones()).problemas.join("\n")).toContain("src/a.ts [prohibido]: 1 → 2 (+1)");
  });

  it("BAJAR_CERCOS=1 con una subida SE NIEGA a escribir (aunque otra cuenta haya bajado)", () => {
    escribir("src/a.ts", "PROHIBIDO");
    escribir("src/sub/b.tsx", "export const B = () => <p>PROHIBIDO PROHIBIDO</p>;\n");
    const antes = readFileSync(join(dirLineaDeBase, "juguete.json"), "utf8");
    const r = revisarCerco(cerco(), opciones({ bajar: true }));
    expect(r.escritura).toBe("negada");
    expect(r.problemas.join("\n")).toContain("se niega");
    expect(readFileSync(join(dirLineaDeBase, "juguete.json"), "utf8")).toBe(antes);
  });

  it("regenerar dos veces da el mismo archivo (determinista) y un JSON tocado a mano fuera de su forma canónica se marca", () => {
    const texto = readFileSync(join(dirLineaDeBase, "juguete.json"), "utf8");
    expect(texto).toBe(serializarLineaDeBase(cerco(), { "src/sub/b.tsx": { prohibido: 1 }, "src/a.ts": { prohibido: 2 } }));
    writeFileSync(join(dirLineaDeBase, "juguete.json"), texto.replace('"total": 3', '"total": 99'));
    expect(revisarCerco(cerco(), opciones()).problemas.join("\n")).toContain("forma canónica");
  });
});

describe("trinquete: excepciones por ruta exacta, con motivo, en las dos direcciones", () => {
  const MOTIVO = "archivo de juguete exceptuado a propósito para la prueba";

  it("una ruta exceptuada no cuenta (puede subir sin romper el cerco)", () => {
    const conExcepcion = cerco({ excepciones: [{ ruta: "src/a.ts", motivo: MOTIVO }] });
    rmSync(join(dirLineaDeBase, "juguete.json"));
    revisarCerco(conExcepcion, opciones({ crear: true }));
    escribir("src/a.ts", "PROHIBIDO PROHIBIDO PROHIBIDO PROHIBIDO");
    expect(revisarCerco(conExcepcion, opciones()).problemas).toEqual([]);
    expect(lineaDeBase().cuentas).toEqual({ "src/sub/b.tsx": { prohibido: 1 } });
  });

  it("la excepción es por ruta EXACTA: no cubre otro archivo de la misma carpeta", () => {
    const conExcepcion = cerco({ excepciones: [{ ruta: "src/sub/b.tsx", motivo: MOTIVO }] });
    escribir("src/sub/otro.tsx", "PROHIBIDO");
    expect(revisarCerco(conExcepcion, opciones()).problemas.join("\n")).toContain("src/sub/otro.tsx [prohibido]: 0 → 1");
  });

  it("una excepción sin motivo, a un archivo que no existe o a uno ya limpio se marca", () => {
    const problemas = revisarCerco(
      cerco({ excepciones: [{ ruta: "src/a.ts", motivo: "" }, { ruta: "src/no-existe.ts", motivo: MOTIVO }, { ruta: "src/limpio.ts", motivo: MOTIVO }] }),
      opciones()
    ).problemas.join("\n");
    expect(problemas).toContain("Excepción sin motivo");
    expect(problemas).toContain("ya no existe (sacala): src/no-existe.ts");
    expect(problemas).toContain("Excepción que sobra: src/limpio.ts");
  });

  it("motivos por entrada: falta uno → falla; sobra uno → falla", () => {
    const problemas = revisarCerco(cerco({ motivos: { "src/a.ts": "deuda conocida del juguete", "src/viejo.ts": "ya no existe" } }), opciones()).problemas.join("\n");
    expect(problemas).toContain("Entrada sin motivo en la línea de base de «juguete»: src/sub/b.tsx");
    expect(problemas).toContain("Motivo que sobra en «juguete»: src/viejo.ts");
  });
});

describe("sinComentarios: los detectores no ven comentarios, pero sí strings, plantillas y texto de JSX", () => {
  it("TS/TSX", () => {
    const fuente = [
      "// PROHIBIDO en línea",
      "/* PROHIBIDO en bloque */ const a = 'PROHIBIDO';",
      'const url = "https://ejemplo.com/PROHIBIDO"; // PROHIBIDO',
      "const t = `// PROHIBIDO ${a} /* PROHIBIDO */`;",
      "const r = /\\/\\/PROHIBIDO/;",
      "export const C = () => <p>http://PROHIBIDO {/* PROHIBIDO */}</p>;",
    ].join("\n");
    const limpia = sinComentarios(fuente, "x.tsx");
    expect(contarCoincidencias(limpia, /PROHIBIDO/g)).toBe(6);
    expect(limpia.split("\n")).toHaveLength(6);
  });

  it("CSS", () => {
    expect(sinComentarios("/* color: #fff */\na { color: #000; }", "x.css")).toBe("                 \na { color: #000; }");
  });
});
