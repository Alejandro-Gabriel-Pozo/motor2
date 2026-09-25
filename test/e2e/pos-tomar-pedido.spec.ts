import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { abrirComoRol } from "./fixtures/rol-pos";
import { impresiones, interceptarImpresion } from "./fixtures/impresion";

/**
 * Tomar pedido en el salón (docs/plan-tomar-pedido-2026-09-25.md): la pantalla de la mesa (/mesas/<id>) con el circuito completo —
 * abrir la cuenta, agregar, quitar, enviar a cocina, anular con motivo y cerrar la cuenta (venta) —, el cierre con stock insuficiente
 * (B6bis: se cierra igual, con aviso y auditoría), los permisos por rol y el acceso sin sesión.
 *
 * Siembra en «Central» dos PV sin receta y un PV con receta de una MP SIN stock (para ejercitar B6bis de verdad), todos disponibles
 * en la sucursal. Cada caso limpia lo suyo en `finally`, en el orden que exigen las claves foráneas: filas espejo → ítems →
 * movimientos/operaciones (y su auditoría) → ejemplares de la boleta (correcciones primero) → cuentas → mesas → productos.
 */

const SECCION = "Depósito E2E";

async function sembrarCatalogo(sucursalId: string) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const [unidad, kg] = await Promise.all([prisma.unidad.findUniqueOrThrow({ where: { nombre: "unidad" } }), prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } })]);
  const crear = async (data: Parameters<typeof prisma.producto.create>[0]["data"]) => {
    const p = await prisma.producto.create({ data });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible: true } });
    return p;
  };
  const milanesa = await crear({ codigo: `E2E-TP-MILA-${marca}`, nombre: `E2E Milanesa ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 9000 });
  const flan = await crear({ codigo: `E2E-TP-FLAN-${marca}`, nombre: `E2E Flan ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 3000 });
  const muzzarella = await crear({ codigo: `E2E-TP-MUZZA-${marca}`, nombre: `E2E Muzzarella ${marca}`, tipo: "MP", unidadStockId: kg.id });
  const pizza = await crear({ codigo: `E2E-TP-PIZZA-${marca}`, nombre: `E2E Pizza ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 12000 });
  await prisma.recetaVersion.create({ data: { productoId: pizza.id, version: 1, ingredientes: { create: [{ insumoProductoId: muzzarella.id, cantidad: 0.25, unidadId: kg.id }] } } });
  const productoIds = [milanesa.id, flan.id, muzzarella.id, pizza.id];

  return {
    milanesa,
    flan,
    muzzarella,
    pizza,
    /** Borra todo lo que tocó cualquier cuenta de estas mesas, y después las mesas y el catálogo sembrado. */
    limpiar: async (mesaIds: string[]) => {
      const items = await prisma.cuentaItem.findMany({ where: { cuenta: { mesaId: { in: mesaIds } } }, select: { operacionId: true } });
      const operacionIds = [...new Set(items.flatMap((i) => (i.operacionId ? [i.operacionId] : [])))];
      await prisma.cuentaItem.deleteMany({ where: { cuenta: { mesaId: { in: mesaIds } }, anulaAItemId: { not: null } } });
      await prisma.cuentaItem.deleteMany({ where: { cuenta: { mesaId: { in: mesaIds } } } });
      await prisma.registroAuditoria.deleteMany({ where: { entidadId: { in: operacionIds } } });
      await prisma.movimientoStock.deleteMany({ where: { OR: [{ operacionId: { in: operacionIds } }, { productoId: { in: productoIds } }] } });
      await prisma.operacion.deleteMany({ where: { id: { in: operacionIds } } });
      // Los ejemplares de la boleta referencian la cuenta (RESTRICT) y las correcciones a su ejemplar A (RESTRICT): correcciones → resto → cuentas.
      await prisma.ejemplarBoleta.deleteMany({ where: { cuenta: { mesaId: { in: mesaIds } }, corrigeAId: { not: null } } });
      await prisma.ejemplarBoleta.deleteMany({ where: { cuenta: { mesaId: { in: mesaIds } } } });
      await prisma.cuenta.deleteMany({ where: { mesaId: { in: mesaIds } } });
      await prisma.mesa.deleteMany({ where: { id: { in: mesaIds } } });
      await prisma.recetaIngrediente.deleteMany({ where: { recetaVersion: { productoId: pizza.id } } });
      await prisma.recetaVersion.deleteMany({ where: { productoId: pizza.id } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: productoIds } } });
      await prisma.producto.deleteMany({ where: { id: { in: productoIds } } });
    },
  };
}

const tarjeta = (page: Page, numero: number) => page.locator(`li[data-mesa="${numero}"]`);
const aviso = (page: Page) => page.locator('[role="status"][aria-live="polite"]');

async function agregar(page: Page, nombre: string, cantidad: string) {
  const combo = page.getByRole("combobox", { name: "Producto" });
  await combo.fill(nombre);
  await page.getByRole("option", { name: new RegExp(nombre) }).click();
  await page.getByLabel("Cantidad", { exact: true }).fill(cantidad);
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
}

test("flujo completo: abrir la cuenta, agregar, enviar a cocina, anular con motivo y cerrar la cuenta registra la venta y libera la mesa", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarCatalogo(sucursalId);
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 961 } });
  try {
    // Enviar, anular y cerrar imprimen solos: `window.print()` se reemplaza para contar las impresiones sin abrir el diálogo nativo.
    await interceptarImpresion(page);
    await page.goto("/mesas");
    await tarjeta(page, 961).getByRole("link", { name: "Tomar pedido" }).click();
    await page.waitForURL(`/mesas/${mesa.id}`);
    await expect(page.locator("main h1")).toHaveText("Mesa 961");
    await expect(page.getByText("La mesa está libre.")).toBeVisible();

    await page.getByRole("button", { name: "Abrir cuenta" }).click();
    await expect(aviso(page)).toHaveText("Cuenta de la mesa 961 abierta.");

    await agregar(page, cat.milanesa.nombre, "2");
    await expect(aviso(page)).toHaveText("Se agregó 1 ítem a la mesa 961.");
    await agregar(page, cat.flan.nombre, "1");
    await expect(page.getByRole("heading", { name: "Sin enviar · 2" })).toBeVisible();
    await expect(page.locator("[data-total-cuenta]")).toContainText(/21\.000/);

    await page.getByRole("button", { name: "Enviar a cocina" }).click();
    await expect(aviso(page)).toHaveText("Envío 1 a cocina: 2 ítems de la mesa 961.");
    await expect(page.getByRole("heading", { name: "Envío 1 · en cocina" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sin enviar · 0" })).toBeVisible();
    await expect.poll(async () => (await impresiones(page)).map((i) => i.tipo)).toEqual(["comanda"]);

    // El mapa ya la muestra ocupada, con un pedido enviado.
    await page.goto("/mesas");
    await expect(tarjeta(page, 961)).toContainText("1 pedido enviado");
    await expect(tarjeta(page, 961).getByRole("link", { name: "Facturar" })).toBeVisible();
    await tarjeta(page, 961).getByRole("link", { name: "Ver pedidos" }).click();
    await page.waitForURL(`/mesas/${mesa.id}`);

    // Anular sin motivo: el servidor lo rechaza y el diálogo lo dice. Con motivo: queda tachado y el total baja.
    await page.getByRole("button", { name: `Anular ${cat.milanesa.nombre}` }).click();
    const dialogo = page.getByRole("dialog", { name: `Anular «${cat.milanesa.nombre}»` });
    await expect(dialogo.getByLabel("Cantidad a anular")).toHaveValue("2");
    await dialogo.getByLabel("Cantidad a anular").fill("1");
    await dialogo.getByRole("button", { name: "Anular" }).click();
    await expect(dialogo.getByRole("alert")).toHaveText("Escribí el motivo de la anulación.");
    await dialogo.getByLabel("Motivo (obligatorio)").fill("Pidió una menos");
    await dialogo.getByRole("button", { name: "Anular" }).click();
    await expect(dialogo).toHaveCount(0);
    await expect(aviso(page)).toHaveText(`Se anuló 1 × «${cat.milanesa.nombre}» de la mesa 961.`);
    const anulacion = page.locator("[data-anulacion]");
    await expect(anulacion).toHaveText("−1 · Pidió una menos · por e2e-admin");
    await expect(anulacion).toHaveCSS("text-decoration-line", "line-through");
    await expect(page.locator("[data-total-cuenta]")).toContainText(/12\.000/);
    await expect.poll(async () => (await impresiones(page)).map((i) => i.tipo)).toEqual(["comanda", "anulacion"]);

    // Cerrar la cuenta: se elige la sección y se registra la venta.
    await page.getByRole("button", { name: "Cerrar cuenta" }).click();
    const cierre = page.getByRole("dialog", { name: "Cerrar cuenta · Mesa 961" });
    await expect(cierre.locator("[data-total-cierre]")).toContainText(/12\.000/);
    await cierre.getByLabel("Sección de la que sale la mercadería").selectOption({ label: SECCION });
    await cierre.getByRole("button", { name: "Cerrar y registrar la venta" }).click();
    await expect(aviso(page)).toHaveText(/^Cuenta de la mesa 961 cerrada: se registró la venta por \$\s?12\.000\.$/);
    await expect(page.getByText("La mesa está libre.")).toBeVisible();
    // La boleta del cliente sale sola: el consumo final (lo anulado ya no está), con el total cobrado.
    await expect.poll(async () => (await impresiones(page)).map((i) => i.tipo)).toEqual(["comanda", "anulacion", "boleta"]);
    const boleta = (await impresiones(page))[2].texto;
    expect(boleta).toContain(`TOTAL ${MONEDA.format(12000)}`);
    expect(boleta).not.toContain("Anulado");

    const ventas = await prisma.operacion.findMany({ where: { proceso: "VENTA", detalleLibre: "Mesa 961", sucursalId }, include: { movimientos: true } });
    expect(ventas).toHaveLength(2);
    const lineas = ventas.flatMap((v) => v.movimientos.filter((m) => m.proceso === "VENTA")).map((m) => [m.productoId, Number(m.cantidad), Number(m.precioTotal)]);
    expect(lineas).toEqual(expect.arrayContaining([[cat.milanesa.id, -1, 9000], [cat.flan.id, -1, 3000]]));

    await page.goto("/mesas");
    await expect(tarjeta(page, 961)).toContainText("Libre");
  } finally {
    await cat.limpiar([mesa.id]);
  }
});

test("quitar un ítem sin enviar no pide motivo: se borra y listo", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarCatalogo(sucursalId);
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 962 } });
  try {
    await page.goto(`/mesas/${mesa.id}`);
    await page.getByRole("button", { name: "Abrir cuenta" }).click();
    await expect(aviso(page)).toHaveText("Cuenta de la mesa 962 abierta.");
    await agregar(page, cat.flan.nombre, "1");
    await expect(page.locator(`[data-item-sin-enviar="${cat.flan.nombre}"]`)).toBeVisible();

    await page.getByRole("button", { name: `Quitar ${cat.flan.nombre}` }).click();
    await expect(aviso(page)).toHaveText(`Se quitó «${cat.flan.nombre}» de la mesa 962.`);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("[data-item-sin-enviar]")).toHaveCount(0);
    expect(await prisma.cuentaItem.count({ where: { cuenta: { mesaId: mesa.id } } })).toBe(0);

    // Sin ningún ítem, la mesa se puede liberar sin venta.
    await page.getByRole("button", { name: "Liberar mesa" }).click();
    await expect(aviso(page)).toHaveText("Mesa 962 liberada.");
    await expect(page.getByText("La mesa está libre.")).toBeVisible();
  } finally {
    await cat.limpiar([mesa.id]);
  }
});

test("cerrar con stock insuficiente (B6bis): la cuenta se cierra igual, el mensaje avisa el stock negativo y queda auditado", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarCatalogo(sucursalId);
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 963 } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const cuenta = await prisma.cuenta.create({
    data: { mesaId: mesa.id, abiertaPorId: admin.id, items: { create: [{ productoId: cat.pizza.id, cantidad: 2, precioUnitario: 12000, numeroEnvio: 1, creadoPorId: admin.id }] } },
  });
  try {
    await interceptarImpresion(page);
    await page.goto(`/mesas/${mesa.id}`);
    await page.getByRole("button", { name: "Cerrar cuenta" }).click();
    const cierre = page.getByRole("dialog", { name: "Cerrar cuenta · Mesa 963" });
    await cierre.getByLabel("Sección de la que sale la mercadería").selectOption({ label: SECCION });
    await cierre.getByRole("button", { name: "Cerrar y registrar la venta" }).click();

    await expect(aviso(page)).toContainText("Cuenta de la mesa 963 cerrada: se registró la venta por");
    await expect(aviso(page)).toContainText(`⚠ Quedó stock negativo: "${cat.muzzarella.nombre}" (tenía 0, se consumió 0,5, quedó en -0,5). Corregilo con un Conteo Físico o un Ajuste.`);
    await expect(page.getByText("La mesa está libre.")).toBeVisible();

    // La boleta del cliente sale igual, pero SIN el aviso de stock negativo (información interna: queda en pantalla y en la auditoría).
    await expect.poll(async () => (await impresiones(page)).map((i) => i.tipo)).toEqual(["boleta"]);
    const [boleta] = await impresiones(page);
    expect(boleta.texto).toContain(`2 × ${cat.pizza.nombre}`);
    for (const interno of ["⚠", "stock", "negativo"]) expect(boleta.texto.toLowerCase()).not.toContain(interno);
    await expect(aviso(page)).toContainText("⚠ Quedó stock negativo");

    expect((await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } })).cerradaEn).not.toBeNull();
    const venta = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA", detalleLibre: "Mesa 963", sucursalId } });
    const auditoria = await prisma.registroAuditoria.findMany({ where: { entidad: "Operacion", entidadId: venta.id } });
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({ campo: "saldoStock", valorAnterior: "0", valorNuevo: "-0.5", actorId: admin.id });
    expect(auditoria[0].descripcion).toContain(`Mesa 963: al cerrar la cuenta (e2e-admin@local.test) el stock de "${cat.muzzarella.nombre}" en «${SECCION}» quedó en negativo`);
  } finally {
    await cat.limpiar([mesa.id]);
  }
});

test("permisos: el mozo toma el pedido pero no anula ni cierra; solo Ver de pos_mesas es de solo lectura; sin pos_mesas, el aviso de permiso", async ({ browser, baseURL, sucursalId }) => {
  const cat = await sembrarCatalogo(sucursalId);
  const [mesaMozo, mesaLectura] = await Promise.all([964, 965].map((numero) => prisma.mesa.create({ data: { sucursalId, numero } })));
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  await prisma.cuenta.create({
    data: {
      mesaId: mesaLectura.id,
      abiertaPorId: admin.id,
      items: { create: [{ productoId: cat.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }, { productoId: cat.milanesa.id, cantidad: 1, precioUnitario: 9000 }] },
    },
  });
  const mozo = await abrirComoRol(browser, baseURL, sucursalId, { pos_mesas: "ver", pos_tomar_pedido: "editar" });
  const soloVe = await abrirComoRol(browser, baseURL, sucursalId, { pos_mesas: "ver" });
  const sinPermiso = await abrirComoRol(browser, baseURL, sucursalId, {});
  try {
    const m = mozo.page;
    await interceptarImpresion(m);
    await m.goto(`/mesas/${mesaMozo.id}`);
    await m.getByRole("button", { name: "Abrir cuenta" }).click();
    await expect(aviso(m)).toHaveText("Cuenta de la mesa 964 abierta.");
    await agregar(m, cat.flan.nombre, "1");
    await expect(aviso(m)).toHaveText("Se agregó 1 ítem a la mesa 964.");
    await m.getByRole("button", { name: "Enviar a cocina" }).click();
    await expect(aviso(m)).toHaveText("Envío 1 a cocina: 1 ítem de la mesa 964.");
    await expect.poll(async () => (await impresiones(m)).map((i) => i.tipo)).toEqual(["comanda"]);
    await expect(m.getByRole("button", { name: `Anular ${cat.flan.nombre}` })).toBeDisabled();
    await expect(m.getByRole("button", { name: "Cerrar cuenta" })).toBeDisabled();
    await expect(m.getByRole("button", { name: "Reimprimir la comanda del envío 1" })).toBeEnabled();

    const v = soloVe.page;
    await v.goto(`/mesas/${mesaLectura.id}`);
    await expect(v.locator("main h1")).toHaveText("Mesa 965");
    await expect(v.getByRole("button", { name: "Agregar", exact: true })).toBeDisabled();
    await expect(v.getByRole("combobox", { name: "Producto" })).toBeDisabled();
    await expect(v.getByRole("button", { name: `Quitar ${cat.milanesa.nombre}` })).toBeDisabled();
    await expect(v.getByRole("button", { name: "Enviar a cocina" })).toBeDisabled();
    await expect(v.getByRole("button", { name: `Anular ${cat.flan.nombre}` })).toBeDisabled();
    await expect(v.getByRole("button", { name: "Cerrar cuenta" })).toBeDisabled();
    await expect(v.getByRole("button", { name: "Reimprimir la comanda del envío 1" })).toBeDisabled();

    await sinPermiso.page.goto(`/mesas/${mesaLectura.id}`);
    await expect(sinPermiso.page.getByText(/No tenés permiso para ver esta sección/)).toBeVisible();
    await expect(sinPermiso.page.locator("main h1")).toHaveCount(0);
  } finally {
    // Las cuentas del mozo lo referencian (abiertaPor/creadoPor): se borran antes que el usuario.
    await cat.limpiar([mesaMozo.id, mesaLectura.id]);
    await mozo.limpiar();
    await soloVe.limpiar();
    await sinPermiso.limpiar();
  }
});

test("reimprimir un envío: la comanda sale de nuevo marcada REIMPRESIÓN, con lo vigente y lo anulado, sin precios y sin tocar la base", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarCatalogo(sucursalId);
  const unidad = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "unidad" } });
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  // Nombre largo a propósito: en un rollo de 58 mm tiene que cortar línea, no desbordar.
  const largo = await prisma.producto.create({
    data: { codigo: `E2E-TP-LARGO-${marca}`, nombre: `E2E Milanesa napolitana con papas fritas y dos huevos a caballo ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 15000 },
  });
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 968 } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: admin.id } });
  const original = await prisma.cuentaItem.create({ data: { cuentaId: cuenta.id, productoId: largo.id, cantidad: 3, precioUnitario: 15000, numeroEnvio: 1, creadoPorId: admin.id } });
  await prisma.cuentaItem.create({ data: { cuentaId: cuenta.id, productoId: cat.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1, creadoPorId: admin.id } });
  await prisma.cuentaItem.create({
    data: { cuentaId: cuenta.id, productoId: largo.id, cantidad: -1, precioUnitario: 15000, numeroEnvio: 1, anulaAItemId: original.id, motivoAnulacion: "Se quemó una", creadoPorId: admin.id },
  });
  const filasDeLaCuenta = () => prisma.cuentaItem.findMany({ where: { cuentaId: cuenta.id }, orderBy: { id: "asc" } });
  try {
    await interceptarImpresion(page);
    await page.goto(`/mesas/${mesa.id}`);
    await expect(page.getByRole("heading", { name: "Envío 1 · en cocina" })).toBeVisible();
    const antes = await filasDeLaCuenta();

    await page.getByRole("button", { name: "Reimprimir la comanda del envío 1" }).click();
    await expect.poll(async () => (await impresiones(page)).length).toBe(1);
    const [copia] = await impresiones(page);
    expect(copia.tipo).toBe("reimpresion");
    for (const texto of ["REIMPRESIÓN", "Mesa 968", "Envío 1", "Tomó: e2e-admin", `2 × ${largo.nombre}`, `1 × ${cat.flan.nombre}`, "Anulado", `1 × ${largo.nombre} · Se quemó una`]) {
      expect(copia.texto).toContain(texto);
    }
    expect(copia.texto).not.toContain("$");
    // Reimprimir no escribe nada: ni envío nuevo ni filas nuevas.
    expect(await filasDeLaCuenta()).toEqual(antes);

    // En pantalla el documento nunca se ve; al imprimir es lo único que se ve, y en 58 mm (~220 px) u 80 mm (~302 px) no desborda.
    const documento = page.locator("[data-imprimible]");
    await expect(documento).toHaveCount(1);
    await expect(documento).toBeHidden();
    await page.emulateMedia({ media: "print" });
    await expect(documento).toBeVisible();
    await expect(page.locator(".pos-shell")).toBeHidden();
    for (const ancho of [220, 302]) {
      await page.setViewportSize({ width: ancho, height: 800 });
      const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(desborde, `papel de ${ancho}px`).toBeLessThanOrEqual(0);
    }
    await page.emulateMedia({ media: "screen" });

    // Al cerrar el diálogo de impresión (`afterprint`) el documento sale del DOM.
    const otra = await page.context().newPage();
    await interceptarImpresion(otra, { simularAfterprint: true });
    await otra.goto(`/mesas/${mesa.id}`);
    await otra.getByRole("button", { name: "Reimprimir la comanda del envío 1" }).click();
    await expect.poll(async () => (await impresiones(otra)).length).toBe(1);
    await expect(otra.locator("[data-imprimible]")).toHaveCount(0);
    await otra.close();
  } finally {
    await cat.limpiar([mesa.id]);
    await prisma.producto.deleteMany({ where: { id: largo.id } });
  }
});

