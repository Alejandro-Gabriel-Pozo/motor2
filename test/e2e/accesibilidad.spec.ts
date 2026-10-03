import { randomUUID } from "node:crypto";
import { test as base, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { test as testAutenticado } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { impresiones, interceptarImpresion } from "./fixtures/impresion";
import { crearMembresias, crearMembresia } from "../setup/membresia";
import { prismaAdmin } from "../setup/cliente-duenio";

/**
 * Accesibilidad (WCAG 2.1 A/AA vía axe-core) sobre pantallas puntuales: la pública (login, sin sesión), dos reportes (Costos y márgenes,
 * Promociones), la matriz de permisos, las seis pantallas de catálogo/administración con formularios sueltos (categorías, unidades,
 * insumos-grupos, capacidades por sucursal, precio local, motivos de Merma/Consumo), la sección habitual de stock, el admin de la carta, su portal de sucursales y su
 * tema, el mapa de mesas del salón y la pantalla de una mesa (con «Cuentas cerradas», el modal de comensales al abrir cuenta), el reporte de
 * rotación de mesas y el reporte de boletas emitidas (Task #17). No es exhaustivo sobre todas las pantallas: se suma una cuando aparece una necesidad concreta.
 */

base("login: sin violaciones de accesibilidad detectables por axe", async ({ page }) => {
  await page.goto("/login");
  const resultados = await new AxeBuilder({ page }).analyze();
  expect(resultados.violations).toEqual([]);
});

testAutenticado("inicio: el panel con las tarjetas de módulos (iconos decorativos + texto) no tiene violaciones de axe, en modo claro y oscuro", async ({ paginaAutenticada: page }) => {
  await page.goto("/inicio");
  await expect(page.getByRole("heading", { level: 1, name: /^Hola — estás en / })).toBeVisible();
  await expect(page.locator("main ul li a")).toHaveCount(8);
  expect((await new AxeBuilder({ page }).analyze()).violations, "modo claro").toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
  expect((await new AxeBuilder({ page }).include("main").analyze()).violations, "modo oscuro emulado (contenido de la pantalla)").toEqual([]);
});

testAutenticado("reportes/costos: sin violaciones de accesibilidad detectables por axe, contraste incluido", async ({ paginaAutenticada: page }) => {
  // Un producto de venta con receta cuyo insumo NO tiene ninguna compra: su costo queda incompleto y la tabla lo marca en ámbar (text-amber-700 / dark:
  // text-amber-600). Sin este dato la pantalla no dibuja ningún texto ámbar y el chequeo de contraste no auditaría nada.
  const marca = Date.now();
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const mp = await prisma.producto.create({ data: { codigo: `E2E-A11Y-CMP-${marca}`, nombre: `E2E Insumo Sin Compra ${marca}`, tipo: "MP", unidadStockId: unidad.id } });
  const pv = await prisma.producto.create({ data: { codigo: `E2E-A11Y-CPV-${marca}`, nombre: `E2E Plato Costo Incompleto ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 100 } });
  await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidad.id }] } } });
  try {
    await page.goto("/reportes/costos");
    await expect(page.getByRole("heading", { name: "Costos y márgenes" })).toBeVisible();
    await expect(page.locator("tr", { hasText: pv.nombre }).locator("[class*=\"text-amber-\"]").first(), "el caso sembrado tiene que dibujar texto ámbar").toBeVisible();
    // Scan completo, SIN desactivar reglas: antes `color-contrast` iba afuera porque text-amber-600 no llegaba al mínimo AA.
    const resultados = await new AxeBuilder({ page }).analyze();
    expect(resultados.violations).toEqual([]);
  } finally {
    await prisma.recetaVersion.deleteMany({ where: { productoId: pv.id } });
    await prisma.producto.deleteMany({ where: { id: { in: [pv.id, mp.id] } } });
  }
});

testAutenticado(
  "administracion/permisos: la matriz, en solo lectura y en edición con el resumen de cambios abierto, sin violaciones de axe",
  async ({ paginaAutenticada: page }) => {
    await page.goto("/administracion/permisos");
    await expect(page.getByRole("heading", { name: "Matriz de permisos (acción × rol)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Editar permisos" })).toBeVisible(); // confirma que se renderizó la matriz y no un mensaje de permiso

    const soloLectura = await new AxeBuilder({ page }).analyze();
    expect(soloLectura.violations, "matriz en solo lectura").toEqual([]);

    // Modo edición con un cambio marcado y el diálogo de resumen abierto (es donde vive el `role="dialog"` y el mensaje de estado). No se
    // guarda nada: la base no cambia.
    await page.getByRole("button", { name: "Editar permisos" }).click();
    await page.locator("[data-celda]").first().click();
    await page.getByRole("button", { name: "Revisar y guardar" }).click();
    await expect(page.getByRole("dialog", { name: "Resumen de cambios" })).toBeVisible();

    const enEdicion = await new AxeBuilder({ page }).analyze();
    expect(enEdicion.violations, "matriz en edición con el resumen abierto").toEqual([]);
  }
);

/**
 * Pantallas de catálogo y administración que tenían formularios sueltos (revisadas al arreglar que descartaban el resultado de la acción).
 * Cada una se audita CON DATOS (una fila al menos): sin filas no hay inputs de fila ni botones que auditar. Scan completo, sin desactivar reglas.
 */
const conTitulo = (page: import("@playwright/test").Page, titulo: string | RegExp) => expect(page.getByRole("heading", { name: titulo }).first()).toBeVisible();

testAutenticado("catalogo/categorias: sin violaciones de axe", async ({ paginaAutenticada: page }) => {
  const nombre = `E2E A11y Categoría ${Date.now()}`;
  await prisma.categoriaProducto.create({ data: { nombre } });
  try {
    await page.goto("/catalogo/categorias");
    await conTitulo(page, /Categorías/);
    await expect(page.getByText(nombre)).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    await prisma.categoriaProducto.deleteMany({ where: { nombre } });
  }
});

testAutenticado("catalogo/clientes: la lista con un cliente, con «Editar» desplegado, sin violaciones de axe", async ({ paginaAutenticada: page }) => {
  const nombre = `E2E A11y Cliente ${Date.now()}`;
  await prisma.cliente.create({ data: { nombre, descuentoPorcentaje: 10 } });
  try {
    await page.goto("/catalogo/clientes");
    await conTitulo(page, /Clientes con descuento/);
    await expect(page.getByText(nombre)).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations, "plegada").toEqual([]);
    await page.locator("summary", { hasText: "Editar" }).first().click();
    expect((await new AxeBuilder({ page }).analyze()).violations, "desplegada").toEqual([]);
  } finally {
    await prisma.cliente.deleteMany({ where: { nombre } });
  }
});

testAutenticado("catalogo/margen-objetivo: sin violaciones de axe", async ({ paginaAutenticada: page }) => {
  const nombre = `E2E A11y Objetivo ${Date.now()}`;
  await prisma.categoriaProducto.create({ data: { nombre } });
  try {
    await page.goto("/catalogo/margen-objetivo");
    await conTitulo(page, /Margen objetivo/);
    await expect(page.getByLabel(`Food cost objetivo de ${nombre} (%)`)).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    await prisma.categoriaProducto.deleteMany({ where: { nombre } });
  }
});

testAutenticado("catalogo/unidades: sin violaciones de axe", async ({ paginaAutenticada: page }) => {
  await page.goto("/catalogo/unidades");
  await conTitulo(page, "Unidades de medida");
  await expect(page.getByRole("cell", { name: "kg", exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

testAutenticado("catalogo/insumos-grupos: sin violaciones de axe", async ({ paginaAutenticada: page }) => {
  const marca = Date.now();
  const grupo = await prisma.grupo.create({ data: { nombre: `E2E A11y Grupo ${marca}` } });
  const insumo = await prisma.insumo.create({ data: { nombre: `E2E A11y Insumo ${marca}`, grupoId: grupo.id } });
  try {
    await page.goto("/catalogo/insumos-grupos");
    await conTitulo(page, "Árbol de grupos");
    await expect(page.locator(`input[value="${insumo.nombre}"]`)).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    await prisma.insumo.deleteMany({ where: { id: insumo.id } });
    await prisma.grupo.deleteMany({ where: { id: grupo.id } });
  }
});

testAutenticado("movimientos/motivos-merma: sin violaciones de axe", async ({ paginaAutenticada: page }) => {
  // Sin fixture: la migración expand del catálogo (plan "motivos de Consumo/Merma como catálogo administrable", P3) ya
  // sembró 6 Motivo de Merma + 5 Destino de Consumo en cualquier base migrada — las dos tablas nunca están vacías acá.
  await page.goto("/movimientos/motivos-merma");
  await conTitulo(page, /Motivos de Merma/);
  await expect(page.getByText("Vencido")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

testAutenticado("movimientos/destinos-consumo: sin violaciones de axe", async ({ paginaAutenticada: page }) => {
  await page.goto("/movimientos/destinos-consumo");
  await conTitulo(page, /Destinos de Consumo/);
  await expect(page.getByText("Personal")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

testAutenticado("administracion/capacidades-sucursal: sin violaciones de axe", async ({ paginaAutenticada: page }) => {
  await page.goto("/administracion/capacidades-sucursal");
  await conTitulo(page, /Capacidades por sucursal/);
  await expect(page.getByRole("cell", { name: "stock_minimo", exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

testAutenticado("movimientos/precio-local: sin violaciones de axe", async ({ paginaAutenticada: page, sucursalId }) => {
  const nombre = `E2E A11y Precio ${Date.now()}`;
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-A11Y-PL-${Date.now()}`, nombre, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
  await prisma.precioLocalProducto.create({ data: { sucursalId, productoId: producto.id, precio: 120, habilitado: true } });
  try {
    await page.goto("/movimientos/precio-local");
    await conTitulo(page, /Precio local/);
    await expect(page.getByText(nombre)).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    await prisma.precioLocalProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  }
});

testAutenticado("stock/seccion-habitual: la tabla con una fila, con «Quitar» a confirmar, en modo claro y oscuro, sin violaciones de axe", async ({ paginaAutenticada: page, sucursalId }) => {
  // Pantalla nueva (docs/plan-seccion-habitual-stock-2026-09-25.md, C2): una fila sembrada para que la tabla y sus acciones se dibujen.
  const marca = Date.now();
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-A11Y-SH-${marca}`, nombre: `E2E A11y Habitual ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 100 } });
  const seccion = await prisma.seccion.create({ data: { sucursalId, nombre: `E2E A11y Cocina ${marca}` } });
  await prisma.seccionHabitualProducto.create({ data: { sucursalId, productoId: producto.id, seccionId: seccion.id } });
  try {
    await page.goto("/stock/seccion-habitual");
    await conTitulo(page, "Sección habitual");
    const fila = page.locator("tr", { hasText: producto.nombre });
    await expect(fila).toContainText(seccion.nombre);
    expect((await new AxeBuilder({ page }).analyze()).violations, "modo claro").toEqual([]);

    await fila.getByRole("button", { name: `Quitar la sección habitual de ${producto.nombre}` }).click();
    await expect(fila.getByRole("button", { name: "Sí, quitar" })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations, "«Quitar» a confirmar").toEqual([]);

    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/stock/seccion-habitual");
    await conTitulo(page, "Sección habitual");
    await expect(page.locator("tr", { hasText: producto.nombre })).toBeVisible();
    // En oscuro se audita el contenido de la pantalla (`main`), no el marco de la app: el menú y el encabezado (text-neutral-500 sobre
    // #0a0a0a, 4,17:1) ya fallaban el contraste en modo oscuro antes de esta pantalla — hallazgo aparte, fuera de este cambio.
    expect((await new AxeBuilder({ page }).include("main").analyze()).violations, "modo oscuro emulado (contenido de la pantalla)").toEqual([]);
  } finally {
    await prisma.seccionHabitualProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.seccion.deleteMany({ where: { id: seccion.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  }
});

testAutenticado("movimientos/precio-local: el selector de producto abierto (con resultados y sin resultados) no tiene violaciones de axe", async ({ paginaAutenticada: page, sucursalId }) => {
  const marca = Date.now();
  const nombre = `E2E A11y Selector ${marca}`;
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-A11Y-SEL-${marca}`, nombre, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
  // El selector filtra { tipo: "PV", soloDisponibles: true } (precio-local-form.tsx) — sin esto no aparece ninguna opción.
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
  try {
    await page.goto("/movimientos/precio-local");
    await conTitulo(page, /Precio local/);
    const selector = page.getByRole("combobox");

    // Con resultados: la opción se muestra y la resaltada la anuncia el combobox (aria-activedescendant).
    await selector.fill(nombre);
    const opcion = page.getByRole("option", { name: new RegExp(nombre) });
    await expect(opcion).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations, "listbox con resultados").toEqual([]);
    await selector.press("ArrowDown");
    await expect(selector).toHaveAttribute("aria-activedescendant", (await opcion.getAttribute("id")) ?? "sin-id");

    // Sin resultados: el aviso «Sin resultados.» también vive dentro del listbox.
    await selector.fill("zzz-no-existe-ningun-producto-asi");
    await expect(page.getByText("Sin resultados.")).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations, "listbox sin resultados").toEqual([]);
  } finally {
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  }
});

testAutenticado("modo oscuro: la página declara color-scheme, para que los controles nativos (lista de un <select>, scrollbars) se dibujen oscuros", async ({ paginaAutenticada: page }) => {
  // Los inputs de la app tienen fondo transparente (preflight de Tailwind), así que el fondo de un <input> no dice nada; lo que sí se ve mal sin
  // `color-scheme` son los controles que dibuja el navegador: la lista desplegada de un <select> sale blanca con el texto claro heredado, y las
  // barras de scroll salen claras. Se verifica la declaración (no se puede fotografiar un popup nativo en headless).
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/catalogo/unidades");
  await conTitulo(page, "Unidades de medida");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), "color-scheme de la raíz en modo oscuro").toContain("dark");
});

testAutenticado("catalogo/productos: la lista, con la confirmación de «Desactivar» abierta y con el bloqueo mostrado, sin violaciones de axe", async ({ paginaAutenticada: page, sucursalId }) => {
  // Un producto disponible acá y uno no disponible (para que se dibujen los dos estados del botón) y un plato disponible acá que usa al primero (para que
  // desactivar se bloquee y se muestre el mensaje de error). `?q=` acota la tabla: no depende de lo que dejen otros specs. El "inactivo" queda sin fila de
  // DisponibilidadProducto a propósito — fila ausente = no disponible (docs/plan-disponibilidad-por-sucursal-2026-09-23.md).
  const marca = Date.now();
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const insumo = await prisma.insumo.create({ data: { nombre: `E2E A11y Insumo Lista ${marca}` } });
  const activo = await prisma.producto.create({ data: { codigo: `E2E-A11Y-LA-${marca}`, nombre: `E2E A11y Lista ${marca} activo`, tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } });
  const inactivo = await prisma.producto.create({ data: { codigo: `E2E-A11Y-LI-${marca}`, nombre: `E2E A11y Lista ${marca} inactivo`, tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } });
  const plato = await prisma.producto.create({ data: { codigo: `E2E-A11Y-LP-${marca}`, nombre: `E2E A11y Lista ${marca} plato`, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
  await prisma.disponibilidadProducto.createMany({
    data: [activo.id, plato.id].map((productoId) => ({ sucursalId, productoId, disponible: true })),
  });
  await prisma.recetaVersion.create({ data: { productoId: plato.id, version: 1, ingredientes: { create: [{ insumoProductoId: activo.id, cantidad: 1, unidadId: kg.id }] } } });
  try {
    await page.goto(`/catalogo/productos?q=${encodeURIComponent(`E2E A11y Lista ${marca}`)}`);
    await conTitulo(page, "Productos");
    const filaActiva = page.locator("tr", { hasText: activo.nombre });
    await expect(filaActiva.getByRole("button", { name: "Desactivar", exact: true })).toBeVisible();
    await expect(page.locator("tr", { hasText: inactivo.nombre }).getByRole("button", { name: "Activar", exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations, "tabla en reposo").toEqual([]);

    // Confirmación abierta: acá viven el role="alert" del aviso, el aria-describedby y los dos botones nuevos.
    await filaActiva.getByRole("button", { name: "Desactivar", exact: true }).click();
    await expect(filaActiva.getByRole("button", { name: "Sí, desactivar" })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations, "confirmación abierta").toEqual([]);

    // Bloqueado por la receta: el mensaje de error queda visible.
    await filaActiva.getByRole("button", { name: "Sí, desactivar" }).click();
    await expect(filaActiva.getByRole("alert").filter({ hasText: "No se puede desactivar" })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations, "mensaje de bloqueo visible").toEqual([]);
  } finally {
    await prisma.recetaVersion.deleteMany({ where: { productoId: plato.id } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: [plato.id, activo.id, inactivo.id] } } });
    await prisma.producto.deleteMany({ where: { id: { in: [plato.id, activo.id, inactivo.id] } } });
    await prisma.insumo.deleteMany({ where: { id: insumo.id } });
  }
});

testAutenticado(
  "catalogo/productos/[id]: la tabla nueva «Disponibilidad por sucursal», con 2+ sucursales, sin violaciones de axe (mismo tipo de pantalla que ya dio empty-table-header/contraste en este proyecto)",
  async ({ paginaAutenticada: page, sucursalId }) => {
    const marca = Date.now();
    const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
    const otraSucursal = await prisma.sucursal.create({ data: { nombre: `E2E A11y Norte ${marca}` } });
    const producto = await prisma.producto.create({ data: { codigo: `E2E-A11Y-DISP-${marca}`, nombre: `E2E A11y Disponibilidad ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 100 } });
    // Disponible en la propia (fila con botón «Desactivar») y NO disponible en la otra (fila sin ninguna acción, botón ausente para esa sucursal) — las
    // dos formas de fila que dibuja la tabla nueva.
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
    try {
      await page.goto(`/catalogo/productos/${producto.id}`);
      await conTitulo(page, producto.nombre);
      await expect(page.getByRole("heading", { name: "Disponibilidad por sucursal" })).toBeVisible();
      await expect(page.getByRole("row", { name: new RegExp(otraSucursal.nombre) })).toBeVisible();
      await expect(page.getByRole("button", { name: "Desactivar", exact: true })).toBeVisible(); // solo en la fila de la sucursal activa
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    } finally {
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
      await prisma.producto.deleteMany({ where: { id: producto.id } });
      await prisma.sucursal.deleteMany({ where: { id: otraSucursal.id } });
    }
  }
);

testAutenticado("catalogo/productos/nuevo: el formulario de alta (materia prima, producto de venta y consignación) sin violaciones de axe", async ({ paginaAutenticada: page }) => {
  await page.goto("/catalogo/productos/nuevo");
  await conTitulo(page, "Nuevo producto");
  await expect(page.locator('input[name="nombre"]')).toBeVisible(); // se renderizó el formulario y no un mensaje de permiso

  // Materia prima (lo que abre por defecto): categoría, insumo, unidad de stock, unidad de compra, factor y «se produce».
  expect((await new AxeBuilder({ page }).analyze()).violations, "alta de materia prima").toEqual([]);

  // Es consignación: suma el proveedor y el precio de consignación.
  await page.getByLabel("Es consignación").check();
  await expect(page.getByRole("combobox", { name: "Proveedor de consignación" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations, "alta en consignación").toEqual([]);

  // Producto de venta: sin insumo ni unidad de compra, con precio de venta.
  await page.getByLabel("Producto de venta (PV)").check();
  await expect(page.getByLabel("Precio de venta")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations, "alta de producto de venta").toEqual([]);
});

testAutenticado("catalogo/productos/[id]/editar: el formulario de edición sin violaciones de axe", async ({ paginaAutenticada: page }) => {
  const marca = Date.now();
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-A11Y-ED-${marca}`, nombre: `E2E A11y Editar ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  try {
    await page.goto(`/catalogo/productos/${producto.id}/editar`);
    await conTitulo(page, /Editar/);
    await expect(page.locator('input[name="nombre"]')).toHaveValue(producto.nombre);
    expect((await new AxeBuilder({ page }).analyze()).violations, "edición de materia prima").toEqual([]);
  } finally {
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  }
});

testAutenticado(
  "reportes/compras: la anulación de una compra (en reposo, con la confirmación abierta, con el rechazo por stock y ya anulada) sin violaciones de axe",
  async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
    // Dos compras de un proveedor propio: una con su stock intacto (se anula) y otra ya consumida (la anulación se rechaza). `proveedorId` acota la lista.
    const marca = Date.now();
    const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
    const proveedor = await prisma.proveedor.create({ data: { codigo: `PRV_A11Y_AN_${marca}`, nombre: `E2E A11y Proveedor Anular ${marca}` } });
    const productos: string[] = [];
    const operaciones: string[] = [];
    async function compra(sufijo: string, consumido: number) {
      const producto = await prisma.producto.create({ data: { codigo: `E2E-A11Y-AN-${sufijo}-${marca}`, nombre: `E2E A11y Anular ${sufijo} ${marca}`, tipo: "MP", unidadStockId: kg.id } });
      productos.push(producto.id);
      const op = await prisma.operacion.create({
        data: { sucursalId, proceso: "COMPRA", fecha: new Date("2026-08-10T12:00:00Z"), proveedorId: proveedor.id, nroFactura: `A11Y-${sufijo}-${marca}`, usuarioId: admin.id },
      });
      operaciones.push(op.id);
      await prisma.movimientoStock.create({ data: { operacionId: op.id, productoId: producto.id, seccionId, proceso: "COMPRA", cantidad: 10, detalle: "Compra", precioTotal: 100, precioPorUnidadStock: 10 } });
      if (consumido) {
        const consumo = await prisma.operacion.create({ data: { sucursalId, proceso: "CONSUMO", fecha: new Date("2026-08-11T12:00:00Z"), usuarioId: admin.id } });
        operaciones.push(consumo.id);
        await prisma.movimientoStock.create({ data: { operacionId: consumo.id, productoId: producto.id, seccionId, proceso: "CONSUMO", cantidad: -consumido, detalle: "Consumo", precioTotal: 0, precioPorUnidadStock: 0 } });
      }
      return op;
    }
    const intacta = await compra("intacta", 0);
    const consumida = await compra("consumida", 7);
    try {
      await page.goto(`/reportes/compras?proveedorId=${proveedor.id}`);
      await conTitulo(page, "Compras registradas");
      const tarjetaIntacta = page.locator(`[data-compra="${intacta.id}"]`);
      const tarjetaConsumida = page.locator(`[data-compra="${consumida.id}"]`);
      await tarjetaIntacta.locator("summary").click();
      await tarjetaConsumida.locator("summary").click();
      await expect(tarjetaIntacta.getByRole("button", { name: /^Anular compra/ })).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "detalles abiertos, en reposo").toEqual([]);

      // Confirmación abierta: acá viven el role="alert", el aria-describedby y los dos botones.
      await tarjetaIntacta.getByRole("button", { name: /^Anular compra/ }).click();
      await expect(tarjetaIntacta.getByRole("button", { name: "Sí, anular" })).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "confirmación abierta").toEqual([]);

      // Rechazo por stock consumido: el mensaje de error queda visible.
      await tarjetaConsumida.getByRole("button", { name: /^Anular compra/ }).click();
      await tarjetaConsumida.getByRole("button", { name: "Sí, anular" }).click();
      await expect(tarjetaConsumida.getByRole("alert").filter({ hasText: "No se puede anular" })).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "rechazo por stock consumido").toEqual([]);

      // Anulada: la fila marcada y el aviso de éxito.
      await tarjetaIntacta.getByRole("button", { name: "Sí, anular" }).click();
      await expect(tarjetaIntacta.getByRole("status").filter({ hasText: "Compra anulada" })).toBeVisible();
      await expect(tarjetaIntacta.getByText("Anulada", { exact: true })).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "compra anulada").toEqual([]);
    } finally {
      const reversiones = await prisma.operacion.findMany({ where: { OR: [{ detalleLibre: { contains: intacta.id } }, { detalleLibre: { contains: consumida.id } }] }, select: { id: true } });
      await prisma.movimientoStock.deleteMany({ where: { productoId: { in: productos } } });
      await prisma.operacion.deleteMany({ where: { id: { in: [...operaciones, ...reversiones.map((r) => r.id)] } } });
      await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "Operacion", entidadId: { in: [intacta.id, consumida.id] } } });
      await prisma.producto.deleteMany({ where: { id: { in: productos } } });
      await prisma.proveedor.deleteMany({ where: { id: proveedor.id } });
    }
  }
);

