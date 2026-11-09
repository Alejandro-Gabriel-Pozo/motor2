import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { expectObjetivosTactiles, expectSinDesborde } from "./fixtures/movil";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";

/**
 * «Qué consume cada opción» en el paso 2 «Opciones y precio» del producto (`docs/diseno-consumo-de-opcion-en-el-producto-2026-11-09.md`): se lee el consumo de cada opción en lenguaje llano, una opción sin consumo dice
 * «pendiente de completar», «Editar consumo» abre el MISMO editor que la Biblioteca y guarda con la misma acción (una versión nueva de la opción, que conserva el precio y el factor que regían), y un grupo que usan varios
 * productos avisa ANTES de editar. A 1280 px y a 375 (sin desborde, objetivos táctiles, accesibilidad). Lo sembrado de opciones no se borra (ver `fixtures/opciones.ts`): nombres con marca propia.
 */
const marca = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
const tarjeta = (page: import("@playwright/test").Page, grupoNombre: string) => page.locator(`[data-admision-grupo="${grupoNombre}"]`);

async function insumo(m: string, nombre: string): Promise<string> {
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const i = await prisma.insumo.create({ data: { nombre: `${nombre} ${m}` } });
  return (await prisma.producto.create({ data: { codigo: `E2E-MP-${nombre}-${m}`, nombre: `${nombre} ${m}`, tipo: "MP", unidadStockId: kg.id, insumoId: i.id } })).id;
}

for (const { ancho, alto } of [
  { ancho: 1280, alto: 800 },
  { ancho: 375, alto: 800 },
]) {
  test(`cargar lo que consume una opción desde el producto, a ${ancho} px: pendiente → editar → guardar → se lee; el precio y el factor no cambian`, async ({ paginaAutenticada: page, sucursalId }) => {
    await page.setViewportSize({ width: ancho, height: alto });
    const m = marca();
    const pollo = await insumo(m, "Pollo");
    const grupoNombre = `E2E Tamaño ${m}`;
    const grupo = await sembrarGrupo({
      nombre: grupoNombre,
      tipo: "MEDIDA",
      cantidadMinima: 1,
      cantidadMaxima: 1,
      marca: m,
      opciones: [
        { nombre: "Simple", factorEscala: 1 },
        { nombre: "Doble", monto: 4000, factorEscala: 1.6 },
      ],
    });
    // «Simple» ya consume 0,15 kg de pollo que escala con el tamaño; «Doble» todavía no tiene nada cargado.
    await prisma.consumoDeOpcion.create({ data: { versionDeOpcionId: grupo.opciones["Simple"]!.versionId, efecto: "SUMA", insumoProductoId: pollo, cantidad: "0.1500", unidadId: (await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } })).id, escalaConLaMedida: true } });
    const nombre = `E2E Milanesa ${m}`;
    const { productoId } = await sembrarProductoConOpciones({ nombre, codigo: `E2E-ML-${m}`, precioVenta: 18000, sucursalId, grupos: [{ grupo }] });

    await page.goto(`/catalogo/productos/${productoId}/opciones`);
    const bloque = tarjeta(page, grupoNombre).locator(`[data-consumo-del-grupo="${grupoNombre}"]`);
    await expect(bloque.locator('[data-consumo-de-opcion="Simple"]')).toContainText(`Descuenta 0,15 kg de Pollo ${m}; escala con el tamaño`);
    await expect(bloque.locator('[data-consumo-de-opcion="Simple"]')).toContainText("Consume ×1 del tamaño base");
    const doble = bloque.locator('[data-consumo-de-opcion="Doble"]');
    await expect(doble).toContainText("Consumo: pendiente de completar.");
    await expect(doble).toContainText("Consume ×1,6 del tamaño base");
    await expect(bloque.locator("[data-grupo-compartido]"), "lo usa un solo producto: sin aviso").toHaveCount(0);
    await expectSinDesborde(page, `${ancho} px: la pestaña Opciones con el consumo de cada opción`);
    if (ancho === 375) await expectObjetivosTactiles(bloque.getByRole("button", { name: /^Editar consumo de/ }), `${ancho} px: «Editar consumo»`);

    await doble.getByRole("button", { name: "Editar consumo de Doble" }).click();
    await doble.getByRole("button", { name: "+ Agregar línea de consumo" }).click();
    await doble.getByLabel("Insumo", { exact: true }).selectOption({ label: `Pollo ${m}` });
    await doble.getByLabel(/^Cantidad/).fill("0,25");
    await expectSinDesborde(page, `${ancho} px: el editor de consumo abierto`);
    expect((await new AxeBuilder({ page }).analyze()).violations, "editor de consumo abierto").toEqual([]);
    await doble.getByRole("button", { name: "Guardar el consumo" }).dblclick(); // clic doble: una sola versión

    await expect(bloque.locator('[data-consumo-de-opcion="Doble"]')).toContainText(`Descuenta 0,25 kg de Pollo ${m}`);
    const versiones = await prisma.versionDeOpcion.findMany({ where: { opcionId: grupo.opciones["Doble"]!.opcionId }, orderBy: { numero: "asc" }, include: { consumos: true } });
    expect(versiones.map((v) => v.numero), "el clic doble no duplicó la versión").toEqual([1, 2]);
    expect(versiones[1]!.consumos).toHaveLength(1);
    // Guardar un consumo no cambia lo que cobra ni el factor.
    expect([Number(versiones[0]!.diferenciaPrecio), Number(versiones[0]!.factorEscala)]).toEqual([Number(versiones[1]!.diferenciaPrecio), Number(versiones[1]!.factorEscala)]);
    expect(Number(versiones[1]!.diferenciaPrecio)).toBe(4000);
    expect(Number(versiones[1]!.factorEscala)).toBe(1.6);
    // La Biblioteca lee lo mismo (una sola fuente).
    await page.goto(`/catalogo/opciones/${grupo.grupoId}`);
    await expect(page.locator('[data-opcion="Doble"]')).toContainText(`Pollo ${m}`);
  });
}

test("un grupo que usan varios productos avisa ANTES de editar (con los nombres y el enlace a la Biblioteca)", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const grupoNombre = `E2E Guarniciones ${m}`;
  const grupo = await sembrarGrupo({ nombre: grupoNombre, tipo: "INCLUIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Papas fritas" }, { nombre: "Puré" }] });
  const nombres = [`E2E Bife ${m}`, `E2E Milanesa ${m}`, `E2E Pechuga ${m}`];
  let primero = "";
  for (const [i, nombre] of nombres.entries()) {
    const { productoId } = await sembrarProductoConOpciones({ nombre, codigo: `E2E-GU-${i}-${m}`, precioVenta: 10000, sucursalId, grupos: [{ grupo }] });
    if (i === 1) primero = productoId;
  }
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/catalogo/productos/${primero}/opciones`);
  const aviso = tarjeta(page, grupoNombre).locator("[data-grupo-compartido]");
  await expect(aviso).toContainText(`Este grupo lo usan 3 productos (${nombres.join(", ")}): cambiar el consumo de una opción los afecta a todos.`);
  await expect(aviso.getByRole("link", { name: "Biblioteca de opciones" })).toHaveAttribute("href", `/catalogo/opciones/${grupo.grupoId}`);
  await expectSinDesborde(page, "375 px: el aviso del grupo compartido");
});
