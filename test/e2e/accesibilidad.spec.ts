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
  "reportes/rendimiento-recetas: la tabla en reposo y con la confirmación de «Usar este valor» abierta, sin violaciones de axe",
  async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
    const marca = Date.now();
    const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
    const mp = await prisma.producto.create({ data: { codigo: `E2E-A11Y-RR-MP-${marca}`, nombre: `E2E A11y Salsa Rendimiento ${marca}`, tipo: "MP", unidadStockId: kg.id } });
    const pv = await prisma.producto.create({ data: { codigo: `E2E-A11Y-RR-PV-${marca}`, nombre: `E2E A11y Pizza Rendimiento ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: kg.id }] } } });
    const hoy = new Date();
    const compra = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: hoy, usuarioId: admin.id } });
    await prisma.movimientoStock.create({ data: { operacionId: compra.id, productoId: mp.id, seccionId, proceso: "COMPRA", cantidad: 20, detalle: "Compra", precioTotal: 200, precioPorUnidadStock: 10 } });
    const venta = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: hoy, usuarioId: admin.id } });
    await prisma.movimientoStock.create({ data: { operacionId: venta.id, productoId: pv.id, seccionId, proceso: "VENTA", cantidad: -10, detalle: "Venta", precioTotal: 1000, precioPorUnidadStock: 100 } });
    try {
      await page.goto("/reportes/rendimiento-recetas");
      await conTitulo(page, "Rendimiento real de recetas");
      const fila = page.getByRole("row", { name: new RegExp(pv.nombre) });
      const botonUsar = fila.getByRole("button", { name: `Usar este valor para ${pv.nombre} — ${mp.nombre}` });
      await expect(botonUsar).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "tabla en reposo").toEqual([]);

      await botonUsar.click();
      await expect(page.getByRole("alert").filter({ hasText: "¿Cambiar la receta" })).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, "confirmación abierta").toEqual([]);
    } finally {
      await prisma.movimientoStock.deleteMany({ where: { productoId: { in: [mp.id, pv.id] } } });
      await prisma.operacion.deleteMany({ where: { id: { in: [compra.id, venta.id] } } });
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
