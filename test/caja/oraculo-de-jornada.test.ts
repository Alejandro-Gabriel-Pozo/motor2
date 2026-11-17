import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLASES_DE_MOVIMIENTO, CONTROLES_DEL_DIA, ESTADOS_DE_JORNADA } from "@/core/caja/public";
import { CLASES_DE_MOVIMIENTO_DECLARADAS, COLUMNAS_DECLARADAS, COLUMNAS_SUMADAS_A_OTRAS_TABLAS, ESTADOS_A_RECORRER, ORACULO_DE_AJUSTE, ORACULO_DE_CONTROLES, ORACULO_DE_SEVERIDAD, ORACULO_ESTADO_POR_COMANDO } from "./oraculo-de-jornada";

/**
 * GUARDIÁN del oráculo de la jornada (regla del dueño, 2026-10-28, `docs/mapa-cobertura-de-combinaciones-2026-10-28.md`): falla si aparece una DIMENSIÓN nueva (un estado de jornada, una clave de control, una clase de movimiento o una columna de las
 * tablas de C2) sin declarar en `oraculo-de-jornada.ts` si afecta o no a dinero, permisos, visibilidad o stock. Sin base de datos. Para declarar una columna nueva hay que escribir su entrada (afecta sí o no, con su motivo); si afecta, el oráculo
 * y los tests que lo recorren tienen que cubrirla antes de que este guardián vuelva a verde.
 */
const SCHEMA = readFileSync(join(__dirname, "../../prisma/schema.prisma"), "utf8");
const ESCALARES = new Set(["String", "Int", "Boolean", "DateTime", "Decimal", "BigInt", "Float", "Json", "Bytes"]);

/** Los campos ESCALARES (columnas) de un modelo de `schema.prisma`; las relaciones no son columnas. */
function columnasDe(modelo: string): string[] {
  const inicio = SCHEMA.indexOf(`\nmodel ${modelo} {`);
  if (inicio < 0) throw new Error(`no existe el modelo ${modelo}`);
  const cuerpo = SCHEMA.slice(inicio, SCHEMA.indexOf("\n}", inicio));
  const campos: string[] = [];
  for (const linea of cuerpo.split("\n").slice(1)) {
    const l = linea.trim();
    if (l === "" || l.startsWith("//") || l.startsWith("@@")) continue;
    const [nombre, tipo] = l.split(/\s+/);
    if (nombre !== undefined && tipo !== undefined && ESCALARES.has(tipo.replace(/[?[\]]/g, ""))) campos.push(nombre);
  }
  return campos.sort();
}

describe("guardián del oráculo de la jornada: ninguna dimensión sin declarar", () => {
  it("los estados de la jornada del núcleo son los del oráculo (más «sin actividad», que es la ausencia de fila)", () => {
    expect([...ESTADOS_DE_JORNADA].sort()).toEqual(ESTADOS_A_RECORRER.filter((e) => e !== "SIN_ACTIVIDAD").sort());
    for (const comando of Object.values(ORACULO_ESTADO_POR_COMANDO)) expect(Object.keys(comando).sort()).toEqual([...ESTADOS_A_RECORRER].sort());
  });

  it("las claves y severidades de los controles son exactamente las del oráculo", () => {
    expect(Object.fromEntries(Object.values(CONTROLES_DEL_DIA).map((d) => [d.clave, d.severidad]))).toEqual(ORACULO_DE_CONTROLES);
  });

  it("las clases de movimiento del núcleo son las declaradas (AJUSTE incluida)", () => {
    expect([...CLASES_DE_MOVIMIENTO].sort()).toEqual([...CLASES_DE_MOVIMIENTO_DECLARADAS].sort());
  });

  it("el oráculo de severidad tiene las 12 combinaciones y el de ajuste las 24, sin repetir", () => {
    expect(new Set(ORACULO_DE_SEVERIDAD.map((f) => `${f.severidad}/${f.conHallazgos}/${f.reconocido}`)).size).toBe(12);
    expect(new Set(ORACULO_DE_AJUSTE.map((f) => `${f.puedeAjustar}/${f.sesion}/${f.jornada}`)).size).toBe(24);
  });

  for (const [tabla, declaradas] of Object.entries(COLUMNAS_DECLARADAS)) {
    it(`cada columna de ${tabla} está declarada («afecta» o no, con su motivo) y no sobra ninguna`, () => {
      expect(columnasDe(tabla), "una columna nueva (o una que se fue) sin declarar en COLUMNAS_DECLARADAS").toEqual(Object.keys(declaradas).sort());
      for (const [columna, d] of Object.entries(declaradas)) {
        expect(typeof d.afecta, `${tabla}.${columna}`).toBe("boolean");
        expect(d.motivo.length, `${tabla}.${columna}: el motivo`).toBeGreaterThan(5);
      }
    });
  }

  it("las columnas que C2 sumó a Sucursal, SesionCaja y MovimientoCaja existen y están declaradas; y SesionCaja y MovimientoCaja no tienen otras sin declarar", () => {
    for (const [tabla, declaradas] of Object.entries(COLUMNAS_SUMADAS_A_OTRAS_TABLAS)) {
      for (const columna of Object.keys(declaradas)) expect(columnasDe(tabla), `${tabla}.${columna}`).toContain(columna);
    }
    const c1SesionCaja = ["abiertaEn", "abiertaPorId", "cajaId", "cerradaEn", "cerradaPorId", "claveIdempotencia", "empresaId", "estado", "fechaDeNegocio", "huella", "id", "observacion", "sucursalId", "zonaHoraria"];
    // «cuentaDeCobroId» la sumó C3 y la declara su oráculo (`oraculo-de-combinaciones-del-cobro.ts`, dimensión 4); acá se cuenta como columna ya declarada.
    const c1MovimientoCaja = ["anulaAId", "claveIdempotencia", "clase", "creadoEn", "creadoPorId", "cuentaDeCobroId", "empresaId", "id", "importe", "medioDePagoId", "motivo", "sesionId", "sucursalId"];
    expect(columnasDe("SesionCaja"), "una columna nueva de SesionCaja sin declarar").toEqual([...c1SesionCaja, ...Object.keys(COLUMNAS_SUMADAS_A_OTRAS_TABLAS.SesionCaja as object)].sort());
    expect(columnasDe("MovimientoCaja"), "una columna nueva de MovimientoCaja sin declarar").toEqual([...c1MovimientoCaja, ...Object.keys(COLUMNAS_SUMADAS_A_OTRAS_TABLAS.MovimientoCaja as object)].sort());
  });

  it("el detector de columnas funciona: ve un campo escalar nuevo y no confunde una relación con una columna", () => {
    const columnas = columnasDe("JornadaDeSucursal");
    expect(columnas).toContain("estado");
    expect(columnas).not.toContain("controles");
    expect(columnas).not.toContain("sucursal");
  });
});
