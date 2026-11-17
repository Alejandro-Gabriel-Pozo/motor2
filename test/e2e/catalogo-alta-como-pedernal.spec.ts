import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * «Producto nuevo» como Pedernal (docs/diseno-producto-nuevo-como-pedernal-2026-11-17.md; pedido del dueño, 2026-11-17): «¿Qué es?» elige cómo se guarda cada producto, sin las casillas «Se produce…» ni «Activo
 * en todas las sucursales». Contra Postgres real y un navegador: cada clase queda guardada con el tipo y «se produce» de siempre, y el producto nace disponible en la sucursal (el de venta y la Reventa, sin precio, nacen NO disponibles: el precio ya no se pide en el alta). A 375 px.
 */
test("cada clase del alta se guarda con el tipo y «se produce» de siempre, y el producto nace disponible (el de venta, no)", async ({ paginaAutenticada: page, sucursalId }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const marca = Date.now();
  const casos = [
    { clase: "Materia prima", nombre: `E2E Alta MP ${marca}`, tipo: "MP", seProduce: false, claseDeUso: "MATERIA_PRIMA" },
    { clase: "Insumo", nombre: `E2E Alta Insumo ${marca}`, tipo: "MP", seProduce: false, claseDeUso: "INSUMO" },
    { clase: "Reventa", nombre: `E2E Alta Reventa ${marca}`, tipo: "PV", seProduce: false, claseDeUso: "REVENTA" },
    { clase: "Elaborado", nombre: `E2E Alta Elaborado ${marca}`, tipo: "MP", seProduce: true, claseDeUso: "ELABORADO" },
    { clase: "Producto vendible", nombre: `E2E Alta Vendible ${marca}`, tipo: "PV", seProduce: false, claseDeUso: "VENDIBLE" },
  ] as const;
  try {
    for (const c of casos) {
      await page.goto("/catalogo/productos/nuevo");
      await expect(page.getByLabel("¿Qué es?")).toBeVisible();
      // Ya no están las casillas que Pedernal sacó ni los dos botones de antes.
      await expect(page.getByLabel("Activo en todas las sucursales")).toHaveCount(0);
      await expect(page.getByLabel(/Se produce/)).toHaveCount(0);
      await expect(page.getByLabel("Producto de venta (PV)")).toHaveCount(0);
      // Las cinco clases de Pedernal, en su orden (Reventa entra con E4-5).
      await expect(page.getByLabel("¿Qué es?").locator("option")).toHaveText(["Materia prima", "Insumo", "Reventa", "Elaborado", "Producto vendible"]);
      await page.getByLabel("¿Qué es?").selectOption({ label: c.clase });
      // Frente 2: el alta no pide precio (se carga en la pestaña «Precios» de la ficha).
      await expect(page.getByLabel("Precio de venta")).toHaveCount(0);
      await page.locator('input[name="nombre"]').fill(c.nombre);
      await page.getByRole("combobox", { name: "Unidad", exact: true }).selectOption({ label: "unidad" });
      await page.getByRole("button", { name: "Guardar", exact: true }).click();
      await page.waitForURL(/\/catalogo\/productos\/[^/?]+\?guardado=alta/);
      const guardado = await prisma.producto.findFirstOrThrow({ where: { nombre: c.nombre } });
      expect({ tipo: guardado.tipo, seProduce: guardado.seProduce, claseDeUso: guardado.claseDeUso }, c.clase).toEqual({ tipo: c.tipo, seProduce: c.seProduce, claseDeUso: c.claseDeUso });
      const disponibilidad = await prisma.disponibilidadProducto.findFirst({ where: { productoId: guardado.id, sucursalId } });
      // MP/Insumo/Elaborado nacen disponibles; el producto de venta nace NO disponible hasta tener precio y activarse (A1).
      expect(disponibilidad?.disponible, `${c.clase}: ${c.tipo === "MP" ? "nace disponible" : "nace no disponible (sin precio)"} en la sucursal`).toBe(c.tipo === "MP");
    }
  } finally {
    const productos = await prisma.producto.findMany({ where: { nombre: { startsWith: "E2E Alta " }, codigo: { not: "" } }, select: { id: true } });
    const ids = productos.map((p) => p.id);
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: ids } } });
    await prisma.producto.deleteMany({ where: { id: { in: ids } } });
  }
});
