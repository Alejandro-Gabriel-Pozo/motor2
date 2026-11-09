import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { leer, listarArchivos, revisarCerco, type Cerco, type Cuentas } from "./cercos/trinquete";
import { probarCerco } from "./cercos/probar-cerco";
import { procesosSinDecidirAnuladas } from "./cercos/anuladas";

/**
 * Cerco «anuladas en las consultas y lecturas del servidor» (lote 2 de la deuda, auditoría del catálogo común 2026-11-06). El guardián de `reportes-compras-anuladas.test.ts` solo mira `src/core/reportes/`, pero
 * los filtros que de verdad llegan a la base viven en `src/server/consultas/` y `src/server/lecturas/`, y ahí una compra o venta ANULADA (una factura o un ingreso que no ocurrió) puede colarse en un total sin
 * que ningún test lo note. Este cerco aplica la MISMA heurística (`cercos/anuladas.ts`: cada mención en código a `"COMPRA"` o `"VENTA"` tiene una referencia a `anulad…` en las líneas de alrededor) a esas dos carpetas.
 *
 * Alcance de este lote: AMPLIAR el guardián, no unificar los mecanismos con que hoy se excluyen las anuladas (hay varios: `anuladaEn: null`, el flag `anulada`, el filtro de reversiones, SQL crudo…; unificarlos es
 * otro lote). Lo que hoy NO cumple queda como deuda declarada con motivo y fecha (`linea-de-base/anuladas-en-consultas.json` y `cercos/vencimientos.ts`, 60 días); una mención nueva sin decidir las
 * anuladas hace fallar el test (el trinquete no deja subir la cuenta ni aparecer un archivo nuevo). Meta: 0 (cada consulta decide sus anuladas, o se declara en una lista de «las muestra» como en `MUESTRAN_ANULADAS`).
 *
 * Mecanismo, regeneración (`BAJAR_CERCOS=1`) y creación (`CREAR_CERCOS=1`): `test/arquitectura/cercos/trinquete.ts`.
 */
const RAICES = ["src/server/consultas", "src/server/lecturas"] as const;

function medirAnuladas(raizDelRepo: string): Cuentas {
  const cuentas: Cuentas = {};
  for (const ruta of listarArchivos(raizDelRepo, RAICES, [".ts", ".tsx"])) {
    const n = procesosSinDecidirAnuladas(leer(raizDelRepo, ruta)).length;
    if (n > 0) cuentas[ruta] = { "proceso-sin-decidir-anuladas": n };
  }
  return cuentas;
}

const CERCO_ANULADAS_EN_CONSULTAS: Cerco = {
  regla: "anuladas-en-consultas",
  meta: "0 (cada consulta o lectura de COMPRA/VENTA del servidor decide qué hace con las anuladas; lote posterior unifica los mecanismos)",
  medir: medirAnuladas,
  motivos: {
    "src/server/consultas/carta/ventas-por-seccion.ts":
      "Pide las ventas con `cargarLineasDelPeriodo(…, { proceso: \"VENTA\" })` y deja que `calcularVentasDelPeriodo` descarte las anuladas (la fila trae `anulada`, periodo.ts): la decisión existe pero está en otro archivo y la heurística no la ve. Se paga declarando el filtro acá o poniendo el archivo en una lista de «delegan».",
  },
};

probarCerco(CERCO_ANULADAS_EN_CONSULTAS, "Una consulta o lectura de COMPRA o VENTA en src/server/consultas o src/server/lecturas tiene que filtrar o decidir las anuladas (`anuladaEn: null`, `anulada`…) en las líneas de alrededor. Si de verdad las muestra, avisalo.");

describe("cerco «anuladas en consultas»: el detector se ejerce sobre el servidor", () => {
  it("marca una consulta de VENTA sin filtro y la acepta con él", () => {
    expect(procesosSinDecidirAnuladas('where: { proceso: "VENTA", seccion: { sucursalId } },')).toEqual([1]);
    expect(procesosSinDecidirAnuladas('where: { proceso: "VENTA", operacion: { anuladaEn: null } },')).toEqual([]);
  });

  it("encuentra los archivos del servidor que mira", () => {
    expect(listarArchivos(process.cwd(), RAICES, [".ts"]).length).toBeGreaterThan(30);
    expect(medirAnuladas(process.cwd())).toBeTypeOf("object");
  });

  it("un filtro nuevo sin decidir las anuladas en una consulta que no está declarada hace fallar el cerco", () => {
    const raiz = mkdtempSync(join(tmpdir(), "cerco-anuladas-"));
    const dirBase = join(raiz, "base");
    mkdirSync(join(raiz, "src/server/consultas/nuevo"), { recursive: true });
    mkdirSync(dirBase);
    writeFileSync(join(raiz, "src/server/consultas/nuevo/compras-del-mes.ts"), 'export const w = { proceso: "COMPRA", seccion: { sucursalId } };\n');
    writeFileSync(join(dirBase, "anuladas-en-consultas.json"), JSON.stringify({ regla: "anuladas-en-consultas", meta: "", total: 0, entradas: 0, porTipo: {}, cuentas: {} }));
    const { problemas } = revisarCerco({ ...CERCO_ANULADAS_EN_CONSULTAS, motivos: undefined }, { raizDelRepo: raiz, dirLineaDeBase: dirBase, bajar: false, crear: false });
    expect(problemas.join("\n")).toContain("src/server/consultas/nuevo/compras-del-mes.ts");
  });
});
