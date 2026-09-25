import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { TOKEN_CARTA_E2E } from "./fixtures/carta-token";

/**
 * Ítems agrupados de la carta (/catalogo/carta/agrupados, docs/plan-agrupacion-items-carta-2026-09-24.md, M7) de punta a punta,
 * caso «Los Miches» (A.13): se crea «Gaseosa 500 CC» desde la pantalla y se le agregan tres gaseosas a $5000; una cuarta a $5500
 * se RECHAZA (D5: solo se agrupan productos del mismo precio) y sigue suelta; el endpoint público muestra un solo renglón a $5000
 * con las tres opciones. Después se quita una opción y se apaga el ítem (sus opciones no salen sueltas, D3). El ítem elige su
 * sección de carta directo, sin categoría ni imagen (docs/plan-carta-seccion-directa-2026-09-25.md).
 */
test("crear un ítem agrupado, bloquear una opción de otro precio y publicarlo en /api/carta/[sucursal]", async ({ paginaAutenticada: page, sucursalId, request }) => {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const nombreItem = `E2E Gaseosa 500 CC ${marca}`;
  const unidad = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "unidad" } });
  const categoria = await prisma.categoriaProducto.create({ data: { nombre: `E2E Gaseosa 500 CC Cat ${marca}` } });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Bebidas sin alcohol ${marca}`, orden: 1 } });
  const crear = (q: string, precioVenta: number) =>
    prisma.producto.create({ data: { codigo: `E2E_AGR_UI_${q}_${marca}`, nombre: `E2E ${q} 500cc ${marca}`, tipo: "PV", categoriaId: categoria.id, precioVenta, unidadStockId: unidad.id } });
  const [coca, sprite, pomelo, fanta] = await Promise.all([crear("Coca", 5000), crear("Sprite", 5000), crear("Pomelo", 5000), crear("Fanta", 5500)]);
  const productoIds = [coca, sprite, pomelo, fanta].map((p) => p.id);
  await prisma.disponibilidadProducto.createMany({ data: productoIds.map((productoId) => ({ sucursalId, productoId, disponible: true })) });
  // Fanta ya sale suelta en la carta (con su contenido): el bloqueo la deja así.
  await prisma.contenidoCartaProducto.create({ data: { productoId: fanta.id, visibleEnCarta: true, seccionCartaId: seccion.id } });

  const leerSeccion = async () => {
    const r = await request.get(`/api/carta/${sucursalId}`, { headers: { Authorization: `Bearer ${TOKEN_CARTA_E2E}` } });
    expect(r.status()).toBe(200);
    const carta = await r.json();
    expect(carta.version).toBe(1);
    return carta.secciones.find((s: { id: string }) => s.id === seccion.id) as { items: Array<{ productoId: string; nombre: string; precio: number; opciones?: unknown[] }> } | undefined;
  };

  try {
    await page.goto("/catalogo/carta/agrupados");
    await expect(page.getByRole("heading", { name: "Ítems agrupados de la carta", level: 1 })).toBeVisible();
    await expect(page.getByText("Solo se pueden agrupar productos del mismo precio (acá).")).toBeVisible();

    // 1. Nuevo ítem agrupado, con descripción y ★.
    const nuevo = page.locator("form", { has: page.getByRole("heading", { name: "Nuevo ítem agrupado" }) });
    await nuevo.getByLabel("Nombre", { exact: true }).fill(nombreItem);
    await nuevo.getByLabel(/^Sección de carta/).selectOption({ label: seccion.nombre });
    await expect(nuevo.getByLabel(/^Imagen/)).toHaveCount(0);
    await nuevo.getByLabel("Descripción (opcional)").fill("Bien fría");
    await nuevo.getByLabel("Especial (★)").check();
    await nuevo.getByRole("button", { name: "Crear ítem agrupado" }).click();
    await expect(nuevo.getByRole("status")).toHaveText(`Ítem agrupado "${nombreItem}" creado.`);

    // 2. Las tres gaseosas de $5000 entran.
    const fila = page.locator(`[data-item-agrupado="${nombreItem}"]`);
    await expect(fila).toBeVisible();
    await fila.locator("summary").first().click();
    const agregar = fila.locator("form", { has: page.getByLabel(`Agregar producto a «${nombreItem}»`) });
    for (const p of [coca, sprite, pomelo]) {
      await agregar.getByLabel(`Agregar producto a «${nombreItem}»`).selectOption(p.id);
      await agregar.getByRole("button", { name: "Agregar" }).click();
      await expect(agregar.getByRole("status")).toHaveText(`«${p.nombre}» agregado a «${nombreItem}».`);
    }
    await expect(fila.locator("[data-opcion-agrupada]")).toHaveCount(3);

    // 3. Fanta ($5500) se rechaza con el mensaje de D5 y sigue en el select (no quedó agregada).
    await agregar.getByLabel(`Agregar producto a «${nombreItem}»`).selectOption(fanta.id);
    await agregar.getByRole("button", { name: "Agregar" }).click();
    await expect(agregar.getByRole("alert")).toHaveText(
      `«${fanta.nombre}» cuesta $5.500 acá y «${nombreItem}» ya tiene opciones a $5.000: agrupá solo productos del mismo precio, o dejala aparte.`
    );
    await expect(agregar.locator(`option[value="${fanta.id}"]`)).toHaveCount(1);
    expect(await prisma.opcionItemAgrupadoCarta.findUnique({ where: { productoId: fanta.id } })).toBeNull();

    // 4. Sin aviso de precios distintos; la carta: un renglón a $5000 con 3 opciones, y Fanta suelta a $5500.
    await expect(fila.getByText(/no cuestan lo mismo/)).toHaveCount(0);
    const item = await prisma.itemAgrupadoCarta.findUniqueOrThrow({ where: { nombre: nombreItem } });
    let s = await leerSeccion();
    const renglon = s!.items.find((i) => i.productoId === item.id)!;
    expect(renglon).toMatchObject({ nombre: nombreItem, precio: 5000, especial: true, descripcion: "Bien fría" });
    expect(renglon.opciones).toEqual([coca, sprite, pomelo].map((p) => ({ productoId: p.id, nombre: p.nombre, precio: 5000 })));
    expect(s!.items.find((i) => i.productoId === fanta.id)).toMatchObject({ nombre: fanta.nombre, precio: 5500 });
    expect(s!.items.find((i) => i.productoId === fanta.id)).not.toHaveProperty("opciones");
    expect(s!.items).toHaveLength(2);

    // 5. Quitar una opción: quedan 2.
    const opcionPomelo = fila.locator(`[data-opcion-agrupada="${pomelo.nombre}"]`);
    await opcionPomelo.getByRole("button", { name: `Quitar «${pomelo.nombre}»` }).click();
    // La fila de la opción desaparece con el refresco (y con ella el mensaje de su formulario).
    await expect(opcionPomelo).toHaveCount(0);
    await expect(fila.locator("[data-opcion-agrupada]")).toHaveCount(2);
    // Pomelo vuelve al select de "sin grupo".
    await expect(agregar.locator(`option[value="${pomelo.id}"]`)).toHaveCount(1);
    s = await leerSeccion();
    expect(s!.items.find((i) => i.productoId === item.id)!.opciones).toHaveLength(2);

    // 6. Apagar el ítem: el renglón desaparece y sus PV no salen sueltos (solo queda Fanta).
    await fila.getByRole("button", { name: `Apagar «${nombreItem}»` }).click();
    await expect(fila.getByRole("button", { name: `Prender «${nombreItem}»` })).toBeVisible();
    s = await leerSeccion();
    expect(s!.items.map((i) => i.productoId)).toEqual([fanta.id]);
  } finally {
    // Orden RESTRICT: opciones → agrupado → contenido → sección → disponibilidad → productos → categoría.
    const items = await prisma.itemAgrupadoCarta.findMany({ where: { seccionCartaId: seccion.id }, select: { id: true } });
    await prisma.opcionItemAgrupadoCarta.deleteMany({ where: { OR: [{ productoId: { in: productoIds } }, { itemAgrupadoCartaId: { in: items.map((i) => i.id) } }] } });
    await prisma.itemAgrupadoCarta.deleteMany({ where: { seccionCartaId: seccion.id } });
    await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: { in: productoIds } } });
    await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: productoIds } } });
    await prisma.producto.deleteMany({ where: { id: { in: productoIds } } });
    await prisma.categoriaProducto.deleteMany({ where: { id: categoria.id } });
  }
});
