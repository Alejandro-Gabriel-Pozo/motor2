import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";

/**
 * Fase 4 de la ola «precio y carta» (ADR-035): «¿Cómo se vende?» en la edición de un producto de venta (`/catalogo/productos/[id]/datos`, el paso 1 del espacio del producto; `/editar` redirige ahí). Marcar la base (con su grupo de medida en precio
 * propio), ver el precio guardado bloqueado («no se cobra») con el enlace a las opciones, el rechazo del servidor («… diferencia en porcentaje …» / «Falta el precio final de cada opción…»), «Por opción»
 * apagado con su motivo cuando no hay grupo de precio, volver a «Directo», y axe a 1280 y a 375 px. Lo sembrado no se borra (las tablas de opciones solo se agregan; ver `fixtures/opciones.ts`).
 */
const marca = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

async function productoConPrecioPorOpcion(sucursalId: string, m: string, extra: { conPorcentaje?: boolean } = {}) {
  const tipos = await sembrarGrupo({ nombre: `E2E Tipos ${m}`, tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Muzzarella" }, { nombre: "Fugazzeta" }] });
  const grupos: Parameters<typeof sembrarProductoConOpciones>[0]["grupos"] = [{ grupo: tipos, modoPrecio: "ABSOLUTO", preciosAbsolutos: { Muzzarella: 18000, Fugazzeta: 22000 } }];
  if (extra.conPorcentaje) {
    const variante = await sembrarGrupo({ nombre: `E2E Borde ${m}`, tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1, marca: `${m}-v`, opciones: [{ nombre: "Relleno", porcentaje: 10 }] });
    grupos.push({ grupo: variante });
  }
  return sembrarProductoConOpciones({ nombre: `E2E Pizzas ${m}`, codigo: `E2E-BASE-${m}`, precioVenta: 18000, sucursalId, grupos });
}

for (const ancho of [1280, 375]) {
  test(`a ${ancho} px: marcar «Por opción», el precio guardado bloqueado y volver a «Directo»`, async ({ paginaAutenticada: page, sucursalId }) => {
    await page.setViewportSize({ width: ancho, height: 900 });
    const m = marca();
    const { productoId } = await productoConPrecioPorOpcion(sucursalId, m);
    await page.goto(`/catalogo/productos/${productoId}/datos`);
    const grupo = page.getByRole("group", { name: "¿Cómo se vende?" });
    await expect(grupo.getByRole("radio", { name: /Directo/ })).toBeChecked();
    await expect(page.getByText(`El precio final de cada opción está en «E2E Tipos ${m}».`).first()).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations, "directo").toEqual([]);

    await grupo.getByRole("radio", { name: /Por opción/ }).check();
    // El precio editable desaparece: queda el guardado, en solo lectura, con el enlace a las opciones.
    await expect(page.getByRole("textbox", { name: "Precio de venta" })).toHaveCount(0);
    await expect(page.locator('[data-solo-lectura="precioVenta"]')).toContainText("Precio guardado (no se cobra)");
    await expect(page.getByRole("link", { name: "Ver las opciones de venta del producto" })).toHaveAttribute("href", `/catalogo/productos/${productoId}/opciones`);
    expect((await new AxeBuilder({ page }).analyze()).violations, "por opción").toEqual([]);
    await page.getByRole("button", { name: /Guardar/ }).click();
    await expect(page).toHaveURL(new RegExp(`/catalogo/productos/${productoId}\\?guardado=cambios`));
    await expect(page.locator("[data-se-vende-por-opcion]")).toBeVisible();
    expect(await prisma.producto.findUniqueOrThrow({ where: { id: productoId }, select: { modoDeVenta: true, precioVenta: true } })).toEqual({ modoDeVenta: "BASE_CONFIGURABLE", precioVenta: expect.anything() });
    expect(Number((await prisma.producto.findUniqueOrThrow({ where: { id: productoId } })).precioVenta), "el guardado se conserva").toBe(18000);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "Producto", entidadId: productoId, campo: "modoDeVenta" } })).toBe(1);

    // Volver a «Directo»: el precio vuelve a ser editable.
    await page.goto(`/catalogo/productos/${productoId}/datos`);
    await page.getByRole("group", { name: "¿Cómo se vende?" }).getByRole("radio", { name: /Directo/ }).check();
    await expect(page.getByRole("textbox", { name: "Precio de venta" })).toBeVisible();
    await page.getByRole("button", { name: /Guardar/ }).click();
    await expect(page).toHaveURL(new RegExp(`/catalogo/productos/${productoId}\\?guardado=cambios`));
    expect((await prisma.producto.findUniqueOrThrow({ where: { id: productoId }, select: { modoDeVenta: true } })).modoDeVenta).toBe("DIRECTO");
  });
}

test("el servidor rechaza pasar a base con un porcentaje (mensaje claro) y no guarda nada", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const { productoId } = await productoConPrecioPorOpcion(sucursalId, m, { conPorcentaje: true });
  await page.goto(`/catalogo/productos/${productoId}/datos`);
  await page.getByRole("group", { name: "¿Cómo se vende?" }).getByRole("radio", { name: /Por opción/ }).check();
  await page.getByRole("button", { name: /Guardar/ }).click();
  await expect(page.getByText(/tiene una diferencia en porcentaje/)).toBeVisible();
  expect((await prisma.producto.findUniqueOrThrow({ where: { id: productoId }, select: { modoDeVenta: true } })).modoDeVenta).toBe("DIRECTO");
  expect((await new AxeBuilder({ page }).analyze()).violations, "con el rechazo a la vista").toEqual([]);
});

test("sin grupo de precio, «Por opción» se ve apagado y dice por qué", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const { productoId } = await sembrarProductoConOpciones({ nombre: `E2E Gaseosa ${m}`, codigo: `E2E-GAS-${m}`, precioVenta: 4000, sucursalId, grupos: [] });
  // Entra por la ruta VIEJA (`/editar`) a propósito: el favorito de siempre termina en el mismo formulario del paso 1.
  await page.goto(`/catalogo/productos/${productoId}/editar`);
  await expect(page).toHaveURL(new RegExp(`/catalogo/productos/${productoId}/datos$`));
  const porOpcion = page.getByRole("group", { name: "¿Cómo se vende?" }).getByRole("radio", { name: /Por opción/ });
  await expect(porOpcion).toBeDisabled();
  await expect(page.getByText(/Para venderlo por opción, primero asignale un grupo de tamaños/)).toBeVisible();
  await expect(porOpcion).toHaveAccessibleDescription(/Para venderlo por opción/);
});
