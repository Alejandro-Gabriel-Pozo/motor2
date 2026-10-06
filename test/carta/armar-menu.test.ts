import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  armarMenuCarta,
  precioDeCarta,
  urlImagenSegura,
  type EntradaArmarMenu,
  type ProductoCartaEntrada,
} from "@/core/carta/armar-menu";
import { resolverPrecioVenta } from "@/core/movimientos/precio-venta";

const contenido = (extra: Partial<ProductoCartaEntrada["contenido"]> = {}): ProductoCartaEntrada["contenido"] => ({
  descripcion: null,
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
      { id: "sP", nombre: "Platos Principales", titulo: "Del fuego", descripcion: "Brasas", imagenUrl: null, orden: 2 },
      { id: "sE", nombre: "Entradas", titulo: null, descripcion: null, imagenUrl: null, orden: 1 },
    ],
    productos: [
      { id: "p1", nombre: "Bife de chorizo", precioVenta: 34000, categoriaNombre: "Bife", seccionCartaId: "sP", contenido: contenido({ especial: true, tags: ["Regional"] }) },
      { id: "p2", nombre: "Empanada", precioVenta: 2500, categoriaNombre: "Empanadas", seccionCartaId: "sE", contenido: contenido() },
    ],
    preciosLocales: [],
    promos: [],
    ...extra,
  };
}

describe("precioDeCarta — misma regla que resolverPrecioVenta", () => {
  it("sin precio local: el precio de venta global", () => {
    expect(precioDeCarta(1000, null)).toBe(1000);
    expect(precioDeCarta(1000, undefined)).toBe(1000);
  });

  it("con precio local habilitado: el local", () => {
    expect(precioDeCarta(1000, { precio: 1200, habilitado: true })).toBe(1200);
  });

  it("con precio local DEshabilitado: el global", () => {
    expect(precioDeCarta(1000, { precio: 1200, habilitado: false })).toBe(1000);
  });

  it("paridad con resolverPrecioVenta (el precio que se cobra) en los tres casos", async () => {
    const casos: Array<{ precio: number; habilitado: boolean } | null> = [null, { precio: 1200, habilitado: true }, { precio: 1200, habilitado: false }, { precio: 0, habilitado: true }];
    for (const fila of casos) {
      // Sin ninguna fila de capacidad (`capacidadSucursal.findMany` vacío) = `precio_local` habilitado.
      const dbFalsa = {
        capacidadSucursal: { findMany: async () => [] },
        precioLocalProducto: { findMany: async () => (fila ? [{ productoId: "p1", precio: fila.precio, habilitado: fila.habilitado }] : []) },
      } as unknown as PrismaClient;
      const cobrado = await resolverPrecioVenta("suc1", "p1", 1000, dbFalsa);
      expect(precioDeCarta(1000, fila), JSON.stringify(fila)).toBe(cobrado);
    }
  });
});

describe("urlImagenSegura", () => {
  it("acepta https simple", () => {
    expect(urlImagenSegura("https://cdn.ejemplo.com/img/bife.jpg")).toBe("https://cdn.ejemplo.com/img/bife.jpg");
    expect(urlImagenSegura("  https://cdn.ejemplo.com/a.png?w=400&h=300  ")).toBe("https://cdn.ejemplo.com/a.png?w=400&h=300");
  });

  it("rechaza lo que no es https", () => {
    expect(urlImagenSegura("http://cdn.ejemplo.com/a.png")).toBeNull();
    expect(urlImagenSegura("javascript:alert(1)")).toBeNull();
    expect(urlImagenSegura("data:image/png;base64,AAAA")).toBeNull();
    expect(urlImagenSegura("//cdn.ejemplo.com/a.png")).toBeNull();
    expect(urlImagenSegura("")).toBeNull();
    expect(urlImagenSegura(null)).toBeNull();
    expect(urlImagenSegura(undefined)).toBeNull();
  });

  it("rechaza espacios, comillas, paréntesis y barras invertidas (rompen el url(...) del CSS de la carta)", () => {
    for (const mala of [
      "https://cdn.ejemplo.com/a b.png",
      'https://cdn.ejemplo.com/a".png',
      "https://cdn.ejemplo.com/a'.png",
      "https://cdn.ejemplo.com/a).png",
      "https://cdn.ejemplo.com/a(.png",
      "https://cdn.ejemplo.com/a\\.png",
      "https://cdn.ejemplo.com/a.png);background:red",
      "https://cdn.ejemplo.com/<x>.png",
    ]) {
      expect(urlImagenSegura(mala), mala).toBeNull();
    }
  });
});

