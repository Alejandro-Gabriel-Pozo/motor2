import { test as base, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { test as testAutenticado } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Accesibilidad (WCAG 2.1 A/AA vía axe-core) sobre pantallas puntuales: la pública (login, sin sesión), dos reportes (Costos y márgenes,
 * Promociones), la matriz de permisos y las cinco pantallas de catálogo/administración con formularios sueltos (categorías, unidades,
 * insumos-grupos, capacidades por sucursal, precio local). No es exhaustivo sobre todas las pantallas: se suma una cuando aparece una
 * necesidad concreta.
 */

base("login: sin violaciones de accesibilidad detectables por axe", async ({ page }) => {
  await page.goto("/login");
  const resultados = await new AxeBuilder({ page }).analyze();
  expect(resultados.violations).toEqual([]);
});

testAutenticado("reportes/costos: sin violaciones de accesibilidad detectables por axe, contraste incluido", async ({ paginaAutenticada: page }) => {
  // Un producto de venta con receta cuyo insumo NO tiene ninguna compra: su costo queda incompleto y la tabla lo marca en ámbar (text-amber-700 / dark:
  // text-amber-600). Sin este dato la pantalla no dibuja ningún texto ámbar y el chequeo de contraste no auditaría nada.
  const marca = Date.now();
  const unidad = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
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
  "reportes/promociones: sin violaciones de accesibilidad, incluido el color de \"· parcial\" del Margen Real",
  async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
    const marca = Date.now();
    const unidad = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
    const mp = await prisma.producto.create({ data: { codigo: `E2E-A11Y-MP-${marca}`, nombre: `E2E Harina A11y ${marca}`, tipo: "MP", unidadStockId: unidad.id } });
    const combo = await prisma.producto.create({ data: { codigo: `E2E-A11Y-PV-${marca}`, nombre: `E2E Combo A11y ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 100 } });
    await prisma.recetaVersion.create({ data: { productoId: combo.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidad.id }] } } });
    await prisma.sucursal.update({ where: { id: sucursalId }, data: { promocionesHabilitadas: true } });
    await prisma.promocionProducto.create({ data: { sucursalId, productoId: combo.id, activa: true } });

    // Venta 1: ANTES de que exista cualquier compra del insumo — no se puede costear (queda afuera del Real).
    const op1 = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: new Date("2026-08-01T12:00:00Z"), usuarioId: admin.id } });
    await prisma.movimientoStock.create({
      data: { operacionId: op1.id, productoId: combo.id, seccionId, proceso: "VENTA", cantidad: -1, detalle: "Venta", precioTotal: 100, precioPorUnidadStock: 100, costoUnitarioVenta: null },
    });
    // Compra del insumo, y una segunda venta DESPUÉS — esa sí se reconstruye. El producto queda con cobertura PARCIAL.
    const opCompra = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date("2026-08-03T12:00:00Z"), usuarioId: admin.id } });
    await prisma.movimientoStock.create({
      data: { operacionId: opCompra.id, productoId: mp.id, seccionId, proceso: "COMPRA", cantidad: 10, detalle: "Compra", precioTotal: 50, precioPorUnidadStock: 5 },
    });
    const op2 = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: new Date("2026-08-04T12:00:00Z"), usuarioId: admin.id } });
    await prisma.movimientoStock.create({
      data: { operacionId: op2.id, productoId: combo.id, seccionId, proceso: "VENTA", cantidad: -1, detalle: "Venta", precioTotal: 100, precioPorUnidadStock: 100, costoUnitarioVenta: null },
    });

    await page.goto(`/reportes/promociones?desde=2026-08-01&hasta=2026-08-10`);
    await expect(page.getByRole("heading", { name: "Promociones y Combos" })).toBeVisible();
    // `.first()`: la base de e2e se reinicia al empezar cada corrida (global-setup), pero dentro de una misma corrida
    // otro spec puede haber dejado un "· parcial" en la tabla — no afecta lo que se audita.
    await expect(page.getByText("· parcial").first()).toBeVisible(); // confirma que el caso que se quiere auditar realmente se renderizó

    // Chequeo ACOTADO al elemento nuevo, no un scan de toda la pantalla: el formulario de "marcar como
    // Promoción/Combo" de esta misma página tiene un checkbox sin label (promocion-form.tsx) — hallazgo real,
    // pero ajeno a este cambio (ver docs/pendientes-responsable-2026-09-20.md). Lo que este test quiere
    // confirmar es puntual: que el amber-700 elegido para "· parcial" pasa AA por sí mismo.
    const soloElNodoNuevo = await new AxeBuilder({ page })
      .include(".text-amber-700")
      .withTags(["wcag2aa"])
      .analyze();
    expect(soloElNodoNuevo.violations).toEqual([]);

    // El checkbox de «marcar como Promoción/Combo» (promocion-form.tsx) tenía que llevar un nombre: sin él un lector de pantalla anuncia solo «casilla».
    const casillas = page.locator('input[type="checkbox"]');
    await expect(casillas.first(), "el formulario de marcar como promoción tiene que dibujar al menos una casilla").toBeVisible();
    const soloLasCasillas = await new AxeBuilder({ page }).include('input[type="checkbox"]').analyze();
    expect(soloLasCasillas.violations, "casillas de promoción").toEqual([]);
  }
);

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

testAutenticado("administracion/capacidades-sucursal: sin violaciones de axe", async ({ paginaAutenticada: page }) => {
  await page.goto("/administracion/capacidades-sucursal");
  await conTitulo(page, /Capacidades por sucursal/);
  await expect(page.getByRole("cell", { name: "stock_minimo", exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

testAutenticado("movimientos/precio-local: sin violaciones de axe", async ({ paginaAutenticada: page, sucursalId }) => {
  const nombre = `E2E A11y Precio ${Date.now()}`;
  const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
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

testAutenticado("movimientos/precio-local: el selector de producto abierto (con resultados y sin resultados) no tiene violaciones de axe", async ({ paginaAutenticada: page }) => {
  const marca = Date.now();
  const nombre = `E2E A11y Selector ${marca}`;
  const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-A11Y-SEL-${marca}`, nombre, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
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

testAutenticado("catalogo/productos: la lista, con la confirmación de «Desactivar» abierta y con el bloqueo mostrado, sin violaciones de axe", async ({ paginaAutenticada: page }) => {
  // Un producto activo y uno inactivo (para que se dibujen los dos estados del botón) y un plato que usa al activo (para que desactivar se bloquee y se
  // muestre el mensaje de error). `?q=` acota la tabla: no depende de lo que dejen otros specs.
  const marca = Date.now();
  const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
  const insumo = await prisma.insumo.create({ data: { nombre: `E2E A11y Insumo Lista ${marca}` } });
  const activo = await prisma.producto.create({ data: { codigo: `E2E-A11Y-LA-${marca}`, nombre: `E2E A11y Lista ${marca} activo`, tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } });
  const inactivo = await prisma.producto.create({ data: { codigo: `E2E-A11Y-LI-${marca}`, nombre: `E2E A11y Lista ${marca} inactivo`, tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id, activo: false } });
  const plato = await prisma.producto.create({ data: { codigo: `E2E-A11Y-LP-${marca}`, nombre: `E2E A11y Lista ${marca} plato`, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
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
    await prisma.producto.deleteMany({ where: { id: { in: [plato.id, activo.id, inactivo.id] } } });
    await prisma.insumo.deleteMany({ where: { id: insumo.id } });
  }
});