testAutenticado(
  "reportes/compras: la corrección de una compra (formulario abierto, con el rechazo por factura repetida y ya corregida) sin violaciones de axe",
  async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
    const marca = Date.now();
    const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
    const producto = await prisma.producto.create({ data: { codigo: `E2E-A11Y-CO-${marca}`, nombre: `E2E A11y Corregir ${marca}`, tipo: "MP", unidadStockId: kg.id } });
    const proveedor = await prisma.proveedor.create({ data: { codigo: `PRV_A11Y_CO_${marca}`, nombre: `E2E A11y Proveedor Corregir ${marca}` } });
    const operaciones: string[] = [];
    async function compra(nroFactura: string) {
      const op = await prisma.operacion.create({
        data: { sucursalId, proceso: "COMPRA", fecha: new Date("2026-08-10T12:00:00Z"), proveedorId: proveedor.id, nroFactura, usuarioId: admin.id },
      });
      operaciones.push(op.id);
      await prisma.movimientoStock.create({ data: { operacionId: op.id, productoId: producto.id, seccionId, proceso: "COMPRA", cantidad: 5, detalle: "Compra", precioTotal: 50, precioPorUnidadStock: 10 } });
      return op;
    }
    await compra(`A11Y-USADA-${marca}`);
    const aCorregir = await compra(`A11Y-MAL-${marca}`);
    try {
      await page.goto(`/reportes/compras?proveedorId=${proveedor.id}`);
      await conTitulo(page, "Compras registradas");
      const tarjeta = page.locator(`[data-compra="${aCorregir.id}"]`);
      await tarjeta.locator("summary").click();
      await tarjeta.getByRole("button", { name: /^Corregir proveedor y factura/ }).click();
      await expect(tarjeta.getByLabel("Proveedor", { exact: true })).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "formulario abierto").toEqual([]);

      // Rechazo por factura repetida: el aviso queda visible.
      await tarjeta.getByLabel("N.º de factura", { exact: true }).fill(`A11Y-USADA-${marca}`);
      await tarjeta.getByRole("button", { name: "Guardar corrección" }).click();
      await expect(tarjeta.getByRole("alert").filter({ hasText: "Ya hay una compra registrada con esa factura" })).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "rechazo por factura repetida").toEqual([]);

      // Corregida: el formulario se cierra y queda el aviso de éxito.
      await tarjeta.getByLabel("N.º de factura", { exact: true }).fill(`A11Y-BIEN-${marca}`);
      await tarjeta.getByRole("button", { name: "Guardar corrección" }).click();
      await expect(tarjeta.getByRole("status").filter({ hasText: "Compra corregida" })).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "compra corregida").toEqual([]);
    } finally {
      await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "Operacion", entidadId: { in: operaciones } } });
      await prisma.movimientoStock.deleteMany({ where: { productoId: producto.id } });
      await prisma.operacion.deleteMany({ where: { id: { in: operaciones } } });
      await prisma.producto.deleteMany({ where: { id: producto.id } });
      await prisma.proveedor.deleteMany({ where: { id: proveedor.id } });
    }
  }
);

