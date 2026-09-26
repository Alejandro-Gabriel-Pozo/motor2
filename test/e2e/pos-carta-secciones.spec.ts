import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { abrirComoRol } from "./fixtures/rol-pos";

/**
 * «Agregar al pedido» por SECCIÓN DE CARTA en la pantalla de la mesa (docs/plan-selector-carta-pos-2026-09-25.md): la barra de
 * secciones de la carta (más «Fuera de carta» al final), la grilla de la sección a la vista, el despliegue de un ítem agrupado con
 * sus opciones y el camino de siempre (elegir → cantidad → «Agregar»). El buscador por texto sigue andando y comparte lo elegido.
 *
 * Siembra en «Central» dos secciones de carta («E2E Platos», «E2E Bebidas»), sueltos en cada una, el agrupado «E2E Gaseosa 500cc»
 * (Coca y Sprite a $5.000; Fanta NO disponible en Central) y un PV sin carta. `pos-tomar-pedido.spec.ts` no siembra carta y por
 * eso no ve este navegador (DP3). Cada caso limpia lo suyo en `finally`, en el orden que exigen las claves foráneas (RESTRICT):
 * ítems → cuentas → mesas → opciones → agrupado → contenidos → secciones → disponibilidad → productos.
 */

async function sembrarCarta(sucursalId: string) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const unidad = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "unidad" } });
  const crear = async (clave: string, nombre: string, precioVenta: number, disponible = true) => {
    const p = await prisma.producto.create({ data: { codigo: `E2E-CS-${clave}-${marca}`, nombre: `E2E ${nombre} ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta } });
    if (disponible) await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible: true } });
    return p;
  };
  const bife = await crear("BIFE", "Bife de chorizo", 34000);
  const milanesa = await crear("MILA", "Milanesa", 9000);
  const agua = await crear("AGUA", "Agua mineral", 2000);
  const coca = await crear("COCA", "Coca 500cc", 5000);
  const sprite = await crear("SPRITE", "Sprite 500cc", 5000);
  const fanta = await crear("FANTA", "Fanta 500cc", 5000, false);
  const sinCarta = await crear("FLAN", "Flan sin carta", 3000);
  const productoIds = [bife, milanesa, agua, coca, sprite, fanta, sinCarta].map((p) => p.id);

  const platos = await prisma.seccionCarta.create({ data: { nombre: `E2E Platos ${marca}`, orden: 1 } });
  const bebidas = await prisma.seccionCarta.create({ data: { nombre: `E2E Bebidas ${marca}`, orden: 2 } });
  await prisma.contenidoCartaProducto.createMany({
    data: [
      { productoId: bife.id, visibleEnCarta: true, seccionCartaId: platos.id, orden: 1 },
      { productoId: milanesa.id, visibleEnCarta: true, seccionCartaId: platos.id, orden: 2 },
      { productoId: agua.id, visibleEnCarta: true, seccionCartaId: bebidas.id, orden: 1 },
    ],
  });
  const gaseosa = await prisma.itemAgrupadoCarta.create({ data: { nombre: `E2E Gaseosa 500cc ${marca}`, seccionCartaId: bebidas.id, orden: 2 } });
  await prisma.opcionItemAgrupadoCarta.createMany({ data: [coca, sprite, fanta].map((p, orden) => ({ itemAgrupadoCartaId: gaseosa.id, productoId: p.id, orden })) });

  return {
    bife,
    milanesa,
    agua,
    coca,
    sprite,
    fanta,
    sinCarta,
    platos,
    bebidas,
    gaseosa,
    limpiar: async (mesaIds: string[]) => {
      await prisma.cuentaItem.deleteMany({ where: { cuenta: { mesaId: { in: mesaIds } } } });
      await prisma.cuenta.deleteMany({ where: { mesaId: { in: mesaIds } } });
      await prisma.mesa.deleteMany({ where: { id: { in: mesaIds } } });
      await prisma.opcionItemAgrupadoCarta.deleteMany({ where: { itemAgrupadoCartaId: gaseosa.id } });
      await prisma.itemAgrupadoCarta.deleteMany({ where: { id: gaseosa.id } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: { in: productoIds } } });
      await prisma.seccionCarta.deleteMany({ where: { id: { in: [platos.id, bebidas.id] } } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: productoIds } } });
      await prisma.producto.deleteMany({ where: { id: { in: productoIds } } });
    },
  };
}

const MONEDA = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const aviso = (page: Page) => page.locator('[role="status"][aria-live="polite"]');

/** «Abrir cuenta» pasando por el modal de comensales (docs/plan-comensales-y-limite-mesas-2026-09-26.md): botón rápido 1-6 + confirmar. */
async function abrirCuentaUI(page: Page, comensales: number) {
  await page.getByRole("button", { name: "Abrir cuenta" }).click();
  const dialogo = page.getByRole("dialog", { name: "¿Cuántos comensales?" });
  await dialogo.getByRole("button", { name: String(comensales), exact: true }).click();
  await dialogo.getByRole("button", { name: "Confirmar apertura" }).click();
}
const barra = (page: Page) => page.getByRole("group", { name: "Secciones de la carta" });
const elegido = (page: Page) => page.locator("[data-elegido]");

/** Una mesa con la cuenta abierta por el admin de las pruebas. */
async function mesaConCuenta(sucursalId: string, numero: number) {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero } });
  const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: admin.id } });
  return { mesa, cuenta };
}

test("la barra sigue el orden de la carta con «Fuera de carta» al final; un agrupado despliega sus opciones disponibles y se agrega la opción elegida", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarCarta(sucursalId);
  const { mesa, cuenta } = await mesaConCuenta(sucursalId, 981);
  try {
    await page.goto(`/mesas/${mesa.id}`);
    await expect(page.locator("main h1")).toHaveText("Mesa 981");

    // (1) Barra: las secciones en el orden de la carta y «Fuera de carta» al final. Arranca en la primera.
    const nombres = (await barra(page).getByRole("button").allTextContents()).map((t) => t.trim());
    expect(nombres.indexOf(cat.platos.nombre)).toBeGreaterThanOrEqual(0);
    expect(nombres.indexOf(cat.platos.nombre)).toBeLessThan(nombres.indexOf(cat.bebidas.nombre));
    expect(nombres.at(-1)).toBe("Fuera de carta");
    await expect(page.getByRole("region", { name: nombres[0] })).toBeVisible();

    // (2) Bebidas → el agrupado se despliega: Coca y Sprite con su precio, Fanta (no disponible en Central) no.
    await barra(page).getByRole("button", { name: cat.bebidas.nombre }).click();
    await expect(barra(page).getByRole("button", { name: cat.bebidas.nombre })).toHaveAttribute("aria-pressed", "true");
    const region = page.getByRole("region", { name: cat.bebidas.nombre });
    await expect(region.getByRole("button", { name: cat.agua.nombre })).toBeVisible();
    const grupo = region.getByRole("button", { name: cat.gaseosa.nombre });
    await expect(grupo).toHaveAttribute("aria-expanded", "false");
    await expect(grupo).toContainText(`2 opciones · ${MONEDA.format(5000)}`);
    await grupo.click();
    await expect(grupo).toHaveAttribute("aria-expanded", "true");
    const opciones = page.getByRole("list", { name: `Opciones de ${cat.gaseosa.nombre}` });
    await expect(opciones.getByRole("button")).toHaveCount(2);
    await expect(opciones.getByRole("button", { name: cat.coca.nombre })).toContainText(MONEDA.format(5000));
    await expect(opciones.getByRole("button", { name: cat.sprite.nombre })).toContainText(MONEDA.format(5000));
    await expect(page.getByRole("button", { name: cat.fanta.nombre })).toHaveCount(0);

    await opciones.getByRole("button", { name: cat.sprite.nombre }).click();
    await expect(opciones.getByRole("button", { name: cat.sprite.nombre })).toHaveAttribute("aria-pressed", "true");
    await expect(elegido(page)).toHaveText(`Elegido: ${cat.sprite.nombre} · ${MONEDA.format(5000)}`);
    await page.getByLabel("Cantidad", { exact: true }).fill("2");
    await page.getByRole("button", { name: "Agregar", exact: true }).click();
    await expect(aviso(page)).toHaveText("Se agregó 1 ítem a la mesa 981.");

    const items = await prisma.cuentaItem.findMany({ where: { cuentaId: cuenta.id } });
    expect(items.map((i) => [i.productoId, Number(i.cantidad), Number(i.precioUnitario)])).toEqual([[cat.sprite.id, 2, 5000]]);

    // Después de agregar: sigue en Bebidas, el agrupado cerrado y nada marcado.
    await expect(page.locator(`[data-item-sin-enviar="${cat.sprite.nombre}"]`)).toBeVisible();
    await expect(barra(page).getByRole("button", { name: cat.bebidas.nombre })).toHaveAttribute("aria-pressed", "true");
    await expect(region.getByRole("button", { name: cat.gaseosa.nombre })).toHaveAttribute("aria-expanded", "false");
    await expect(region.locator('button[aria-pressed="true"]')).toHaveCount(0);
    await expect(elegido(page)).not.toContainText("Elegido:");
    await expect(page.getByRole("button", { name: "Agregar", exact: true })).toBeDisabled();
  } finally {
    await cat.limpiar([mesa.id]);
  }
});

test("tocar un producto de la carta no envía el formulario: todos los botones del selector son type=button", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarCarta(sucursalId);
  const { mesa, cuenta } = await mesaConCuenta(sucursalId, 982);
  try {
    await page.goto(`/mesas/${mesa.id}`);
    await barra(page).getByRole("button", { name: cat.platos.nombre }).click();
    const region = page.getByRole("region", { name: cat.platos.nombre });
    await region.getByRole("button", { name: cat.bife.nombre }).click();
    await expect(region.getByRole("button", { name: cat.bife.nombre })).toHaveAttribute("aria-pressed", "true");
    await barra(page).getByRole("button", { name: cat.bebidas.nombre }).click();
    await page.getByRole("region", { name: cat.bebidas.nombre }).getByRole("button", { name: cat.gaseosa.nombre }).click();

    const selector = page.locator("form[aria-label='Agregar producto'] [data-elegido] ~ div");
    await expect(selector.locator("button")).not.toHaveCount(0);
    await expect(selector.locator('button:not([type="button"])')).toHaveCount(0);
    // Nada se agregó ni se avisó: el formulario no se envió.
    await expect(aviso(page)).toBeEmpty();
    expect(await prisma.cuentaItem.count({ where: { cuentaId: cuenta.id } })).toBe(0);
    await expect(elegido(page)).toHaveText(`Elegido: ${cat.bife.nombre} · ${MONEDA.format(34000)}`);
  } finally {
    await cat.limpiar([mesa.id]);
  }
});

test("el buscador por texto sigue andando y marca el botón de la carta; elegir en la carta vacía el buscador; tipear limpia lo elegido", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarCarta(sucursalId);
  const { mesa, cuenta } = await mesaConCuenta(sucursalId, 983);
  try {
    await page.goto(`/mesas/${mesa.id}`);
    await barra(page).getByRole("button", { name: cat.platos.nombre }).click();
    const region = page.getByRole("region", { name: cat.platos.nombre });
    const combo = page.getByRole("combobox", { name: "Producto" });

    await combo.fill(cat.milanesa.nombre);
    await page.getByRole("option", { name: new RegExp(cat.milanesa.nombre) }).click();
    await expect(region.getByRole("button", { name: cat.milanesa.nombre })).toHaveAttribute("aria-pressed", "true");
    await expect(elegido(page)).toHaveText(`Elegido: ${cat.milanesa.nombre} · ${MONEDA.format(9000)}`);

    await region.getByRole("button", { name: cat.bife.nombre }).click();
    await expect(combo).toHaveValue("");
    await expect(region.getByRole("button", { name: cat.bife.nombre })).toHaveAttribute("aria-pressed", "true");
    await expect(region.getByRole("button", { name: cat.milanesa.nombre })).toHaveAttribute("aria-pressed", "false");

    await combo.fill("E2E");
    await expect(region.locator('button[aria-pressed="true"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Agregar", exact: true })).toBeDisabled();

    // Y por el buscador se sigue agregando como siempre.
    await combo.fill(cat.milanesa.nombre);
    await page.getByRole("option", { name: new RegExp(cat.milanesa.nombre) }).click();
    await page.getByRole("button", { name: "Agregar", exact: true }).click();
    await expect(aviso(page)).toHaveText("Se agregó 1 ítem a la mesa 983.");
    expect((await prisma.cuentaItem.findMany({ where: { cuentaId: cuenta.id } })).map((i) => [i.productoId, Number(i.precioUnitario)])).toEqual([[cat.milanesa.id, 9000]]);
  } finally {
    await cat.limpiar([mesa.id]);
  }
});

test("un PV sin carta está en «Fuera de carta» y se puede agregar", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarCarta(sucursalId);
  const { mesa, cuenta } = await mesaConCuenta(sucursalId, 984);
  try {
    await page.goto(`/mesas/${mesa.id}`);
    // No está en ninguna sección de carta.
    for (const seccion of [cat.platos.nombre, cat.bebidas.nombre]) {
      await barra(page).getByRole("button", { name: seccion }).click();
      await expect(page.getByRole("region", { name: seccion }).getByRole("button", { name: cat.sinCarta.nombre })).toHaveCount(0);
    }
    await barra(page).getByRole("button", { name: "Fuera de carta" }).click();
    const region = page.getByRole("region", { name: "Fuera de carta" });
    await region.getByRole("button", { name: cat.sinCarta.nombre }).click();
    await expect(elegido(page)).toHaveText(`Elegido: ${cat.sinCarta.nombre} · ${MONEDA.format(3000)}`);
    await page.getByRole("button", { name: "Agregar", exact: true }).click();
    await expect(aviso(page)).toHaveText("Se agregó 1 ítem a la mesa 984.");
    expect((await prisma.cuentaItem.findMany({ where: { cuentaId: cuenta.id } })).map((i) => [i.productoId, Number(i.cantidad), Number(i.precioUnitario)])).toEqual([[cat.sinCarta.id, 1, 3000]]);
    await expect(barra(page).getByRole("button", { name: "Fuera de carta" })).toHaveAttribute("aria-pressed", "true");
  } finally {
    await cat.limpiar([mesa.id]);
  }
});

test("el mozo (sin permiso de carta) elige por sección de carta y agrega", async ({ browser, baseURL, sucursalId }) => {
  const cat = await sembrarCarta(sucursalId);
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 985 } });
  const mozo = await abrirComoRol(browser, baseURL, sucursalId, { pos_mesas: "ver", pos_tomar_pedido: "editar" });
  try {
    const m = mozo.page;
    await m.goto(`/mesas/${mesa.id}`);
    await abrirCuentaUI(m, 2);
    await expect(aviso(m)).toHaveText("Cuenta de la mesa 985 abierta.");
    await barra(m).getByRole("button", { name: cat.bebidas.nombre }).click();
    await m.getByRole("region", { name: cat.bebidas.nombre }).getByRole("button", { name: cat.gaseosa.nombre }).click();
    await m.getByRole("list", { name: `Opciones de ${cat.gaseosa.nombre}` }).getByRole("button", { name: cat.coca.nombre }).click();
    await m.getByRole("button", { name: "Agregar", exact: true }).click();
    await expect(aviso(m)).toHaveText("Se agregó 1 ítem a la mesa 985.");
    const items = await prisma.cuentaItem.findMany({ where: { cuenta: { mesaId: mesa.id } } });
    expect(items.map((i) => [i.productoId, i.creadoPorId])).toEqual([[cat.coca.id, mozo.usuario.id]]);
  } finally {
    // Las cuentas del mozo lo referencian (abiertaPor/creadoPor): se borran antes que el usuario.
    await cat.limpiar([mesa.id]);
    await mozo.limpiar();
  }
});

test("a 1024px y a 390px, con un agrupado desplegado, no hay scroll horizontal", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarCarta(sucursalId);
  const { mesa } = await mesaConCuenta(sucursalId, 986);
  try {
    for (const ancho of [1024, 390]) {
      await page.setViewportSize({ width: ancho, height: 800 });
      await page.goto(`/mesas/${mesa.id}`);
      await barra(page).getByRole("button", { name: cat.bebidas.nombre }).click();
      await page.getByRole("region", { name: cat.bebidas.nombre }).getByRole("button", { name: cat.gaseosa.nombre }).click();
      await expect(page.getByRole("list", { name: `Opciones de ${cat.gaseosa.nombre}` })).toBeVisible();
      const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(desborde, `a ${ancho}px`).toBeLessThanOrEqual(0);
    }
  } finally {
    await cat.limpiar([mesa.id]);
  }
});

/**
 * Carpeta de GÉNERO (docs/plan-genero-carta-2026-09-26.md): en «E2E Bebidas Género» siembra un género («E2E Cerveza») con un
 * suelto (IPA) y un ítem agrupado («E2E Cerveza Artesanal»: Stout y Rubia) adentro, más un suelto SIN género (Agua con gas) en
 * la misma sección, y una segunda sección («E2E Postres Género») con un suelto para probar que cambiar de sección cierra la
 * carpeta.
 */
async function sembrarCartaConGenero(sucursalId: string) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const unidad = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "unidad" } });
  const crear = async (clave: string, nombre: string, precioVenta: number) => {
    const p = await prisma.producto.create({ data: { codigo: `E2E-GEN-${clave}-${marca}`, nombre: `E2E ${nombre} ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible: true } });
    return p;
  };
  const ipa = await crear("IPA", "Cerveza IPA", 6000);
  const stout = await crear("STOUT", "Cerveza Stout", 6500);
  const rubia = await crear("RUBIA", "Cerveza Rubia", 6500);
  const agua = await crear("AGUA2", "Agua con gas", 2000);
  const flan = await crear("FLAN2", "Flan casero", 3000);
  const productoIds = [ipa, stout, rubia, agua, flan].map((p) => p.id);

  const bebidas = await prisma.seccionCarta.create({ data: { nombre: `E2E Bebidas Género ${marca}`, orden: 1 } });
  const postres = await prisma.seccionCarta.create({ data: { nombre: `E2E Postres Género ${marca}`, orden: 2 } });
  const genero = await prisma.generoCarta.create({ data: { nombre: `E2E Cerveza ${marca}`, orden: 0 } });
  await prisma.contenidoCartaProducto.createMany({
    data: [
      { productoId: ipa.id, visibleEnCarta: true, seccionCartaId: bebidas.id, orden: 1, generoCartaId: genero.id },
      { productoId: agua.id, visibleEnCarta: true, seccionCartaId: bebidas.id, orden: 2 },
      { productoId: flan.id, visibleEnCarta: true, seccionCartaId: postres.id, orden: 1 },
    ],
  });
  const artesanal = await prisma.itemAgrupadoCarta.create({ data: { nombre: `E2E Cerveza Artesanal ${marca}`, seccionCartaId: bebidas.id, orden: 0, generoCartaId: genero.id } });
  await prisma.opcionItemAgrupadoCarta.createMany({ data: [stout, rubia].map((p, orden) => ({ itemAgrupadoCartaId: artesanal.id, productoId: p.id, orden })) });

  return {
    ipa,
    stout,
    rubia,
    agua,
    flan,
    bebidas,
    postres,
    genero,
    artesanal,
    limpiar: async (mesaIds: string[]) => {
      await prisma.cuentaItem.deleteMany({ where: { cuenta: { mesaId: { in: mesaIds } } } });
      await prisma.cuenta.deleteMany({ where: { mesaId: { in: mesaIds } } });
      await prisma.mesa.deleteMany({ where: { id: { in: mesaIds } } });
      await prisma.opcionItemAgrupadoCarta.deleteMany({ where: { itemAgrupadoCartaId: artesanal.id } });
      await prisma.itemAgrupadoCarta.deleteMany({ where: { id: artesanal.id } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: { in: productoIds } } });
      await prisma.seccionCarta.deleteMany({ where: { id: { in: [bebidas.id, postres.id] } } });
      await prisma.generoCarta.deleteMany({ where: { id: genero.id } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: productoIds } } });
      await prisma.producto.deleteMany({ where: { id: { in: productoIds } } });
    },
  };
}

