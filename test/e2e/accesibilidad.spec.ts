import { randomUUID } from "node:crypto";
import { test as base, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { test as testAutenticado } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Accesibilidad (WCAG 2.1 A/AA vía axe-core) sobre pantallas puntuales: la pública (login, sin sesión), dos reportes (Costos y márgenes,
 * Promociones), la matriz de permisos, las cinco pantallas de catálogo/administración con formularios sueltos (categorías, unidades,
 * insumos-grupos, capacidades por sucursal, precio local), el admin de la carta, su portal de sucursales y su tema, y el mapa de mesas del salón. No es exhaustivo sobre todas las pantallas: se suma una cuando aparece una
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
    // buscarProductoParaPromocion filtra whereDisponibleEn(sucursalId) (P11) — sin esto no aparece como candidato y el formulario no dibuja ningún checkbox.
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: combo.id, disponible: true } });
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

testAutenticado("movimientos/precio-local: el selector de producto abierto (con resultados y sin resultados) no tiene violaciones de axe", async ({ paginaAutenticada: page, sucursalId }) => {
  const marca = Date.now();
  const nombre = `E2E A11y Selector ${marca}`;
  const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
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
  const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
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
    const unidad = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
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
  const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
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
    const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
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
      await prisma.registroAuditoria.deleteMany({ where: { entidad: "Operacion", entidadId: { in: [intacta.id, consumida.id] } } });
      await prisma.producto.deleteMany({ where: { id: { in: productos } } });
      await prisma.proveedor.deleteMany({ where: { id: proveedor.id } });
    }
  }
);

testAutenticado(
  "reportes/compras: la corrección de una compra (formulario abierto, con el rechazo por factura repetida y ya corregida) sin violaciones de axe",
  async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
    const marca = Date.now();
    const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
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
      await prisma.registroAuditoria.deleteMany({ where: { entidad: "Operacion", entidadId: { in: operaciones } } });
      await prisma.movimientoStock.deleteMany({ where: { productoId: producto.id } });
      await prisma.operacion.deleteMany({ where: { id: { in: operaciones } } });
      await prisma.producto.deleteMany({ where: { id: producto.id } });
      await prisma.proveedor.deleteMany({ where: { id: proveedor.id } });
    }
  }
);