testAutenticado(
  "reportes/rendimiento-recetas: la tabla en reposo (con rótulo, banda de ruido y motivoSinEstimacion), con la confirmación de «Usar este valor» abierta (colSpan 11) y con la fila ya calibrada, sin violaciones de axe",
  async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
    const marca = Date.now();
    const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
    const mp = await prisma.producto.create({ data: { codigo: `E2E-A11Y-RR-MP-${marca}`, nombre: `E2E A11y Salsa Rendimiento ${marca}`, tipo: "MP", unidadStockId: kg.id } });
    const pv = await prisma.producto.create({ data: { codigo: `E2E-A11Y-RR-PV-${marca}`, nombre: `E2E A11y Pizza Rendimiento ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
    // construirPools (P7) filtra whereDisponibleEn(sucursalId) — sin esto ninguno de los 4 productos de este test aparece en la tabla.
    await prisma.disponibilidadProducto.createMany({ data: [mp.id, pv.id].map((productoId) => ({ sucursalId, productoId, disponible: true })) });
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: kg.id }] } } });
    const hoy = new Date();
    const compra = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: hoy, usuarioId: admin.id } });
    await prisma.movimientoStock.create({ data: { operacionId: compra.id, productoId: mp.id, seccionId, proceso: "COMPRA", cantidad: 20, detalle: "Compra", precioTotal: 200, precioPorUnidadStock: 10 } });
    const venta = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: hoy, usuarioId: admin.id } });
    await prisma.movimientoStock.create({ data: { operacionId: venta.id, productoId: pv.id, seccionId, proceso: "VENTA", cantidad: -10, detalle: "Venta", precioTotal: 1000, precioPorUnidadStock: 100 } });

    // Segundo plato/insumo, SIN compra en la ventana — solo venta: cae en motivoSinEstimacion ("No hubo compras ni producción...") en vez de ocultarse (decisión 3, rotular/explicar, nunca ocultar).
    const mp2 = await prisma.producto.create({ data: { codigo: `E2E-A11Y-RR-MP2-${marca}`, nombre: `E2E A11y Queso Sin Compra ${marca}`, tipo: "MP", unidadStockId: kg.id } });
    const pv2 = await prisma.producto.create({ data: { codigo: `E2E-A11Y-RR-PV2-${marca}`, nombre: `E2E A11y Muzzarella Sin Compra ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
    await prisma.disponibilidadProducto.createMany({ data: [mp2.id, pv2.id].map((productoId) => ({ sucursalId, productoId, disponible: true })) });
    await prisma.recetaVersion.create({ data: { productoId: pv2.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp2.id, cantidad: 1, unidadId: kg.id }] } } });
    const venta2 = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: hoy, usuarioId: admin.id } });
    await prisma.movimientoStock.create({ data: { operacionId: venta2.id, productoId: pv2.id, seccionId, proceso: "VENTA", cantidad: -5, detalle: "Venta", precioTotal: 500, precioPorUnidadStock: 100 } });

    try {
      await page.goto("/reportes/rendimiento-recetas");
      await conTitulo(page, "Rendimiento real de recetas");
      const fila = page.getByRole("row", { name: new RegExp(pv.nombre) });
      const botonUsar = fila.getByRole("button", { name: `Usar este valor para ${pv.nombre} — ${mp.nombre}` });
      await expect(botonUsar).toBeVisible();
      // Rótulo declarado: mp/pv sin producción, 1:1 sin merma → "Producto de reventa" (decisión 4).
      await expect(fila.getByText("(Producto de reventa)")).toBeVisible();
      // Banda de ruido de lote: compra de 20 contra una receta 1:1 con 10 vendidos — mucho más de lo que la receta prevé, se explica como ruido de lote, texto en la misma celda del desvío.
      await expect(fila.getByText(/de ruido esperable por comprar de a lotes/)).toBeVisible();

      const filaSinCompra = page.getByRole("row", { name: new RegExp(pv2.nombre) });
      await expect(filaSinCompra.getByText("No hubo compras ni producción de este insumo en la ventana: no se puede estimar el consumo.")).toBeVisible();

      expect((await new AxeBuilder({ page }).analyze()).violations, "tabla en reposo").toEqual([]);

      await botonUsar.click();
      const filaConfirmacion = page.getByRole("alert").filter({ hasText: "¿Calibrar el rendimiento" }).locator("xpath=ancestor::tr");
      await expect(filaConfirmacion.locator("td")).toHaveAttribute("colspan", "11");
      expect((await new AxeBuilder({ page }).analyze()).violations, "confirmación abierta").toEqual([]);

      // Fila ya calibrada — el texto "(calibrado acá; central: X)" y el botón "Volver al valor central" nuevos, sin violaciones.
      await page.getByRole("button", { name: /Guardar como rendimiento de/ }).click();
      await expect(fila.getByText(/calibrado acá/)).toBeVisible();
      await expect(fila.getByRole("button", { name: "Volver al valor central" })).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "fila calibrada").toEqual([]);
    } finally {
      await prisma.rendimientoLocalIngrediente.deleteMany({ where: { recetaIngrediente: { insumoProductoId: mp.id } } });
      await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "RendimientoLocalIngrediente", entidadId: `${sucursalId}:${pv.id}:${mp.id}` } });
      await prisma.movimientoStock.deleteMany({ where: { productoId: { in: [mp.id, pv.id, mp2.id, pv2.id] } } });
      await prisma.operacion.deleteMany({ where: { id: { in: [compra.id, venta.id, venta2.id] } } });
      await prisma.recetaVersion.deleteMany({ where: { productoId: { in: [pv.id, pv2.id] } } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: [pv.id, mp.id, pv2.id, mp2.id] } } });
      await prisma.producto.deleteMany({ where: { id: { in: [pv.id, mp.id, pv2.id, mp2.id] } } });
    }
  }
);