test("enviar a cocina imprime la comanda del envío: sin precios, y el segundo envío solo con lo nuevo", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarCatalogo(sucursalId);
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 969 } });
  try {
    await interceptarImpresion(page);
    await page.goto(`/mesas/${mesa.id}`);
    await page.getByRole("button", { name: "Abrir cuenta" }).click();
    await expect(aviso(page)).toHaveText("Cuenta de la mesa 969 abierta.");
    await agregar(page, cat.milanesa.nombre, "2");
    await expect(aviso(page)).toHaveText("Se agregó 1 ítem a la mesa 969.");
    await agregar(page, cat.flan.nombre, "1");
    await expect(page.getByRole("heading", { name: "Sin enviar · 2" })).toBeVisible();

    await page.getByRole("button", { name: "Enviar a cocina" }).click();
    await expect(page.getByRole("heading", { name: "Envío 1 · en cocina" })).toBeVisible();
    await expect.poll(async () => (await impresiones(page)).length).toBe(1);
    const [primera] = await impresiones(page);
    expect(primera.tipo).toBe("comanda");
    for (const texto of ["COMANDA · COCINA", "Mesa 969", "Envío 1", "Tomó: e2e-admin", `2 × ${cat.milanesa.nombre}`, `1 × ${cat.flan.nombre}`]) expect(primera.texto).toContain(texto);
    expect(primera.texto).not.toContain("$");

    await agregar(page, cat.pizza.nombre, "1");
    await expect(page.getByRole("heading", { name: "Sin enviar · 1" })).toBeVisible();
    await page.getByRole("button", { name: "Enviar a cocina" }).click();
    await expect(page.getByRole("heading", { name: "Envío 2 · en cocina" })).toBeVisible();
    await expect.poll(async () => (await impresiones(page)).length).toBe(2);
    const segunda = (await impresiones(page))[1];
    expect(segunda.tipo).toBe("comanda");
    expect(segunda.texto).toContain("Envío 2");
    expect(segunda.texto).toContain(`1 × ${cat.pizza.nombre}`);
    expect(segunda.texto).not.toContain(cat.milanesa.nombre);
    expect(segunda.texto).not.toContain(cat.flan.nombre);
    expect(segunda.texto).not.toContain("$");
  } finally {
    await cat.limpiar([mesa.id]);
  }
});

