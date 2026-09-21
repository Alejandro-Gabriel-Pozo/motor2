import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Maquetación de TODAS las pantallas sin parámetros a 1024 y 1280 px, con datos de nombre largo (1024 es donde arrancan las grillas de dos
 * columnas `lg:`, el ancho más apretado; 1280 es el ancho del hallazgo original).
 *
 * Generaliza el bug de /catalogo/insumos-grupos (ver catalogo-insumos-grupos-maquetacion.spec.ts): un <table w-full> dentro de una grilla
 * `minmax(0, 1fr)` no se achica por debajo de su ancho mínimo y SE SALE de su caja (overflow visible), pintándose sobre la columna de al lado y
 * quitándole los clics. Sin contenedor con scroll, o el desborde queda tapando a otro, o agranda la PÁGINA entera.
 *
 * Detector (el mismo mecanismo medido en ese spec): para cada <table>, se sube por sus ancestros; el primero que tenga overflow-x distinto de
 * "visible" contiene el desborde (correcto: es el `overflow-x-auto` de la tabla) y se corta ahí; un ancestro con overflow visible cuyo
 * `scrollWidth` supere su `clientWidth` es un contenido que se sale de su caja. Además, la PÁGINA no puede tener scroll horizontal.
 *
 * Los anchos van EXPLÍCITOS aunque uno sea el default: ensancharlos escondería justamente esta regresión.
 */
const ANCHOS = [1024, 1280];

const RUTAS = [
  "/inicio",
  "/administracion/auditoria",
  "/administracion/capacidades-sucursal",
  "/administracion/permisos",
  "/administracion/roles",
  "/administracion/sucursales",
  "/administracion/usuarios",
  "/catalogo/categorias",
  "/catalogo/insumos-grupos",
  "/catalogo/productos",
  "/catalogo/proveedores",
  "/catalogo/proveedores/comparativa",
  "/catalogo/recetas",
  "/catalogo/unidades",
  "/movimientos/conteo-fisico",
  "/movimientos/precio-local",
  "/movimientos/secciones",
  "/movimientos/venta",
  "/reportes",
  "/reportes/categorias",
  "/reportes/compras",
  "/reportes/consignacion",
  "/reportes/consolidado",
  "/reportes/conteos",
  "/reportes/costos",
  "/reportes/devoluciones",
  "/reportes/diferencias",
  "/reportes/historial",
  "/reportes/huecos-catalogo",
  "/reportes/insumos-sin-receta",
  "/reportes/perdidas",
  "/reportes/periodo",
  "/reportes/promociones",
  "/reportes/rendimiento-recetas",
  "/reportes/salud",
  "/reportes/sin-receta",
  "/reportes/trazabilidad",
  "/reportes/valuacion",
  "/reportes/vencimientos",
  "/stock/alertas",
  "/stock/consolidado",
  "/stock/minimo",
  "/stock/por-familia",
  "/stock/reclasificar",
  "/traspasos",
  "/traspasos/enviar",
  "/traspasos/solicitar",
];

let limpiar: () => Promise<void> = async () => {};

test.beforeAll(async () => {
  const marca = Date.now();
  const largo = `E2E Maquetación producto de nombre bastante largo para forzar el ancho de las tablas ${marca}`;
  const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
  const sucursal = await prisma.sucursal.findFirstOrThrow({ where: { nombre: "Central" } });
  const seccion = await prisma.seccion.findFirstOrThrow({ where: { sucursalId: sucursal.id } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-MQ-${marca}`, nombre: largo, tipo: "PV", unidadStockId: kg.id, precioVenta: 1234.5 } });
  const proveedor = await prisma.proveedor.create({ data: { codigo: `PRV_MQ${marca}`, nombre: `E2E Proveedor con un nombre larguísimo ${marca}`, contacto: "contacto con un texto largo de ejemplo" } });
  // El caso que destapó el hallazgo original: un grupo de nombre largo ensancha el <select> de cada insumo.
  const grupo = await prisma.grupo.create({ data: { nombre: `Materias primas secas y harinas de uso frecuente ${marca}` } });
  const insumo = await prisma.insumo.create({ data: { nombre: `E2E Insumo Maquetación General ${marca}`, grupoId: grupo.id } });
  await prisma.precioLocalProducto.create({ data: { sucursalId: sucursal.id, productoId: producto.id, precio: 1500, habilitado: true } });
  await prisma.stockMinimoProducto.create({ data: { sucursalId: sucursal.id, productoId: producto.id, seccionId: seccion.id, minimo: 5 } });
  limpiar = async () => {
    await prisma.insumo.deleteMany({ where: { id: insumo.id } });
    await prisma.grupo.deleteMany({ where: { id: grupo.id } });
    await prisma.stockMinimoProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.precioLocalProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.proveedor.deleteMany({ where: { id: proveedor.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  };
});

test.afterAll(async () => {
  await limpiar();
});

for (const ancho of ANCHOS) for (const ruta of RUTAS) {
  test(`${ruta}: nada se sale de su caja a ${ancho} px`, async ({ paginaAutenticada: page }) => {
    await page.setViewportSize({ width: ancho, height: 720 });
    await page.goto(ruta);
    await expect(page.locator("main h1, main h2").first(), "la pantalla no renderizó su título").toBeVisible();

    const problemas = await page.evaluate(() => {
      const salida: string[] = [];
      const desc = (el: Element) => `<${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? ` class="${el.className.slice(0, 60)}"` : ""}>`;
      for (const tabla of document.querySelectorAll("table")) {
        for (let el: Element | null = tabla.parentElement; el && el !== document.body; el = el.parentElement) {
          if (getComputedStyle(el).overflowX !== "visible") break; // contenedor con scroll propio: el desborde queda adentro
          if (el.scrollWidth > el.clientWidth + 1) {
            salida.push(`la tabla se sale de ${desc(el)} (${el.scrollWidth} px de contenido en ${el.clientWidth} px)`);
            break;
          }
        }
      }
      if (document.documentElement.scrollWidth > document.documentElement.clientWidth) {
        salida.push(`la PÁGINA tiene scroll horizontal (${document.documentElement.scrollWidth} px en ${document.documentElement.clientWidth} px)`);
      }
      return [...new Set(salida)];
    });
    expect(problemas, `desbordes en ${ruta} a ${ancho} px`).toEqual([]);
  });
}
