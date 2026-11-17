import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * «Producto nuevo» como Pedernal (docs/diseno-producto-nuevo-como-pedernal-2026-11-17.md; pedido del dueño, 2026-11-17): «¿Qué es?» elige cómo se guarda cada producto, sin las casillas «Se produce…» ni «Activo
 * en todas las sucursales». Contra Postgres real y un navegador: cada clase queda guardada con el tipo y «se produce» de siempre, y el producto nace disponible en la sucursal. A 375 px.
 */
test("cada clase del alta se guarda con el tipo y «se produce» de siempre, y el producto nace disponible", async ({ paginaAutenticada: page, sucursalId }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const marca = Date.now();
  const casos = [
    { clase: "Materia prima", nombre: `E2E Alta MP ${marca}`, tipo: "MP", seProduce: false },
    { clase: "Elaborado", nombre: `E2E Alta Elaborado ${marca}`, tipo: "MP", seProduce: true },
    { clase: "Producto vendible", nombre: `E2E Alta Vendible ${marca}`, tipo: "PV", seProduce: false },
  ] as const;
  try {
    for (const c of casos) {
      await page.goto("/catalogo/productos/nuevo");
      await expect(page.getByLabel("¿Qué es?")).toBeVisible();
      // Ya no están las casillas que Pedernal sacó ni los dos botones de antes.
      await expect(page.getByLabel("Activo en todas las sucursales")).toHaveCount(0);
      await expect(page.getByLabel(/Se produce/)).toHaveCount(0);
      await expect(page.getByLabel("Producto de venta (PV)")).toHaveCount(0);
      await page.getByLabel("¿Qué es?").selectOption({ label: c.clase });
      await page.locator('input[name="nombre"]').fill(c.nombre);
      await page.getByLabel("Unidad de stock").selectOption({ label: "unidad" });
      await page.getByRole("button", { name: "Crear producto" }).click();
      await page.waitForURL(/\/catalogo\/productos\/[^/?]+\?guardado=alta/);
      const guardado = await prisma.producto.findFirstOrThrow({ where: { nombre: c.nombre } });
      expect({ tipo: guardado.tipo, seProduce: guardado.seProduce }, c.clase).toEqual({ tipo: c.tipo, seProduce: c.seProduce });
      if (c.tipo === "MP") {
        const disponibilidad = await prisma.disponibilidadProducto.findFirst({ where: { productoId: guardado.id, sucursalId } });
        expect(disponibilidad?.disponible, `${c.clase}: nace disponible en la sucursal`).toBe(true);
      }
    }
  } finally {
    const productos = await prisma.producto.findMany({ where: { nombre: { startsWith: "E2E Alta " }, codigo: { not: "" } }, select: { id: true } });
    const ids = productos.map((p) => p.id);
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: ids } } });
    await prisma.producto.deleteMany({ where: { id: { in: ids } } });
  }
});
