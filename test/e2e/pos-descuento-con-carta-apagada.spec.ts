import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { prismaAdmin } from "../setup/cliente-duenio";
import { fijarModulosActivos } from "../setup/modulos";
import { activarEmpresaB, crearSesion, paginaConSesion, suspenderEmpresaB, type EmpresasDeLaPrueba } from "./fixtures/multiempresa";

/**
 * P18 / D18 (decisión del dueño, 2026-10-11): con el módulo Carta APAGADO no rige el descuento de producto en el salón (igual que las promociones). El selector ofrece el
 * precio de lista, sin precio tachado, y lo que se agrega a la cuenta se congela a ese mismo precio (lo que se ve es lo que se cobra). Con Carta prendida, el mismo producto
 * se ofrece descontado con la lista tachada: es el control de que el descuento está cargado y rige.
 *
 * Aislado en la empresa B (`activarEmpresaB`, como `modulos-registro.spec.ts`) para no tocar el registro de módulos de la empresa `e2e` del resto de la suite; se suspende al
 * terminar. Se siembra como dueño (`prismaAdmin`, con `empresaId` explícito: con dos empresas activas no hay empresa por defecto). La capacidad `precio_local` no tiene filas, así
 * que está prendida (sin fila = habilitado) y el descuento rige salvo por el módulo.
 */
test.describe.configure({ mode: "serial" });

const aviso = (page: Page) => page.locator('[role="status"][aria-live="polite"]');

let e: EmpresasDeLaPrueba;
let sesion: string;
let producto: { id: string; nombre: string };
const mesaIds: string[] = [];

/** Una mesa de la sucursal de B con la cuenta abierta por su gerente. */
async function mesaConCuenta(numero: number) {
  const mesa = await prismaAdmin.mesa.create({ data: { empresaId: e.b.empresaId, sucursalId: e.b.sucursalId, numero } });
  mesaIds.push(mesa.id);
  await prismaAdmin.cuenta.create({ data: { empresaId: e.b.empresaId, mesaId: mesa.id, abiertaPorId: e.b.adminUsuarioId } });
  return mesa;
}

test.beforeAll(async () => {
  e = await activarEmpresaB();
  sesion = await crearSesion(e.b.adminUsuarioId);
  const unidad = await prismaAdmin.unidad.findFirstOrThrow({ where: { empresaId: e.b.empresaId, nombre: "unidad" } });
  const nombre = `E2E Flan descuento ${e.marca}`;
  const creado = await prismaAdmin.producto.create({
    data: { empresaId: e.b.empresaId, codigo: `E2E-D18-${e.marca}`, nombre, tipo: "PV", unidadStockId: unidad.id, precioVenta: 3000 },
  });
  producto = { id: creado.id, nombre };
  await prismaAdmin.disponibilidadProducto.create({ data: { empresaId: e.b.empresaId, sucursalId: e.b.sucursalId, productoId: creado.id, disponible: true } });
  await prismaAdmin.descuentoProductoSucursal.create({ data: { empresaId: e.b.empresaId, productoId: creado.id, sucursalId: e.b.sucursalId, porcentaje: 15 } });
});

test.afterAll(async () => {
  try {
    await prismaAdmin.cuentaItem.deleteMany({ where: { cuenta: { mesaId: { in: mesaIds } } } });
    // P3: el comprobante de «Agregar al pedido» referencia la cuenta (RESTRICT): se borra antes.
    await prismaAdmin.agregadoDeCuenta.deleteMany({ where: { cuenta: { mesaId: { in: mesaIds } } } });
    await prismaAdmin.cuenta.deleteMany({ where: { mesaId: { in: mesaIds } } });
    await prismaAdmin.mesa.deleteMany({ where: { id: { in: mesaIds } } });
    await prismaAdmin.descuentoProductoSucursal.deleteMany({ where: { productoId: producto?.id } });
    await prismaAdmin.disponibilidadProducto.deleteMany({ where: { productoId: producto?.id } });
    await prismaAdmin.producto.deleteMany({ where: { id: producto?.id } });
  } finally {
    await suspenderEmpresaB(e.b.empresaId);
  }
});

