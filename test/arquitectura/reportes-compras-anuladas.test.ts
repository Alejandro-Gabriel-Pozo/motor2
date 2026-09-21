import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura (K1c, Fase 0): toda consulta o filtro de `src/core/reportes/` sobre el proceso COMPRA tiene que decidir qué hace con las
 * compras ANULADAS. Una compra anulada es una factura que no ocurrió: si un reporte nuevo (o un cambio en uno viejo) la deja entrar, suma gasto que no
 * existió, fija un costo de reposición con el precio de una factura cancelada o mueve un margen ya cerrado.
 *
 * El olvido no da ningún error: el reporte anda y devuelve un número, solo que equivocado el día que se anule la primera compra. Por eso es un test.
 *
 * Cómo se controla: cada mención a `"COMPRA"` en código (no en comentarios) de esos archivos tiene que tener una referencia a `anulad…` en las
 * líneas de alrededor (el filtro `anuladaEn: null` de una consulta, o el `r.anulada` de un cálculo sobre filas ya cargadas). Es una heurística
 * estática, no un análisis de la consulta: no prueba que el filtro esté bien puesto (eso lo hacen los tests de `compras-anuladas.test.ts`), prueba
 * que alguien lo pensó.
 *
 * Excepciones: un archivo que MUESTRA las compras anuladas (en vez de calcular dinero con ellas) va en `MUESTRAN_ANULADAS`, con el motivo.
 */
const RAIZ = join(__dirname, "../../src/core/reportes");
const VENTANA_ANTES = 3;
const VENTANA_DESPUES = 8;

const MUESTRAN_ANULADAS: Record<string, string> = {
  "compras-registradas.ts": "es el listado de facturas: muestra las anuladas marcadas (y la página las deja fuera del total)",
};

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : ruta.endsWith(".ts") ? [ruta] : [];
  });
}

function esComentario(linea: string): boolean {
  const t = linea.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

/** Las líneas (1-based) con una mención a COMPRA en código que no tienen ninguna referencia a anuladas cerca. */
function comprasSinDecidirAnuladas(fuente: string): number[] {
  const lineas = fuente.replace(/\r\n/g, "\n").split("\n");
  const malas: number[] = [];
  lineas.forEach((linea, i) => {
    if (esComentario(linea) || !/["']COMPRA["']/.test(linea)) return;
    const ventana = lineas.slice(Math.max(0, i - VENTANA_ANTES), i + VENTANA_DESPUES + 1).join("\n");
    if (!/anulad/i.test(ventana)) malas.push(i + 1);
  });
  return malas;
}

describe("reportes: toda mención al proceso COMPRA decide qué hace con las compras anuladas", () => {
  const rutas = archivos(RAIZ);

  it("encuentra los archivos de reportes", () => {
    expect(rutas.length).toBeGreaterThan(15);
  });

  it("ninguna consulta o filtro de COMPRA deja pasar las anuladas sin decidirlo", () => {
    const problemas: string[] = [];
    for (const ruta of rutas) {
      const nombre = relative(RAIZ, ruta).split(sep).join("/");
      if (nombre in MUESTRAN_ANULADAS) continue;
      for (const linea of comprasSinDecidirAnuladas(readFileSync(ruta, "utf8"))) problemas.push(`${nombre}:${linea}`);
    }
    expect(
      problemas,
      `Estas líneas de src/core/reportes/ consultan o filtran el proceso COMPRA sin mencionar las compras anuladas cerca (agregá \`anuladaEn: null\` a la consulta, \`r.anulada\` al ` +
        `cálculo, o —si el archivo las muestra en vez de sumarlas— ponelo en MUESTRAN_ANULADAS con el motivo):\n${problemas.join("\n")}`
    ).toEqual([]);
  });

  it("las excepciones declaradas existen y realmente mencionan las anuladas (no es una lista blanca vacía de sentido)", () => {
    for (const nombre of Object.keys(MUESTRAN_ANULADAS)) {
      const ruta = join(RAIZ, nombre);
      expect(readFileSync(ruta, "utf8"), `${nombre} figura en MUESTRAN_ANULADAS pero no menciona las anuladas`).toMatch(/anulad/i);
    }
  });

  describe("el detector (con fuentes sintéticas)", () => {
    it("marca una consulta de COMPRA sin filtro de anuladas", () => {
      const fuente = ["const c = await db.movimientoStock.findMany({", '  where: { proceso: "COMPRA", seccion: { sucursalId } },', "});"].join("\n");
      expect(comprasSinDecidirAnuladas(fuente)).toEqual([2]);
    });

    it("no marca la consulta que filtra anuladas, en la misma línea o cerca", () => {
      const enLinea = 'where: { proceso: "COMPRA", operacion: { anuladaEn: null } },';
      const cerca = ["where: {", '  proceso: "COMPRA",', "  seccion: { sucursalId },", "  operacion: { anuladaEn: null },", "},"].join("\n");
      expect(comprasSinDecidirAnuladas(enLinea)).toEqual([]);
      expect(comprasSinDecidirAnuladas(cerca)).toEqual([]);
    });

    it("marca un filtro en JS sobre filas ya cargadas si no mira `anulada`, y lo acepta si lo mira", () => {
      expect(comprasSinDecidirAnuladas('for (const r of items) {\n  if (r.proceso !== "COMPRA") continue;\n}')).toEqual([2]);
      expect(comprasSinDecidirAnuladas('for (const r of items) {\n  if (r.proceso !== "COMPRA" || r.anulada) continue;\n}')).toEqual([]);
    });

    it("marca el SQL crudo de COMPRA sin filtro y lo acepta con él", () => {
      expect(comprasSinDecidirAnuladas(`WHERE m."proceso" = 'COMPRA' AND s."sucursalId" = x`)).toEqual([1]);
      expect(comprasSinDecidirAnuladas(`WHERE m."proceso" = 'COMPRA' AND o."anuladaEn" IS NULL`)).toEqual([]);
    });

    it("ignora las menciones en comentarios", () => {
      expect(comprasSinDecidirAnuladas('// las compras (proceso: "COMPRA") van aparte\n/* "COMPRA" */\n * "COMPRA"')).toEqual([]);
    });

    it("no se confunde con otros procesos", () => {
      expect(comprasSinDecidirAnuladas('where: { proceso: "VENTA" }')).toEqual([]);
    });
  });
});