describe("armarMenuCarta", () => {
  it("arma la forma v1: versión, fecha ISO, sucursal y secciones con ítems", () => {
    const { carta } = armarMenuCarta(entradaBase());
    expect(carta.version).toBe(1);
    expect(carta.generadoEn).toBe("2026-09-24T12:00:00.000Z");
    expect(carta.sucursal).toEqual({ id: "suc1", nombre: "Central" });
    expect(carta.secciones.map((s) => s.nombre)).toEqual(["Entradas", "Platos Principales"]);
    const platos = carta.secciones[1];
    expect(platos).toEqual({
      id: "sP",
      nombre: "Platos Principales",
      titulo: "Del fuego",
      descripcion: "Brasas",
      imagenUrl: null,
      orden: 2,
      items: [{ productoId: "p1", nombre: "Bife de chorizo", categoria: "Bife", descripcion: null, precio: 34000, tags: ["Regional"], especial: true, imagenUrl: null }],
      promos: [],
    });
  });

  it("aplica el precio local habilitado y no el deshabilitado", () => {
    const { carta } = armarMenuCarta(
      entradaBase({
        preciosLocales: [
          { productoId: "p1", precio: 36000, habilitado: true },
          { productoId: "p2", precio: 9999, habilitado: false },
        ],
      })
    );
    const precios = Object.fromEntries(carta.secciones.flatMap((s) => s.items).map((i) => [i.productoId, i.precio]));
    expect(precios).toEqual({ p1: 36000, p2: 2500 });
  });

  it("cada PV va a la sección de SU contenido, sin importar su categoría: dos de la misma categoría pueden ir a secciones distintas", () => {
    const { carta } = armarMenuCarta(
      entradaBase({
        productos: [
          ...entradaBase().productos,
          // Misma categoría que el bife ("Bife"), pero ubicado en Entradas.
          { id: "p3", nombre: "Bife chico", precioVenta: 20000, categoriaNombre: "Bife", seccionCartaId: "sE", contenido: contenido() },
        ],
      })
    );
    const porSeccion = Object.fromEntries(carta.secciones.map((s) => [s.id, s.items.map((i) => i.productoId)]));
    expect(porSeccion).toEqual({ sE: ["p3", "p2"], sP: ["p1"] });
  });

  it("un PV sin sección, o con la sección apagada (no llega entre las activas), NO aparece y va al diagnóstico", () => {
    const { carta, diagnostico } = armarMenuCarta(
      entradaBase({
        productos: [
          ...entradaBase().productos,
          { id: "p3", nombre: "Postre suelto", precioVenta: 1, categoriaNombre: "Postres", seccionCartaId: "sApagada", contenido: contenido() },
          { id: "p4", nombre: "Agua", precioVenta: 1, categoriaNombre: null, seccionCartaId: null, contenido: contenido() },
        ],
      })
    );
    const ids = carta.secciones.flatMap((s) => s.items).map((i) => i.productoId);
    expect(ids).not.toContain("p3");
    expect(ids).not.toContain("p4");
    expect(diagnostico.visiblesSinSeccion).toEqual([
      { productoId: "p4", nombre: "Agua" },
      { productoId: "p3", nombre: "Postre suelto" },
    ]);
  });

  it("un PV sin categoría pero con sección SÍ sale: `categoria` lleva el nombre de su sección (texto no vacío)", () => {
    const { carta, diagnostico } = armarMenuCarta(
      entradaBase({ productos: [{ id: "p4", nombre: "Agua", precioVenta: 900, categoriaNombre: null, seccionCartaId: "sE", contenido: contenido() }] })
    );
    expect(carta.secciones[0].items).toEqual([{ productoId: "p4", nombre: "Agua", categoria: "Entradas", descripcion: null, precio: 900, tags: [], especial: false, imagenUrl: null }]);
    expect(diagnostico.visiblesSinSeccion).toEqual([]);
  });

  it("descarta las secciones vacías (sin ítems ni promos), pero una sección solo con promos se muestra", () => {
    const { carta } = armarMenuCarta(
      entradaBase({
        secciones: [
          ...entradaBase().secciones,
          { id: "sV", nombre: "Vacía", titulo: null, descripcion: null, imagenUrl: null, orden: 0 },
          { id: "sPr", nombre: "Promos", titulo: null, descripcion: null, imagenUrl: null, orden: 9 },
        ],
        promos: [{ id: "pr1", seccionCartaId: "sPr", titulo: "1 pizza + coca 1,5L", descripcion: "  ", precio: 25000, orden: 1 }],
      })
    );
    expect(carta.secciones.map((s) => s.nombre)).toEqual(["Entradas", "Platos Principales", "Promos"]);
    expect(carta.secciones[2].promos).toEqual([{ id: "pr1", titulo: "1 pizza + coca 1,5L", descripcion: null, precio: 25000, orden: 1 }]);
    expect(carta.secciones[2].items).toEqual([]);
  });

  it("ordena secciones por orden y nombre, ítems por orden → nombre (sin categoría de por medio), promos por orden y título", () => {
    const { carta } = armarMenuCarta({
      sucursal: { id: "s", nombre: "S" },
      generadoEn: new Date(0),
      secciones: [
        { id: "B", nombre: "Bebidas", titulo: null, descripcion: null, imagenUrl: null, orden: 1 },
        { id: "A", nombre: "Álbum", titulo: null, descripcion: null, imagenUrl: null, orden: 1 },
        { id: "Z", nombre: "Zeta", titulo: null, descripcion: null, imagenUrl: null, orden: 0 },
      ],
      productos: [
        { id: "x1", nombre: "Ñoquis", precioVenta: 1, categoriaNombre: "Pastas", seccionCartaId: "A", contenido: contenido({ orden: 0 }) },
        { id: "x2", nombre: "Canelones", precioVenta: 1, categoriaNombre: "Pastas", seccionCartaId: "A", contenido: contenido({ orden: 0 }) },
        { id: "x3", nombre: "Zzz primero", precioVenta: 1, categoriaNombre: "Pastas", seccionCartaId: "A", contenido: contenido({ orden: -1 }) },
        { id: "x4", nombre: "Milanesa", precioVenta: 1, categoriaNombre: "Carnes", seccionCartaId: "A", contenido: contenido({ orden: 5 }) },
        { id: "x5", nombre: "Agua", precioVenta: 1, categoriaNombre: "Bebidas", seccionCartaId: "Z", contenido: contenido() },
      ],
      preciosLocales: [],
      promos: [
        { id: "q2", seccionCartaId: "B", titulo: "Beta", descripcion: null, precio: 1, orden: 1 },
        { id: "q1", seccionCartaId: "B", titulo: "Alfa", descripcion: null, precio: 1, orden: 1 },
        { id: "q0", seccionCartaId: "B", titulo: "Zeta", descripcion: null, precio: 1, orden: 0 },
      ],
    });
    expect(carta.secciones.map((s) => s.id)).toEqual(["Z", "A", "B"]);
    // Antes la categoría "Carnes" (orden 1 en la sección) iba antes que "Pastas": ahora solo cuenta el orden de cada ítem.
    expect(carta.secciones[1].items.map((i) => i.productoId)).toEqual(["x3", "x2", "x1", "x4"]);
    expect(carta.secciones[2].promos.map((p) => p.id)).toEqual(["q0", "q1", "q2"]);
  });

  it("con el mismo orden, los ítems de categorías distintas se ordenan por nombre (la categoría no agrupa nada)", () => {
    const { carta } = armarMenuCarta({
      ...entradaBase(),
      secciones: [{ id: "s", nombre: "S", titulo: null, descripcion: null, imagenUrl: null, orden: 0 }],
      productos: [
        { id: "1", nombre: "C", precioVenta: 1, categoriaNombre: "Vinos", seccionCartaId: "s", contenido: contenido() },
        { id: "2", nombre: "B", precioVenta: 1, categoriaNombre: "Cervezas", seccionCartaId: "s", contenido: contenido() },
        { id: "3", nombre: "A", precioVenta: 1, categoriaNombre: "Vinos", seccionCartaId: "s", contenido: contenido() },
      ],
    });
    expect(carta.secciones[0].items.map((i) => i.nombre)).toEqual(["A", "B", "C"]);
  });

  it("limpia textos y tags, descarta la imagenUrl insegura de la sección y el ítem sale SIEMPRE con imagenUrl null", () => {
    const { carta } = armarMenuCarta(
      entradaBase({
        secciones: [{ id: "sE", nombre: "Entradas", titulo: "  ", descripcion: " Para picar ", imagenUrl: "https://x.com/a b.jpg", orden: 1 }],
        productos: [
          {
            id: "p2",
            nombre: "Empanada",
            precioVenta: 2500,
            categoriaNombre: "Empanadas",
            seccionCartaId: "sE",
            contenido: contenido({ descripcion: "  ", tags: [" Veggie ", "", "Veggie", "Picante"] }),
          },
        ],
      })
    );
    const s = carta.secciones[0];
    expect(s.titulo).toBeNull();
    expect(s.descripcion).toBe("Para picar");
    expect(s.imagenUrl).toBeNull();
    expect(s.items[0].descripcion).toBeNull();
    expect(s.items[0].tags).toEqual(["Veggie", "Picante"]);
    expect(s.items[0]).toHaveProperty("imagenUrl", null);
  });

  it("la imagen segura de la SECCIÓN sí viaja", () => {
    const { carta } = armarMenuCarta(
      entradaBase({ secciones: [{ id: "sE", nombre: "Entradas", titulo: null, descripcion: null, imagenUrl: "https://cdn.x.com/entradas.jpg", orden: 1 }] })
    );
    expect(carta.secciones[0].imagenUrl).toBe("https://cdn.x.com/entradas.jpg");
  });

  it("sin nada que mostrar: secciones vacías, no error", () => {
    const { carta } = armarMenuCarta(entradaBase({ productos: [] }));
    expect(carta.secciones).toEqual([]);
  });
});