test("una pestaña vieja no reimprime un envío ya hecho: «Esos ítems ya estaban enviados.» no imprime nada", async ({ browser, baseURL, paginaAutenticada: a, sucursalId }) => {
  const cat = await sembrarCatalogo(sucursalId);
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 970 } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: admin.id, items: { create: [{ productoId: cat.flan.id, cantidad: 1, precioUnitario: 3000, creadoPorId: admin.id }] } } });
  const mozo = await abrirComoRol(browser, baseURL, sucursalId, { pos_mesas: "ver", pos_tomar_pedido: "editar" });
  const b = mozo.page;
  try {
    await interceptarImpresion(a);
    await interceptarImpresion(b);
    await a.goto(`/mesas/${mesa.id}`);
    await b.goto(`/mesas/${mesa.id}`);
    await expect(b.locator(`[data-item-sin-enviar="${cat.flan.nombre}"]`)).toBeVisible();

    await a.getByRole("button", { name: "Enviar a cocina" }).click();
    await expect(a.getByRole("heading", { name: "Envío 1 · en cocina" })).toBeVisible();
    await expect.poll(async () => (await impresiones(a)).length).toBe(1);

    // B todavía muestra el ítem sin enviar: al apretar «Enviar», el servidor no crea otro envío y le contesta el envío 1 de A con
    // `envioNuevo: false`. B solo imprime automáticamente un envío que haya creado su propia llamada: no imprime nada.
    await b.getByRole("button", { name: "Enviar a cocina" }).click();
    await expect(aviso(b)).toHaveText("Esos ítems ya estaban enviados.");
    await expect(b.getByRole("heading", { name: "Envío 1 · en cocina" })).toBeVisible();
    await expect(b.getByRole("heading", { name: "Sin enviar · 0" })).toBeVisible();
    expect(await impresiones(b)).toEqual([]);
  } finally {
    await cat.limpiar([mesa.id]);
    await mozo.limpiar();
  }
});