testAutenticado(
  "reportes/rendimiento-recetas: la tabla en reposo (con rótulo, banda de ruido y motivoSinEstimacion) y con la confirmación de «Usar este valor» abierta (colSpan 11), sin violaciones de axe",
  async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
    const marca = Date.now();
    const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
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
      const filaConfirmacion = page.getByRole("alert").filter({ hasText: "¿Cambiar la receta" }).locator("xpath=ancestor::tr");
      await expect(filaConfirmacion.locator("td")).toHaveAttribute("colspan", "11");
      expect((await new AxeBuilder({ page }).analyze()).violations, "confirmación abierta").toEqual([]);
    } finally {
      await prisma.movimientoStock.deleteMany({ where: { productoId: { in: [mp.id, pv.id, mp2.id, pv2.id] } } });
      await prisma.operacion.deleteMany({ where: { id: { in: [compra.id, venta.id, venta2.id] } } });
      await prisma.recetaVersion.deleteMany({ where: { productoId: { in: [pv.id, pv2.id] } } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: [pv.id, mp.id, pv2.id, mp2.id] } } });
      await prisma.producto.deleteMany({ where: { id: { in: [pv.id, mp.id, pv2.id, mp2.id] } } });
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
    const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
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
    const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
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
    const central = await prisma.sucursal.findUniqueOrThrow({ where: { nombre: "Central" } });
    const segunda = await prisma.sucursal.create({ data: { nombre: `E2E A11y Sucursal Dos ${marca}` } });
    const rol = await prisma.rol.findUniqueOrThrow({ where: { nombre: "admin" } });
    const usuario = await prisma.user.create({ data: { email: `e2e-a11y-selector-sucursal-${marca}@local.test`, activoGlobal: true } });
    await prisma.usuarioSucursal.createMany({
      data: [
        { usuarioId: usuario.id, sucursalId: central.id, rolId: rol.id, activo: true },
        { usuarioId: usuario.id, sucursalId: segunda.id, rolId: rol.id, activo: true },
      ],
    });
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
  "reportes/ventas-por-seccion: sin violaciones de axe, contraste incluido (con una sección con ventas y una categoría sin sección en ámbar)",
  async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
    // docs/plan-carta-catalogo-2026-09-24.md, M7. Dos ventas: una de una categoría que está en una sección de carta (tabla) y otra de una
    // categoría que no está en ninguna (aviso en ámbar): sin las dos, la pantalla no dibuja todo lo que se quiere auditar.
    const marca = `${Date.now()}`;
    const unidad = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
    const conSeccion = await prisma.categoriaProducto.create({ data: { nombre: `E2E A11y Cat Carta ${marca}` } });
    const sinSeccion = await prisma.categoriaProducto.create({ data: { nombre: `E2E A11y Cat Suelta ${marca}` } });
    const seccionCarta = await prisma.seccionCarta.create({ data: { nombre: `E2E A11y Sección Carta ${marca}`, orden: 1 } });
    await prisma.categoriaSeccionCarta.create({ data: { categoriaId: conSeccion.id, seccionCartaId: seccionCarta.id } });
    const pvs = await Promise.all(
      [conSeccion, sinSeccion].map((c, i) =>
        prisma.producto.create({ data: { codigo: `E2E-A11Y-SEC-${i}-${marca}`, nombre: `E2E A11y Plato ${i} ${marca}`, tipo: "PV", categoriaId: c.id, unidadStockId: unidad.id, precioVenta: 100 } })
      )
    );
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
      await expect(page.getByRole("listitem").filter({ hasText: sinSeccion.nombre }), "la categoría sin sección tiene que aparecer en el aviso").toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    } finally {
      await prisma.movimientoStock.deleteMany({ where: { operacionId: op.id } });
      await prisma.operacion.deleteMany({ where: { id: op.id } });
      await prisma.categoriaSeccionCarta.deleteMany({ where: { seccionCartaId: seccionCarta.id } });
      await prisma.seccionCarta.deleteMany({ where: { id: seccionCarta.id } });
      await prisma.producto.deleteMany({ where: { id: { in: pvs.map((p) => p.id) } } });
      await prisma.categoriaProducto.deleteMany({ where: { id: { in: [conSeccion.id, sinSeccion.id] } } });
    }
  }
);

