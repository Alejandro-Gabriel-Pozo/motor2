import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reportarErrorUnaVez = vi.hoisted(() => vi.fn(async () => {}));
const reportarError = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../src/lib/reportar-error", () => ({ reportarErrorUnaVez, reportarError }));

import { limpiarBaseDeTest, prisma, sembrarProductoDisponible } from "../setup/test-db";
import { GET } from "../../src/app/api/carta/[sucursal]/route";

/**
 * Contrato de GET /api/carta/[sucursal] con un ítem agrupado (docs/plan-agrupacion-items-carta-2026-09-24.md, M4, caso «Los
 * Miches», A.13): `version` sigue en 1; el ítem agrupado lleva la clave aditiva `opciones` y su `productoId` es el del ítem
 * agrupado; un PV suelto de la misma sección NO lleva la clave; nada interno se filtra. `route.ts` no cambia.
 */
const TOKEN = "token-de-prueba-carta-agrupados";

const pedir = (sucursal: string) =>
  GET(new Request(`http://localhost/api/carta/${encodeURIComponent(sucursal)}`, { headers: { authorization: `Bearer ${TOKEN}` } }), {
    params: Promise.resolve({ sucursal }),
  });

describe("GET /api/carta/[sucursal] — ítem agrupado", () => {
  let central: string;
  let agId: string;
  let opciones: { id: string; nombre: string }[];
  let tonicaId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    process.env.CARTA_API_TOKEN = TOKEN;
    const u = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    central = (await prisma.sucursal.create({ data: { nombre: "Central" } })).id;
    const cat = await prisma.categoriaProducto.create({ data: { nombre: "Gaseosa 500 CC" } });
    const seccion = await prisma.seccionCarta.create({ data: { nombre: "Bebidas sin alcohol", orden: 1 } });
    await prisma.categoriaSeccionCarta.create({ data: { categoriaId: cat.id, seccionCartaId: seccion.id } });

    opciones = [];
    for (const [i, nombre] of ["Coca-Cola 500cc", "Sprite 500cc", "Fanta 500cc"].entries()) {
      const p = await sembrarProductoDisponible(
        { codigo: `PV_GASEOSA_SECRETO_${i}`, nombre, tipo: "PV", categoriaId: cat.id, precioVenta: 5000, observaciones: "nota interna", unidadStockId: u.id },
        central
      );
      opciones.push({ id: p.id, nombre });
    }
    const tonica = await sembrarProductoDisponible({ codigo: "PV_TONICA_SECRETO", nombre: "Tónica 500cc", tipo: "PV", categoriaId: cat.id, precioVenta: 5500, unidadStockId: u.id }, central);
    tonicaId = tonica.id;
    await prisma.contenidoCartaProducto.create({ data: { productoId: tonica.id, visibleEnCarta: true, orden: 5 } });

    const ag = await prisma.itemAgrupadoCarta.create({
      data: { nombre: "Gaseosa 500 CC", categoriaId: cat.id, descripcion: "Bien fría", tags: ["Sin alcohol"], especial: true },
    });
    agId = ag.id;
    await prisma.opcionItemAgrupadoCarta.createMany({ data: opciones.map((o, orden) => ({ itemAgrupadoCartaId: ag.id, productoId: o.id, orden })) });
  });

  afterEach(() => {
    delete process.env.CARTA_API_TOKEN;
  });

  it("200: versión 1, un solo renglón agrupado con sus opciones a $5000, el PV suelto sin `opciones`, nada interno", async () => {
    const r = await pedir(central);
    expect(r.status).toBe(200);
    const cuerpo = await r.json();
    expect(cuerpo.version).toBe(1);
    expect(cuerpo.secciones).toHaveLength(1);
    const [agrupado, suelto] = cuerpo.secciones[0].items;
    expect(agrupado).toEqual({
      productoId: agId,
      nombre: "Gaseosa 500 CC",
      categoria: "Gaseosa 500 CC",
      descripcion: "Bien fría",
      precio: 5000,
      tags: ["Sin alcohol"],
      especial: true,
      imagenUrl: null,
      opciones: opciones.map((o) => ({ productoId: o.id, nombre: o.nombre, precio: 5000 })),
    });
    expect(suelto).toEqual({ productoId: tonicaId, nombre: "Tónica 500cc", categoria: "Gaseosa 500 CC", descripcion: null, precio: 5500, tags: [], especial: false, imagenUrl: null });
    expect(Object.keys(suelto)).not.toContain("opciones");

    const texto = JSON.stringify(cuerpo);
    for (const interno of ["PV_GASEOSA_SECRETO", "PV_TONICA_SECRETO", "codigo", "nota interna", "observaciones", "precioVenta", "diagnostico", "agrupadosConPreciosDistintos"]) {
      expect(texto, interno).not.toContain(interno);
    }
  });
});