test("anular un ítem enviado imprime el aviso para cocina: ANULACIÓN · NO PREPARAR, con motivo, quién y cuánto queda, sin precios", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarCatalogo(sucursalId);
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 971 } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  await prisma.cuenta.create({
    data: { mesaId: mesa.id, abiertaPorId: admin.id, items: { create: [{ productoId: cat.milanesa.id, cantidad: 2, precioUnitario: 9000, numeroEnvio: 1, creadoPorId: admin.id }] } },
  });
  try {
    await interceptarImpresion(page);
    await page.goto(`/mesas/${mesa.id}`);
    await page.getByRole("button", { name: `Anular ${cat.milanesa.nombre}` }).click();
    const dialogo = page.getByRole("dialog", { name: `Anular «${cat.milanesa.nombre}»` });
    await dialogo.getByLabel("Cantidad a anular").fill("1");
    await dialogo.getByLabel("Motivo (obligatorio)").fill("Se cayó al piso");
    await dialogo.getByRole("button", { name: "Anular" }).click();
    await expect(aviso(page)).toHaveText(`Se anuló 1 × «${cat.milanesa.nombre}» de la mesa 971.`);

    await expect.poll(async () => (await impresiones(page)).length).toBe(1);
    const [anulacion] = await impresiones(page);
    expect(anulacion.tipo).toBe("anulacion");
    for (const texto of ["ANULACIÓN", "NO PREPARAR", "Mesa 971", "Envío 1", `1 × ${cat.milanesa.nombre}`, "Motivo: Se cayó al piso", "Quedan: 1", "Anuló: e2e-admin"]) {
      expect(anulacion.texto).toContain(texto);
    }
    expect(anulacion.texto).not.toContain("$");
  } finally {
    await cat.limpiar([mesa.id]);
  }
});

