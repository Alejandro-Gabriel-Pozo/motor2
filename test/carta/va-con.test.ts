import { describe, expect, it } from "vitest";
import { incluyeDeLaSeccion, nombresDeLosPlatosDelItem, textoDeVaCon, vaConDelBloque, type AclaracionParaIncluye } from "../../src/core/carta/incluye-en-carta";
import { AGRUPADO, DE_CARTA, FORMA_DEL_PLATO, INTERNO, NOMBRE_EN_CARTA, RENGLONES, SUBCONJUNTO, TAMANO_DEL_VA_CON, vaConEsperado } from "./va-con.oraculo";

/**
 * «Va con: …» nombra lo que el cliente LEE (caso del dueño, 2026-11-04). Se recorren TODAS las combinaciones (forma del plato × nombre en la carta × subconjunto) contra el oráculo escrito a mano y aparte
 * (`va-con.oraculo.ts`), con las funciones reales: `nombresDeLosPlatosDelItem` (cómo se llama cada plato que dibuja la carta), `incluyeDeLaSeccion` y `vaConDelBloque`.
 */
const eleccion = (opciones: string[]): AclaracionParaIncluye => ({ tipo: "eleccion", rotulo: "Guarnición", opciones, descripciones: opciones.map(() => null), cantidadMinima: 1, cantidadMaxima: 1 });
const TODAS = ["puré", "ensalada", "papas fritas"];
const ALGUNAS = ["puré", "ensalada"];

type Forma = (typeof FORMA_DEL_PLATO)[number];
/** El ítem como lo entrega la carta: el nombre ya resuelto (`nombreEnCarta ?? nombre`) y la forma. */
function item(forma: Forma, conNombre: "sin" | "con") {
  const nombre = forma === "agrupado" ? AGRUPADO : conNombre === "con" ? DE_CARTA : INTERNO;
  if (forma === "base-oculta") return { nombre, presentacion: { forma: "tabla", titulo: false, filas: RENGLONES.map((rotulo) => ({ rotulo })) } };
  if (forma === "base-con-nombre-arriba") return { nombre, presentacion: { forma: "tabla", titulo: true, filas: RENGLONES.map((rotulo) => ({ rotulo })) } };
  return { nombre, presentacion: { forma: "simple" } };
}

describe("«Va con»: el nombre de cada plato según su forma (oráculo)", () => {
  const todas = FORMA_DEL_PLATO.flatMap((forma) => NOMBRE_EN_CARTA.flatMap((conNombre) => SUBCONJUNTO.map((sub) => ({ forma, conNombre, sub }))));

  it("recorre el producto completo de las dimensiones", () => {
    expect(todas).toHaveLength(TAMANO_DEL_VA_CON);
  });

  it.each(todas.map((c) => [`${c.forma} / nombre ${c.conNombre} / ${c.sub}`, c] as const))("%s", (_n, c) => {
    // Una sección con el plato bajo prueba y otro que incluye TODAS las opciones (arma el bloque completo).
    const bajoPrueba = item(c.forma, c.conNombre);
    const otro = { nombre: "Milanesa", presentacion: { forma: "simple" } };
    const r = incluyeDeLaSeccion([[eleccion(c.sub === "todas" ? TODAS : ALGUNAS)], [eleccion(TODAS)]]);
    const bloque = r.bloques[0]!;
    const items = [bajoPrueba, otro];
    const platos = items.map((i, k) => ({ nombre: i.nombre, nombres: nombresDeLosPlatosDelItem(i), partes: r.platos[k] ?? [] }));
    const va = vaConDelBloque(bloque, platos);
    // El plato bajo prueba va primero; «Milanesa» (el otro) cierra la lista.
    expect(va.slice(0, va.length - 1)).toEqual(vaConEsperado(c.forma, c.conNombre, c.sub));
    expect(va.at(-1)).toBe("Milanesa");
    // El nombre interno de la base nunca aparece en «Va con» si la base está oculta.
    if (c.forma === "base-oculta") expect(textoDeVaCon(va)).not.toContain(INTERNO);
  });

  it("una tabla SIN renglones con rótulo (no debería pasar) cae al nombre del ítem: nunca queda un plato sin nombre", () => {
    expect(nombresDeLosPlatosDelItem({ nombre: INTERNO, presentacion: { forma: "tabla", titulo: false, filas: [{ rotulo: null }] } })).toEqual([INTERNO]);
    expect(nombresDeLosPlatosDelItem({ nombre: INTERNO })).toEqual([INTERNO]);
  });
});
