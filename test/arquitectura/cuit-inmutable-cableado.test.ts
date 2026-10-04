import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FUENTES_DE_FACTURAS_AUTORIZADAS } from "../../src/core/fiscal/factura-autorizada";

/**
 * El CUIT de una empresa es inmutable desde la primera factura autorizada en PRODUCCIÓN (ADR-021). Hoy no existe el circuito fiscal y el predicado
 * (`core/fiscal/factura-autorizada.ts`) da siempre falso. Este test impide que eso se olvide: el día que el schema declare comprobantes fiscales, la lista de fuentes
 * tiene que dejar de estar vacía, o la plataforma podría corregirle el CUIT a una empresa que ya facturó.
 */
const RAIZ = join(__dirname, "../..");

/** ¿El schema declara algo del circuito fiscal? Un modelo o enum fiscal, o una columna `cae`. */
function schemaTieneCircuitoFiscal(schema: string): boolean {
  return /^\s*(model|enum)\s+(ComprobanteFiscal|AmbienteFiscal|CredencialFiscal|PuntoDeVentaFiscal)\b/m.test(schema) || /^\s+cae\s+/m.test(schema);
}

describe("el CUIT inmutable está cableado cuando existe el circuito fiscal", () => {
  it("el detector distingue un schema con comprobantes fiscales de uno sin ellos", () => {
    expect(schemaTieneCircuitoFiscal("model Empresa {\n  id String @id\n  cuit String?\n}")).toBe(false);
    expect(schemaTieneCircuitoFiscal("model ComprobanteFiscal {\n  id String @id\n}")).toBe(true);
    expect(schemaTieneCircuitoFiscal("model Otra {\n  cae   String?\n}")).toBe(true);
  });

  it("si el schema actual tiene circuito fiscal, la lista de fuentes no está vacía", () => {
    const schema = readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8");
    if (schemaTieneCircuitoFiscal(schema)) {
      expect(FUENTES_DE_FACTURAS_AUTORIZADAS.length, "hay comprobantes fiscales y el predicado `empresaTieneFacturaAutorizada` sigue siempre en falso").toBeGreaterThan(0);
    } else {
      expect(FUENTES_DE_FACTURAS_AUTORIZADAS).toHaveLength(0);
    }
  });
});