const MONEDA = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const HORA_AR = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires" });

/** Una cuenta ya cerrada CON VENTA (sembrada directo: Operacion VENTA + ítems enlazados), cerrada en `cerradaEn`. */
async function sembrarCuentaCerrada(sucursalId: string, mesaId: string, usuarioId: string, productoId: string, cerradaEn: Date, anulada = false) {
  const venta = await prisma.operacion.create({
    data: { sucursalId, proceso: "VENTA", fecha: cerradaEn, usuarioId, detalleLibre: "Mesa E2E", anuladaEn: anulada ? new Date() : null },
  });
  return prisma.cuenta.create({
    data: {
      mesaId,
      abiertaPorId: usuarioId,
      cerradaEn,
      cerradaPorId: usuarioId,
      items: { create: [{ productoId, cantidad: 2, precioUnitario: 9000, numeroEnvio: 1, creadoPorId: usuarioId, operacionId: venta.id }] },
    },
  });
}

test("reimprimir la boleta de una cuenta cerrada: «Cuentas cerradas» la lista y la copia sale marcada REIMPRESIÓN, con las líneas netas y el total", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarCatalogo(sucursalId);
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 972 } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  await prisma.cuenta.create({
    data: {
      mesaId: mesa.id,
      abiertaPorId: admin.id,
      items: {
        create: [
          { productoId: cat.milanesa.id, cantidad: 2, precioUnitario: 9000, numeroEnvio: 1, creadoPorId: admin.id },
          { productoId: cat.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1, creadoPorId: admin.id },
        ],
      },
    },
  });
  try {
    await interceptarImpresion(page);
    await page.goto(`/mesas/${mesa.id}`);
    await page.getByRole("button", { name: "Cerrar cuenta" }).click();
    const cierre = page.getByRole("dialog", { name: "Cerrar cuenta · Mesa 972" });
    const total = (await cierre.locator("[data-total-cierre]").textContent())?.trim() ?? "";
    expect(total).toBe(MONEDA.format(21000));
    await cierre.getByLabel("Sección de la que sale la mercadería").selectOption({ label: SECCION });
    await cierre.getByRole("button", { name: "Cerrar y registrar la venta" }).click();
    await expect(page.getByText("La mesa está libre.")).toBeVisible();
    await expect.poll(async () => (await impresiones(page)).map((i) => i.tipo)).toEqual(["boleta"]);

    const cerrada = await prisma.cuenta.findFirstOrThrow({ where: { mesaId: mesa.id } });
    const hora = HORA_AR.format(cerrada.cerradaEn!);
    const seccion = page.getByRole("region", { name: "Cuentas cerradas" });
    await expect(seccion.locator("[data-cuenta-cerrada]")).toHaveCount(1);
    await expect(seccion.locator("[data-cuenta-cerrada]")).toContainText(`Cerrada ${hora} · Atendió e2e-admin · ${total}`);

    await seccion.getByRole("button", { name: `Reimprimir la boleta de la cuenta cerrada a las ${hora}` }).click();
    await expect.poll(async () => (await impresiones(page)).map((i) => i.tipo)).toEqual(["boleta", "boleta-reimpresion"]);
    const copia = (await impresiones(page))[1];
    expect((await impresiones(page))[0].texto).not.toContain("REIMPRESIÓN");
    for (const texto of [
      "REIMPRESIÓN",
      "Central",
      "Mesa 972",
      "Atendió: e2e-admin",
      `2 × ${cat.milanesa.nombre}`,
      `${MONEDA.format(9000)} c/u ${MONEDA.format(18000)}`,
      `1 × ${cat.flan.nombre}`,
      `${MONEDA.format(3000)} c/u ${MONEDA.format(3000)}`,
      `TOTAL ${total}`,
      "No válido como factura",
    ]) {
      expect(copia.texto).toContain(texto);
    }

    await page.emulateMedia({ media: "print" });
    await expect(page.locator("[data-imprimible]")).toBeVisible();
    await page.setViewportSize({ width: 220, height: 800 });
    const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(desborde).toBeLessThanOrEqual(0);
  } finally {
    await cat.limpiar([mesa.id]);
  }
});

