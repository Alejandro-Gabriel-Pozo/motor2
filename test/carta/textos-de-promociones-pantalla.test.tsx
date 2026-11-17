import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
// Las Server Actions arrastran la sesión (next-auth) que no se carga fuera de Next: el render del servidor no las ejecuta, alcanza con que existan.
vi.mock("../../src/server/actions/refrescar", () => ({ refrescarVistaSiHaceFalta: vi.fn() }));
import type { LugarDeCombo } from "../../src/core/carta/public";
import type { ParteParaRepartir } from "../../src/core/pos/reparto-del-precio-de-la-promo";

/**
 * Los componentes de la pantalla de promociones en los DOS estados del interruptor `ARMADO_DE_PROMO_COMO_PEDERNAL` (pedido del dueño 2026-11-17: aire y pocas palabras). El módulo del interruptor se
 * reemplaza con `vi.doMock` + `vi.resetModules` (como `armado-de-promo-como-pedernal.test.tsx`). Los textos exactos de cada estado los fija `textos-de-promociones.test.ts`; acá se mira que los componentes los lean.
 */
const RUTA = "../../src/core/carta/armado-de-promo-como-pedernal";
const SECCIONES = [{ id: "s1", nombre: "Entrada", activa: true }];
const LUGARES: LugarDeCombo[] = [{ id: "l1", tipo: "LISTA", nombre: "Bebida", cantidadMinima: 1, cantidadMaxima: 1, orden: 1, entradas: [] }];
const PARTES: ParteParaRepartir[] = [
  { nombre: "Platos", cantidadMinima: 0, cantidadMaxima: 2, ejemplo: { nombre: "Barbacoa", precioLista: 12000 } },
  { nombre: "Bebidas", cantidadMinima: 1, cantidadMaxima: 1, ejemplo: { nombre: "Gaseosa", precioLista: 2200 } },
];

async function dibujar(encendido: boolean) {
  vi.resetModules();
  vi.doMock(RUTA, async (original) => ({ ...(await original<typeof import("../../src/core/carta/armado-de-promo-como-pedernal")>()), ARMADO_DE_PROMO_COMO_PEDERNAL: encendido }));
  const formularios = await import("../../src/app/(app)/carta/parametrizacion/formularios");
  const { DondeSeVe } = await import("../../src/app/(app)/carta/parametrizacion/promociones/donde-se-ve");
  const { PartesDeLaPromo } = await import("../../src/app/(app)/carta/parametrizacion/promociones/partes-de-la-promo");
  const { RepartoDelPrecio } = await import("../../src/app/(app)/carta/parametrizacion/promociones/reparto-del-precio");
  const guardar = vi.fn();
  return {
    promo: renderToStaticMarkup(<formularios.CamposPromo secciones={SECCIONES} />),
    lugares: renderToStaticMarkup(<formularios.CamposLugares lugares={LUGARES} />),
    dondeSeVe: renderToStaticMarkup(<DondeSeVe titulo="Menú" soloSalon tieneCupos={false} puedeDefinir guardar={guardar} />),
    queLleva: renderToStaticMarkup(
      <PartesDeLaPromo secciones={[...SECCIONES, { id: "s2", nombre: "Postres", activa: true }]} cuposDeSeccion={[{ seccionCartaId: "s1", cantidadMinima: 1, cantidadMaxima: 1 }]} lugares={[]} productos={[]} puedeEditar guardar={guardar} />
    ),
    reparto: renderToStaticMarkup(<RepartoDelPrecio precio={13500} partes={PARTES} />),
  };
}

afterEach(() => {
  vi.doUnmock(RUTA);
  vi.resetModules();
});

describe("interruptor APAGADO: la pantalla de siempre", () => {
  it("CamposPromo, CamposLugares y «Dónde se ve» con sus textos y sus clases de hoy", async () => {
    const h = await dibujar(false);
    expect(h.promo).toContain("Título");
    expect(h.promo).toContain("Descripción (opcional)");
    expect(h.promo).toContain("Precio<span aria-hidden=\"true\"> *</span>");
    expect(h.lugares).toContain("Sumar un lugar (opcional)");
    expect(h.lugares).toContain("grid grid-cols-2 gap-2 rounded border p-2");
    expect(h.dondeSeVe).toContain("Solo salón: se vende desde el POS, pero no aparece en la carta pública (web, QR ni impresa)");
    expect(h.dondeSeVe).toContain("Útil para un menú pactado con una empresa: el precio no queda publicado.");
    expect(h.dondeSeVe).toContain("Esta promo está en «solo salón» pero no tiene cupos");
    expect(h.dondeSeVe).toContain("mt-3 flex flex-col gap-1");
    expect(h.queLleva).toContain("Agregar un componente");
    expect(h.queLleva).toContain("Tildá la sección de la carta (o «No está en la carta»)");
  });
});

describe("interruptor ENCENDIDO: aire y pocas palabras", () => {
  it("CamposPromo: «Nombre», «Precio» sin el asterisco propio y «Descripción» sin «(opcional)» (el asterisco de los campos obligatorios de `Campo` no cambia)", async () => {
    const h = await dibujar(true);
    expect(h.promo).toContain("Nombre");
    expect(h.promo).not.toContain("Título");
    expect(h.promo).toContain("Descripción");
    expect(h.promo).not.toContain("(opcional)");
    expect(h.promo).toContain("Precio</span>");
    expect(h.promo).not.toContain("Precio<span");
  });

  it("CamposLugares: un campo por línea en celular (apilado), rótulo arriba; «Sumar un lugar» no se dibuja (E2b)", async () => {
    const h = await dibujar(true);
    expect(h.lugares).not.toContain("Sumar un lugar");
    expect(h.lugares).not.toContain("(opcional)");
    expect(h.lugares).toContain("flex flex-col gap-3 rounded border p-3");
    expect(h.lugares).not.toContain("grid-cols-2");
    expect(h.lugares).toContain('name="lugar_cantidad_l1"');
  });

  it("«Dónde se ve»: «Solo salón» sin la explicación ni el aviso", async () => {
    const h = await dibujar(true);
    expect(h.dondeSeVe).toContain(">Solo salón</label>");
    expect(h.dondeSeVe).not.toContain("Útil para un menú pactado");
    expect(h.dondeSeVe).not.toContain("data-aviso-solo-salon-sin-cupos");
    expect(h.dondeSeVe).toContain("Guardar dónde se ve");
  });

  it("«Qué lleva»: «Agregar componente» plegado y sin el párrafo, con «Cantidad» en la parte que ya lleva", async () => {
    const h = await dibujar(true);
    expect(h.queLleva).toContain("Agregar componente");
    expect(h.queLleva).not.toContain("Agregar un componente");
    expect(h.queLleva).not.toContain("Tildá la sección");
    expect(h.queLleva).toContain("Cantidad");
  });

  it("«Reparto del precio»: la frase de la maqueta y, con un rango, sin la explicación del máximo", async () => {
    const h = await dibujar(true);
    expect(h.reparto).toContain("Reparto del precio");
    expect(h.reparto).toContain("Se reparte en proporción al precio de lista. Para el ejemplo se usa el primer producto disponible de cada elección.");
    expect(h.reparto).not.toContain("cantidad máxima");
  });
});