test("CONTROL, con Carta prendida: el selector ofrece el precio descontado con la lista tachada y la cuenta congela el descontado", async ({ browser, baseURL }) => {
  await fijarModulosActivos(e.b.empresaId, ["salon", "carta"]);
  // Con Carta prendida la grilla de botones solo se dibuja si la carta tiene una sección con productos (`hayCarta`): el producto va en una.
  const seccionCarta = await prismaAdmin.seccionCarta.create({ data: { empresaId: e.b.empresaId, nombre: `E2E Postres D18 ${e.marca}`, orden: 1 } });
  await prismaAdmin.contenidoCartaProducto.create({ data: { empresaId: e.b.empresaId, sucursalId: e.b.sucursalId, productoId: producto.id, visibleEnCarta: true, seccionCartaId: seccionCarta.id, orden: 1 } });
  const mesa = await mesaConCuenta(971);
  const page = await paginaConSesion(browser, baseURL, sesion);
  try {
    await page.goto(`/mesas/${mesa.id}`);
    await expect(page.locator("main h1")).toHaveText("Mesa 971");
    const boton = page.locator(`[data-producto-carta="${producto.id}"]`);
    await expect(boton).toContainText(/\$\s?2\.550/);
    await expect(boton.locator("[data-precio-lista]")).toContainText(/\$\s?3\.000/);

    await boton.click();
    await page.getByRole("button", { name: "Agregar 1 al pedido", exact: true }).click();
    await expect(aviso(page)).toHaveText("Se agregó 1 ítem a la mesa 971.");
    await expect(page.locator("[data-total-cuenta]")).toContainText(/2\.550/);
    const [item] = await prismaAdmin.cuentaItem.findMany({ where: { cuenta: { mesaId: mesa.id } } });
    expect(Number(item.precioUnitario)).toBe(2550);
    expect(Number(item.precioCartaUnitario)).toBe(3000);
  } finally {
    await page.context().close();
    await prismaAdmin.contenidoCartaProducto.deleteMany({ where: { productoId: producto.id } });
    await prismaAdmin.seccionCarta.deleteMany({ where: { id: seccionCarta.id } });
  }
});

test("con Carta APAGADA: el selector ofrece el precio de lista sin tachado, la cuenta congela ese mismo precio y no guarda precio de lista", async ({ browser, baseURL }) => {
  await fijarModulosActivos(e.b.empresaId, ["salon"]);
  const mesa = await mesaConCuenta(972);
  const page = await paginaConSesion(browser, baseURL, sesion);
  try {
    await page.goto(`/mesas/${mesa.id}`);
    await expect(page.locator("main h1")).toHaveText("Mesa 972");
    // Sin Carta no se lee ninguna sección: la grilla de botones no se dibuja y el producto se agrega con el buscador (el precio de la línea es el que se congela).
    await expect(page.locator(`[data-producto-carta="${producto.id}"]`)).toHaveCount(0);
    await page.getByRole("combobox", { name: "Producto" }).fill(producto.nombre);
    await page.getByRole("option", { name: new RegExp(producto.nombre) }).click();
    await expect(page.locator(`[data-linea-por-agregar="${producto.nombre}"]`)).toBeVisible();
    await page.getByRole("button", { name: "Agregar 1 al pedido", exact: true }).click();
    await expect(aviso(page)).toHaveText("Se agregó 1 ítem a la mesa 972.");

    // El detalle muestra el precio de lista (sin tachado) y el total de la cuenta es el de lista.
    const fila = page.locator(`[data-item-sin-enviar="${producto.nombre}"]`);
    await expect(fila).toBeVisible();
    await expect(fila).toContainText(/\$\s?3\.000/);
    await expect(fila.locator("[data-precio-lista]")).toHaveCount(0);
    await expect(page.locator("[data-total-cuenta]")).toContainText(/3\.000/);
    await expect(page.locator("[data-total-cuenta]")).not.toContainText(/2\.550/);

    // Lo que se cobra: el precio de lista congelado, sin precio de lista aparte (no hay descuento de producto que lo explique).
    const [item] = await prismaAdmin.cuentaItem.findMany({ where: { cuenta: { mesaId: mesa.id } } });
    expect(Number(item.precioUnitario)).toBe(3000);
    expect(item.precioCartaUnitario).toBeNull();

    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations).toEqual([]);
  } finally {
    await page.context().close();
  }
});