test("guardas de la reimpresión de la boleta: sin pos_cerrar_cuenta queda deshabilitada; con la venta anulada, también, y lo dice", async ({ browser, baseURL, paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarCatalogo(sucursalId);
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 973 } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const vigenteEn = new Date(Date.now() - 60 * 60_000);
  const anuladaEn = new Date(Date.now() - 2 * 60 * 60_000);
  await sembrarCuentaCerrada(sucursalId, mesa.id, admin.id, cat.milanesa.id, vigenteEn);
  await sembrarCuentaCerrada(sucursalId, mesa.id, admin.id, cat.milanesa.id, anuladaEn, true);
  const reimprimir = (p: Page, fecha: Date) => p.getByRole("button", { name: `Reimprimir la boleta de la cuenta cerrada a las ${HORA_AR.format(fecha)}` });
  const mozo = await abrirComoRol(browser, baseURL, sucursalId, { pos_mesas: "ver", pos_tomar_pedido: "editar" });
  try {
    await page.goto(`/mesas/${mesa.id}`);
    await expect(page.locator("[data-cuenta-cerrada]")).toHaveCount(2);
    await expect(reimprimir(page, vigenteEn)).toBeEnabled();
    await expect(reimprimir(page, anuladaEn)).toBeDisabled();
    await expect(page.locator(`[data-cuenta-cerrada="${HORA_AR.format(anuladaEn)}"]`)).toContainText("Venta anulada");
    await expect(page.locator(`[data-cuenta-cerrada="${HORA_AR.format(vigenteEn)}"]`)).not.toContainText("Venta anulada");

    await mozo.page.goto(`/mesas/${mesa.id}`);
    await expect(mozo.page.locator("[data-cuenta-cerrada]")).toHaveCount(2);
    await expect(reimprimir(mozo.page, vigenteEn)).toBeDisabled();
    await expect(reimprimir(mozo.page, anuladaEn)).toBeDisabled();
  } finally {
    await cat.limpiar([mesa.id]);
    await mozo.limpiar();
  }
});

