import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { prismaAdmin } from "../setup/cliente-duenio";
import { crearMembresia } from "../setup/membresia";

/**
 * La tarjeta «Ocultar» de la ficha del producto (docs/diseno-ocultar-como-pedernal-2026-11-15.md, etapa d; Pedernal A15), en un navegador real: dos filas (la sucursal y toda la empresa) con su botón; ocultar y volver a mostrar;
 * doble clic = una sola marca y un solo registro; dos pestañas con la pantalla vieja (la segunda es «ya estaba», sin error); con existencia no se oculta y dice por qué; y la tarjeta sin violaciones de accesibilidad (axe).
 * El usuario de las pruebas es administrador; para que cuente como «alcance total» se lo suma a toda otra sucursal activa de la empresa mientras dura el spec (y se lo saca al terminar).
 */
test.describe.configure({ mode: "serial" });

test("ocultar y volver a mostrar en la sucursal y en toda la empresa; doble clic; dos pestañas; existencia; axe", async ({ paginaAutenticada: page, sucursalId, browser, baseURL }) => {
  const marca = `${Date.now()}`;
  const { empresaId } = await prismaAdmin.sucursal.findUniqueOrThrow({ where: { id: sucursalId }, select: { empresaId: true } });
  const admin = await prismaAdmin.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const rolAdmin = await prismaAdmin.rol.findFirstOrThrow({ where: { empresaId, clave: "admin" } });
  const otras = await prismaAdmin.sucursal.findMany({ where: { empresaId, activo: true, id: { not: sucursalId } }, select: { id: true } });
  const membresiasCreadas: string[] = [];
  for (const o of otras) {
    const ya = await prismaAdmin.usuarioSucursal.findFirst({ where: { usuarioId: admin.id, sucursalId: o.id, activo: true } });
    if (!ya) {
      membresiasCreadas.push((await crearMembresia({ usuarioId: admin.id, sucursalId: o.id, rolId: rolAdmin.id, activo: true })).id);
    }
  }
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-OC-${marca}`, nombre: `E2E Ocultar ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 1000 } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
  let operacionId: string | null = null;
  const marcas = () => prismaAdmin.ocultamientoProducto.findMany({ where: { productoId: producto.id } });
  const registros = () => prismaAdmin.registroAuditoria.count({ where: { entidad: "OcultamientoProducto", descripcion: { contains: producto.nombre } } });
  const tarjeta = (p: typeof page) => p.getByRole("region", { name: "Ocultar" });

  try {
    await page.goto(`/catalogo/productos/${producto.id}`);
    await expect(tarjeta(page)).toBeVisible();
    await expect(tarjeta(page).getByRole("button", { name: "Ocultar", exact: true })).toBeVisible();
    await expect(tarjeta(page).getByRole("button", { name: "Ocultar en toda la empresa" })).toBeVisible();
    expect((await new AxeBuilder({ page }).include("[data-tarjeta-ocultar]").analyze()).violations).toEqual([]);

    // Dos pestañas: la «vieja» se abre ahora y sigue diciendo «Ocultar» aunque la otra ya oculte.
    const vieja = await (await browser.newContext({ storageState: await page.context().storageState(), baseURL })).newPage();
    await vieja.goto(`/catalogo/productos/${producto.id}`);
    await expect(tarjeta(vieja).getByRole("button", { name: "Ocultar", exact: true })).toBeVisible();

    // Ocultar en la sucursal: aviso «Oculto» y el botón pide el estado contrario.
    await tarjeta(page).getByRole("button", { name: "Ocultar", exact: true }).click();
    await expect(tarjeta(page).getByText("Oculto", { exact: true })).toBeVisible();
    await expect(tarjeta(page).getByRole("button", { name: "Volver a mostrar" })).toBeVisible();
    expect(await marcas()).toMatchObject([{ sucursalId, oculto: true }]);
    const registrosTrasOcultar = await registros();

    // La pestaña vieja pide lo mismo: «ya estaba», sin error, sin segunda marca ni segundo registro; al refrescar ya dice «Volver a mostrar».
    await tarjeta(vieja).getByRole("button", { name: "Ocultar", exact: true }).click();
    await expect(tarjeta(vieja).getByRole("button", { name: "Volver a mostrar" })).toBeVisible();
    await expect(vieja.getByRole("alert")).toHaveCount(0);
    expect(await marcas()).toHaveLength(1);
    expect(await registros()).toBe(registrosTrasOcultar);
    await vieja.close();

    await tarjeta(page).getByRole("button", { name: "Volver a mostrar" }).click();
    await expect(tarjeta(page).getByRole("button", { name: "Ocultar", exact: true })).toBeVisible();
    expect((await marcas())[0]?.oculto).toBe(false);

    // Doble clic en «Ocultar en toda la empresa»: una sola marca de la empresa y un solo registro de ese cambio.
    const antes = await registros();
    await tarjeta(page).getByRole("button", { name: "Ocultar en toda la empresa" }).dblclick();
    await expect(tarjeta(page).getByText("Oculto en toda la empresa", { exact: true })).toBeVisible();
    const deLaEmpresa = (await marcas()).filter((m) => m.sucursalId === null);
    expect(deLaEmpresa).toHaveLength(1);
    expect(deLaEmpresa[0]?.oculto).toBe(true);
    expect(await registros()).toBe(antes + 1);
    // La sucursal no puede mostrar lo que la empresa oculta: sin botón en su fila.
    await expect(page.locator('[data-fila-ocultar="local"]').getByRole("button")).toHaveCount(0);
    expect((await new AxeBuilder({ page }).include("[data-tarjeta-ocultar]").analyze()).violations).toEqual([]);

    // Volver a mostrar en toda la empresa y, con existencia, ocultar se rechaza con su motivo (y no deja marca).
    await tarjeta(page).getByRole("button", { name: "Volver a mostrar" }).click();
    await expect(tarjeta(page).getByRole("button", { name: "Ocultar en toda la empresa" })).toBeVisible();
    const seccion = await prisma.seccion.create({ data: { sucursalId, nombre: `E2E Sec ${marca}` } });
    const op = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: admin.id } });
    operacionId = op.id;
    await prisma.movimientoStock.create({ data: { operacionId: op.id, productoId: producto.id, seccionId: seccion.id, proceso: "COMPRA", cantidad: 3, detalle: "e2e" } });
    await page.reload();
    await tarjeta(page).getByRole("button", { name: "Ocultar en toda la empresa" }).click();
    await expect(tarjeta(page).getByText("Primero dejá la existencia en 0.")).toBeVisible();
    expect((await marcas()).filter((m) => m.sucursalId === null && m.oculto)).toHaveLength(0);
    expect((await new AxeBuilder({ page }).include("[data-tarjeta-ocultar]").analyze()).violations).toEqual([]);
  } finally {
    await prismaAdmin.movimientoStock.deleteMany({ where: { productoId: producto.id } });
    await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "OcultamientoProducto", descripcion: { contains: producto.nombre } } });
    await prismaAdmin.ocultamientoProducto.deleteMany({ where: { productoId: producto.id } });
    if (operacionId) await prismaAdmin.operacion.deleteMany({ where: { id: operacionId } });
    await prismaAdmin.seccion.deleteMany({ where: { nombre: `E2E Sec ${marca}` } });
    await prismaAdmin.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
    await prismaAdmin.producto.deleteMany({ where: { id: producto.id } });
    for (const id of membresiasCreadas) await prismaAdmin.usuarioSucursal.deleteMany({ where: { id } });
  }
});
