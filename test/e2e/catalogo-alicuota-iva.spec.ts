import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { fijarCelular } from "./fixtures/movil";

/**
 * Circuito Catálogo — cargar la alícuota de IVA de un producto (paso 13 de la auditoría 2026-11-12; `docs/diseno-alicuota-iva-del-producto-2026-11-12.md`; pedido del dueño del 2026-11-12, «Sí, hacemos A»).
 * El formulario de producto trae «IVA de venta» (en un PV) o «IVA de compra» (en una MP): nada preelegido, y vacío se lee «Pendiente de completar». Se abre el producto, se ve «Pendiente de completar», se
 * elige IVA 21 %, se guarda y se lo ve guardado — a 375 px (celular) y a 1280 (escritorio), y la pantalla no tiene violaciones de axe. `paginaAutenticada` es el administrador de la semilla (tiene
 * `producto_campos_sensibles`, la clave que protege este campo).
 */

async function sinViolacionesDeAxe(page: Page, momento: string) {
  expect((await new AxeBuilder({ page }).analyze()).violations, momento).toEqual([]);
}

const MEDIDAS = [
  { nombre: "celular (375 px)", ancho: 375, alto: 812 },
  { nombre: "escritorio (1280 px)", ancho: 1280, alto: 800 },
] as const;

for (const medida of MEDIDAS) {
  test(`un producto de venta sin declarar: se ve «Pendiente de completar», se elige IVA 21 %, se guarda y queda guardado — ${medida.nombre}`, async ({ paginaAutenticada: page }) => {
    const marca = `${Date.now()}-${medida.ancho}`;
    const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
    const producto = await prisma.producto.create({ data: { codigo: `E2E-IVA-PV-${marca}`, nombre: `E2E IVA Venta ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 3200 } });
    try {
      await page.setViewportSize({ width: medida.ancho, height: medida.alto });
      if (medida.ancho === 375) await fijarCelular(page);
      await page.goto(`/catalogo/productos/${producto.id}/datos`);
      await expect(page.getByText(`Editar "${producto.nombre}"`)).toBeVisible();

      const bloque = page.locator('[data-alicuota-iva="venta"]');
      const selector = bloque.getByLabel("IVA de venta");
      // Nada preelegido: sin declarar, y la pantalla lo dice.
      await expect(selector).toHaveValue("");
      await expect(bloque.getByText("Pendiente de completar", { exact: true })).toBeVisible();
      await expect(page.locator('[data-alicuota-iva="compra"]')).toHaveCount(0);
      // La lista de la base, en el orden de `ALICUOTAS_IVA`.
      await expect(selector.locator("option")).toHaveText(["Sin declarar", "IVA 0 %", "IVA 2,5 %", "IVA 5 %", "IVA 10,5 %", "IVA 21 %", "IVA 27 %", "Exento", "No gravado"]);
      await sinViolacionesDeAxe(page, "formulario con la alícuota sin declarar");

      await selector.selectOption({ label: "IVA 21 %" });
      await expect(selector).toHaveValue("IVA_21");
      await expect(bloque.getByText("Pendiente de completar", { exact: true })).toHaveCount(0);
      await sinViolacionesDeAxe(page, "formulario con IVA 21 % elegido");

      await page.getByRole("button", { name: "Guardar cambios" }).click();
      await page.waitForURL(new RegExp(`/catalogo/productos/${producto.id}\\?guardado=cambios`));
      expect((await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } })).alicuotaIvaVenta).toBe("IVA_21");
      expect((await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } })).alicuotaIvaCompra).toBeNull();

      // Se lo ve guardado al volver a abrir el formulario.
      await page.goto(`/catalogo/productos/${producto.id}/datos`);
      await expect(page.getByText(`Editar "${producto.nombre}"`)).toBeVisible();
      await expect(page.locator('[data-alicuota-iva="venta"]').getByLabel("IVA de venta")).toHaveValue("IVA_21");
      await expect(page.locator('[data-alicuota-iva="venta"]').getByText("Pendiente de completar", { exact: true })).toHaveCount(0);
      await sinViolacionesDeAxe(page, "formulario con la alícuota guardada");
    } finally {
      await prisma.producto.deleteMany({ where: { id: producto.id } });
    }
  });
}

test("una materia prima trae «IVA de compra» (no el de venta): se elige IVA 10,5 %, se guarda y queda guardado — celular", async ({ paginaAutenticada: page }) => {
  const marca = `${Date.now()}-mp`;
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-IVA-MP-${marca}`, nombre: `E2E IVA Compra ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  try {
    await fijarCelular(page);
    await page.goto(`/catalogo/productos/${producto.id}/datos`);
    await expect(page.getByText(`Editar "${producto.nombre}"`)).toBeVisible();
    const bloque = page.locator('[data-alicuota-iva="compra"]');
    await expect(page.locator('[data-alicuota-iva="venta"]')).toHaveCount(0);
    await expect(bloque.getByLabel("IVA de compra")).toHaveValue("");
    await expect(bloque.getByText("Pendiente de completar", { exact: true })).toBeVisible();
    await bloque.getByLabel("IVA de compra").selectOption({ label: "IVA 10,5 %" });
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await page.waitForURL(new RegExp(`/catalogo/productos/${producto.id}\\?guardado=cambios`));
    const guardado = await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } });
    expect({ venta: guardado.alicuotaIvaVenta, compra: guardado.alicuotaIvaCompra }).toEqual({ venta: null, compra: "IVA_10_5" });
  } finally {
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  }
});