test("cerrar una cuenta sin venta (todo anulado) no imprime boleta", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarCatalogo(sucursalId);
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 974 } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: admin.id } });
  const original = await prisma.cuentaItem.create({ data: { cuentaId: cuenta.id, productoId: cat.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1, creadoPorId: admin.id } });
  await prisma.cuentaItem.create({
    data: { cuentaId: cuenta.id, productoId: cat.flan.id, cantidad: -1, precioUnitario: 3000, numeroEnvio: 1, anulaAItemId: original.id, motivoAnulacion: "Se fueron", creadoPorId: admin.id },
  });
  try {
    await interceptarImpresion(page);
    await page.goto(`/mesas/${mesa.id}`);
    await page.getByRole("button", { name: "Cerrar cuenta" }).click();
    const cierre = page.getByRole("dialog", { name: "Cerrar cuenta · Mesa 974" });
    await expect(cierre.locator("[data-total-cierre]")).toHaveText(MONEDA.format(0));
    await cierre.getByRole("button", { name: "Cerrar y registrar la venta" }).click();
    await expect(aviso(page)).toHaveText("Cuenta de la mesa 974 cerrada sin venta: no quedó nada por cobrar.");
    await expect(page.getByText("La mesa está libre.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Cuentas cerradas" })).toHaveCount(0);
    expect((await impresiones(page)).filter((i) => i.tipo === "boleta")).toEqual([]);
  } finally {
    await cat.limpiar([mesa.id]);
  }
});

