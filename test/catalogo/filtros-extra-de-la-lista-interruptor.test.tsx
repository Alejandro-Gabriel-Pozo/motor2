import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FILTROS_EXTRA_DE_LA_LISTA_VISIBLES, masFiltrosOfrecidos } from "../../src/core/catalogo/filtros-extra-de-la-lista";
import { FiltrosDeLaListaDeProductos } from "../../src/components/catalogo/filtros-de-la-lista-de-productos";
import { leerFiltrosDeProductos } from "../../src/core/catalogo/public";

/**
 * Paso 6 del plan de pantallas (dueño, 2026-11-17: «2a»): la lista de Productos deja Buscar, «¿Qué es?» y «Estado» y OCULTA «Cómo se vende», «En esta sucursal» y «Le falta algo» con un interruptor reversible
 * (`FILTROS_EXTRA_DE_LA_LISTA_VISIBLES`). Los dos estados, y que ocultarlos no cambia lo que la dirección puede pedir.
 */
const MAS = [
  { nombre: "modo", etiqueta: "Cómo se vende", valor: "", opciones: [{ valor: "directo", etiqueta: "Directo" }] },
  { nombre: "disponible", etiqueta: "En esta sucursal", valor: "", opciones: [{ valor: "aca", etiqueta: "Acá" }] },
  { nombre: "falta", etiqueta: "Le falta algo", valor: "", opciones: [{ valor: "sin-precio", etiqueta: "Sin precio de venta" }] },
];

const dibujar = (masFiltros: typeof MAS | readonly never[]) =>
  renderToStaticMarkup(
    <FiltrosDeLaListaDeProductos
      accion="/catalogo/productos"
      filtros={leerFiltrosDeProductos({})}
      clases={[{ valor: "venta", etiqueta: "Producto de venta" }]}
      estados={[{ valor: "falta-completar", etiqueta: "Falta completar" }]}
      masFiltros={masFiltros}
      hayFiltros={false}
      etiquetaDeLaBusqueda="Buscar por nombre o código"
      marcadorDeLaBusqueda="Buscar…"
    />,
  );

describe("filtros extra de la lista de Productos: interruptor", () => {
  it("hoy está apagado (los tres filtros ocultos)", () => {
    expect(FILTROS_EXTRA_DE_LA_LISTA_VISIBLES).toBe(false);
  });

  it("apagado: no se ofrece ninguno; encendido: se ofrecen los tres, en su orden", () => {
    expect(masFiltrosOfrecidos(MAS, false)).toEqual([]);
    expect(masFiltrosOfrecidos(MAS, true)).toEqual(MAS);
    expect(masFiltrosOfrecidos(MAS)).toEqual(FILTROS_EXTRA_DE_LA_LISTA_VISIBLES ? MAS : []);
  });

  it("apagado: la barra tiene Buscar, «¿Qué es?», «Estado» y «Aplicar filtros», y ni «Más filtros» ni los tres controles", () => {
    const html = dibujar(masFiltrosOfrecidos(MAS, false) as never[]);
    for (const visible of ["Buscar por nombre o código", "¿Qué es?", "Estado", "Aplicar filtros"]) expect(html).toContain(visible);
    for (const oculto of ["Más filtros", "Cómo se vende", "En esta sucursal", "Le falta algo", 'name="modo"', 'name="disponible"', 'name="falta"']) expect(html).not.toContain(oculto);
  });

  it("encendido: vuelve «Más filtros» con los tres controles, como antes", () => {
    const html = dibujar(masFiltrosOfrecidos(MAS, true) as typeof MAS);
    for (const visible of ["Más filtros", "Cómo se vende", "En esta sucursal", "Le falta algo", 'name="modo"', 'name="disponible"', 'name="falta"']) expect(html).toContain(visible);
  });

  it("ocultarlos NO borra nada: la dirección sigue pudiendo pedir esos filtros (se leen como siempre)", () => {
    const f = leerFiltrosDeProductos({ modo: "directo", disponible: "aca", falta: "sin-precio" });
    expect(f.modo).not.toBeNull();
    expect(f.disponible).toBe("aca");
    expect(f.falta).toBe("sin-precio");
  });
});