testAutenticado(
  "reportes/rendimiento-recetas/por-sucursal: central + una sucursal calibrada + una sin calibrar, sin violaciones de axe",
  async ({ paginaAutenticada: page, sucursalId }) => {
    const marca = Date.now();
    const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
    const membresiaA = await prisma.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: admin.id, sucursalId } });
    const sucursalB = await prisma.sucursal.create({ data: { nombre: `E2E A11y Norte ${marca}` } });
    await crearMembresia({ usuarioId: admin.id, sucursalId: sucursalB.id, rolId: membresiaA.rolId, activo: true });

    const mp = await prisma.producto.create({ data: { codigo: `E2E-A11Y-PS-MP-${marca}`, nombre: `E2E A11y PS Salsa ${marca}`, tipo: "MP", unidadStockId: kg.id } });
    const pv = await prisma.producto.create({ data: { codigo: `E2E-A11Y-PS-PV-${marca}`, nombre: `E2E A11y PS Pizza ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
    const receta = await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: kg.id }] } },
      include: { ingredientes: true },
    });
    await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId: receta.ingredientes[0].id, sucursalId, cantidad: 2, mermaPorcentaje: null } });

    try {
      await page.goto("/reportes/rendimiento-recetas/por-sucursal");
      await conTitulo(page, "Rendimiento por sucursal");
      const fila = page.getByRole("row", { name: new RegExp(pv.nombre) });
      await expect(fila.getByText("(calibrado)")).toBeVisible();
      await expect(fila.getByText("(sin calibrar)")).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "por-sucursal").toEqual([]);
    } finally {
      await prisma.rendimientoLocalIngrediente.deleteMany({ where: { recetaIngredienteId: receta.ingredientes[0].id } });
      await prisma.usuarioSucursal.deleteMany({ where: { usuarioId: admin.id, sucursalId: sucursalB.id } });
      await prisma.recetaVersion.deleteMany({ where: { productoId: pv.id } });
      await prisma.producto.deleteMany({ where: { id: { in: [pv.id, mp.id] } } });
      await prisma.sucursal.delete({ where: { id: sucursalB.id } });
    }
  }
);

testAutenticado(
  "catalogo/recetas/[productoId]: la nota «Calibrado en N sucursal(es)» de un ingrediente calibrado, sin violaciones de axe",
  async ({ paginaAutenticada: page, sucursalId }) => {
    const marca = Date.now();
    const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
    const mp = await prisma.producto.create({ data: { codigo: `E2E-A11Y-ED-MP-${marca}`, nombre: `E2E A11y Editor Salsa ${marca}`, tipo: "MP", unidadStockId: kg.id } });
    const pv = await prisma.producto.create({ data: { codigo: `E2E-A11Y-ED-PV-${marca}`, nombre: `E2E A11y Editor Pizza ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
    const receta = await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: kg.id }] } },
      include: { ingredientes: true },
    });
    await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId: receta.ingredientes[0].id, sucursalId, cantidad: 2, mermaPorcentaje: null } });

    try {
      await page.goto(`/catalogo/recetas/${pv.id}`);
      await conTitulo(page, `${pv.nombre} — versión vigente: 1`);
      await expect(page.getByText(/Calibrado en 1 sucursal\(es\)/)).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "nota de calibración").toEqual([]);
    } finally {
      await prisma.rendimientoLocalIngrediente.deleteMany({ where: { recetaIngredienteId: receta.ingredientes[0].id } });
      await prisma.recetaVersion.deleteMany({ where: { productoId: pv.id } });
      await prisma.producto.deleteMany({ where: { id: { in: [pv.id, mp.id] } } });
    }
  }
);

testAutenticado(
  "reportes/periodo: el selector de rango, en su estado de solo lectura y con «Fechas personalizadas» (inputs de fecha visibles), sin violaciones de axe",
  async ({ paginaAutenticada: page }) => {
    // Solo lectura (default: "Últimos 30 días", sin inputs de fecha — ver SelectorRango).
    await page.goto("/reportes/periodo");
    await expect(page.getByRole("heading", { name: "Reporte por período" })).toBeVisible();
    await expect(page.getByText(/^Del \d{4}-\d{2}-\d{2} al \d{4}-\d{2}-\d{2}$/)).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations, "rango de solo lectura").toEqual([]);

    // "Fechas personalizadas": recién ahí aparecen los <input type="date">.
    await page.getByLabel("Rango").selectOption("personalizado");
    await page.getByRole("button", { name: "Actualizar" }).click();
    await expect(page.getByLabel("Desde", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Hasta", { exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations, "fechas personalizadas").toEqual([]);
  }
);

testAutenticado(
  "reportes/periodo y reportes: la tarjeta de margen (§2), plegada y desplegada, sin violaciones de axe",
  async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
    const marca = Date.now();
    const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
    const mp = await prisma.producto.create({ data: { codigo: `E2E-A11Y-MRG-MP-${marca}`, nombre: `E2E A11y Margen MP ${marca}`, tipo: "MP", unidadStockId: kg.id } });
    const pv = await prisma.producto.create({ data: { codigo: `E2E-A11Y-MRG-PV-${marca}`, nombre: `E2E A11y Margen PV ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: kg.id }] } } });
    const hoy = new Date();
    const compra = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: hoy, usuarioId: admin.id } });
    await prisma.movimientoStock.create({ data: { operacionId: compra.id, productoId: mp.id, seccionId, proceso: "COMPRA", cantidad: 10, detalle: "Compra", precioTotal: 50, precioPorUnidadStock: 5 } });
    const venta = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: hoy, usuarioId: admin.id } });
    await prisma.movimientoStock.create({
      data: { operacionId: venta.id, productoId: pv.id, seccionId, proceso: "VENTA", cantidad: -1, detalle: "Venta", precioTotal: 100, precioPorUnidadStock: 100, costoUnitarioVenta: 5 },
    });
    try {
      for (const ruta of ["/reportes/periodo", "/reportes"]) {
        await page.goto(ruta);
        await expect(page.getByText("Ganancia de lo vendido")).toBeVisible();
        expect((await new AxeBuilder({ page }).analyze()).violations, `${ruta}: plegada`).toEqual([]);

        const detalle = page.locator("details").filter({ hasText: "Otras formas de ver el margen" });
        await detalle.locator("summary").click();
        await expect(detalle.getByText("Si repusieras hoy")).toBeVisible();
        expect((await new AxeBuilder({ page }).analyze()).violations, `${ruta}: desplegada`).toEqual([]);
      }
    } finally {
      await prisma.movimientoStock.deleteMany({ where: { productoId: { in: [mp.id, pv.id] } } });
      await prisma.operacion.deleteMany({ where: { id: { in: [compra.id, venta.id] } } });
      await prisma.recetaVersion.deleteMany({ where: { productoId: pv.id } });
      await prisma.producto.deleteMany({ where: { id: { in: [pv.id, mp.id] } } });
    }
  }
);

testAutenticado(
  "reportes/historial: el cartel 'Producto de reventa' de un PV sin stock propio, 'Cómo se compró' de una MP, y el Kardex plegado/desplegado con el filtro 'Qué mostrar', sin violaciones de axe",
  async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
    // §4 (docs/plan-historial-producto-mp-pv-2026-09-22.md, paso 11): ninguna pantalla cubierta hasta ahora ejercita el
    // <details>/<summary> del Kardex, el <select> "Qué mostrar", ni el cartel de un PV sin stock propio.
    const marca = Date.now();
    const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
    const mp = await prisma.producto.create({ data: { codigo: `E2E-A11Y-HIST-MP-${marca}`, nombre: `E2E A11y Historial MP ${marca}`, tipo: "MP", unidadStockId: kg.id } });
    const pv = await prisma.producto.create({ data: { codigo: `E2E-A11Y-HIST-PV-${marca}`, nombre: `E2E A11y Historial PV ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: kg.id }] } } });
    const operaciones: string[] = [];
    const compra1 = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date(Date.now() - 2 * 86_400_000), usuarioId: admin.id } });
    operaciones.push(compra1.id);
    await prisma.movimientoStock.create({ data: { operacionId: compra1.id, productoId: mp.id, seccionId, proceso: "COMPRA", cantidad: 10, detalle: "Compra", precioTotal: 100, precioPorUnidadStock: 10 } });
    const compra2 = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date(Date.now() - 1 * 86_400_000), usuarioId: admin.id } });
    operaciones.push(compra2.id);
    await prisma.movimientoStock.create({ data: { operacionId: compra2.id, productoId: mp.id, seccionId, proceso: "COMPRA", cantidad: 10, detalle: "Compra", precioTotal: 120, precioPorUnidadStock: 12 } });
    const venta = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: new Date(Date.now() - 1 * 86_400_000), usuarioId: admin.id } });
    operaciones.push(venta.id);
    await prisma.movimientoStock.create({
      data: { operacionId: venta.id, productoId: pv.id, seccionId, proceso: "VENTA", cantidad: -2, detalle: `Venta de "${pv.nombre}"`, precioTotal: 200, precioPorUnidadStock: 100 },
    });

    try {
      // PV sin stock propio: el cartel "Producto de reventa" + "Cómo se vendió".
      await page.goto(`/reportes/historial?productoId=${pv.id}`);
      await expect(page.getByText("Producto de reventa: no lleva stock propio.")).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "PV sin stock propio").toEqual([]);

      // MP con compras: "Cómo se compró" + el Kardex plegado (cerrado, el estado por defecto).
      await page.goto(`/reportes/historial?productoId=${mp.id}`);
      await expect(page.getByRole("heading", { name: "Cómo se compró" })).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "MP con compras, Kardex plegado").toEqual([]);

      // El Kardex desplegado.
      const kardex = page.locator("details").filter({ hasText: "Movimiento por movimiento" });
      await kardex.locator("summary").click();
      await expect(kardex.getByRole("table")).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "Kardex desplegado").toEqual([]);

      // El filtro "Qué mostrar" cambiado a "Solo compras".
      await page.getByLabel("Qué mostrar").selectOption("compras");
      await page.getByRole("button", { name: "Ver historial" }).click();
      await expect(kardex.getByRole("row", { name: /VENTA|CONSUMO/ })).toHaveCount(0);
      expect((await new AxeBuilder({ page }).analyze()).violations, "filtro 'Solo compras'").toEqual([]);
    } finally {
      await prisma.movimientoStock.deleteMany({ where: { productoId: { in: [mp.id, pv.id] } } });
      await prisma.operacion.deleteMany({ where: { id: { in: operaciones } } });
      await prisma.recetaVersion.deleteMany({ where: { productoId: pv.id } });
      await prisma.producto.deleteMany({ where: { id: { in: [pv.id, mp.id] } } });
    }
  }
);

