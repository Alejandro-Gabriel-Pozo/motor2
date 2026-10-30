import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { menuCartaPublicado } from "./fixtures/carta-menu";
import { prismaAdmin } from "../setup/cliente-duenio";
import { DESCUENTO_POR_PRODUCTO_VISIBLE } from "../../src/core/carta/descuento-producto";

/**
 * Producto con descuento (Fase 2 de promociones, un solo concepto) de punta a punta: el % que se carga en el admin de la carta (/carta, dentro del
 * producto) es lo que resuelve la carta pública (precio descontado + precio de lista), y sacarlo la deja como antes. Con un formulario abierto
 * también se comprueba accesibilidad (axe).
 *
 * Interruptor del descuento por producto (`DESCUENTO_POR_PRODUCTO_VISIBLE`, decisión del dueño 2026-10-29): mientras esté apagado, la ficha del producto no ofrece el campo, así que el primer recorrido
 * (que lo usa) se omite con el motivo a la vista y el segundo comprueba que el campo no aparece. Con el interruptor prendido pasa lo contrario.
 */
test("cargar y sacar el descuento de un producto desde /carta se refleja en la carta pública", async ({ paginaAutenticada: page, sucursalId }) => {
  test.skip(!DESCUENTO_POR_PRODUCTO_VISIBLE, "el descuento por producto está oculto (DESCUENTO_POR_PRODUCTO_VISIBLE = false en src/core/carta/descuento-producto.ts): la ficha del producto no ofrece el campo");
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Descuento Sección ${marca}`, titulo: "Con descuento", orden: 1 } });
  const producto = await prisma.producto.create({
    data: { codigo: `E2E_DESC_${marca}`, nombre: `E2E Descuento Plato ${marca}`, tipo: "PV", precioVenta: 10000, unidadStockId: unidad.id },
  });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: producto.id, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 1 } });

  const itemEnCarta = async () => {
    const carta = await menuCartaPublicado(sucursalId);
    const item = carta.secciones.find((s) => s.nombre === seccion.nombre)?.items.find((i) => i.productoId === producto.id);
    if (!item) throw new Error("el producto no aparece en la carta pública");
    return item;
  };

  try {
    // CARTA-MANT: la ficha de cada producto vive en Parametrización › Secciones.
    await page.goto("/carta/parametrizacion/secciones");
    await expect(page.getByRole("heading", { name: "Carta", level: 1 })).toBeVisible();
    // CARTA-MANT: los productos van agrupados por sección (plegada).
    await page.locator(`[data-grupo-de-la-carta="${seccion.nombre}"] > summary`).click();
    const fila = page.locator(`[data-contenido-carta="${producto.nombre}"]`);
    await fila.locator("summary").click();

    // Sin descuento al principio: la carta pública no trae precio de lista.
    expect(await itemEnCarta()).not.toHaveProperty("precioLista");

    // Alta: 15 % sobre $10.000.
    await fila.getByLabel(/^Descuento en esta sucursal/).fill("15");
    await fila.getByRole("button", { name: `Guardar descuento de «${producto.nombre}»` }).click();
    await expect(fila.getByRole("status")).toHaveText(`«${producto.nombre}» con 15 % de descuento en esta sucursal.`);
    await expect(fila.locator("summary")).toContainText("−15 %");
    expect(await itemEnCarta()).toMatchObject({ precio: 8500, precioLista: 10000, descuentoPorcentaje: 15 });

    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    // Baja: vacío = sin descuento.
    await fila.getByLabel(/^Descuento en esta sucursal/).fill("");
    await fila.getByRole("button", { name: `Guardar descuento de «${producto.nombre}»` }).click();
    await expect(fila.getByRole("status")).toHaveText(`«${producto.nombre}» vuelve a su precio, sin descuento en esta sucursal.`);
    const despues = await itemEnCarta();
    expect(despues).toMatchObject({ precio: 10000 });
    expect(despues).not.toHaveProperty("precioLista");
  } finally {
    await prisma.descuentoProductoSucursal.deleteMany({ where: { productoId: producto.id } });
    await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "DescuentoProductoSucursal", descripcion: `Descuento de "${producto.nombre}"` } });
    await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  }
});

test("con el interruptor apagado, la ficha del producto en /carta no ofrece el descuento", async ({ paginaAutenticada: page, sucursalId }) => {
  test.skip(DESCUENTO_POR_PRODUCTO_VISIBLE, "el descuento por producto está visible (DESCUENTO_POR_PRODUCTO_VISIBLE = true): vale el recorrido de arriba");
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E SinDesc Sección ${marca}`, titulo: "Sin descuento", orden: 1 } });
  const producto = await prisma.producto.create({
    data: { codigo: `E2E_SINDESC_${marca}`, nombre: `E2E SinDesc Plato ${marca}`, tipo: "PV", precioVenta: 10000, unidadStockId: unidad.id },
  });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: producto.id, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 1 } });

  try {
    await page.goto("/carta/parametrizacion/secciones");
    await expect(page.getByRole("heading", { name: "Carta", level: 1 })).toBeVisible();
    await page.locator(`[data-grupo-de-la-carta="${seccion.nombre}"] > summary`).click();
    const fila = page.locator(`[data-contenido-carta="${producto.nombre}"]`);
    await fila.locator("summary").click();

    // La ficha se abrió (el contenido sigue editable) pero no hay campo ni botón de descuento.
    await expect(fila.getByRole("button", { name: `Guardar contenido de «${producto.nombre}»` })).toBeVisible();
    await expect(fila.getByLabel(/^Descuento en esta sucursal/)).toHaveCount(0);
    await expect(fila.getByRole("button", { name: `Guardar descuento de «${producto.nombre}»` })).toHaveCount(0);
  } finally {
    await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  }
});
