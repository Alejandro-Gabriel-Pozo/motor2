import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONDICIONES_DE_PAGO } from "@/core/compras/pago-de-factura";
import { dimensionesDelOraculo, tablaDelOraculo } from "../setup/oraculo-una-sola-compra";

/**
 * GUARDIÁN de dimensiones nuevas de «una sola compra» (regla «Combinaciones» del dueño, AGENTS.md). El oráculo `docs/oraculo-combinaciones-una-sola-compra-2026-11-06.md` declara, para cada columna de las tablas de la
 * factura (`FacturaProveedor`, `FacturaProveedorSucursal`, `PagoDeFacturaProveedor`, `NotaCreditoProveedor`), la dimensión a la que responde o «no afecta» con su motivo. Falla si:
 *  (a) el esquema tiene una columna que el oráculo no declara (una columna nueva obliga a decidir si cambia el resultado de anular, corregir o pagar);
 *  (b) el oráculo declara una columna que ya no existe, o una columna «afecta» a una dimensión que el oráculo no define, o «no afecta» sin motivo;
 *  (c) las condiciones de pago del código no son exactamente los valores declarados de la dimensión C (un estado nuevo obliga a ampliar el oráculo).
 */
const MODELOS = ["FacturaProveedor", "FacturaProveedorSucursal", "PagoDeFacturaProveedor", "NotaCreditoProveedor"] as const;
const ESQUEMA = readFileSync(join(__dirname, "../../prisma/schema.prisma"), "utf8");
const DIMENSIONES = dimensionesDelOraculo();

/** Las columnas escalares del modelo (se omiten las relaciones: su tipo es otro modelo, un `[]` o un `?` de modelo). */
function columnasEscalares(esquema: string, modelo: string): string[] {
  const m = new RegExp(`^model ${modelo} \\{([\\s\\S]*?)^\\}`, "m").exec(esquema);
  if (!m) throw new Error(`No se encontró el modelo ${modelo}.`);
  const modelos = new Set([...esquema.matchAll(/^model (\w+) \{/gm)].map((x) => x[1]!));
  const salida: string[] = [];
  for (const linea of m[1]!.split("\n")) {
    const t = /^\s+(\w+)\s+(\w+)(\[\]|\?)?/.exec(linea);
    if (!t || linea.trim().startsWith("//") || linea.trim().startsWith("@@")) continue;
    if (modelos.has(t[2]!)) continue;
    salida.push(t[1]!);
  }
  return salida;
}

describe("guardián: columnas de la factura declaradas en el oráculo de una sola compra", () => {
  const declaradas = tablaDelOraculo("Columnas de la factura y su efecto").filas.map((f) => ({ columna: (f["Columna"] ?? "").trim(), efecto: (f["Efecto"] ?? "").trim() }));

  it("cada columna del esquema está declarada (y ninguna declarada sobra)", () => {
    const delEsquema = MODELOS.flatMap((m) => columnasEscalares(ESQUEMA, m).map((c) => `${m}.${c}`));
    expect(delEsquema.length).toBeGreaterThan(40);
    expect(declaradas.map((d) => d.columna).sort()).toEqual([...delEsquema].sort());
  });

  it("cada declaración es una dimensión definida o «no afecta» con motivo", () => {
    for (const { columna, efecto } of declaradas) {
      if (efecto.startsWith("no afecta")) expect(efecto.replace(/^no afecta:?\s*/, "").length, `${columna}: «no afecta» sin motivo`).toBeGreaterThan(3);
      else expect(Object.keys(DIMENSIONES), `${columna}: dimensión «${efecto}» no definida`).toContain(efecto);
    }
  });

  it("las condiciones de pago del código son exactamente los valores declarados de la dimensión C", () => {
    expect([...CONDICIONES_DE_PAGO].sort()).toEqual([...(DIMENSIONES["C"] ?? [])].sort());
  });

  it("control de sanidad: el lector de columnas ve las escalares y no las relaciones", () => {
    const muestra = "model X {\n  id String @id\n  otro Y?\n  hijos Y[]\n  n Int\n  // nota String\n  @@index([n])\n}\nmodel Y {\n  id String\n}";
    expect(columnasEscalares(muestra, "X")).toEqual(["id", "n"]);
  });
});
