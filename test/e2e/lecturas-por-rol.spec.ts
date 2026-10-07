import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { abrirComoRol } from "./fixtures/rol-pos";
import type { AccionClave } from "../../src/core/permisos/acciones";

/**
 * H8 (trabajo D.1 de `pureza-integracion`): las lecturas que antes pedían solo sesión exigen ahora el «Ver» de la pantalla que las consume (o el de alguna
 * de sus pantallas). Este spec comprueba en el navegador, con el servidor de producción, que el OPERADOR de fábrica sigue abriendo las pantallas que las
 * consumen y que cada una CARGA sus datos (secciones, proveedores para elegir, motivos, destinos, el buscador de productos): si una lectura le quedara
 * negada, la página caería en la pantalla de error o el selector quedaría vacío. El rol se arma con la MISMA matriz que el rol «operador» sembrado
 * (`fixtures/auth.ts`). El mozo (solo el salón) ya recorre la mesa y el buscador de productos en `pos-tomar-pedido.spec.ts`.
 */

/** La matriz del rol «operador» sembrado, como mapa para `abrirComoRol` (las filas con «Ver»). */
async function permisosDelOperador(): Promise<Partial<Record<AccionClave, "ver" | "editar">>> {
  const filas = await prisma.permisoRol.findMany({ where: { rol: { clave: "operador" }, puedeVer: true }, select: { accionClave: true, puedeEditar: true } });
  return Object.fromEntries(filas.map((f) => [f.accionClave, f.puedeEditar ? "editar" : "ver"])) as Partial<Record<AccionClave, "ver" | "editar">>;
}

async function abreSinError(page: Page, ruta: string, titulo: string) {
  await page.goto(ruta);
  await expect(page.getByRole("heading", { level: 1, name: titulo })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Algo falló al abrir esta pantalla" })).toHaveCount(0);
  await expect(page.getByText(/No tenés permiso/)).toHaveCount(0);
}

test("el operador de fábrica abre las pantallas que consumen las lecturas de H8 y cada una carga sus datos", async ({ browser, baseURL, sucursalId }) => {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-LPR-${marca}`, nombre: `E2E Lectura por rol ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
  const proveedor = await prisma.proveedor.create({ data: { codigo: `E2E-LPR-${marca}`, nombre: `E2E Proveedor por rol ${marca}`, cuit: null } });
  const operador = await abrirComoRol(browser, baseURL, sucursalId, await permisosDelOperador());
  try {
    const page = operador.page;

    // Compra: secciones, proveedores para elegir (sin la ficha) y el buscador de productos.
    await abreSinError(page, "/movimientos/compra", "Compra");
    await expect(page.getByLabel("Sección").locator("option", { hasText: "Depósito E2E" })).toHaveCount(1);
    await expect(page.getByLabel("Proveedor").locator("option", { hasText: proveedor.nombre })).toHaveCount(1);
    await page.locator('input[role="combobox"]').first().fill(producto.codigo);
    await expect(page.getByRole("option", { name: new RegExp(producto.codigo) })).toBeVisible();

    // Merma y consumo: los motivos y los destinos activos (sembrados por la base del E2E).
    await abreSinError(page, "/movimientos/merma", "Merma");
    await expect(page.getByLabel("Motivo").locator("option")).not.toHaveCount(1);
    await abreSinError(page, "/movimientos/consumo", "Consumo");
    await expect(page.getByLabel("Sección").locator("option", { hasText: "Depósito E2E" })).toHaveCount(1);

    // Catálogo: la tabla de productos y el alta (unidades, insumos, categorías, proveedores y la cuenta de sucursales).
    await abreSinError(page, "/catalogo/productos", "Productos");
    await abreSinError(page, "/catalogo/productos/nuevo", "Nuevo producto");

    // Stock, traspasos y el reporte de conteos: todas piden las secciones activas de la sucursal.
    await abreSinError(page, "/movimientos/conteo-fisico", "Conteo físico");
    await abreSinError(page, "/stock/reclasificar", "Reclasificar stock");
    await abreSinError(page, "/traspasos", "Traspasos entre sucursales");
    await abreSinError(page, "/reportes/conteos", "Historial de conteos físicos");
  } finally {
    await operador.limpiar();
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
    await prisma.proveedor.deleteMany({ where: { id: proveedor.id } });
  }
});