test("la carpeta de género se ve, se abre y muestra sueltos y agrupados; elegir un producto de adentro lo agrega y la carpeta queda abierta; cambiar de sección la cierra", async ({
  paginaAutenticada: page,
  sucursalId,
}) => {
  const cat = await sembrarCartaConGenero(sucursalId);
  const { mesa, cuenta } = await mesaConCuenta(sucursalId, 987);
  try {
    await page.goto(`/mesas/${mesa.id}`);
    await barra(page).getByRole("button", { name: cat.bebidas.nombre }).click();
    const region = page.getByRole("region", { name: cat.bebidas.nombre });

    // La carpeta se ve, cerrada, y el suelto sin género (Agua con gas) está a la vista sin abrir nada.
    const carpeta = region.getByRole("button", { name: cat.genero.nombre });
    await expect(carpeta).toBeVisible();
    await expect(carpeta).toHaveAttribute("aria-expanded", "false");
    await expect(region.getByRole("button", { name: cat.agua.nombre })).toBeVisible();
    await expect(region.getByRole("button", { name: cat.ipa.nombre })).toHaveCount(0);

    // Se abre y muestra tanto el suelto (IPA) como el agrupado (Stout y Rubia), sin un clic adicional para el agrupado.
    await carpeta.click();
    await expect(carpeta).toHaveAttribute("aria-expanded", "true");
    const contenido = page.getByRole("list", { name: `Productos de ${cat.genero.nombre}` });
    await expect(contenido.getByRole("button", { name: cat.ipa.nombre })).toBeVisible();
    await expect(contenido.getByRole("button", { name: cat.stout.nombre })).toBeVisible();
    await expect(contenido.getByRole("button", { name: cat.rubia.nombre })).toBeVisible();

    // Elegir un producto de adentro (Stout) lo agrega con su propio productoId.
    await contenido.getByRole("button", { name: cat.stout.nombre }).click();
    await expect(elegido(page)).toHaveText(`Elegido: ${cat.stout.nombre} · ${MONEDA.format(6500)}`);
    await page.getByRole("button", { name: "Agregar", exact: true }).click();
    await expect(aviso(page)).toHaveText("Se agregó 1 ítem a la mesa 987.");
    const items = await prisma.cuentaItem.findMany({ where: { cuentaId: cuenta.id } });
    expect(items.map((i) => [i.productoId, Number(i.precioUnitario)])).toEqual([[cat.stout.id, 6500]]);

    // G3: la carpeta queda ABIERTA después de agregar (para pedir varias de adentro sin reabrir).
    await expect(carpeta).toHaveAttribute("aria-expanded", "true");
    await expect(contenido.getByRole("button", { name: cat.ipa.nombre })).toBeVisible();

    // Cambiar de sección la cierra.
    await barra(page).getByRole("button", { name: cat.postres.nombre }).click();
    await barra(page).getByRole("button", { name: cat.bebidas.nombre }).click();
    await expect(region.getByRole("button", { name: cat.genero.nombre })).toHaveAttribute("aria-expanded", "false");
  } finally {
    await cat.limpiar([mesa.id]);
  }
});

test("accesibilidad: con la carpeta de género abierta, sin violaciones", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarCartaConGenero(sucursalId);
  const { mesa } = await mesaConCuenta(sucursalId, 988);
  try {
    await page.goto(`/mesas/${mesa.id}`);
    await barra(page).getByRole("button", { name: cat.bebidas.nombre }).click();
    await page.getByRole("region", { name: cat.bebidas.nombre }).getByRole("button", { name: cat.genero.nombre }).click();
    await expect(page.getByRole("list", { name: `Productos de ${cat.genero.nombre}` })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations, "mesa con la carpeta de género abierta").toEqual([]);
  } finally {
    await cat.limpiar([mesa.id]);
  }
});