base(
  "el selector de sucursal (solo se dibuja con 2+ sucursales — con una sola queda como texto fijo) no tiene violaciones de axe",
  async ({ browser, baseURL }) => {
    // Encontrado corriendo el proyecto Playwright de la demo (§5, docs/planes-demo-y-claridad-reportes-2026-09-21.md, tramo
    // 5): ningún spec de este archivo había ejercitado nunca un usuario con 2+ sucursales — `paginaAutenticada` siempre da
    // una sola, así que `<SelectorSucursal>` (app-shell.tsx: solo se dibuja con `membresias.length > 1`) nunca se había
    // auditado. Sin `aria-label`, un `<select>` con más de una opción no tiene nombre accesible (WCAG 4.1.2).
    const marca = Date.now();
    const central = await prisma.sucursal.findFirstOrThrow({ where: { nombre: "Central" } });
    const segunda = await prisma.sucursal.create({ data: { nombre: `E2E A11y Sucursal Dos ${marca}` } });
    const rol = await prisma.rol.findFirstOrThrow({ where: { nombre: "admin" } });
    const usuario = await prisma.user.create({ data: { email: `e2e-a11y-selector-sucursal-${marca}@local.test`, activoGlobal: true } });
    await crearMembresias([
        { usuarioId: usuario.id, sucursalId: central.id, rolId: rol.id, activo: true },
        { usuarioId: usuario.id, sucursalId: segunda.id, rolId: rol.id, activo: true },
      ]);
    const sessionToken = randomUUID();
    await prisma.session.create({ data: { sessionToken, userId: usuario.id, expires: new Date(Date.now() + 1000 * 60 * 60) } });

    const contexto = await browser.newContext();
    await contexto.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: new URL(baseURL ?? "http://localhost:3000").hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
    const page = await contexto.newPage();
    try {
      await page.goto("/inicio");
      const selector = page.getByLabel("Sucursal activa");
      await expect(selector).toBeVisible();
      await expect(selector).toHaveValue(central.id);
      const resultados = await new AxeBuilder({ page }).analyze();
      expect(resultados.violations).toEqual([]);
    } finally {
      await contexto.close();
    }
  }
);

testAutenticado(
  "administracion/sucursales (con 2+ filas) y administracion/usuarios: sin violaciones de axe — ninguna de las dos pantallas tenía chequeo hasta ahora",
  async ({ paginaAutenticada: page }) => {
    // Encontrado corriendo el proyecto Playwright de la demo (§5, docs/planes-demo-y-claridad-reportes-2026-09-21.md, tramo
    // 5): el input de renombrar (una fila por sucursal) no tenía nombre accesible, y el <select> de rol en "Agregar/
    // actualizar usuario" tampoco — ninguno de los dos requiere 2+ sucursales para fallar (el de sucursales SÍ necesita al
    // menos una fila para tener algo que auditar; con la sucursal "Central" del seed base alcanza).
    const marca = Date.now();
    await prisma.sucursal.create({ data: { nombre: `E2E A11y Sucursal ${marca}` } });
    try {
      await page.goto("/administracion/sucursales");
      await expect(page.getByRole("heading", { name: "Sucursales" })).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "administracion/sucursales").toEqual([]);

      await page.goto("/administracion/usuarios");
      await expect(page.getByLabel("Rol")).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "administracion/usuarios").toEqual([]);
    } finally {
      await prisma.sucursal.deleteMany({ where: { nombre: `E2E A11y Sucursal ${marca}` } });
    }
  }
);

testAutenticado(
  "reportes/ventas-por-seccion: sin violaciones de axe, contraste incluido (con una sección con ventas y un producto sin sección en ámbar)",
  async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
    // docs/plan-carta-catalogo-2026-09-24.md, M7 (a nivel de producto desde docs/plan-carta-seccion-directa-2026-09-25.md, M5). Dos ventas: una
    // de un producto que se ve en una sección de carta (tabla) y otra de uno sin contenido de carta (aviso en ámbar): sin las dos, la pantalla
    // no dibuja todo lo que se quiere auditar.
    const marca = `${Date.now()}`;
    const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
    const conSeccion = await prisma.categoriaProducto.create({ data: { nombre: `E2E A11y Cat Carta ${marca}` } });
    const sinSeccion = await prisma.categoriaProducto.create({ data: { nombre: `E2E A11y Cat Suelta ${marca}` } });
    const seccionCarta = await prisma.seccionCarta.create({ data: { nombre: `E2E A11y Sección Carta ${marca}`, orden: 1 } });
    const pvs = await Promise.all(
      [conSeccion, sinSeccion].map((c, i) =>
        prisma.producto.create({ data: { codigo: `E2E-A11Y-SEC-${i}-${marca}`, nombre: `E2E A11y Plato ${i} ${marca}`, tipo: "PV", categoriaId: c.id, unidadStockId: unidad.id, precioVenta: 100 } })
      )
    );
    // El primero se ve en la sección de carta; el segundo no tiene contenido de carta → "Sin sección" y el aviso ámbar.
    await prisma.contenidoCartaProducto.create({ data: { productoId: pvs[0].id, visibleEnCarta: true, seccionCartaId: seccionCarta.id } });
    const op = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: new Date("2026-08-04T12:00:00Z"), usuarioId: admin.id } });
    for (const pv of pvs) {
      await prisma.movimientoStock.create({
        data: { operacionId: op.id, productoId: pv.id, seccionId, proceso: "VENTA", cantidad: -1, detalle: "Venta", precioTotal: 100, precioPorUnidadStock: 100 },
      });
    }
    try {
      await page.goto("/reportes/ventas-por-seccion?desde=2026-08-01&hasta=2026-08-10");
      await expect(page.getByRole("heading", { name: "Ventas por sección de carta" })).toBeVisible();
      await expect(page.getByRole("heading", { name: new RegExp(`E2E A11y Sección Carta ${marca}`) })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Productos con ventas que no se ven en ninguna sección de carta" })).toBeVisible();
      await expect(page.getByRole("listitem").filter({ hasText: pvs[1].nombre }), "el producto sin sección tiene que aparecer en el aviso").toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    } finally {
      await prisma.movimientoStock.deleteMany({ where: { operacionId: op.id } });
      await prisma.operacion.deleteMany({ where: { id: op.id } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: { in: pvs.map((p) => p.id) } } });
      await prisma.seccionCarta.deleteMany({ where: { id: seccionCarta.id } });
      await prisma.producto.deleteMany({ where: { id: { in: pvs.map((p) => p.id) } } });
      await prisma.categoriaProducto.deleteMany({ where: { id: { in: [conSeccion.id, sinSeccion.id] } } });
    }
  }
);

testAutenticado("carta: sin violaciones de axe, con formularios abiertos y el aviso en ámbar de PV sin contenido", async ({ paginaAutenticada: page, sucursalId }) => {
  // docs/plan-carta-catalogo-2026-09-24.md, M10. Con datos en los tres bloques (sección, un PV con contenido en esa sección y otro sin él
  // —dibuja el aviso ámbar— y una promo), y con un formulario de cada tipo desplegado: cerrado, un <details> no expone sus campos (entre
  // ellos el select "Sección de carta" del contenido, docs/plan-carta-seccion-directa-2026-09-25.md).
  const marca = `${Date.now()}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const categoria = await prisma.categoriaProducto.create({ data: { nombre: `E2E A11y Carta Cat ${marca}` } });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E A11y Carta Sección ${marca}`, titulo: "Del fuego", orden: 1 } });
  const [conContenido, sinContenido] = await Promise.all(
    ["Con", "Sin"].map((q) =>
      prisma.producto.create({ data: { codigo: `E2E-A11Y-CARTA-${q}-${marca}`, nombre: `E2E A11y Carta ${q} ${marca}`, tipo: "PV", categoriaId: categoria.id, unidadStockId: unidad.id, precioVenta: 100 } })
    )
  );
  await prisma.disponibilidadProducto.createMany({ data: [conContenido, sinContenido].map((p) => ({ sucursalId, productoId: p.id, disponible: true })) });
  await prisma.contenidoCartaProducto.create({ data: { productoId: conContenido.id, visibleEnCarta: true, seccionCartaId: seccion.id, tags: ["Regional"], especial: true } });
  const promo = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId } }, seccionCartaId: seccion.id, titulo: `E2E A11y Promo ${marca}`, precio: 1000 } });
  try {
    await page.goto("/carta");
    await expect(page.getByRole("heading", { name: "Carta pública", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: /PV disponibles acá sin contenido de carta/ })).toBeVisible();
    await page.locator(`[data-seccion-carta="${seccion.nombre}"] summary`).click();
    await page.locator(`[data-contenido-carta="${conContenido.nombre}"] summary`).click();
    await page.locator(`[data-promo-carta="${promo.titulo}"] summary`).click();
    await expect(page.locator(`[data-contenido-carta="${conContenido.nombre}"]`).getByLabel("Especial (★)")).toBeChecked();
    await expect(page.locator(`[data-contenido-carta="${conContenido.nombre}"]`).getByLabel(/^Sección de carta/)).toHaveValue(seccion.id);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    await prisma.promoCartaSucursal.deleteMany({ where: { promoCarta: { id: promo.id } } });
    await prisma.promoCarta.deleteMany({ where: { id: promo.id } });
    await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: { in: [conContenido.id, sinContenido.id] } } });
    await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: [conContenido.id, sinContenido.id] } } });
    await prisma.producto.deleteMany({ where: { id: { in: [conContenido.id, sinContenido.id] } } });
    await prisma.categoriaProducto.deleteMany({ where: { id: categoria.id } });
  }
});

testAutenticado("carta/agrupados: sin violaciones de axe, con un ítem abierto, el aviso ámbar de precios distintos y los selects", async ({ paginaAutenticada: page, sucursalId }) => {
  // docs/plan-agrupacion-items-carta-2026-09-24.md, M7. Un ítem agrupado con dos opciones de distinto precio (el drift posterior de D5,
  // sembrado directo: la acción de agregar lo bloquearía) dibuja el aviso ámbar; se abre su <details> para exponer el formulario del ítem,
  // las opciones (orden y quitar) y el select "Agregar producto" (hay un PV suelto disponible para listar).
  const marca = `${Date.now()}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const categoria = await prisma.categoriaProducto.create({ data: { nombre: `E2E A11y Agrupado Cat ${marca}` } });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E A11y Agrupado Sección ${marca}` } });
  const productos = await Promise.all(
    [
      ["Coca", 5000],
      ["Sprite", 5500],
      ["Suelta", 5000],
    ].map(([q, precioVenta]) =>
      prisma.producto.create({
        data: { codigo: `E2E-A11Y-AGR-${q}-${marca}`, nombre: `E2E A11y Agrupado ${q} ${marca}`, tipo: "PV", categoriaId: categoria.id, unidadStockId: unidad.id, precioVenta: Number(precioVenta) },
      })
    )
  );
  const ids = productos.map((p) => p.id);
  await prisma.disponibilidadProducto.createMany({ data: ids.map((productoId) => ({ sucursalId, productoId, disponible: true })) });
  const item = await prisma.itemAgrupadoCarta.create({ data: { nombre: `E2E A11y Gaseosa ${marca}`, seccionCartaId: seccion.id, especial: true, tags: ["Sin alcohol"] } });
  await prisma.opcionItemAgrupadoCarta.createMany({ data: ids.slice(0, 2).map((productoId, orden) => ({ itemAgrupadoCartaId: item.id, productoId, orden })) });
  try {
    await page.goto("/carta/agrupados");
    await expect(page.getByRole("heading", { name: "Ítems agrupados de la carta", level: 1 })).toBeVisible();
    const fila = page.locator(`[data-item-agrupado="${item.nombre}"]`);
    await expect(fila.getByText(/no cuestan lo mismo/)).toBeVisible();
    await fila.locator("summary").click();
    await expect(fila.getByLabel(`Agregar producto a «${item.nombre}»`)).toBeVisible();
    await expect(fila.getByLabel(/^Sección de carta/)).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    await prisma.opcionItemAgrupadoCarta.deleteMany({ where: { itemAgrupadoCartaId: item.id } });
    await prisma.itemAgrupadoCarta.deleteMany({ where: { id: item.id } });
    await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: ids } } });
    await prisma.producto.deleteMany({ where: { id: { in: ids } } });
    await prisma.categoriaProducto.deleteMany({ where: { id: categoria.id } });
  }
});

