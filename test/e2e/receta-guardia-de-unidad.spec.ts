import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { expectSinDesborde } from "./fixtures/movil";
import { elegirMateriaPrima } from "./fixtures/receta";

/**
 * Guardia de unidad de las recetas (docs/diseno-guardia-de-unidad-receta-2026-11-09.md): 100 en kg para «Pan rallado» (pensando en gramos) no se guarda sin que la persona lo confirme. El mensaje muestra la
 * equivalencia, el botón «Sí, es esa cantidad: guardar» reenvía el MISMO pedido con la confirmación, tocar el formulario después del aviso lo descarta, y una cantidad normal no molesta. Debajo del campo, la
 * frase llana («Lleva 0,22 kg de … por cada unidad vendida de …»). A 375 px (celular) y a 1280 px, sin desborde y con axe en 0.
 *
 * Datos propios con nombre único (la base del CI es compartida).
 */
for (const ancho of [375, 1280]) {
  test(`receta: una cantidad desproporcionada pide confirmación y la normal no molesta — a ${ancho} px`, async ({ paginaAutenticada: page, sucursalId }) => {
    test.setTimeout(120_000);
    const marca = `${Date.now().toString(36)}${ancho}`;
    const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
    const pan = await prisma.producto.create({ data: { codigo: `E2E-GU-PAN-${marca}`, nombre: `E2E Pan rallado ${marca}`, tipo: "MP", unidadStockId: kg.id } });
    const bife = await prisma.producto.create({ data: { codigo: `E2E-GU-BIFE-${marca}`, nombre: `E2E Bife ${marca}`, tipo: "MP", unidadStockId: kg.id } });
    const milanesa = await prisma.producto.create({ data: { codigo: `E2E-GU-MILA-${marca}`, nombre: `E2E Milanesa ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 18000 } });
    await prisma.disponibilidadProducto.createMany({ data: [pan.id, bife.id, milanesa.id].map((productoId) => ({ sucursalId, productoId, disponible: true })) });

    await page.setViewportSize({ width: ancho, height: 812 });
    await page.goto(`/catalogo/recetas/${milanesa.id}`);
    await page.getByRole("button", { name: "+ Agregar ingrediente", exact: true }).click();
    const formulario = page.locator("form").filter({ has: page.getByRole("heading", { name: "Agregar ingrediente (genera la próxima versión)" }) });
    const cantidad = formulario.locator("#cantidad-ingrediente-nuevo");
    const confirmar = formulario.getByRole("button", { name: "Sí, es esa cantidad: guardar" });
    const guardados = () => prisma.recetaIngrediente.findMany({ where: { recetaVersion: { productoId: milanesa.id } } });

    // Una cantidad normal: la frase llana, y se guarda sin avisos.
    await elegirMateriaPrima(formulario, "Materia prima", bife.nombre);
    await cantidad.fill("0,22");
    await expect(formulario.locator("[data-frase-de-cantidad]")).toHaveText(`Lleva 0,22 kg de ${bife.nombre} por cada unidad vendida de ${milanesa.nombre}.`);
    await formulario.getByRole("button", { name: "Agregar", exact: true }).click();
    await expect(page.locator("tbody tr").filter({ hasText: bife.nombre })).toBeVisible();
    await expect(confirmar).toHaveCount(0);
    expect(await guardados()).toHaveLength(1);

    // 100 kg de pan rallado: no se guarda, el mensaje muestra la equivalencia y ofrece confirmar.
    await elegirMateriaPrima(formulario, "Materia prima", pan.nombre);
    await cantidad.fill("100");
    await expect(formulario.locator("[data-frase-de-cantidad]")).toHaveText(`Lleva 100 kg de ${pan.nombre} por cada unidad vendida de ${milanesa.nombre}.`);
    await formulario.getByRole("button", { name: "Agregar", exact: true }).click();
    const aviso = formulario.getByRole("status").filter({ hasText: "Esto descuenta 100 kg" });
    await expect(aviso).toContainText(`Esto descuenta 100 kg de ${pan.nombre} por cada unidad vendida de ${milanesa.nombre}. Si querías 100 gramos, escribí 0,1 (la receta se carga en kg). Si de verdad es 100 kg, confirmalo.`);
    await expect(confirmar).toBeVisible();
    expect(await guardados()).toHaveLength(1);
    expect((await new AxeBuilder({ page }).analyze()).violations, "receta con el aviso de la guardia de unidad").toEqual([]);
    await expectSinDesborde(page, `receta con el aviso de la guardia a ${ancho} px`);

    // Tocar el formulario después del aviso lo descarta: lo que confirmaría ya no es lo que se avisó.
    await cantidad.fill("0,1");
    await expect(confirmar).toHaveCount(0);
    await expect(aviso).toHaveCount(0);
    await cantidad.fill("100");
    await formulario.getByRole("button", { name: "Agregar", exact: true }).click();
    await expect(confirmar).toBeVisible();

    // Confirmar reenvía el mismo pedido: se guarda con 100.
    await confirmar.click();
    await expect(page.locator("tbody tr").filter({ hasText: pan.nombre })).toBeVisible();
    await expect(confirmar).toHaveCount(0);
    const versiones = await prisma.recetaVersion.findMany({ where: { productoId: milanesa.id }, orderBy: { version: "asc" }, include: { ingredientes: true } });
    expect(versiones.map((v) => v.version)).toEqual([1, 2]);
    expect(versiones[1]!.ingredientes.map((i) => i.insumoProductoId).sort()).toEqual([bife.id, pan.id].sort());
    expect(Number(versiones[1]!.ingredientes.find((i) => i.insumoProductoId === pan.id)?.cantidad)).toBe(100);
  });
}
