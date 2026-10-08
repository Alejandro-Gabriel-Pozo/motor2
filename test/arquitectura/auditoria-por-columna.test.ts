import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ENTIDADES_AUDITABLES } from "../../src/core/permisos/auditoria";

/**
 * GT-5 del plan de endurecimiento de seguridad (nace en la tanda T2; S-05 y S-06): AUDITORÍA POR COLUMNA.
 *
 * `escrituras-auditadas.test.ts` exige que toda función que escribe dinero o cambia el significado de una cantidad llame a `registrarCambioAuditado`, pero mira la FUNCIÓN
 * entera: si una edición audita tres columnas y alguien saca la cuarta, sigue en verde (así quedó el factor de conversión de un producto sin rastro mientras se auditaban
 * los precios). Este guardián fija, para los dos casos de uso que ya auditan por columna, la LISTA CERRADA de columnas que dejan su fila, en las dos direcciones:
 *  1. toda columna de la lista aparece como `campo: "<columna>"` de un cambio auditado en el archivo (sacar una → rojo);
 *  2. todo `campo: "<literal>"` auditado del archivo está en la lista (una columna nueva se declara acá, con su entidad);
 *  3. la entidad es una de `ENTIDADES_AUDITABLES` (si no, la pantalla de auditoría no la filtra).
 * Pendientes declarados (S-56): el alta de producto, el portal y la disponibilidad no auditan por columna todavía.
 */
const RAIZ = join(__dirname, "../..");

const COLUMNAS_AUDITADAS: { archivo: string; entidad: (typeof ENTIDADES_AUDITABLES)[number]; campos: string[] }[] = [
  {
    archivo: "src/server/actions/catalogo/casos-de-uso/actualizar-producto.ts",
    entidad: "Producto",
    campos: ["precioVenta", "precioConsignacion", "pasoVenta", "factorConversion", "unidadStockId", "unidadCompraId", "seProduce", "esConsignacion", "proveedorConsignacionId"],
  },
  {
    archivo: "src/server/actions/carta/casos-de-uso/guardar-cupos-promo-carta.ts",
    entidad: "PromoCartaCupo",
    campos: ["cantidadMinima", "cantidadMaxima"],
  },
];

/** Los literales de texto de `campo: "<literal>"` y de `entidad: "<literal>"` que hay en el código (propiedades de un literal de objeto). */
export function camposYEntidadesAuditados(codigo: string): { campos: string[]; entidades: string[] } {
  const fuente = ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, true);
  const campos: string[] = [];
  const entidades: string[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && ts.isStringLiteralLike(n.initializer)) {
      if (n.name.text === "campo") campos.push(n.initializer.text);
      if (n.name.text === "entidad") entidades.push(n.initializer.text);
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return { campos, entidades };
}

describe("GT-5: auditoría por columna (lista cerrada)", () => {
  it.each(COLUMNAS_AUDITADAS)("$archivo audita exactamente sus columnas, en las dos direcciones", ({ archivo, entidad, campos }) => {
    const { campos: auditados, entidades } = camposYEntidadesAuditados(readFileSync(join(RAIZ, archivo), "utf8"));
    expect(auditados.sort(), `${archivo}: las columnas auditadas no coinciden con la lista cerrada (una que falta es un campo sin rastro; una que sobra, una columna nueva sin declarar acá)`).toEqual([...campos].sort());
    expect(new Set(entidades), `${archivo}: la entidad auditada`).toEqual(new Set([entidad]));
    expect(ENTIDADES_AUDITABLES as readonly string[]).toContain(entidad);
  });

  it("el analizador ve una columna que se saca y una que se suma (control de sanidad)", () => {
    const base = 'async function f(tx) { await registrarCambioAuditado(tx, { entidad: "Producto", campo: "a" }); await registrarCambioAuditado(tx, { entidad: "Producto", campo: "b" }); }';
    expect(camposYEntidadesAuditados(base).campos).toEqual(["a", "b"]);
    expect(camposYEntidadesAuditados(base.replace('campo: "b"', "campo: variable")).campos).toEqual(["a"]);
    expect(camposYEntidadesAuditados(base.replace('campo: "b"', 'campo: "b" }); await registrarCambioAuditado(tx, { campo: "c"')).campos).toEqual(["a", "b", "c"]);
  });
});
