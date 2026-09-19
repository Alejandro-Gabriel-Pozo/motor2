import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * El dólar oficial (BNA) se ve en el encabezado de toda la aplicación y, en dólares, en el Resumen. Se siembra una cotización con una
 * fecha lejana para que sea la más reciente sin importar lo que haya en la base de pruebas, y se borra al terminar.
 */
test("el encabezado muestra la cotización más reciente y el Resumen expresa los importes en dólares", async ({ paginaAutenticada: page }) => {
  const fecha = new Date("2099-01-05");
  await prisma.cotizacionDolar.upsert({
    where: { fecha_fuente: { fecha, fuente: "BNA" } },
    create: { fecha, fuente: "BNA", compra: 1485, venta: 1535 },
    update: { compra: 1485, venta: 1535 },
  });
  try {
    await page.goto("/catalogo/categorias"); // cualquier pantalla: el encabezado es de todas
    const encabezado = page.locator("[data-cotizacion-dolar]");
    await expect(encabezado).toContainText("USD BNA: 1.485 / 1.535 · 05/01");
    await expect(encabezado).toHaveAttribute("title", /Banco Nación.*1\.535.*05\/01\/2099/);

    await page.goto("/reportes");
    await expect(page.getByRole("heading", { name: "Resumen operativo" })).toBeVisible();
    await expect(page.getByText(/≈ US\$ /).first()).toBeVisible();
  } finally {
    await prisma.cotizacionDolar.deleteMany({ where: { fecha } });
  }
});

test("sin ninguna cotización guardada, el encabezado no muestra el dólar y la pantalla sigue funcionando", async ({ paginaAutenticada: page }) => {
  const guardadas = await prisma.cotizacionDolar.findMany();
  await prisma.cotizacionDolar.deleteMany();
  try {
    await page.goto("/catalogo/categorias");
    await expect(page.getByRole("heading", { name: /Categorías/ })).toBeVisible();
    await expect(page.locator("[data-cotizacion-dolar]")).toHaveCount(0);
  } finally {
    if (guardadas.length) await prisma.cotizacionDolar.createMany({ data: guardadas });
  }
});