testAutenticado("catalogo/carta: sin violaciones de axe, con formularios abiertos y el aviso en ámbar de PV sin contenido", async ({ paginaAutenticada: page, sucursalId }) => {
  // docs/plan-carta-catalogo-2026-09-24.md, M10. Con datos en los cuatro bloques (sección, categoría asignada, un PV con contenido y otro
  // sin él —dibuja el aviso ámbar— y una promo), y con un formulario de cada tipo desplegado: cerrado, un <details> no expone sus campos.
  const marca = `${Date.now()}`;
  const unidad = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "unidad" } });
  const categoria = await prisma.categoriaProducto.create({ data: { nombre: `E2E A11y Carta Cat ${marca}` } });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E A11y Carta Sección ${marca}`, titulo: "Del fuego", orden: 1 } });
  await prisma.categoriaSeccionCarta.create({ data: { categoriaId: categoria.id, seccionCartaId: seccion.id } });
  const [conContenido, sinContenido] = await Promise.all(
    ["Con", "Sin"].map((q) =>
      prisma.producto.create({ data: { codigo: `E2E-A11Y-CARTA-${q}-${marca}`, nombre: `E2E A11y Carta ${q} ${marca}`, tipo: "PV", categoriaId: categoria.id, unidadStockId: unidad.id, precioVenta: 100 } })
    )
  );
  await prisma.disponibilidadProducto.createMany({ data: [conContenido, sinContenido].map((p) => ({ sucursalId, productoId: p.id, disponible: true })) });
  await prisma.contenidoCartaProducto.create({ data: { productoId: conContenido.id, visibleEnCarta: true, tags: ["Regional"], especial: true } });
  const promo = await prisma.promoCarta.create({ data: { sucursalId, seccionCartaId: seccion.id, titulo: `E2E A11y Promo ${marca}`, precio: 1000 } });
  try {
    await page.goto("/catalogo/carta");
    await expect(page.getByRole("heading", { name: "Carta pública", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: /PV disponibles acá sin contenido de carta/ })).toBeVisible();
    await page.locator(`[data-seccion-carta="${seccion.nombre}"] summary`).click();
    await page.locator(`[data-contenido-carta="${conContenido.nombre}"] summary`).click();
    await page.locator(`[data-promo-carta="${promo.titulo}"] summary`).click();
    await expect(page.locator(`[data-contenido-carta="${conContenido.nombre}"]`).getByLabel("Especial (★)")).toBeChecked();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    await prisma.promoCarta.deleteMany({ where: { id: promo.id } });
    await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: { in: [conContenido.id, sinContenido.id] } } });
    await prisma.categoriaSeccionCarta.deleteMany({ where: { seccionCartaId: seccion.id } });
    await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: [conContenido.id, sinContenido.id] } } });
    await prisma.producto.deleteMany({ where: { id: { in: [conContenido.id, sinContenido.id] } } });
    await prisma.categoriaProducto.deleteMany({ where: { id: categoria.id } });
  }
});

testAutenticado("catalogo/carta/agrupados: sin violaciones de axe, con un ítem abierto, el aviso ámbar de precios distintos y los selects", async ({ paginaAutenticada: page, sucursalId }) => {
  // docs/plan-agrupacion-items-carta-2026-09-24.md, M7. Un ítem agrupado con dos opciones de distinto precio (el drift posterior de D5,
  // sembrado directo: la acción de agregar lo bloquearía) dibuja el aviso ámbar; se abre su <details> para exponer el formulario del ítem,
  // las opciones (orden y quitar) y el select "Agregar producto" (hay un PV suelto disponible para listar).
  const marca = `${Date.now()}`;
  const unidad = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "unidad" } });
  const categoria = await prisma.categoriaProducto.create({ data: { nombre: `E2E A11y Agrupado Cat ${marca}` } });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E A11y Agrupado Sección ${marca}` } });
  await prisma.categoriaSeccionCarta.create({ data: { categoriaId: categoria.id, seccionCartaId: seccion.id } });
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
  const item = await prisma.itemAgrupadoCarta.create({ data: { nombre: `E2E A11y Gaseosa ${marca}`, categoriaId: categoria.id, especial: true, tags: ["Sin alcohol"] } });
  await prisma.opcionItemAgrupadoCarta.createMany({ data: ids.slice(0, 2).map((productoId, orden) => ({ itemAgrupadoCartaId: item.id, productoId, orden })) });
  try {
    await page.goto("/catalogo/carta/agrupados");
    await expect(page.getByRole("heading", { name: "Ítems agrupados de la carta", level: 1 })).toBeVisible();
    const fila = page.locator(`[data-item-agrupado="${item.nombre}"]`);
    await expect(fila.getByText(/no cuestan lo mismo/)).toBeVisible();
    await fila.locator("summary").click();
    await expect(fila.getByLabel(`Agregar producto a «${item.nombre}»`)).toBeVisible();
    await expect(fila.getByLabel(/^Categoría/)).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    await prisma.opcionItemAgrupadoCarta.deleteMany({ where: { itemAgrupadoCartaId: item.id } });
    await prisma.itemAgrupadoCarta.deleteMany({ where: { id: item.id } });
    await prisma.categoriaSeccionCarta.deleteMany({ where: { seccionCartaId: seccion.id } });
    await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: ids } } });
    await prisma.producto.deleteMany({ where: { id: { in: ids } } });
    await prisma.categoriaProducto.deleteMany({ where: { id: categoria.id } });
  }
});

