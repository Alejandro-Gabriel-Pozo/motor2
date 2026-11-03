import { describe, expect, it } from "vitest";
import { nombreDeLineaConfigurada, type FotoParaElNombre } from "../../../src/core/opciones/nombre-de-la-linea";
import { CASOS_COMPLETOS, ORACULO_DE_UNA_OPCION } from "./oraculos/nombre-de-la-linea";

/**
 * El nombre de la línea con opciones («Café solo chico»; decisión del dueño 2026-10-29) contra el oráculo escrito a mano (`oraculos/nombre-de-la-linea.ts`): cada combinación válida de
 * tipo × modo de venta × prefijo × «ninguna» × cantidad, el orden de la foto (todas las permutaciones de 2 y de 3 grupos) y los casos completos de las cartas del dueño.
 */
const foto = (tipoGrupo: string, nombreOpcion: string, prefijoEnCarta: string | null, esNinguna: boolean, cantidad: number): FotoParaElNombre => ({
  tipoGrupo,
  nombreOpcion,
  cantidad,
  grupo: { prefijoEnCarta },
  opcion: { esNinguna },
});

const permutaciones = <T>(xs: readonly T[]): T[][] => (xs.length <= 1 ? [[...xs]] : xs.flatMap((x, i) => permutaciones([...xs.slice(0, i), ...xs.slice(i + 1)]).map((resto) => [x, ...resto])));

describe("nombreDeLineaConfigurada contra el oráculo", () => {
  it("una opción: todas las combinaciones válidas dan lo de la tabla, y ninguna fila de la tabla queda sin recorrer", () => {
    const vistas = new Set<string>();
    for (const tipo of ["MEDIDA", "VARIANTE", "INCLUIDA", "ADICIONAL"]) {
      for (const modo of ["DIRECTO", "BASE"]) {
        for (const prefijo of ["sin", "de"]) {
          for (const ninguna of ["no", "si"]) {
            for (const cantidad of [1, 3]) {
              const clave = `${tipo}|${modo}|${prefijo}|${ninguna}|${cantidad}`;
              const esperado = ORACULO_DE_UNA_OPCION[clave];
              if (esperado === undefined) continue; // combinación inválida (no existe en el sistema)
              vistas.add(clave);
              const f = foto(tipo, ninguna === "si" ? "Sin pollo" : "Pollo", prefijo === "de" ? "de" : null, ninguna === "si", cantidad);
              expect(nombreDeLineaConfigurada("Milanesa", modo === "BASE", [f]), clave).toEqual(esperado);
            }
          }
        }
      }
    }
    expect([...vistas].sort()).toEqual(Object.keys(ORACULO_DE_UNA_OPCION).sort());
  });

  it("el orden es el de la foto: todas las permutaciones de 2 y de 3 grupos (en una base, el plato va primero y las demás partes siguen el orden)", () => {
    const grupos = [foto("MEDIDA", "Chico", null, false, 1), foto("VARIANTE", "Pollo", "de", false, 1), foto("VARIANTE", "Napolitana", null, false, 1)];
    const parte = new Map([[grupos[0]!, "chico"], [grupos[1]!, "de pollo"], [grupos[2]!, "napolitana"]]);
    for (const n of [2, 3]) {
      for (const orden of permutaciones(grupos.slice(0, n))) {
        const cual = orden.map((f) => f.nombreOpcion).join(">");
        expect(nombreDeLineaConfigurada("Café", false, orden).nombre, cual).toBe(["Café", ...orden.map((f) => parte.get(f)!)].join(" "));
        // En una base, la MEDIDA es el plato («Chico», tal cual) y las demás partes siguen el orden de la foto.
        const resto = orden.filter((f) => f !== grupos[0]).map((f) => parte.get(f)!);
        expect(nombreDeLineaConfigurada("Café", true, orden).nombre, cual).toBe(["Chico", ...resto].join(" "));
      }
    }
  });

  it.each(CASOS_COMPLETOS)("$caso", ({ producto, base, fotos, nombre, detalle }) => {
    const salida = nombreDeLineaConfigurada(producto, base, fotos.map(([t, o, p, n, c]) => foto(t, o, p, n, c)));
    expect(salida).toEqual({ nombre, ...(detalle ? { detalle } : {}) });
  });

  it("es una lectura pura: la misma foto da el mismo texto (reimprimir no cambia nada) y no modifica la entrada", () => {
    const fotos = [foto("MEDIDA", "Chico", null, false, 1), foto("VARIANTE", "Solo", null, false, 1)];
    const copia = structuredClone(fotos);
    expect(nombreDeLineaConfigurada("Café", false, fotos)).toEqual(nombreDeLineaConfigurada("Café", false, fotos));
    expect(fotos).toEqual(copia);
  });
});
