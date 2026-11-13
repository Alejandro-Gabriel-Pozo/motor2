import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLUMNAS_DEL_DUPLICADO } from "../../src/core/catalogo/duplicar-producto";

/**
 * GUARDIÁN DE COLUMNAS de «Duplicar producto» (E4; regla del dueño, 2026-10-28: «un guardián debe fallar si aparece una dimensión nueva —una columna, una opción, una clave— sin declarar si afecta o no»). Compara las columnas
 * escalares de las tablas que el duplicado toca (`Producto`, las cinco de la receta y las dos de lo que el producto admite) con `COLUMNAS_DEL_DUPLICADO` (`src/core/catalogo/duplicar-producto.ts`), en las dos direcciones:
 *  - una columna del esquema que no figura en la declaración → falla: hay que decidir si el duplicado la hereda («se copia»), nace con otro valor («no se copia»), la arma el sistema («derivada») o necesita un permiso;
 *  - una columna declarada que ya no existe en el esquema → falla: la declaración no puede quedar con fantasmas.
 * El comportamiento real de cada columna declarada «se copia» lo prueba `duplicar-producto.test.ts` contra la base.
 */
const esquema = readFileSync(join(__dirname, "../../prisma/schema.prisma"), "utf8");
const MODELOS = new Set([...esquema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]!));

/** Las columnas escalares de un modelo: las líneas de campo que no son una relación (el tipo no es un modelo ni una lista) ni una directiva `@@`. */
function columnasDelModelo(modelo: string): string[] {
  const cuerpo = new RegExp(`^model\\s+${modelo}\\s*\\{([\\s\\S]*?)^\\}`, "m").exec(esquema)?.[1];
  if (cuerpo === undefined) throw new Error(`No se encontró el modelo ${modelo} en schema.prisma`);
  const columnas: string[] = [];
  for (const linea of cuerpo.split("\n")) {
    const m = /^\s+(\w+)\s+(\w+)(\[\])?(\?)?/.exec(linea);
    if (!m || linea.trim().startsWith("//") || linea.trim().startsWith("@@")) continue;
    const [, nombre, tipo, lista] = m;
    if (lista || MODELOS.has(tipo!)) continue;
    columnas.push(nombre!);
  }
  return columnas;
}

describe("guardián de columnas de Duplicar producto", () => {
  it("la declaración cubre exactamente las tablas que el duplicado toca", () => {
    expect(Object.keys(COLUMNAS_DEL_DUPLICADO).sort()).toEqual(["Producto", "ProductoAdmiteGrupo", "ProductoAdmiteOpcion", "RecetaIngrediente", "RecetaPaso", "RecetaPasoIngrediente", "RecetaVersion", "SustitutoRecetaIngrediente"]);
  });

  for (const [modelo, declaradas] of Object.entries(COLUMNAS_DEL_DUPLICADO)) {
    it(`${modelo}: cada columna del esquema está declarada («se copia», «se copia con permiso», «no se copia» o «derivada») y no sobra ninguna`, () => {
      const delEsquema = columnasDelModelo(modelo);
      expect(delEsquema.length).toBeGreaterThan(0);
      const sinDeclarar = delEsquema.filter((c) => !(c in declaradas));
      const fantasmas = Object.keys(declaradas).filter((c) => !delEsquema.includes(c));
      expect(sinDeclarar, `${modelo}: columnas nuevas sin declarar si el duplicado las hereda (agregalas a COLUMNAS_DEL_DUPLICADO)`).toEqual([]);
      expect(fantasmas, `${modelo}: columnas declaradas que ya no existen en el esquema`).toEqual([]);
      for (const destino of Object.values(declaradas)) expect(["SE_COPIA", "SE_COPIA_CON_PERMISO", "NO_SE_COPIA", "DERIVADA"]).toContain(destino);
    });
  }

  it("el lector de columnas ve lo que tiene que ver (sanidad: no pasa en vacío)", () => {
    expect(columnasDelModelo("Producto")).toEqual(expect.arrayContaining(["id", "codigo", "nombre", "precioVenta", "modoDeVenta", "seProduce"]));
    expect(columnasDelModelo("Producto")).not.toContain("presentaciones");
    expect(columnasDelModelo("RecetaVersion")).toEqual(expect.arrayContaining(["rendimientoCantidad", "equipamientoNecesario", "sucursalId"]));
  });
});
