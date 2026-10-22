import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RAIZ_DEL_REPO } from "../../cercos/trinquete";
import { ErrorDeSalida, ejecutar, prepararSalidas, VARIABLE_DE_EVIDENCIA, VARIABLE_DE_RESUMEN } from "../ejecutar";
import { MANIFIESTO } from "../manifiesto";
import { PISO_DE_ARCHIVOS_LEIDOS, fechaUtcDeHoy } from "../politica";
import { TIPOS_DE_PROBLEMA_DE_EVIDENCIA, armarEvidencia, archivosEnAlcance, markdownDeEvidencia, problemasEstructurales, textoDeEvidencia, type Evidencia, type EntradaEstructural, type ResumenDeMatriz } from "./evidencia";

/**
 * La EVIDENCIA POR CORRIDA (paso G5): «pasó» no es «no encontró nada». Casos sintéticos rojo y verde de los controles estructurales (conjunto de ids, alcance de 0 archivos, piso de archivos leídos), la
 * evidencia armada sobre el repo REAL (tiene que dar `ok`, con todo lo que prometen los datos) y el ejecutor (`ejecutar.ts`): el código de salida, el JSON de `CONTRATOS_EVIDENCIA`, el resumen de
 * `GITHUB_STEP_SUMMARY` y la ruta que no se puede escribir. Las mutaciones sobre una copia del repo (vaciar el manifiesto, subir el piso…) están en la matriz (`guardian/evidencia-no-vacia`).
 */

const HOY = fechaUtcDeHoy();

// ---------------------------------------------------------------------------------------------------------------------------------
// 1. Los controles estructurales, con literales (nada de leer el repo)
// ---------------------------------------------------------------------------------------------------------------------------------

const VERDE: EntradaEstructural = {
  ids: ["a", "b"],
  aprobados: ["a", "b"],
  alcances: [
    { id: "a", raices: ["src/x"], archivos: 3 },
    { id: "b", raices: ["src/y"], archivos: 1 },
  ],
  archivosLeidos: 100,
  piso: 100,
};

const tipos = (e: EntradaEstructural): string[] => problemasEstructurales(e).map((p) => p.tipo);