testAutenticado("carta/portal: sin violaciones de axe, con una sucursal sin agregar y el formulario de otra abierto", async ({ paginaAutenticada: page }) => {
  // docs/plan-registro-tenants-2026-09-24.md, M7. Una sucursal fuera del portal (botón «Agregar») y otra dentro, publicada y con posición, con su
  // <details> desplegado: cerrado, un <details> no expone sus campos (los dos fieldset, los checkbox y el botón de quitar).
  const marca = `${Date.now()}`;
  const [fuera, dentro] = await Promise.all(["Fuera", "Dentro"].map((q) => prisma.sucursal.create({ data: { nombre: `E2E A11y Portal ${q} ${marca}` } })));
  await prisma.sucursalPublica.create({
    data: { sucursalId: dentro.id, slug: `e2e-a11y-portal-${marca}`, publicada: true, posX: 10, posY: 20, posW: 5, subtituloPortal: "Frente al lago" },
  });
  try {
    await page.goto("/carta/portal");
    await expect(page.getByRole("heading", { name: "Portal de sucursales", level: 1 })).toBeVisible();
    await expect(page.locator(`[data-sucursal-portal="${fuera.nombre}"]`).getByRole("button", { name: /^Agregar/ })).toBeVisible();
    await page.locator(`[data-sucursal-portal="${dentro.nombre}"] summary`).click();
    await expect(page.locator(`[data-sucursal-portal="${dentro.nombre}"]`).getByLabel("Publicada en el portal")).toBeChecked();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId: { in: [fuera.id, dentro.id] } } });
    await prisma.sucursal.deleteMany({ where: { id: { in: [fuera.id, dentro.id] } } });
  }
});

testAutenticado("carta/tema: sin violaciones de axe, con zonas del editor abiertas (color, select, número) y un campo inválido", async ({ paginaAutenticada: page, sucursalId }) => {
  // docs/plan-tema-carta-2026-09-24.md, M9. Un tema con valores (uno inválido, cargado a mano: dibuja el aviso rojo del campo) y tres <details>
  // desplegados además del primero: "Colores generales" (selectores de color con su etiqueta propia), "Banda e imagen de sección" (los
  // <select> y los <input type="number">) e "Ítems" (el campo inválido). Cerrado, un <details> no expone sus campos.
  //
  // Se EXCLUYE [data-vista-previa-tema]: la vista previa dibuja la carta con sus propios colores, y con los defaults de la carta (ámbar
  // oklch(0.76 0.14 80) sobre casi blanco) no cumple color-contrast. Es un problema conocido de la carta pública (restaurant-menu-design), fuera
  // de este plan: acá solo se simula, y lo que se audita es el editor de motor2.
  await prisma.temaCartaSucursal.deleteMany({ where: { sucursalId } });
  await prisma.temaCartaSucursal.create({ data: { sucursalId, valores: { color_marca: "#8b4513", hero_ink: "claro", carta_imagen_pos_x: "center", carta_imagen_opacidad: "60", color_item_precio: "red;x" } } });
  try {
    await page.goto("/carta/tema");
    await expect(page.getByRole("heading", { name: "Tema de la carta", level: 1 })).toBeVisible();
    for (const zona of ["Colores generales", "Banda e imagen de sección", "Ítems"]) await page.locator(`[data-zona-tema="${zona}"] summary`).click();
    await expect(page.locator('select[name="carta_imagen_pos_x"]')).toBeVisible();
    await expect(page.locator('[data-campo-tema="color_item_precio"]')).toContainText("No es válido");
    expect((await new AxeBuilder({ page }).exclude("[data-vista-previa-tema]").analyze()).violations).toEqual([]);
  } finally {
    await prisma.temaCartaSucursal.deleteMany({ where: { sucursalId } });
  }
});

testAutenticado("carta-publica (ADR-006): portal y carta de una sucursal, sin violaciones de axe (confirma el arreglo de contraste del tema por defecto)", async ({ page, sucursalId }) => {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const slug = `e2e-a11y-carta-${marca}`;
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E A11y Sección ${marca}` } });
  await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId } }, seccionCartaId: seccion.id, titulo: `E2E A11y Promo ${marca}`, precio: 1000 } });
  await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true } });
  try {
    await page.goto("/carta-publica/e2e");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await page.goto(`/carta-publica/e2e/${slug}`);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    await prisma.promoCartaSucursal.deleteMany({ where: { promoCarta: { seccionCartaId: seccion.id } } });
    await prisma.promoCarta.deleteMany({ where: { seccionCartaId: seccion.id } });
    await prisma.seccionCarta.delete({ where: { id: seccion.id } });
  }
});

testAutenticado("carta-publica (ADR-006): portal en modo mapa (a 360px, con una tarjeta fuera del mapa) y su editor con la vista previa, sin violaciones de axe", async ({ paginaAutenticada: page, sucursalId }) => {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const imagen = "https://cdn.example.com/e2e-a11y-mapa.svg";
  await page.route(imagen, (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1533"><rect width="100%" height="100%" fill="#dfe8df"/></svg>' }));
  const otra = await prisma.sucursal.create({ data: { nombre: `E2E A11y Mapa Otra ${marca}` } });
  await prisma.portalCartaEmpresa.deleteMany();
  await prisma.portalCartaEmpresa.create({ data: { valores: { portal_bg_image_url: imagen, portal_titulo: `Sucursales ${marca}`, portal_etiqueta: "Nuestras casas", portal_bg_overlay: "0.2" } } });
  await prisma.sucursalPublica.createMany({
    data: [
      { sucursalId, slug: `e2e-a11y-mapa-a-${marca}`, publicada: true, etiqueta: `A11y Mapa ${marca}`, subtituloPortal: "Frente al lago", posX: 30, posY: 30, posW: 40, posH: 8 },
      { sucursalId: otra.id, slug: `e2e-a11y-mapa-b-${marca}`, publicada: true, etiqueta: `A11y Grilla ${marca}`, subtituloPortal: "Sin posición" },
    ],
  });
  try {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/carta-publica/e2e");
    await expect(page.locator(".portal-mapa")).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/carta/portal");
    await expect(page.locator("[data-modo-portal]")).toHaveAttribute("data-modo-portal", "mapa");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    await prisma.portalCartaEmpresa.deleteMany();
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId: { in: [sucursalId, otra.id] } } });
    await prisma.sucursal.deleteMany({ where: { id: otra.id } });
  }
});

testAutenticado(
  "pos/mesas: el mapa con los tres estados, con el diálogo de «Nueva mesa» abierto y con el sistema en modo oscuro, sin violaciones de axe (confirma los contrastes aprobados)",
  async ({ paginaAutenticada: page, sucursalId }) => {
    // Plan docs/plan-mapa-de-mesas-2026-09-24.md §A.3: --ink-faint #76726A («MESA», rótulos de métricas, nota al pie), la etiqueta «Libre» en
    // --mesa-libre-ink y «En pedido» en --mesa-draft-ink. Hacen falta las tres tarjetas: sin una mesa en pedido no se dibuja la etiqueta ámbar,
    // y sin datos no hay nada que auditar. Desde «tomar pedido» «Tomar pedido»/«Continuar pedido»/«Facturar» son enlaces HABILITADOS: axe ya
    // mide su contraste (antes los ignoraba por deshabilitados).
    const marca = Date.now();
    const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
    const producto = await prisma.producto.create({ data: { codigo: `E2E-A11Y-POS-${marca}`, nombre: `E2E A11y Plato Salón ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 1000 } });
    const mesas = await Promise.all([801, 802, 803].map((numero) => prisma.mesa.create({ data: { sucursalId, numero } })));
    await prisma.cuenta.create({ data: { mesaId: mesas[1].id, abiertaPorId: admin.id, items: { create: [{ productoId: producto.id, cantidad: 2, precioUnitario: 1000 }] } } });
    await prisma.cuenta.create({ data: { mesaId: mesas[2].id, abiertaPorId: admin.id, items: { create: [{ productoId: producto.id, cantidad: 1, precioUnitario: 1000, numeroEnvio: 1 }] } } });
    try {
      await page.goto("/mesas");
      await conTitulo(page, "Mapa de mesas");
      await expect(page.locator('li[data-mesa="801"]').getByText("Libre", { exact: true })).toBeVisible();
      await expect(page.locator('li[data-mesa="802"]').getByText("En pedido", { exact: true })).toBeVisible();
      await expect(page.locator('li[data-mesa="803"]').getByRole("link", { name: "Facturar" })).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "mapa en reposo").toEqual([]);

      await page.getByRole("button", { name: "Nueva mesa" }).click();
      await expect(page.getByRole("dialog", { name: "Nueva mesa" })).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "diálogo de «Nueva mesa» abierto").toEqual([]);

      // El salón no tiene modo oscuro: con el sistema en oscuro tiene que seguir claro y legible (tokens en .pos-shell, no en :root).
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto("/mesas");
      await conTitulo(page, "Mapa de mesas");
      expect((await new AxeBuilder({ page }).analyze()).violations, "modo oscuro emulado").toEqual([]);
    } finally {
      const mesaIds = mesas.map((m) => m.id);
      await prisma.cuentaItem.deleteMany({ where: { cuenta: { mesaId: { in: mesaIds } } } });
      await prisma.cuenta.deleteMany({ where: { mesaId: { in: mesaIds } } });
      await prisma.mesa.deleteMany({ where: { id: { in: mesaIds } } });
      await prisma.producto.deleteMany({ where: { id: producto.id } });
    }
  }
);

