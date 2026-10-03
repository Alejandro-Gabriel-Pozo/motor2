import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { impresiones, interceptarImpresion } from "./fixtures/impresion";

/**
 * Lista «Por agregar» del POS (docs/plan-pos-agregar-varios-2026-09-26.md): sumar productos de secciones distintas y del buscador
 * SIN perderlos entre sí, confirmar todos juntos en un solo `agregarItems` (un solo KOT al enviar a cocina), el caso todo-o-nada
 * cuando un producto deja de estar disponible justo al confirmar, y accesibilidad de la lista con productos y con un error.
 *
 * `pos-carta-secciones.spec.ts` ya cubre el detalle de la navegación por sección/agrupado/carpeta y el buscador; acá solo lo
 * propio de esta pantalla: la CONFIRMACIÓN ÚNICA de varias líneas.
 */

async function sembrarCatalogo(sucursalId: string) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const crear = async (clave: string, nombre: string, precioVenta: number) => {
    const p = await prisma.producto.create({ data: { codigo: `E2E-AV-${clave}-${marca}`, nombre: `E2E ${nombre} ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta } });
    const disponibilidad = await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible: true } });
    return { producto: p, disponibilidadId: disponibilidad.id };
  };
  const { producto: milanesa } = await crear("MILA", "Milanesa", 9000);
  const { producto: coca, disponibilidadId: dispCocaId } = await crear("COCA", "Coca 500cc", 5000);
  const { producto: flan } = await crear("FLAN", "Flan sin carta", 3000);
  const productoIds = [milanesa.id, coca.id, flan.id];

  const platos = await prisma.seccionCarta.create({ data: { nombre: `E2E Platos AV ${marca}`, orden: 1 } });
  const bebidas = await prisma.seccionCarta.create({ data: { nombre: `E2E Bebidas AV ${marca}`, orden: 2 } });
  await prisma.contenidoCartaProducto.createMany({
    data: [
      { sucursalId, productoId: milanesa.id, visibleEnCarta: true, seccionCartaId: platos.id, orden: 1 },
      { sucursalId, productoId: coca.id, visibleEnCarta: true, seccionCartaId: bebidas.id, orden: 1 },
    ],
  });

  return {
    milanesa,
    coca,
    flan,
    dispCocaId,
    platos,
    bebidas,
    limpiar: async (mesaIds: string[]) => {
      await prisma.cuentaItem.deleteMany({ where: { cuenta: { mesaId: { in: mesaIds } } } });
      await prisma.cuenta.deleteMany({ where: { mesaId: { in: mesaIds } } });
      await prisma.mesa.deleteMany({ where: { id: { in: mesaIds } } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: { in: productoIds } } });
      await prisma.seccionCarta.deleteMany({ where: { id: { in: [platos.id, bebidas.id] } } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: productoIds } } });
      await prisma.producto.deleteMany({ where: { id: { in: productoIds } } });
    },
  };
}

async function mesaConCuenta(sucursalId: string, numero: number) {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero } });
  const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: admin.id } });
  return { mesa, cuenta };
}

const aviso = (page: Page) => page.locator('[role="status"][aria-live="polite"]');
const barra = (page: Page) => page.getByRole("group", { name: "Secciones de la carta" });
const lineaPorAgregar = (page: Page, nombre: string) => page.locator(`[data-linea-por-agregar="${nombre}"]`);

test("una sola confirmación con productos de dos secciones distintas y del buscador: un solo KOT con las tres líneas", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarCatalogo(sucursalId);
  const { mesa } = await mesaConCuenta(sucursalId, 991);
  try {
    await interceptarImpresion(page);
    await page.goto(`/mesas/${mesa.id}`);

    // Milanesa (sección Platos).
    await barra(page).getByRole("button", { name: cat.platos.nombre }).click();
    await page.getByRole("region", { name: cat.platos.nombre }).getByRole("button", { name: cat.milanesa.nombre }).click();

    // Coca (sección Bebidas): cambiar de sección no pierde la Milanesa ya sumada.
    await barra(page).getByRole("button", { name: cat.bebidas.nombre }).click();
    await page.getByRole("region", { name: cat.bebidas.nombre }).getByRole("button", { name: cat.coca.nombre }).click();
    await page.getByLabel(`Cantidad de ${cat.coca.nombre}`, { exact: true }).fill("2");

    // Flan (fuera de carta) por el buscador.
    const combo = page.getByRole("combobox", { name: "Producto" });
    await combo.fill(cat.flan.nombre);
    await page.getByRole("option", { name: new RegExp(cat.flan.nombre) }).click();

    await expect(page.locator("[data-linea-por-agregar]")).toHaveCount(3);
    await expect(lineaPorAgregar(page, cat.milanesa.nombre)).toBeVisible();
    await expect(lineaPorAgregar(page, cat.coca.nombre)).toBeVisible();
    await expect(lineaPorAgregar(page, cat.flan.nombre)).toBeVisible();

    // Una sola confirmación: un solo `agregarItems` con las tres líneas.
    await page.getByRole("button", { name: "Agregar 3 al pedido", exact: true }).click();
    await expect(aviso(page)).toHaveText("Se agregaron 3 ítems a la mesa 991.");
    await expect(page.locator("[data-linea-por-agregar]")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Sin enviar · 3" })).toBeVisible();

    // Enviar a cocina: un solo KOT con las tres, aunque vinieran de caminos distintos.
    await page.getByRole("button", { name: "Enviar a cocina" }).click();
    await expect(aviso(page)).toHaveText("Envío 1 a cocina: 3 ítems de la mesa 991.");
    await expect.poll(async () => (await impresiones(page)).map((i) => i.tipo)).toEqual(["comanda"]);
    const [comanda] = await impresiones(page);
    for (const texto of [`1 × ${cat.milanesa.nombre}`, `2 × ${cat.coca.nombre}`, `1 × ${cat.flan.nombre}`]) expect(comanda.texto).toContain(texto);
  } finally {
    await cat.limpiar([mesa.id]);
  }
});

test("disponibilidad perdida justo al confirmar: todo o nada, la lista del cliente queda intacta con el error a la vista", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarCatalogo(sucursalId);
  const { mesa, cuenta } = await mesaConCuenta(sucursalId, 992);
  try {
    await page.goto(`/mesas/${mesa.id}`);
    await barra(page).getByRole("button", { name: cat.platos.nombre }).click();
    await page.getByRole("region", { name: cat.platos.nombre }).getByRole("button", { name: cat.milanesa.nombre }).click();
    await barra(page).getByRole("button", { name: cat.bebidas.nombre }).click();
    await page.getByRole("region", { name: cat.bebidas.nombre }).getByRole("button", { name: cat.coca.nombre }).click();
    await expect(page.locator("[data-linea-por-agregar]")).toHaveCount(2);

    // Justo antes de confirmar, la Coca deja de estar disponible (otro admin la apagó desde Catálogo).
    await prisma.disponibilidadProducto.update({ where: { id: cat.dispCocaId }, data: { disponible: false } });

    const formulario = page.getByRole("form", { name: "Agregar producto" });
    await page.getByRole("button", { name: "Agregar 2 al pedido", exact: true }).click();
    await expect(formulario.getByRole("alert")).toContainText(`«${cat.coca.nombre}» no está disponible`);

    // Todo o nada: no se guardó ni la Milanesa, que sí seguía disponible.
    expect(await prisma.cuentaItem.count({ where: { cuentaId: cuenta.id } })).toBe(0);
    // La lista del cliente queda INTACTA: no hay que volver a elegir todo de nuevo.
    await expect(lineaPorAgregar(page, cat.milanesa.nombre)).toBeVisible();
    await expect(lineaPorAgregar(page, cat.coca.nombre)).toBeVisible();
    await expect(page.getByRole("button", { name: "Agregar 2 al pedido", exact: true })).toBeVisible();
  } finally {
    await cat.limpiar([mesa.id]);
  }
});

test("accesibilidad: la lista «Por agregar» con un producto, y con un error de cantidad, sin violaciones", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarCatalogo(sucursalId);
  const { mesa } = await mesaConCuenta(sucursalId, 993);
  try {
    await page.goto(`/mesas/${mesa.id}`);
    await barra(page).getByRole("button", { name: cat.platos.nombre }).click();
    await page.getByRole("region", { name: cat.platos.nombre }).getByRole("button", { name: cat.milanesa.nombre }).click();
    await expect(lineaPorAgregar(page, cat.milanesa.nombre)).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations, "lista «Por agregar» con un producto").toEqual([]);

    // Una cantidad inválida (vacía) deja el mensaje de error a la vista al salir del campo.
    const campoCantidad = page.getByLabel(`Cantidad de ${cat.milanesa.nombre}`, { exact: true });
    await campoCantidad.fill("");
    await campoCantidad.blur();
    await expect(page.getByRole("form", { name: "Agregar producto" }).getByRole("alert")).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations, "lista «Por agregar» con un error de cantidad").toEqual([]);
  } finally {
    await cat.limpiar([mesa.id]);
  }
});
