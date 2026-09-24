import { describe, expect, it } from "vitest";
import {
  armarMenuCarta,
  precioDeCarta,
  type ContenidoCartaEntrada,
  type EntradaArmarMenu,
  type ItemAgrupadoEntrada,
} from "@/core/carta/armar-menu";

/**
 * Ítems AGRUPADOS de la carta (docs/plan-agrupacion-items-carta-2026-09-24.md, M2): lógica pura de `armarMenuCarta`. Un
 * "Gaseosa 500 CC" agrupa varios PV reales (Coca-Cola, Sprite, Fanta 500cc) bajo un solo renglón. `armar-menu.test.ts` queda
 * idéntico: acá se prueba lo nuevo y, explícitamente, que un ítem sin agrupar sale exactamente como antes (D3, D6).
 */

const contenido = (extra: Partial<ContenidoCartaEntrada> = {}): ContenidoCartaEntrada => ({
  descripcion: null,
  imagenUrl: null,
  tags: [],
  especial: false,
  orden: 0,
  ...extra,
});

function entradaBase(extra: Partial<EntradaArmarMenu> = {}): EntradaArmarMenu {
  return {
    sucursal: { id: "suc1", nombre: "Central" },
    generadoEn: new Date("2026-09-24T12:00:00.000Z"),
    secciones: [
      {
        id: "sB",
        nombre: "Bebidas sin alcohol",
        titulo: null,
        descripcion: null,
        imagenUrl: null,
        orden: 1,
        categorias: [
          { categoriaId: "cGas", orden: 0 },
          { categoriaId: "cAgua", orden: 1 },
        ],
      },
      { id: "sP", nombre: "Platos Principales", titulo: null, descripcion: null, imagenUrl: null, orden: 2, categorias: [{ categoriaId: "cBife", orden: 0 }] },
    ],
    productos: [
      { id: "p1", nombre: "Bife de chorizo", precioVenta: 34000, categoriaId: "cBife", categoriaNombre: "Bife", contenido: contenido({ especial: true, tags: ["Regional"] }) },
      { id: "pAgua", nombre: "Agua saborizada 500 CC", precioVenta: 5000, categoriaId: "cAgua", categoriaNombre: "Aguas", contenido: contenido() },
      { id: "pTonica", nombre: "Tónica 500cc", precioVenta: 5000, categoriaId: "cGas", categoriaNombre: "Gaseosa 500 CC", contenido: contenido({ orden: 5 }) },
    ],
    preciosLocales: [],
    promos: [],
    ...extra,
  };
}

/** «Gaseosa 500 CC» de Los Miches (A.13): tres opciones a $5000. */
function gaseosa(extra: Partial<ItemAgrupadoEntrada> = {}): ItemAgrupadoEntrada {
  return {
    id: "ag1",
    nombre: "Gaseosa 500 CC",
    categoriaId: "cGas",
    categoriaNombre: "Gaseosa 500 CC",
    contenido: contenido({ descripcion: "  Bien fría  ", tags: ["Sin alcohol"], especial: true, orden: 1 }),
    opciones: [
      { productoId: "pFanta", nombre: "Fanta 500cc", precioVenta: 5000, orden: 2 },
      { productoId: "pCoca", nombre: "Coca-Cola 500cc", precioVenta: 5000, orden: 0 },
      { productoId: "pSprite", nombre: "Sprite 500cc", precioVenta: 5000, orden: 1 },
    ],
    ...extra,
  };
}

const items = (e: EntradaArmarMenu) => armarMenuCarta(e).carta.secciones.flatMap((s) => s.items);