testAutenticado(
  "pos/mesas/[mesaId]: la pantalla de la mesa en reposo (sin enviar, dos envíos y una anulación), con «Anular» abierto y su error, con «Cerrar cuenta» abierto y en modo oscuro, sin violaciones de axe",
  async ({ paginaAutenticada: page, sucursalId }) => {
    // Pendiente «tomar pedido» (docs/plan-tomar-pedido-2026-09-25.md, paso 9). Hacen falta todos los estados de la lista para que axe audite algo:
    // un ítem sin enviar (con «Quitar»), dos envíos a cocina y una anulación tachada (texto en --ink-soft con line-through).
    const marca = Date.now();
    const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
    const producto = await prisma.producto.create({ data: { codigo: `E2E-A11Y-TP-${marca}`, nombre: `E2E A11y Plato ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 1000 } });
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 804 } });
    const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: admin.id } });
    const original = await prisma.cuentaItem.create({ data: { cuentaId: cuenta.id, productoId: producto.id, cantidad: 3, precioUnitario: 1000, numeroEnvio: 1, creadoPorId: admin.id } });
    await prisma.cuentaItem.create({ data: { cuentaId: cuenta.id, productoId: producto.id, cantidad: 1, precioUnitario: 1000, numeroEnvio: 2, creadoPorId: admin.id } });
    await prisma.cuentaItem.create({ data: { cuentaId: cuenta.id, productoId: producto.id, cantidad: 2, precioUnitario: 1000, creadoPorId: admin.id } });
    await prisma.cuentaItem.create({
      data: { cuentaId: cuenta.id, productoId: producto.id, cantidad: -1, precioUnitario: 1000, numeroEnvio: 1, anulaAItemId: original.id, motivoAnulacion: "Pidió una menos", creadoPorId: admin.id },
    });
    try {
      // «Enviar a cocina» imprime la comanda: sin reemplazar `window.print()` se abriría el diálogo nativo.
      await interceptarImpresion(page);
      await page.goto(`/mesas/${mesa.id}`);
      await conTitulo(page, "Mesa 804");
      await expect(page.getByRole("heading", { name: "Envío 2 · en cocina" })).toBeVisible();
      await expect(page.locator("[data-anulacion]")).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "pantalla en reposo").toEqual([]);

      await page.getByRole("button", { name: `Anular ${producto.nombre}` }).first().click();
      const anular = page.getByRole("dialog", { name: `Anular «${producto.nombre}»` });
      await anular.getByRole("button", { name: "Anular" }).click();
      await expect(anular.getByRole("alert")).toHaveText("Escribí el motivo de la anulación.");
      expect((await new AxeBuilder({ page }).analyze()).violations, "«Anular» abierto con el error del motivo").toEqual([]);
      await anular.getByRole("button", { name: "Cancelar" }).click();

      // Con un ítem sin enviar «Cerrar cuenta» está deshabilitado (y lo explica): se envía para poder abrir el diálogo.
      await expect(page.getByText("Hay 1 ítem sin enviar: envialo o quitalo antes de cerrar la cuenta.")).toBeVisible();
      await page.getByRole("button", { name: "Enviar a cocina" }).click();
      await expect(page.getByRole("heading", { name: "Envío 3 · en cocina" })).toBeVisible();
      // El documento impreso queda montado pero nunca se ve en pantalla (fuera del árbol de accesibilidad: sin caso axe propio).
      await expect.poll(async () => (await impresiones(page)).length).toBe(1);
      await expect(page.locator("[data-imprimible]")).toBeHidden();
      await page.getByRole("button", { name: "Cerrar cuenta" }).click();
      await expect(page.getByRole("dialog", { name: "Cerrar cuenta · Mesa 804" })).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "«Cerrar cuenta» abierto").toEqual([]);

      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(`/mesas/${mesa.id}`);
      await conTitulo(page, "Mesa 804");
      expect((await new AxeBuilder({ page }).analyze()).violations, "modo oscuro emulado").toEqual([]);
    } finally {
      await prisma.cuentaItem.deleteMany({ where: { cuentaId: cuenta.id, anulaAItemId: { not: null } } });
      await prisma.cuentaItem.deleteMany({ where: { cuentaId: cuenta.id } });
      await prisma.cuenta.deleteMany({ where: { id: cuenta.id } });
      await prisma.mesa.deleteMany({ where: { id: mesa.id } });
      await prisma.producto.deleteMany({ where: { id: producto.id } });
    }
  }
);

testAutenticado(
  "pos/mesas/[mesaId]: mesa libre con «Cuentas cerradas» (una boleta reimprimible y una de venta anulada), en modo claro y oscuro, sin violaciones de axe",
  async ({ paginaAutenticada: page, sucursalId }) => {
    // docs/plan-imprimir-comanda-y-boleta-2026-09-25.md, B10: la sección nueva con sus dos estados de fila (botón habilitado; «Venta anulada»
    // con el botón deshabilitado). Los documentos impresos no llevan caso propio: en pantalla son display:none.
    const marca = Date.now();
    const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
    const producto = await prisma.producto.create({ data: { codigo: `E2E-A11Y-BOL-${marca}`, nombre: `E2E A11y Plato Boleta ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 1000 } });
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 975 } });
    const operacionIds: string[] = [];
    for (const [horasAtras, anulada] of [[1, false], [2, true]] as const) {
      const cerradaEn = new Date(Date.now() - horasAtras * 60 * 60_000);
      const venta = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: cerradaEn, usuarioId: admin.id, anuladaEn: anulada ? new Date() : null } });
      operacionIds.push(venta.id);
      await prisma.cuenta.create({
        data: {
          mesaId: mesa.id,
          abiertaPorId: admin.id,
          cerradaEn,
          cerradaPorId: admin.id,
          items: { create: [{ productoId: producto.id, cantidad: 2, precioUnitario: 1000, numeroEnvio: 1, creadoPorId: admin.id, operacionId: venta.id }] },
        },
      });
    }
    try {
      await page.goto(`/mesas/${mesa.id}`);
      await conTitulo(page, "Mesa 975");
      await expect(page.getByText("La mesa está libre.")).toBeVisible();
      await expect(page.locator("[data-cuenta-cerrada]")).toHaveCount(2);
      await expect(page.getByText("Venta anulada")).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "«Cuentas cerradas» en modo claro").toEqual([]);

      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(`/mesas/${mesa.id}`);
      await conTitulo(page, "Mesa 975");
      await expect(page.locator("[data-cuenta-cerrada]")).toHaveCount(2);
      expect((await new AxeBuilder({ page }).analyze()).violations, "«Cuentas cerradas» en modo oscuro emulado").toEqual([]);
    } finally {
      // Mismo orden que `limpiar` de pos-tomar-pedido.spec.ts: ítems → operaciones (y lo que cuelga de ellas) → cuentas → mesa → producto.
      await prisma.cuentaItem.deleteMany({ where: { cuenta: { mesaId: mesa.id } } });
      await prismaAdmin.registroAuditoria.deleteMany({ where: { entidadId: { in: operacionIds } } });
      await prisma.movimientoStock.deleteMany({ where: { operacionId: { in: operacionIds } } });
      await prisma.operacion.deleteMany({ where: { id: { in: operacionIds } } });
      await prisma.cuenta.deleteMany({ where: { mesaId: mesa.id } });
      await prisma.mesa.deleteMany({ where: { id: mesa.id } });
      await prisma.producto.deleteMany({ where: { id: producto.id } });
    }
  }
);

testAutenticado(
  "pos/mesas/[mesaId]: «Agregar al pedido» por sección de carta en reposo, con un ítem agrupado desplegado, con una opción elegida y en modo oscuro, sin violaciones de axe",
  async ({ paginaAutenticada: page, sucursalId }) => {
    // docs/plan-selector-carta-pos-2026-09-25.md, paso 6. Los dos casos de la mesa de arriba no siembran carta: sin ninguna sección de carta
    // el navegador no se dibuja (DP3) y axe nunca lo vería. Acá se siembra una sección con un suelto y un agrupado de dos opciones.
    const marca = Date.now();
    const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
    const crear = async (clave: string, nombre: string) => {
      const p = await prisma.producto.create({ data: { codigo: `E2E-A11Y-CS-${clave}-${marca}`, nombre: `E2E A11y ${nombre} ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 5000 } });
      await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible: true } });
      return p;
    };
    const agua = await crear("AGUA", "Agua");
    const coca = await crear("COCA", "Coca");
    const sprite = await crear("SPRITE", "Sprite");
    const productoIds = [agua.id, coca.id, sprite.id];
    const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E A11y Bebidas ${marca}`, orden: 1 } });
    await prisma.contenidoCartaProducto.create({ data: { productoId: agua.id, visibleEnCarta: true, seccionCartaId: seccion.id } });
    const gaseosa = await prisma.itemAgrupadoCarta.create({ data: { nombre: `E2E A11y Gaseosa ${marca}`, seccionCartaId: seccion.id, orden: 1 } });
    await prisma.opcionItemAgrupadoCarta.createMany({ data: [coca, sprite].map((p, orden) => ({ itemAgrupadoCartaId: gaseosa.id, productoId: p.id, orden })) });
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 987 } });
    const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: admin.id } });
    const secciones = page.getByRole("group", { name: "Secciones de la carta" });
    try {
      await page.goto(`/mesas/${mesa.id}`);
      await conTitulo(page, "Mesa 987");
      await secciones.getByRole("button", { name: seccion.nombre }).click();
      const region = page.getByRole("region", { name: seccion.nombre });
      await expect(region.getByRole("button", { name: agua.nombre })).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "selector por sección de carta en reposo").toEqual([]);

      await region.getByRole("button", { name: gaseosa.nombre }).click();
      const opciones = page.getByRole("list", { name: `Opciones de ${gaseosa.nombre}` });
      await expect(opciones.getByRole("button")).toHaveCount(2);
      expect((await new AxeBuilder({ page }).analyze()).violations, "ítem agrupado desplegado").toEqual([]);

      // Elegir una opción la suma a la lista «Por agregar» (docs/plan-pos-agregar-varios-2026-09-26.md) y cierra el agrupado.
      await opciones.getByRole("button", { name: sprite.nombre }).click();
      await expect(page.locator(`[data-linea-por-agregar="${sprite.nombre}"]`)).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "con una opción elegida").toEqual([]);

      // El salón no tiene modo oscuro: con el sistema en oscuro queda claro igual.
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(`/mesas/${mesa.id}`);
      await conTitulo(page, "Mesa 987");
      await secciones.getByRole("button", { name: seccion.nombre }).click();
      await page.getByRole("region", { name: seccion.nombre }).getByRole("button", { name: gaseosa.nombre }).click();
      await page.getByRole("list", { name: `Opciones de ${gaseosa.nombre}` }).getByRole("button", { name: coca.nombre }).click();
      expect((await new AxeBuilder({ page }).analyze()).violations, "modo oscuro emulado").toEqual([]);
    } finally {
      await prisma.cuentaItem.deleteMany({ where: { cuentaId: cuenta.id } });
      await prisma.cuenta.deleteMany({ where: { id: cuenta.id } });
      await prisma.mesa.deleteMany({ where: { id: mesa.id } });
      await prisma.opcionItemAgrupadoCarta.deleteMany({ where: { itemAgrupadoCartaId: gaseosa.id } });
      await prisma.itemAgrupadoCarta.deleteMany({ where: { id: gaseosa.id } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: { in: productoIds } } });
      await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: productoIds } } });
      await prisma.producto.deleteMany({ where: { id: { in: productoIds } } });
    }
  }
);

