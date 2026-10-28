import { randomUUID } from "node:crypto";
import type { Browser, Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { crearMembresias } from "../setup/membresia";
import { prismaAdmin } from "../setup/cliente-duenio";

/**
 * E3a (ADR-041; docs/diseno-factura-de-proveedor-e3a-2026-10-27.md): la factura de proveedor repartida, de punta a punta, en la pantalla de Compra.
 *  1. El administrador (en «Central», la sucursal que compra) carga una factura de $1000 con el interruptor «Repartir entre sucursales»: $600 para Central y $400 para una sucursal nueva.
 *     La parte de Central entra al stock al confirmar; la de la otra queda propuesta.
 *  2. Un operario con membresía SOLO en esa sucursal ve «Para aceptar (1)» con el producto y la cantidad, SIN importes (decisión del dueño, 2026-10-28), y la acepta.
 *  3. El administrador anula la factura entera desde «Compras registradas», con motivo: sin permiso en la otra sucursal se rechaza (P4); con permiso, el stock vuelve en las dos.
 * Todo lo sembrado lleva una marca única y se limpia al final con el dueño de las tablas (las de la factura solo admiten agregar para la app).
 */
async function elegirSelectPorOpcion(page: Page, textoOpcion: string) {
  for (const select of await page.locator("select").all()) {
    if ((await select.locator("option").allTextContents()).includes(textoOpcion)) {
      await select.selectOption({ label: textoOpcion });
      return;
    }
  }
  throw new Error(`Ningún <select> tiene una opción "${textoOpcion}"`);
}

async function operarioSoloEn(browser: Browser, baseURL: string | undefined, sucursalId: string, marca: string) {
  const operador = await prisma.rol.findFirstOrThrow({ where: { clave: "operador" } });
  const usuario = await prisma.user.create({ data: { email: `e2e-factura-op-${marca}@local.test`, activoGlobal: true } });
  await crearMembresias([{ usuarioId: usuario.id, sucursalId, rolId: operador.id, activo: true }]);
  const sessionToken = randomUUID();
  await prisma.session.create({ data: { sessionToken, userId: usuario.id, expires: new Date(Date.now() + 1000 * 60 * 60) } });
  const contexto = await browser.newContext();
  await contexto.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: new URL(baseURL ?? "http://localhost:3000").hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
  return { usuario, contexto, page: await contexto.newPage() };
}

test("cargar una factura repartida, aceptar la parte desde la otra sucursal (sin ver importes) y anular la factura entera", async ({ paginaAutenticada: page, browser, baseURL, sucursalId, seccionId }) => {
  test.setTimeout(120_000);
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const central = await prisma.sucursal.findUniqueOrThrow({ where: { id: sucursalId } });
  const seccion = await prisma.seccion.findUniqueOrThrow({ where: { id: seccionId } });
  const destino = await prisma.sucursal.create({ data: { nombre: `E2E Destino Factura ${marca}` } });
  const seccionDestino = await prisma.seccion.create({ data: { sucursalId: destino.id, nombre: `E2E Depósito Destino ${marca}` } });
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const proveedor = await prisma.proveedor.create({ data: { codigo: `PRV_E2E_FR_${marca}`, nombre: `E2E Proveedor Repartida ${marca}` } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-FR-${marca}`, nombre: `E2E Harina Repartida ${marca}`, tipo: "MP", unidadStockId: unidad.id } });
  await prisma.disponibilidadProducto.createMany({ data: [sucursalId, destino.id].map((s) => ({ sucursalId: s, productoId: producto.id, disponible: true })) });
  const numero = `0007-${marca.replace("-", "").slice(-8)}`;
  const op = await operarioSoloEn(browser, baseURL, destino.id, marca);
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });

  try {
    // 1. Cargar la factura y repartirla.
    await page.goto("/movimientos/compra");
    await elegirSelectPorOpcion(page, seccion.nombre);
    await elegirSelectPorOpcion(page, proveedor.nombre);
    await expect(page.getByText(/Todavía no le compraste nada a este proveedor/)).toBeVisible();
    await page.getByLabel("N° de factura").fill(numero);
    await page.locator('input[placeholder="Código o nombre…"]').first().fill(producto.nombre);
    await page.getByRole("option", { name: new RegExp(producto.nombre) }).click();
    await page.locator("label:has-text('Cantidad') input").first().fill("10");
    await page.locator("label:has-text('Precio total') input").first().fill("1000");
    const bloque = page.getByTestId("bloque-reparto");
    await bloque.getByLabel("Repartir entre sucursales").check();
    await bloque.getByLabel(`Parte de ${destino.nombre}`, { exact: true }).check();
    await bloque.getByLabel(`Importe de ${central.nombre}`).fill("600");
    await expect(bloque).toContainText("Falta repartir");
    await bloque.getByLabel(`Importe de ${destino.nombre}`).fill("400");
    await expect(bloque).toContainText("El reparto cierra.");
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
    await expect(page.getByText(/Quedan para aceptar las partes de/)).toBeVisible();

    const factura = await prismaAdmin.facturaProveedor.findFirstOrThrow({ where: { proveedorId: proveedor.id }, include: { partes: true, propuestas: true } });
    expect(Number(factura.importeTotal)).toBe(1000);
    expect(factura.partes.map((p) => p.sucursalId)).toEqual([sucursalId]);
    expect(factura.propuestas.map((p) => [p.destinoSucursalId, p.estado])).toEqual([[destino.id, "PENDIENTE"]]);
    const enCentral = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: producto.id, seccionId } });
    expect([Number(enCentral.cantidad), Number(enCentral.precioTotal)]).toEqual([6, 600]);
    expect(await prisma.movimientoStock.count({ where: { productoId: producto.id, seccionId: seccionDestino.id } }), "la parte propuesta no entra a la otra sucursal hasta que la acepte").toBe(0);
    // En la Compra de Central queda a la vista lo propuesto y su estado.
    await expect(page.getByTestId("propuestas-enviadas")).toContainText(`«${destino.nombre}»: pendiente`);

    // 2. La otra sucursal la ve (producto y cantidad, ningún importe) y la acepta.
    await op.page.goto("/movimientos/compra");
    const bandeja = op.page.getByRole("region", { name: "Para aceptar (1)" });
    const propuesta = bandeja.getByTestId("propuesta-para-aceptar");
    await expect(propuesta).toContainText(`${producto.nombre}: 4 kg`);
    await expect(propuesta).toContainText(central.nombre);
    await expect(propuesta).not.toContainText("$");
    await expect(propuesta).not.toContainText("400");
    await expect(propuesta).not.toContainText("600");
    await propuesta.getByRole("combobox", { name: "Depósito" }).selectOption({ label: seccionDestino.nombre });
    await propuesta.getByRole("button", { name: "Aceptar", exact: true }).click();
    await expect(op.page.getByText(/Parte aceptada: 1 movimiento/)).toBeVisible();
    const enDestino = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: producto.id, seccionId: seccionDestino.id } });
    expect([Number(enDestino.cantidad), Number(enDestino.precioTotal)]).toEqual([4, 400]);
    expect((await prismaAdmin.facturaProveedorPropuesta.findFirstOrThrow({ where: { facturaProveedorId: factura.id } })).estado).toBe("ACEPTADA");

    // 3. Anular la factura entera desde Compras registradas (en Central): pide motivo y confirmación. La parte de la otra sucursal ya entró a su stock, así que hace falta
    //    `anular_compra` TAMBIÉN allí (decisión del dueño P4): sin membresía en esa sucursal se rechaza nombrándolo y no se anula nada.
    const anularDesdeCompras = async () => {
      await page.goto(`/reportes/compras?proveedorId=${proveedor.id}`);
      const tarjeta = page.locator(`[data-compra="${factura.partes[0].operacionId}"]`);
      await tarjeta.locator("summary").click();
      await expect(tarjeta).toContainText("se anula la factura entera");
      await expect(tarjeta.getByRole("button", { name: /^Anular compra/ })).toHaveCount(0);
      await tarjeta.getByLabel("Motivo de la anulación de la factura").fill("carga de prueba");
      await tarjeta.getByRole("button", { name: /^Anular la factura/ }).click();
      await tarjeta.getByRole("button", { name: "Sí, anular la factura" }).click();
      return tarjeta;
    };
    const sinPermisoAlla = await anularDesdeCompras();
    await expect(sinPermisoAlla.getByRole("alert").filter({ hasText: "No podés anular esta factura" })).toBeVisible();
    expect((await prismaAdmin.facturaProveedor.findUniqueOrThrow({ where: { id: factura.id } })).anuladaEn).toBeNull();

    const rolAdmin = await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } });
    await crearMembresias([{ usuarioId: admin.id, sucursalId: destino.id, rolId: rolAdmin.id, activo: true }]);
    const tarjeta = await anularDesdeCompras();
    await expect(tarjeta.getByText(/Factura anulada/)).toBeVisible();

    expect((await prismaAdmin.facturaProveedor.findUniqueOrThrow({ where: { id: factura.id } })).anuladaEn).not.toBeNull();
    expect((await prismaAdmin.anulacionDeFacturaProveedor.findFirstOrThrow({ where: { facturaProveedorId: factura.id } })).motivo).toBe("carga de prueba");
    for (const s of [seccionId, seccionDestino.id]) {
      const saldo = await prisma.movimientoStock.aggregate({ where: { productoId: producto.id, seccionId: s }, _sum: { cantidad: true } });
      expect(Number(saldo._sum.cantidad), "el stock vuelve en las dos sucursales").toBe(0);
    }
  } finally {
    await op.contexto.close();
    const ids = (await prismaAdmin.facturaProveedor.findMany({ where: { proveedorId: proveedor.id }, select: { id: true } })).map((f) => f.id);
    const operaciones = [...new Set((await prismaAdmin.movimientoStock.findMany({ where: { productoId: producto.id }, select: { operacionId: true } })).map((m) => m.operacionId))];
    await prismaAdmin.anulacionDeFacturaProveedor.deleteMany({ where: { facturaProveedorId: { in: ids } } });
    await prismaAdmin.facturaProveedorPropuestaRenglon.deleteMany({ where: { facturaProveedorId: { in: ids } } });
    await prismaAdmin.facturaProveedorPropuesta.deleteMany({ where: { facturaProveedorId: { in: ids } } });
    await prismaAdmin.facturaProveedorSucursal.deleteMany({ where: { facturaProveedorId: { in: ids } } });
    await prismaAdmin.movimientoStock.deleteMany({ where: { productoId: producto.id } });
    await prismaAdmin.operacion.deleteMany({ where: { id: { in: operaciones } } });
    await prismaAdmin.operacion.deleteMany({ where: { proveedorId: proveedor.id } });
    await prismaAdmin.facturaProveedorRenglon.deleteMany({ where: { facturaProveedorId: { in: ids } } });
    await prismaAdmin.registroAuditoria.deleteMany({ where: { entidadId: { in: [...ids, ...operaciones] } } });
    await prismaAdmin.facturaProveedor.deleteMany({ where: { id: { in: ids } } });
    await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "ProveedorPorProducto", entidadId: { contains: producto.id } } });
    await prismaAdmin.proveedorPorProducto.deleteMany({ where: { productoId: producto.id } });
    await prismaAdmin.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
    await prismaAdmin.producto.deleteMany({ where: { id: producto.id } });
    await prismaAdmin.proveedor.deleteMany({ where: { id: proveedor.id } });
    await prismaAdmin.session.deleteMany({ where: { userId: op.usuario.id } });
    await prismaAdmin.usuarioSucursal.deleteMany({ where: { OR: [{ usuarioId: op.usuario.id }, { sucursalId: destino.id }] } });
    await prismaAdmin.usuarioEmpresa.deleteMany({ where: { usuarioId: op.usuario.id } });
    await prismaAdmin.user.deleteMany({ where: { id: op.usuario.id } });
    await prismaAdmin.seccion.deleteMany({ where: { id: seccionDestino.id } });
    await prismaAdmin.capacidadSucursal.deleteMany({ where: { sucursalId: destino.id } });
    await prismaAdmin.sucursal.deleteMany({ where: { id: destino.id } });
  }
});