describe("armarMenuCarta — ítems agrupados", () => {
  it("1. sin agrupar = como hoy: sin `agrupados`, con `agrupados: []` y con agrupados que no emiten, la carta es idéntica", () => {
    const hoy = armarMenuCarta(entradaBase()).carta;
    const conVacio = armarMenuCarta(entradaBase({ agrupados: [] })).carta;
    // Un agrupado sin opciones disponibles y otro cuya categoría no está en ninguna sección: ninguno de los dos emite nada,
    // y ningún producto de la entrada es miembro de ellos.
    const conAgrupadosQueNoEmiten = armarMenuCarta(
      entradaBase({
        agrupados: [gaseosa({ opciones: [] }), gaseosa({ id: "ag2", nombre: "Otra", categoriaId: "cSinSeccion", categoriaNombre: "Sin sección" })],
      })
    ).carta;
    for (const otra of [conVacio, conAgrupadosQueNoEmiten]) {
      expect(otra).toEqual(hoy);
      expect(JSON.stringify(otra)).toBe(JSON.stringify(hoy));
    }

    // Con un agrupado que SÍ emite, los ítems sueltos siguen siendo byte por byte los de hoy.
    const conGrupo = items(entradaBase({ agrupados: [gaseosa()] }));
    for (const suelto of hoy.secciones.flatMap((s) => s.items)) {
      const mismo = conGrupo.find((i) => i.productoId === suelto.productoId);
      expect(JSON.stringify(mismo)).toBe(JSON.stringify(suelto));
      expect(Object.keys(mismo!)).toEqual(["productoId", "nombre", "categoria", "descripcion", "precio", "tags", "especial", "imagenUrl"]);
      expect(mismo).not.toHaveProperty("opciones");
    }
  });

  it("2. forma del ítem agrupado: id del agrupado, lo de cara al cliente del agrupado, opciones en orden → nombre; versión 1", () => {
    const { carta } = armarMenuCarta(entradaBase({ agrupados: [gaseosa()] }));
    expect(carta.version).toBe(1);
    const item = carta.secciones[0].items.find((i) => i.productoId === "ag1");
    expect(item).toEqual({
      productoId: "ag1",
      nombre: "Gaseosa 500 CC",
      categoria: "Gaseosa 500 CC",
      descripcion: "Bien fría",
      precio: 5000,
      tags: ["Sin alcohol"],
      especial: true,
      imagenUrl: null,
      opciones: [
        { productoId: "pCoca", nombre: "Coca-Cola 500cc", precio: 5000 },
        { productoId: "pSprite", nombre: "Sprite 500cc", precio: 5000 },
        { productoId: "pFanta", nombre: "Fanta 500cc", precio: 5000 },
      ],
    });

    // Mismo orden → por nombre (localeCompare "es").
    const empatadas = items(
      entradaBase({
        agrupados: [
          gaseosa({
            opciones: [
              { productoId: "b", nombre: "Sprite 500cc", precioVenta: 5000, orden: 0 },
              { productoId: "a", nombre: "Coca-Cola 500cc", precioVenta: 5000, orden: 0 },
            ],
          }),
        ],
      })
    ).find((i) => i.productoId === "ag1")!;
    expect(empatadas.opciones!.map((o) => o.nombre)).toEqual(["Coca-Cola 500cc", "Sprite 500cc"]);
  });

  it("3. un producto presente como suelto Y como opción sale SOLO dentro del grupo (D3)", () => {
    const base = entradaBase();
    const entrada = entradaBase({
      productos: [...base.productos, { id: "pSprite", nombre: "Sprite 500cc", precioVenta: 5000, categoriaId: "cGas", categoriaNombre: "Gaseosa 500 CC", contenido: contenido() }],
      agrupados: [gaseosa()],
    });
    const todos = items(entrada);
    expect(todos.filter((i) => i.productoId === "pSprite")).toEqual([]);
    expect(todos.find((i) => i.productoId === "ag1")!.opciones!.map((o) => o.productoId)).toContain("pSprite");
    expect(todos.filter((i) => i.nombre === "Sprite 500cc")).toEqual([]);
  });

  describe("4. precio (caso «Los Miches»): red de seguridad ante un cambio de precio POSTERIOR (el alta ya bloquea)", () => {
    it("tres opciones a $5000 → $5000, sin diagnóstico", () => {
      const { carta, diagnostico } = armarMenuCarta(entradaBase({ agrupados: [gaseosa()] }));
      expect(carta.secciones[0].items.find((i) => i.productoId === "ag1")!.precio).toBe(5000);
      expect(diagnostico.agrupadosConPreciosDistintos).toEqual([]);
    });

    it("una opción que después pasó a $5500 (drift simulado a mano) → se muestra $5500 (el mayor) y va al diagnóstico", () => {
      const g = gaseosa();
      const conDrift = gaseosa({ opciones: g.opciones.map((o) => (o.productoId === "pFanta" ? { ...o, precioVenta: 5500 } : o)) });
      const { carta, diagnostico } = armarMenuCarta(entradaBase({ agrupados: [conDrift] }));
      const item = carta.secciones[0].items.find((i) => i.productoId === "ag1")!;
      expect(item.precio).toBe(5500);
      expect(item.opciones!.find((o) => o.productoId === "pFanta")!.precio).toBe(5500);
      expect(diagnostico.agrupadosConPreciosDistintos).toEqual([{ id: "ag1", nombre: "Gaseosa 500 CC", minimo: 5000, maximo: 5500 }]);
    });

    it("precio local habilitado en una opción → se usa; deshabilitado → no", () => {
      const habilitado = armarMenuCarta(entradaBase({ agrupados: [gaseosa()], preciosLocales: [{ productoId: "pCoca", precio: 6000, habilitado: true }] }));
      const itemH = habilitado.carta.secciones[0].items.find((i) => i.productoId === "ag1")!;
      expect(itemH.opciones!.find((o) => o.productoId === "pCoca")!.precio).toBe(6000);
      expect(itemH.precio).toBe(6000);
      expect(habilitado.diagnostico.agrupadosConPreciosDistintos).toEqual([{ id: "ag1", nombre: "Gaseosa 500 CC", minimo: 5000, maximo: 6000 }]);

      const deshabilitado = armarMenuCarta(entradaBase({ agrupados: [gaseosa()], preciosLocales: [{ productoId: "pCoca", precio: 6000, habilitado: false }] }));
      const itemD = deshabilitado.carta.secciones[0].items.find((i) => i.productoId === "ag1")!;
      expect(itemD.opciones!.find((o) => o.productoId === "pCoca")!.precio).toBe(5000);
      expect(itemD.precio).toBe(5000);
      expect(deshabilitado.diagnostico.agrupadosConPreciosDistintos).toEqual([]);
    });

    it("paridad: el precio de cada opción es exactamente precioDeCarta", () => {
      const preciosLocales = [
        { productoId: "pCoca", precio: 6000, habilitado: true },
        { productoId: "pSprite", precio: 7000, habilitado: false },
      ];
      const g = gaseosa();
      const item = items(entradaBase({ agrupados: [g], preciosLocales })).find((i) => i.productoId === "ag1")!;
      for (const o of g.opciones) {
        const local = preciosLocales.find((pl) => pl.productoId === o.productoId);
        expect(item.opciones!.find((x) => x.productoId === o.productoId)!.precio, o.nombre).toBe(precioDeCarta(o.precioVenta, local));
      }
    });
  });

  it("5. orden: se intercala con los PV sueltos de su categoría por orden y nombre, y respeta el orden de la categoría", () => {
    const { carta } = armarMenuCarta(
      entradaBase({
        productos: [
          ...entradaBase().productos,
          { id: "pPomelo", nombre: "Pomelo 500cc", precioVenta: 5000, categoriaId: "cGas", categoriaNombre: "Gaseosa 500 CC", contenido: contenido({ orden: 1 }) },
          { id: "pCero", nombre: "Agua tónica cero", precioVenta: 5000, categoriaId: "cGas", categoriaNombre: "Gaseosa 500 CC", contenido: contenido({ orden: 0 }) },
        ],
        agrupados: [gaseosa()],
      })
    );
    // cGas (orden 0) antes que cAgua (orden 1); dentro de cGas: orden 0 → "Agua tónica cero"; orden 1 → "Gaseosa 500 CC" y
    // "Pomelo 500cc" (por nombre); orden 5 → "Tónica 500cc".
    expect(carta.secciones[0].items.map((i) => i.nombre)).toEqual(["Agua tónica cero", "Gaseosa 500 CC", "Pomelo 500cc", "Tónica 500cc", "Agua saborizada 500 CC"]);
  });

  it("6. sin opciones: no se emite, va al diagnóstico, y una sección que solo tenía ese agrupado desaparece", () => {
    const soloGrupo = entradaBase({
      secciones: [{ id: "sG", nombre: "Solo gaseosas", titulo: null, descripcion: null, imagenUrl: null, orden: 0, categorias: [{ categoriaId: "cGas", orden: 0 }] }],
      productos: [],
      agrupados: [gaseosa({ opciones: [] })],
    });
    const { carta, diagnostico } = armarMenuCarta(soloGrupo);
    expect(carta.secciones).toEqual([]);
    expect(diagnostico.agrupadosSinOpciones).toEqual([{ id: "ag1", nombre: "Gaseosa 500 CC" }]);
    expect(diagnostico.agrupadosSinSeccion).toEqual([]);
  });

  it("7. categoría sin sección activa: no se emite y va a agrupadosSinSeccion", () => {
    const { carta, diagnostico } = armarMenuCarta(entradaBase({ agrupados: [gaseosa({ categoriaId: "cOtra", categoriaNombre: "Otra categoría" })] }));
    expect(carta.secciones.flatMap((s) => s.items).map((i) => i.productoId)).not.toContain("ag1");
    expect(diagnostico.agrupadosSinSeccion).toEqual([{ id: "ag1", nombre: "Gaseosa 500 CC", categoria: "Otra categoría" }]);
    // Sus opciones tampoco salen sueltas.
    expect(carta.secciones.flatMap((s) => s.items).map((i) => i.nombre)).not.toContain("Coca-Cola 500cc");
  });

  it("8. imagenUrl insegura del agrupado → null; tags limpios y sin repetidos", () => {
    const item = items(
      entradaBase({ agrupados: [gaseosa({ contenido: contenido({ imagenUrl: "https://cdn.x.com/a.png);background:red", tags: [" Fría ", "Fría", "", "Sin TACC"] }) })] })
    ).find((i) => i.productoId === "ag1")!;
    expect(item.imagenUrl).toBeNull();
    expect(item.tags).toEqual(["Fría", "Sin TACC"]);

    const segura = items(entradaBase({ agrupados: [gaseosa({ contenido: contenido({ imagenUrl: "https://cdn.x.com/gaseosa.jpg" }) })] })).find((i) => i.productoId === "ag1")!;
    expect(segura.imagenUrl).toBe("https://cdn.x.com/gaseosa.jpg");
  });
});