testAutenticado(
  "pos/mesas/[mesaId]: «Cuentas cerradas» con una boleta desactualizada («Emitir boleta corregida» habilitado) y su diálogo abierto con el error, en modo claro y oscuro, sin violaciones de axe",
  async ({ paginaAutenticada: page, sucursalId }) => {
    // docs/plan-numeracion-boleta-2026-09-25.md, paso 8: la fila con el número de la boleta y el botón nuevo, y el diálogo del motivo.
    const marca = Date.now();
    const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
    const producto = await prisma.producto.create({ data: { codigo: `E2E-A11Y-COR-${marca}`, nombre: `E2E A11y Plato Corrección ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 1000 } });
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 977 } });
    const cerradaEn = new Date(Date.now() - 60 * 60_000);
    const ventas = await Promise.all(
      [null, new Date()].map((anuladaEn) => prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: cerradaEn, usuarioId: admin.id, anuladaEn } }))
    );
    const cuenta = await prisma.cuenta.create({
      data: {
        mesaId: mesa.id,
        abiertaPorId: admin.id,
        cerradaEn,
        cerradaPorId: admin.id,
        items: {
          create: ventas.map((venta, i) => ({ productoId: producto.id, cantidad: 1, precioUnitario: 1000 + i * 500, numeroEnvio: 1, creadoPorId: admin.id, operacionId: venta.id })),
        },
      },
    });
    const { _max } = await prisma.ejemplarBoleta.aggregate({ where: { sucursalId }, _max: { numero: true } });
    await prisma.ejemplarBoleta.create({ data: { sucursalId, cuentaId: cuenta.id, numero: (_max.numero ?? 0) + 1, emitidoEn: cerradaEn, emitidoPorId: admin.id } });
    const emitir = page.getByRole("button", { name: /^Emitir la boleta corregida de la cuenta cerrada/ });
    try {
      await page.goto(`/mesas/${mesa.id}`);
      await conTitulo(page, "Mesa 977");
      await expect(page.locator("[data-cuenta-cerrada]")).toContainText("N.º");
      await expect(emitir).toBeEnabled();
      expect((await new AxeBuilder({ page }).analyze()).violations, "fila desactualizada en modo claro").toEqual([]);

      await emitir.click();
      const dialogo = page.getByRole("dialog", { name: /^Emitir boleta corregida/ });
      await dialogo.getByRole("button", { name: "Emitir e imprimir" }).click();
      await expect(dialogo.getByRole("alert")).toHaveText("Escribí el motivo de la anulación.");
      expect((await new AxeBuilder({ page }).analyze()).violations, "diálogo «Emitir boleta corregida» con el error").toEqual([]);

      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(`/mesas/${mesa.id}`);
      await conTitulo(page, "Mesa 977");
      await expect(emitir).toBeEnabled();
      expect((await new AxeBuilder({ page }).analyze()).violations, "fila desactualizada en modo oscuro emulado").toEqual([]);
      await emitir.click();
      await expect(page.getByRole("dialog", { name: /^Emitir boleta corregida/ })).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "diálogo en modo oscuro emulado").toEqual([]);
    } finally {
      await prisma.ejemplarBoleta.deleteMany({ where: { cuentaId: cuenta.id, corrigeAId: { not: null } } });
      await prisma.ejemplarBoleta.deleteMany({ where: { cuentaId: cuenta.id } });
      await prisma.cuentaItem.deleteMany({ where: { cuentaId: cuenta.id } });
      await prisma.operacion.deleteMany({ where: { id: { in: ventas.map((v) => v.id) } } });
      await prisma.cuenta.deleteMany({ where: { id: cuenta.id } });
      await prisma.mesa.deleteMany({ where: { id: mesa.id } });
      await prisma.producto.deleteMany({ where: { id: producto.id } });
    }
  }
);

testAutenticado(
  "pos/mesas/[mesaId]: el modal «¿Cuántos comensales?» al abrir cuenta, en reposo y con el error de «elegí cuántos», en modo claro y oscuro, sin violaciones de axe",
  async ({ paginaAutenticada: page, sucursalId }) => {
    // docs/plan-comensales-y-limite-mesas-2026-09-26.md: el modal de comensales es obligatorio y sin default.
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 978 } });
    try {
      await page.goto(`/mesas/${mesa.id}`);
      await conTitulo(page, "Mesa 978");
      await page.getByRole("button", { name: "Abrir cuenta" }).click();
      const dialogo = page.getByRole("dialog", { name: "¿Cuántos comensales?" });
      await expect(dialogo).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "modal de comensales en reposo").toEqual([]);

      await dialogo.getByRole("button", { name: "Confirmar apertura" }).click();
      await expect(dialogo.getByRole("alert")).toHaveText("Elegí cuántos comensales son.");
      expect((await new AxeBuilder({ page }).analyze()).violations, "modal de comensales con el error").toEqual([]);

      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(`/mesas/${mesa.id}`);
      await page.getByRole("button", { name: "Abrir cuenta" }).click();
      await expect(page.getByRole("dialog", { name: "¿Cuántos comensales?" })).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "modal de comensales en modo oscuro emulado").toEqual([]);
    } finally {
      await prisma.cuenta.deleteMany({ where: { mesaId: mesa.id } });
      await prisma.mesa.deleteMany({ where: { id: mesa.id } });
    }
  }
);

testAutenticado("reportes/rotacion-mesas: con datos y sin datos, sin violaciones de accesibilidad detectables por axe", async ({ paginaAutenticada: page, sucursalId }) => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 979 } });
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const marcaProd = Date.now();
  const producto = await prisma.producto.create({ data: { codigo: `E2E-A11Y-ROT-${marcaProd}`, nombre: `E2E A11y Rotación ${marcaProd}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 1000 } });
  const cuenta = await prisma.cuenta.create({
    data: {
      mesaId: mesa.id,
      abiertaPorId: admin.id,
      comensales: 3,
      abiertaEn: new Date(Date.now() - 60 * 60_000),
      cerradaEn: new Date(),
      cerradaPorId: admin.id,
      items: { create: [{ productoId: producto.id, cantidad: 1, precioUnitario: 1000, numeroEnvio: 1, creadoPorId: admin.id }] },
    },
  });
  try {
    await page.goto("/reportes/rotacion-mesas");
    await conTitulo(page, "Rotación de mesas");
    await expect(page.locator("[data-metrica='atendidas']")).not.toHaveText("0");
    expect((await new AxeBuilder({ page }).analyze()).violations, "con datos").toEqual([]);

    // Rango sin ninguna cuenta: las tablas caen a su mensaje de "sin datos".
    await page.goto("/reportes/rotacion-mesas?rango=personalizado&desde=2000-01-01&hasta=2000-01-02");
    await expect(page.getByText("Sin cuentas atendidas en este rango.")).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations, "sin datos").toEqual([]);
  } finally {
    await prisma.cuentaItem.deleteMany({ where: { cuentaId: cuenta.id } });
    await prisma.cuenta.deleteMany({ where: { id: cuenta.id } });
    await prisma.mesa.deleteMany({ where: { id: mesa.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  }
});

testAutenticado(
  "reportes/boletas: el listado con una corrección expandida (marcas «Corrección de»/«Reemplazada por» y el detalle con link a Trazabilidad) sin violaciones de axe",
  async ({ paginaAutenticada: page, sucursalId }) => {
    // Task #17: una fila por EjemplarBoleta — se siembra un A y su corrección B para que aparezcan las dos marcas a la vez.
    const marca = Date.now();
    const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
    const producto = await prisma.producto.create({ data: { codigo: `E2E-A11Y-RB-${marca}`, nombre: `E2E A11y Boleta ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 1000 } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 978 } });
    const venta = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: new Date(), usuarioId: admin.id, detalleLibre: "Mesa 978" } });
    const cuenta = await prisma.cuenta.create({
      data: {
        mesaId: mesa.id,
        abiertaPorId: admin.id,
        cerradaEn: new Date(),
        cerradaPorId: admin.id,
        items: { create: [{ productoId: producto.id, cantidad: 1, precioUnitario: 1000, numeroEnvio: 1, creadoPorId: admin.id, operacionId: venta.id }] },
      },
    });
    const { _max } = await prisma.ejemplarBoleta.aggregate({ where: { sucursalId }, _max: { numero: true } });
    const numero = (_max.numero ?? 0) + 1;
    const a = await prisma.ejemplarBoleta.create({ data: { sucursalId, cuentaId: cuenta.id, numero, ejemplar: 1, emitidoPorId: admin.id } });
    await prisma.ejemplarBoleta.create({ data: { sucursalId, cuentaId: cuenta.id, numero, ejemplar: 2, emitidoPorId: admin.id, corrigeAId: a.id, motivo: "E2E a11y" } });
    try {
      await page.goto(`/reportes/boletas?mesaId=${mesa.id}&desde=&hasta=`);
      await conTitulo(page, "Boletas emitidas");
      await expect(page.locator("[data-boleta]")).toHaveCount(2);
      expect((await new AxeBuilder({ page }).analyze()).violations, "listado con marcas de corrección/reemplazo").toEqual([]);

      await page.locator(`[data-boleta="${a.id}"] summary`).click();
      await expect(page.getByRole("link", { name: "Trazabilidad" }).first()).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "detalle expandido con el link a Trazabilidad").toEqual([]);
    } finally {
      await prisma.ejemplarBoleta.deleteMany({ where: { cuentaId: cuenta.id, corrigeAId: { not: null } } });
      await prisma.ejemplarBoleta.deleteMany({ where: { cuentaId: cuenta.id } });
      await prisma.cuentaItem.deleteMany({ where: { cuentaId: cuenta.id } });
      await prisma.operacion.deleteMany({ where: { id: venta.id } });
      await prisma.cuenta.deleteMany({ where: { id: cuenta.id } });
      await prisma.mesa.deleteMany({ where: { id: mesa.id } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
      await prisma.producto.deleteMany({ where: { id: producto.id } });
    }
  }
);

testAutenticado(
  "stock/consolidado: el aviso de stock en tránsito entre sucursales (por recibir / enviado / pendiente de reingresar), sin violaciones de axe",
  async ({ paginaAutenticada: page, sucursalId }) => {
    const marca = Date.now();
    const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
    const otra = await prisma.sucursal.create({ data: { nombre: `E2E A11y Transito ${marca}` } });
    const mp = await prisma.producto.create({ data: { codigo: `E2E-A11Y-TR-${marca}`, nombre: `E2E A11y Tránsito ${marca}`, tipo: "MP", unidadStockId: kg.id } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: mp.id, disponible: true } });
    const base = { productoId: mp.id, creadoPorId: admin.id, iniciadoPor: "ORIGEN" as const };
    await prisma.traspasoSucursal.createMany({
      data: [
        { ...base, origenSucursalId: otra.id, destinoSucursalId: sucursalId, cantidad: 3, estado: "ENVIADA" },
        { ...base, origenSucursalId: sucursalId, destinoSucursalId: otra.id, cantidad: 2, estado: "ENVIADA" },
        { ...base, origenSucursalId: sucursalId, destinoSucursalId: otra.id, cantidad: 1, estado: "RECHAZADA_DESTINO" },
      ],
    });

    try {
      await page.goto("/stock/consolidado");
      await conTitulo(page, "Stock consolidado");
      const aviso = page.getByRole("region", { name: "Stock en tránsito entre sucursales" });
      await expect(aviso).toBeVisible();
      const fila = aviso.getByRole("row", { name: new RegExp(mp.codigo) });
      await expect(fila.getByRole("cell").nth(1)).toHaveText("3 kg");
      await expect(fila.getByRole("cell").nth(2)).toHaveText("2 kg");
      await expect(fila.getByRole("cell").nth(3)).toHaveText("1 kg");
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    } finally {
      await prisma.traspasoSucursal.deleteMany({ where: { productoId: mp.id } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: mp.id } });
      await prisma.producto.deleteMany({ where: { id: mp.id } });
      await prisma.sucursal.delete({ where: { id: otra.id } });
    }
  }
);
