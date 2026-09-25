import { test, expect } from "@playwright/test";
import { prisma } from "../../src/lib/db";
import { asegurarBaseSeed } from "./fixtures/auth";
import { TOKEN_CARTA_E2E } from "./fixtures/carta-token";

/**
 * GET /api/carta/[sucursal] con un ítem agrupado, contra el build de producción (docs/plan-agrupacion-items-carta-2026-09-24.md,
 * M4): un solo renglón con `opciones`, y la red de seguridad de D5 — si el precio de una opción cambia DESPUÉS (acá, directo en
 * la base, como lo haría Catálogo), la carta muestra el mayor. El ítem se ubica directo en su sección (sin categoría) y lleva en
 * `categoria` el nombre de esa sección (docs/plan-carta-seccion-directa-2026-09-25.md).
 */
const auth = { Authorization: `Bearer ${TOKEN_CARTA_E2E}` };

test("un ítem agrupado sale como un solo renglón con sus opciones; si una opción sube de precio, se muestra el mayor", async ({ request }) => {
  const { sucursal } = await asegurarBaseSeed();
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const unidad = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "unidad" } });
  const categoria = await prisma.categoriaProducto.create({ data: { nombre: `E2E Agrupado Cat ${marca}` } });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Agrupado Sección ${marca}`, orden: 1 } });
  const productos = await Promise.all(
    ["Coca", "Sprite"].map((q) =>
      prisma.producto.create({ data: { codigo: `E2E_AGR_${q}_${marca}`, nombre: `E2E ${q} 500cc ${marca}`, tipo: "PV", categoriaId: categoria.id, precioVenta: 5000, unidadStockId: unidad.id } })
    )
  );
  const productoIds = productos.map((p) => p.id);
  let agrupadoId: string | null = null;
  try {
    await prisma.disponibilidadProducto.createMany({ data: productoIds.map((productoId) => ({ sucursalId: sucursal.id, productoId, disponible: true })) });
    const agrupado = await prisma.itemAgrupadoCarta.create({ data: { nombre: `E2E Gaseosa 500 CC ${marca}`, seccionCartaId: seccion.id, especial: true } });
    agrupadoId = agrupado.id;
    await prisma.opcionItemAgrupadoCarta.createMany({ data: productoIds.map((productoId, orden) => ({ itemAgrupadoCartaId: agrupado.id, productoId, orden })) });

    const leer = async () => {
      const r = await request.get(`/api/carta/${sucursal.id}`, { headers: auth });
      expect(r.status()).toBe(200);
      const carta = await r.json();
      expect(carta.version).toBe(1);
      const s = carta.secciones.find((x: { id: string }) => x.id === seccion.id);
      expect(s, "la sección sembrada no aparece en la carta").toBeTruthy();
      return s.items;
    };

    expect(await leer()).toEqual([
      {
        productoId: agrupado.id,
        nombre: agrupado.nombre,
        categoria: seccion.nombre,
        descripcion: null,
        precio: 5000,
        tags: [],
        especial: true,
        imagenUrl: null,
        opciones: productos.map((p) => ({ productoId: p.id, nombre: p.nombre, precio: 5000 })),
      },
    ]);

    // Drift posterior (fuera de la pantalla de agrupados): Sprite sube a $5500 → la carta muestra el mayor.
    await prisma.producto.update({ where: { id: productos[1].id }, data: { precioVenta: 5500 } });
    const [item] = await leer();
    expect(item.precio).toBe(5500);
    expect(item.opciones).toEqual([
      { productoId: productos[0].id, nombre: productos[0].nombre, precio: 5000 },
      { productoId: productos[1].id, nombre: productos[1].nombre, precio: 5500 },
    ]);
  } finally {
    // Orden RESTRICT: opciones → agrupado → sección → disponibilidad → productos → categoría.
    if (agrupadoId) await prisma.opcionItemAgrupadoCarta.deleteMany({ where: { itemAgrupadoCartaId: agrupadoId } });
    await prisma.itemAgrupadoCarta.deleteMany({ where: { seccionCartaId: seccion.id } });
    await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: productoIds } } });
    await prisma.producto.deleteMany({ where: { id: { in: productoIds } } });
    await prisma.categoriaProducto.deleteMany({ where: { id: categoria.id } });
  }
});
