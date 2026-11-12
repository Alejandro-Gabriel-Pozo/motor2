import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { prismaAdmin } from "../setup/cliente-duenio";
import { ESTA_BIEN_ASI_VISIBLE } from "../../src/core/carta/esta-bien-asi";

// Interruptor de «Está bien así»: mientras esté apagado, este spec no corre (encendido vuelve a correr entero).
test.skip(!ESTA_BIEN_ASI_VISIBLE, "«Está bien así» apagado (ESTA_BIEN_ASI_VISIBLE = false en src/core/carta/esta-bien-asi.ts): Carta › Hoy no dibuja la lista de platos sin nombre de carta");

/**
 * «Platos de la carta sin nombre de carta» y «Está bien así» (confirmado por el dueño, 2026-11-04; `docs/diseno-nombre-en-carta-2026-11-04.md`, §11 F), a 375 px de ancho, con el servidor de producción y la
 * base real: la lista aparece en Carta › Hoy con los platos visibles que no tienen nombre de carta, sin desborde horizontal ni violaciones de axe; «Está bien así» copia el nombre del producto, saca al plato de la
 * lista y deja el nombre en la base; un plato con nombre propio no aparece.
 */
test("la lista de platos sin nombre de carta y el botón «Está bien así», a 375 px", async ({ paginaAutenticada: page, sucursalId }) => {
  test.setTimeout(90_000);
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const crear = (clave: string, nombre: string) => prisma.producto.create({ data: { codigo: `E2E-NP-${clave}-${marca}`, nombre, tipo: "PV", unidadStockId: unidad.id, precioVenta: 5000 } });
  const pendiente = await crear("A", `E2E Milanesa napolitana con guarnición ${marca}`);
  const otroPendiente = await crear("B", `E2E Flan casero ${marca}`);
  const conNombre = await crear("C", `E2E Bife ${marca}`);
  const productoIds = [pendiente.id, otroPendiente.id, conNombre.id];
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Platos ${marca}`, orden: 1 } });
  for (const p of [pendiente, otroPendiente, conNombre]) await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible: true } });
  await prisma.contenidoCartaProducto.createMany({
    data: [
      { sucursalId, productoId: pendiente.id, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 1 },
      { sucursalId, productoId: otroPendiente.id, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 2 },
      { sucursalId, productoId: conNombre.id, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 3, nombreEnCarta: "La Parrilla" },
    ],
  });
  try {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/carta");
    const lista = page.locator("[data-nombres-de-carta-pendientes]");
    await expect(lista).toBeVisible();
    await expect(lista.locator(`[data-plato-pendiente="${pendiente.nombre}"]`)).toContainText("Nombre de carta: pendiente de completar");
    await expect(lista.locator(`[data-plato-pendiente="${otroPendiente.nombre}"]`)).toBeVisible();
    await expect(lista.locator(`[data-plato-pendiente="${conNombre.nombre}"]`), "uno con nombre propio no aparece").toHaveCount(0);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "la página se desborda a 375 px").toBe(true);
    expect((await new AxeBuilder({ page }).include("[data-nombres-de-carta-pendientes]").analyze()).violations).toEqual([]);

    // «Está bien así»: copia el nombre del producto y el plato sale de la lista.
    await lista.getByRole("button", { name: `Está bien así: ${pendiente.nombre}` }).click();
    await expect(lista.locator(`[data-plato-pendiente="${pendiente.nombre}"]`)).toHaveCount(0);
    await expect(lista.locator(`[data-plato-pendiente="${otroPendiente.nombre}"]`)).toBeVisible();
    const fila = await prisma.contenidoCartaProducto.findFirstOrThrow({ where: { sucursalId, productoId: pendiente.id } });
    expect(fila.nombreEnCarta).toBe(pendiente.nombre);
    expect((await prisma.contenidoCartaProducto.findFirstOrThrow({ where: { sucursalId, productoId: otroPendiente.id } })).nombreEnCarta, "el otro sigue sin decidir").toBeNull();
    expect(await prisma.registroAuditoria.count({ where: { entidad: "ContenidoCartaProducto", campo: "nombreEnCarta", entidadId: `${sucursalId}:${pendiente.id}` } })).toBe(1);
  } finally {
    // La auditoría solo se agrega (el rol de la app no la borra): se limpia como dueño.
    await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "ContenidoCartaProducto", campo: "nombreEnCarta", entidadId: { in: productoIds.map((id) => `${sucursalId}:${id}`) } } });
    await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: { in: productoIds } } });
    await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: productoIds } } });
    await prisma.producto.deleteMany({ where: { id: { in: productoIds } } });
  }
});