testAutenticado("catalogo/carta/portal: sin violaciones de axe, con una sucursal sin agregar y el formulario de otra abierto", async ({ paginaAutenticada: page }) => {
  // docs/plan-registro-tenants-2026-09-24.md, M7. Una sucursal fuera del portal (botón «Agregar») y otra dentro, publicada y con posición, con su
  // <details> desplegado: cerrado, un <details> no expone sus campos (los dos fieldset, los checkbox y el botón de quitar).
  const marca = `${Date.now()}`;
  const [fuera, dentro] = await Promise.all(["Fuera", "Dentro"].map((q) => prisma.sucursal.create({ data: { nombre: `E2E A11y Portal ${q} ${marca}` } })));
  await prisma.sucursalPublica.create({
    data: { sucursalId: dentro.id, slug: `e2e-a11y-portal-${marca}`, publicada: true, sheetId: "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-a11y", posX: 10, posY: 20, posW: 5, subtituloPortal: "Frente al lago" },
  });
  try {
    await page.goto("/catalogo/carta/portal");
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

testAutenticado("catalogo/carta/tema: sin violaciones de axe, con zonas del editor abiertas (color, select, número) y un campo inválido", async ({ paginaAutenticada: page, sucursalId }) => {
  // docs/plan-tema-carta-2026-09-24.md, M9. Un tema con valores (uno inválido, cargado a mano: dibuja el aviso rojo del campo) y tres <details>
  // desplegados además del primero: "Colores generales" (selectores de color con su etiqueta propia), "Banda e imagen de sección" (los
  // <select> y los <input type="number">) e "Ítems" (el campo inválido). Cerrado, un <details> no expone sus campos.
  //
  // Se EXCLUYE [data-vista-previa-tema]: la vista previa dibuja la carta con sus propios colores, y con los defaults de la carta (ámbar
  // oklch(0.76 0.14 80) sobre casi blanco) no cumple color-contrast. Es un problema conocido de la carta pública (restaurant-menu-design), fuera
  // de este plan: acá solo se simula, y lo que se audita es el editor de motor2.
  await prisma.temaCartaSucursal.deleteMany({ where: { sucursalId } });
  await prisma.temaCartaSucursal.create({ data: { sucursalId, valores: { color_marca: "#8b4513", hero_ink: "claro", carta_imagen_modo: "miniatura", carta_imagen_opacidad: "60", color_item_precio: "red;x" } } });
  try {
    await page.goto("/catalogo/carta/tema");
    await expect(page.getByRole("heading", { name: "Tema de la carta", level: 1 })).toBeVisible();
    for (const zona of ["Colores generales", "Banda e imagen de sección", "Ítems"]) await page.locator(`[data-zona-tema="${zona}"] summary`).click();
    await expect(page.locator('select[name="carta_imagen_modo"]')).toBeVisible();
    await expect(page.locator('[data-campo-tema="color_item_precio"]')).toContainText("No es válido");
    expect((await new AxeBuilder({ page }).exclude("[data-vista-previa-tema]").analyze()).violations).toEqual([]);
  } finally {
    await prisma.temaCartaSucursal.deleteMany({ where: { sucursalId } });
  }
});

testAutenticado(
  "pos/mesas: el mapa con los tres estados, con el diálogo de «Nueva mesa» abierto y con el sistema en modo oscuro, sin violaciones de axe (confirma los contrastes aprobados)",
  async ({ paginaAutenticada: page, sucursalId }) => {
    // Plan docs/plan-mapa-de-mesas-2026-09-24.md §A.3: --ink-faint #76726A («MESA», rótulos de métricas, nota al pie), la etiqueta «Libre» en
    // --mesa-libre-ink y «En pedido» en --mesa-draft-ink. Hacen falta las tres tarjetas: sin una mesa en pedido no se dibuja la etiqueta ámbar,
    // y sin datos no hay nada que auditar. (Axe ignora los botones deshabilitados: «Continuar pedido» se corrigió igual, para cuando se habilite.)
    const marca = Date.now();
    const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
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
      await expect(page.locator('li[data-mesa="803"]').getByRole("button", { name: "Facturar" })).toBeVisible();
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