test("sin sesión, la pantalla de la mesa lleva al login recordando la ruta", async ({ browser, baseURL, sucursalId }) => {
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 966 } });
  const contexto = await browser.newContext();
  try {
    const page = await contexto.newPage();
    await page.goto(`${baseURL}/mesas/${mesa.id}`);
    await page.waitForURL(new RegExp(`/login\\?volver=%2Fmesas%2F${mesa.id}$`));
    await expect(page.getByRole("button", { name: "Ingresar con Google" })).toBeVisible();
  } finally {
    await contexto.close();
    await prisma.mesa.deleteMany({ where: { id: mesa.id } });
  }
});

test("una mesa de otra sucursal (o inexistente) no se muestra", async ({ paginaAutenticada: page }) => {
  const otra = await prisma.sucursal.create({ data: { nombre: `E2E Otra ${Date.now()}` } });
  const ajena = await prisma.mesa.create({ data: { sucursalId: otra.id, numero: 1 } });
  try {
    await page.goto(`/mesas/${ajena.id}`);
    await expect(page.getByText("No se encontró esa mesa en esta sucursal.")).toBeVisible();
    await page.goto("/mesas/no-existe");
    await expect(page.getByText("No se encontró esa mesa en esta sucursal.")).toBeVisible();
  } finally {
    await prisma.mesa.deleteMany({ where: { id: ajena.id } });
    await prisma.sucursal.deleteMany({ where: { id: otra.id } });
  }
});

test("a 1024px no hay scroll horizontal y el título de la mesa está en main h1", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarCatalogo(sucursalId);
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 967 } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  await prisma.cuenta.create({
    data: {
      mesaId: mesa.id,
      abiertaPorId: admin.id,
      items: { create: [{ productoId: cat.milanesa.id, cantidad: 2, precioUnitario: 9000, numeroEnvio: 1 }, { productoId: cat.flan.id, cantidad: 1, precioUnitario: 3000 }] },
    },
  });
  try {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(`/mesas/${mesa.id}`);
    await expect(page.locator("main h1")).toHaveText("Mesa 967");
    const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(desborde).toBeLessThanOrEqual(0);
  } finally {
    await cat.limpiar([mesa.id]);
  }
});