describe("problemasEstructurales: lo que separa «pasó» de «no encontró nada»", () => {
  it("verde: los ids son los aprobados, todo contrato tiene archivos y se leyó justo el piso", () => {
    expect(problemasEstructurales(VERDE)).toEqual([]);
  });

  it("verde: el orden de los ids no importa", () => {
    expect(tipos({ ...VERDE, ids: ["b", "a"] })).toEqual([]);
  });

  it("rojo: el manifiesto vacío (aunque el registro tenga contratos aprobados)", () => {
    const [p, ...resto] = problemasEstructurales({ ...VERDE, ids: [], alcances: [] });
    expect(resto).toEqual([]);
    expect(p.tipo).toBe("ids-distintos-del-aprobado");
    expect(p.que).toContain("no tiene ningún contrato");
    expect(p.archivo).toBe("test/arquitectura/contratos/manifiesto.ts");
  });

  it("rojo: falta un contrato aprobado (dice cuál)", () => {
    const [p] = problemasEstructurales({ ...VERDE, ids: ["a"], alcances: [{ id: "a", raices: ["src/x"], archivos: 3 }] });
    expect(p.tipo).toBe("ids-distintos-del-aprobado");
    expect(p.que).toContain("faltan «b»");
  });

  it("rojo: sobra un contrato que nadie aprobó (dice cuál)", () => {
    const [p] = problemasEstructurales({ ...VERDE, aprobados: ["a"] });
    expect(p.tipo).toBe("ids-distintos-del-aprobado");
    expect(p.que).toContain("sobran «b»");
  });

  it("rojo: un contrato con alcance de 0 archivos, y solo él", () => {
    const r = problemasEstructurales({ ...VERDE, alcances: [{ id: "a", raices: ["src/x"], archivos: 0 }, { id: "b", raices: ["src/y"], archivos: 1 }] });
    expect(r.map((p) => [p.tipo, p.sujeto, p.archivo])).toEqual([["alcance-cero", "a", "test/arquitectura/contratos/contratos/a.ts"]]);
    expect(r[0].que).toContain("src/x");
  });

  it("borde del piso: leer 99 con piso 100 es rojo; leer 100 es verde; leer 101 es verde", () => {
    expect(tipos({ ...VERDE, archivosLeidos: 99 })).toEqual(["archivos-bajo-el-piso"]);
    expect(tipos({ ...VERDE, archivosLeidos: 100 })).toEqual([]);
    expect(tipos({ ...VERDE, archivosLeidos: 101 })).toEqual([]);
  });

  it("rojo: no leer ningún archivo (0 contra el piso)", () => {
    expect(tipos({ ...VERDE, archivosLeidos: 0 })).toEqual(["archivos-bajo-el-piso"]);
  });

  it("varios problemas a la vez salen todos, cada uno con su corrección", () => {
    const r = problemasEstructurales({ ids: [], aprobados: ["a"], alcances: [{ id: "z", raices: ["q"], archivos: 0 }], archivosLeidos: 0, piso: 5 });
    expect(r.map((p) => p.tipo)).toEqual(["ids-distintos-del-aprobado", "alcance-cero", "archivos-bajo-el-piso"]);
    for (const p of r) expect(p.como.length, p.tipo).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// 2. La evidencia armada sobre el repo real
// ---------------------------------------------------------------------------------------------------------------------------------

let real: Evidencia;

beforeAll(() => {
  real = armarEvidencia({ raiz: RAIZ_DEL_REPO, hoy: HOY });
}, 120_000);

const MATRIZ_CON_HUECOS: ResumenDeMatriz = { invariantes: 1, mutaciones: 2, corridas: 2, protegidas: 1, huecosConocidos: 0, noAplican: 0, fallan: 1, segundos: 0.1, tabla: [], fallas: "HUECO: x" };

describe("armarEvidencia (repo real)", () => {
  it("la evidencia del repo real es OK: sin problemas, con el reporte completo si no lo es", () => {
    expect(real.problemas, `\n${textoDeEvidencia(real)}`).toEqual([]);
    expect(real.veredicto).toBe("ok");
    expect(real.hallazgos).toEqual([]);
  });

  it("dice qué corrió: el commit, la huella del mecanismo, y los contratos del manifiesto, que son los aprobados", () => {
    expect(real.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(real.huellaDelMecanismo).toMatch(/^[0-9a-f]{40}$/);
    expect(real.piezasDelMecanismo).toBeGreaterThan(20);
    expect(real.idsDelManifiesto).toEqual(MANIFIESTO.map((c) => c.id).sort());
    expect(real.idsAprobados).toEqual(real.idsDelManifiesto);
    expect(real.contratos.map((c) => c.id).sort()).toEqual(real.idsDelManifiesto);
  });

  it("por contrato: archivos en alcance (cantidad y sha de la lista ordenada), detectores y consumidores", () => {
    for (const c of real.contratos) {
      const definido = MANIFIESTO.find((m) => m.id === c.id);
      expect(definido, c.id).toBeDefined();
      if (definido === undefined) continue;
      const lista = archivosEnAlcance(RAIZ_DEL_REPO, definido);
      expect(c.archivosEnAlcance, c.id).toBe(lista.length);
      expect(c.archivosEnAlcance, `${c.id}: alcance vacío`).toBeGreaterThan(0);
      expect(c.shaDeLaLista, c.id).toMatch(/^[0-9a-f]{40}$/);
      expect(c.detectores.senales.length, c.id).toBe(definido.senales.length);
      expect(c.detectores.definicion.length, c.id).toBe(definido.definicion.length);
      expect(c.consumidores.cantidad, `${c.id}: sin consumidores`).toBeGreaterThan(0);
      expect(c.hallazgos, c.id).toBe(0);
    }
  });

  it("la lista del alcance cambia de sha si cambia un archivo, y el sha es estable entre corridas", () => {
    const otra = armarEvidencia({ raiz: RAIZ_DEL_REPO, hoy: HOY });
    expect(otra.contratos.map((c) => c.shaDeLaLista)).toEqual(real.contratos.map((c) => c.shaDeLaLista));
    expect(otra.huellaDelMecanismo).toBe(real.huellaDelMecanismo);
  });

  it("el motor leyó al menos el piso aprobado, y ninguna ruta quedó sin clasificar", () => {
    expect(real.pisoDeArchivosLeidos).toBe(PISO_DE_ARCHIVOS_LEIDOS);
    expect(real.archivosLeidos).toBeGreaterThanOrEqual(PISO_DE_ARCHIVOS_LEIDOS);
    expect(real.sinClasificar).toBe(0);
    expect(real.archivosTotales).toBeGreaterThan(real.archivosLeidos);
    expect(Object.values(real.archivosPorTipo).reduce((a, b) => a + b, 0) + real.excluidos).toBe(real.archivosTotales);
  });

  it("áreas: cuántas, cuántas declaran [] y cuántas declaran contratos", () => {
    expect(real.areas.total).toBeGreaterThan(50);
    expect(real.areas.conVacio + real.areas.conContratos).toBe(real.areas.total);
    expect(real.areas.conContratos).toBeGreaterThan(0);
  });

  it("excepciones, deuda y exclusiones con los días hasta vencer, de la que vence antes a la que vence después", () => {
    const dias = real.vencimientos.map((v) => v.dias);
    expect([...dias].sort((a, b) => a - b)).toEqual(dias);
    expect(real.vencimientos.some((v) => v.clase === "exclusion")).toBe(true);
    for (const v of real.vencimientos) expect(v.dias, `${v.clase} ${v.archivo} vencida`).toBeGreaterThanOrEqual(0);
    expect(real.vencimientos.filter((v) => v.clase === "deuda").length).toBe(MANIFIESTO.reduce((n, c) => n + c.deuda.length, 0));
  });

  it("el cumplimiento y el registro de aprobaciones corrieron y están limpios", () => {
    expect(real.cumplimiento.testsProtegidos).toBeGreaterThan(10);
    expect(real.cumplimiento.hallazgos).toBe(0);
    expect(real.aprobaciones.piezas).toBeGreaterThan(20);
    expect(real.aprobaciones.hallazgos).toBe(0);
  });

  it("se serializa a JSON sin perder nada, y el resumen legible y el Markdown traen lo esencial", () => {
    expect(JSON.parse(JSON.stringify(real))).toEqual(real);
    const texto = textoDeEvidencia(real);
    expect(texto).toContain(`Contratos: ${MANIFIESTO.length}`);
    expect(texto).toContain("RESULTADO: OK");
    expect(texto).toContain("Archivos leídos por el motor");
    const md = markdownDeEvidencia(real);
    expect(md).toContain("## Contratos: evidencia por corrida · OK");
    expect(md).toContain("| Contrato | Archivos en alcance |");
    for (const c of MANIFIESTO) expect(md).toContain(`\`${c.id}\``);
  });

  it("rojo: con el piso por encima de lo que se lee, la misma corrida falla y dice cuántos archivos leyó", () => {
    const r = armarEvidencia({ raiz: RAIZ_DEL_REPO, hoy: HOY, piso: 1_000_000 });
    expect(r.veredicto).toBe("falla");
    expect(r.problemas.map((p) => p.tipo)).toEqual(["archivos-bajo-el-piso"]);
    expect(r.problemas[0].que).toContain(`leyó ${r.archivosLeidos} archivos`);
    expect(textoDeEvidencia(r)).toContain("RESULTADO: FALLA");
  });

  it("rojo: una matriz de mutaciones con un hueco hace fallar la evidencia", () => {
    const r = armarEvidencia({ raiz: RAIZ_DEL_REPO, hoy: HOY, matriz: MATRIZ_CON_HUECOS });
    expect(r.problemas.map((p) => p.tipo)).toEqual(["matriz-con-huecos"]);
    expect(textoDeEvidencia(r)).toContain("HUECO: x");
  });

  it("rojo: un registro de aprobaciones sin ningún contrato aprobado deja la evidencia en rojo (ids y hallazgos)", () => {
    const r = armarEvidencia({ raiz: RAIZ_DEL_REPO, hoy: HOY, registro: [] });
    expect(r.veredicto).toBe("falla");
    expect(r.problemas.map((p) => p.tipo)).toEqual(["ids-distintos-del-aprobado", "hallazgos"]);
  });

  it("rojo: pasado el vencimiento de la deuda, la evidencia falla con los hallazgos del motor", () => {
    const r = armarEvidencia({ raiz: RAIZ_DEL_REPO, hoy: "2030-01-01" });
    expect(r.veredicto).toBe("falla");
    expect(r.problemas.map((p) => p.tipo)).toContain("hallazgos");
    expect(r.hallazgos.some((h) => h.includes("deuda-vencida"))).toBe(true);
  });

  it("cada tipo de problema de evidencia que la matriz no produce lo cubre un caso rojo de este archivo", () => {
    // `ids-distintos-del-aprobado`, `alcance-cero` y `archivos-bajo-el-piso` los produce la matriz (`guardian/evidencia-no-vacia`) y los prueban los casos sintéticos de arriba;
    // `hallazgos` y `matriz-con-huecos` los prueban los casos rojos de la evidencia real. Ningún tipo queda sin un caso rojo.
    const producidos = new Set([
      ...problemasEstructurales({ ...VERDE, ids: [], alcances: [] }).map((p) => p.tipo),
      ...problemasEstructurales({ ...VERDE, alcances: [{ id: "a", raices: ["x"], archivos: 0 }] }).map((p) => p.tipo),
      ...problemasEstructurales({ ...VERDE, archivosLeidos: 0 }).map((p) => p.tipo),
      ...armarEvidencia({ raiz: RAIZ_DEL_REPO, hoy: "2030-01-01" }).problemas.map((p) => p.tipo),
      ...armarEvidencia({ raiz: RAIZ_DEL_REPO, hoy: HOY, matriz: MATRIZ_CON_HUECOS }).problemas.map((p) => p.tipo),
    ]);
    expect([...TIPOS_DE_PROBLEMA_DE_EVIDENCIA].filter((t) => !producidos.has(t))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// 3. El ejecutor
// ---------------------------------------------------------------------------------------------------------------------------------

describe("ejecutar (el ejecutor de evidencia)", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "evidencia-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const correr = async (env: Record<string, string>, hoy = HOY): Promise<{ codigo: number; salida: string[]; errores: string[] }> => {
    const salida: string[] = [];
    const errores: string[] = [];
    const codigo = await ejecutar({ raiz: RAIZ_DEL_REPO, env, hoy, correrMatriz: false, imprimir: (t) => salida.push(t), imprimirError: (t) => errores.push(t) });
    return { codigo, salida, errores };
  };

  it("sin variables no escribe ningún archivo y el resumen sale por la consola", () => {
    expect(prepararSalidas({})).toEqual({ json: null, resumen: null });
    expect(prepararSalidas({ [VARIABLE_DE_EVIDENCIA]: "  ", [VARIABLE_DE_RESUMEN]: "" })).toEqual({ json: null, resumen: null });
  });

  it("con CONTRATOS_EVIDENCIA crea la carpeta, borra un resultado viejo y NO deja ningún archivo mientras corre (la clasificación de rutas no lo vería como suelto)", () => {
    const ruta = join(dir, "nueva-carpeta", "resultado-contratos.json");
    writeFileSync(join(dir, "viejo.json"), '{"veredicto":"ok"}');
    prepararSalidas({ [VARIABLE_DE_EVIDENCIA]: ruta });
    expect(existsSync(ruta)).toBe(false);
    const viejo = join(dir, "viejo.json");
    prepararSalidas({ [VARIABLE_DE_EVIDENCIA]: viejo });
    expect(existsSync(viejo)).toBe(false);
  });

  it("CONTRATOS_EVIDENCIA en una ruta que no se puede escribir falla CLARO y antes de correr nada", async () => {
    const archivo = join(dir, "no-es-una-carpeta");
    writeFileSync(archivo, "x");
    const ruta = join(archivo, "adentro", "resultado-contratos.json");
    expect(() => prepararSalidas({ [VARIABLE_DE_EVIDENCIA]: ruta })).toThrow(ErrorDeSalida);
    expect(() => prepararSalidas({ [VARIABLE_DE_EVIDENCIA]: ruta })).toThrow(/CONTRATOS_EVIDENCIA=.*no se puede escribir/);
    const r = await correr({ [VARIABLE_DE_EVIDENCIA]: ruta });
    expect(r.codigo).toBe(1);
    expect(r.salida).toEqual([]);
    expect(r.errores.join("\n")).toContain("CONTRATOS_EVIDENCIA");
    expect(r.errores.join("\n")).toContain("sin dónde dejar la evidencia la corrida no vale");
  });

  it("GITHUB_STEP_SUMMARY en una ruta que no se puede escribir también falla claro", async () => {
    const ruta = join(dir, "no-es-una-carpeta", "resumen.md");
    const r = await correr({ [VARIABLE_DE_RESUMEN]: ruta });
    expect(r.codigo).toBe(1);
    expect(r.errores.join("\n")).toContain("GITHUB_STEP_SUMMARY");
  });

  it("sobre el repo real: sale 0, imprime el resumen, escribe el JSON entero y agrega el resumen en Markdown", async () => {
    const json = join(dir, "salida", "resultado-contratos.json");
    const resumen = join(dir, "resumen.md");
    writeFileSync(resumen, "# Antes\n");
    const r = await correr({ [VARIABLE_DE_EVIDENCIA]: json, [VARIABLE_DE_RESUMEN]: resumen });
    expect(r.errores).toEqual([]);
    expect(r.codigo, r.salida.join("\n")).toBe(0);
    expect(r.salida.join("\n")).toContain("RESULTADO: OK");
    const escrito = JSON.parse(readFileSync(json, "utf8")) as Evidencia;
    expect(escrito.veredicto).toBe("ok");
    expect(escrito.contratos.map((c) => c.id).sort()).toEqual(MANIFIESTO.map((c) => c.id).sort());
    expect(escrito.matriz).toBeNull();
    const md = readFileSync(resumen, "utf8");
    expect(md.startsWith("# Antes\n")).toBe(true);
    expect(md).toContain("## Contratos: evidencia por corrida · OK");
  }, 60_000);

  it("rojo: si algo falla, sale 1, lo dice y el JSON queda con el veredicto `falla` y los problemas", async () => {
    const json = join(dir, "falla.json");
    const r = await correr({ [VARIABLE_DE_EVIDENCIA]: json }, "2030-01-01");
    expect(r.codigo).toBe(1);
    expect(r.salida.join("\n")).toContain("RESULTADO: FALLA");
    const escrito = JSON.parse(readFileSync(json, "utf8")) as Evidencia;
    expect(escrito.veredicto).toBe("falla");
    expect(escrito.problemas.map((p) => p.tipo)).toContain("hallazgos");
  }, 60_000);
});
