import { randomUUID } from "node:crypto";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { crearMembresia } from "../setup/membresia";
import { ajustarCeldasDelAdmin } from "./fixtures/admin-con-filas";
import { prismaAdmin } from "../setup/cliente-duenio";

/**
 * Corregir la cabecera de una compra (proveedor, N.º de factura y detalle) desde «Compras registradas» (K1b). Se siembran las compras directo en la base, con
 * proveedores y producto propios de cada prueba (marca única), y cada prueba limpia lo que creó. `proveedorId` en la URL acota la lista.
 */
async function sembrar(sucursalId: string, seccionId: string) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-CC-${marca}`, nombre: `E2E Harina Corregir ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  const molino = await prisma.proveedor.create({ data: { codigo: `PRV_E2E_CC1_${marca}`, nombre: `E2E Molino Corregir ${marca}` } });
  const distribuidora = await prisma.proveedor.create({ data: { codigo: `PRV_E2E_CC2_${marca}`, nombre: `E2E Distribuidora Corregir ${marca}` } });
  const operaciones: string[] = [];
  async function compra(opciones: { proveedorId?: string; nroFactura: string; detalleLibre?: string }) {
    const op = await prisma.operacion.create({
      data: {
        sucursalId,
        proceso: "COMPRA",
        fecha: new Date("2026-08-10T12:00:00Z"),
        proveedorId: opciones.proveedorId ?? null,
        nroFactura: opciones.nroFactura,
        detalleLibre: opciones.detalleLibre ?? null,
        usuarioId: admin.id,
      },
    });
    operaciones.push(op.id);
    await prisma.movimientoStock.create({
      data: { operacionId: op.id, productoId: producto.id, seccionId, proceso: "COMPRA", cantidad: 10, detalle: "Compra", precioTotal: 1000, precioPorUnidadStock: 100 },
    });
    return op;
  }
  const limpiar = async () => {
    await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "Operacion", entidadId: { in: operaciones } } });
    await prisma.movimientoStock.deleteMany({ where: { productoId: producto.id } });
    await prisma.operacion.deleteMany({ where: { id: { in: operaciones } } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
    await prisma.proveedor.deleteMany({ where: { id: { in: [molino.id, distribuidora.id] } } });
  };
  return { marca, molino, distribuidora, compra, limpiar };
}

test("se corrige el proveedor y el N.º de factura de una compra, sin tocar sus líneas, y el foco y los avisos acompañan", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const s = await sembrar(sucursalId, seccionId);
  try {
    // Una compra cargada «Sin proveedor» y con la factura mal tipeada: el caso real.
    const op = await s.compra({ nroFactura: `MAL-${s.marca}`, detalleLibre: "sin proveedor" });
    // El filtro por factura usa la marca, que tienen tanto el número mal tipeado como el corregido: si filtrara por el número viejo, la compra saldría de la
    // lista apenas se corrige (ya no coincide) y el aviso de éxito se iría con ella.
    await page.goto(`/reportes/compras?factura=${encodeURIComponent(s.marca)}`);
    const tarjeta = page.locator(`[data-compra="${op.id}"]`);
    await expect(tarjeta).toContainText("Sin proveedor");
    await tarjeta.locator("summary").click();

    // Abrir: el foco va al primer campo y el formulario avisa qué NO se corrige acá.
    await tarjeta.getByRole("button", { name: /^Corregir proveedor y factura/ }).click();
    const proveedor = tarjeta.getByLabel("Proveedor", { exact: true });
    await expect(proveedor).toBeFocused();
    await expect(tarjeta.getByText(/Para cambiar precios o cantidades, anulá la compra/)).toBeVisible();
    await expect(tarjeta.getByRole("button", { name: "Guardar corrección" })).toBeDisabled(); // todavía no hay cambios

    // Escape cancela y el foco vuelve al botón que lo abrió; no se guardó nada.
    await page.keyboard.press("Escape");
    await expect(tarjeta.getByLabel("Proveedor", { exact: true })).toHaveCount(0);
    await expect(tarjeta.getByRole("button", { name: /^Corregir proveedor y factura/ })).toBeFocused();

    // Corregir de verdad.
    await tarjeta.getByRole("button", { name: /^Corregir proveedor y factura/ }).click();
    await tarjeta.getByLabel("Proveedor", { exact: true }).selectOption({ label: s.molino.nombre });
    await tarjeta.getByLabel("N.º de factura", { exact: true }).fill(`BIEN-${s.marca}`);
    await expect(tarjeta.getByRole("button", { name: "Guardar corrección" })).toBeEnabled();
    await tarjeta.getByRole("button", { name: "Guardar corrección" }).click();

    const aviso = tarjeta.getByRole("status").filter({ hasText: "Compra corregida" });
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText("proveedor");
    await expect(aviso).toContainText("N.º de factura");
    await expect(aviso).toBeFocused(); // el formulario desaparece: el foco no cae al <body>

    // La fila ya muestra lo corregido.
    await expect(tarjeta).toContainText(s.molino.nombre);
    await expect(tarjeta).toContainText(`Factura BIEN-${s.marca}`);

    // En la base: cabecera corregida, auditoría por campo y el Kardex EXACTAMENTE igual.
    const guardada = await prisma.operacion.findUniqueOrThrow({ where: { id: op.id } });
    expect(guardada.proveedorId).toBe(s.molino.id);
    expect(guardada.nroFactura).toBe(`BIEN-${s.marca}`);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "Operacion", entidadId: op.id } })).toBe(2);
    const linea = await prisma.movimientoStock.findFirstOrThrow({ where: { operacionId: op.id } });
    expect(Number(linea.precioTotal)).toBe(1000);
    expect(Number(linea.cantidad)).toBe(10);
  } finally {
    await s.limpiar();
  }
});

test("un N.º de factura ya usado por otra compra vigente del proveedor se rechaza con un aviso visible, y el formulario sigue abierto", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const s = await sembrar(sucursalId, seccionId);
  try {
    await s.compra({ proveedorId: s.molino.id, nroFactura: `USADA-${s.marca}` });
    const otra = await s.compra({ proveedorId: s.molino.id, nroFactura: `OTRA-${s.marca}` });
    await page.goto(`/reportes/compras?proveedorId=${s.molino.id}`);
    const tarjeta = page.locator(`[data-compra="${otra.id}"]`);
    await tarjeta.locator("summary").click();
    await tarjeta.getByRole("button", { name: /^Corregir proveedor y factura/ }).click();
    await tarjeta.getByLabel("N.º de factura", { exact: true }).fill(`USADA-${s.marca}`);
    await tarjeta.getByRole("button", { name: "Guardar corrección" }).click();

    const error = tarjeta.getByRole("alert").filter({ hasText: "Ya hay una compra registrada con esa factura" });
    await expect(error).toBeVisible();
    await expect(tarjeta.getByLabel("N.º de factura", { exact: true })).toBeVisible(); // sigue abierto para poder corregirlo
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: otra.id } })).nroFactura).toBe(`OTRA-${s.marca}`);
  } finally {
    await s.limpiar();
  }
});

test("si otra persona corrigió la compra mientras se editaba, no se pisa: se avisa", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const s = await sembrar(sucursalId, seccionId);
  try {
    const op = await s.compra({ proveedorId: s.molino.id, nroFactura: `ORIG-${s.marca}` });
    await page.goto(`/reportes/compras?proveedorId=${s.molino.id}`);
    const tarjeta = page.locator(`[data-compra="${op.id}"]`);
    await tarjeta.locator("summary").click();
    await tarjeta.getByRole("button", { name: /^Corregir proveedor y factura/ }).click();
    await tarjeta.getByLabel("N.º de factura", { exact: true }).fill(`MIA-${s.marca}`);

    // Mientras tanto, otra persona la corrige (directo en la base).
    await prisma.operacion.update({ where: { id: op.id }, data: { nroFactura: `DE-OTRA-${s.marca}` } });

    await tarjeta.getByRole("button", { name: "Guardar corrección" }).click();
    await expect(tarjeta.getByRole("alert").filter({ hasText: "cambió mientras la editabas" })).toBeVisible();
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: op.id } })).nroFactura).toBe(`DE-OTRA-${s.marca}`); // no se pisó
  } finally {
    await s.limpiar();
  }
});

test("una compra anulada no ofrece corregir, y quien no tiene «corregir_compra» no ve el botón", async ({ paginaAutenticada: page, browser, baseURL, sucursalId, seccionId }) => {
  const s = await sembrar(sucursalId, seccionId);
  const marca = Date.now();
  // «corregir_compra» es de piso administrador: «quien no la tiene» se arma sobre el rol «admin», quitándole la celda recién después de la fase del admin.
  const admin = await ajustarCeldasDelAdmin({});
  const rol = { id: admin.rolId };
  const usuario = await prisma.user.create({ data: { email: `e2e-sin-corregir-${marca}@local.test`, activoGlobal: true } });
  await crearMembresia({ usuarioId: usuario.id, sucursalId, rolId: rol.id, activo: true });
  const sessionToken = randomUUID();
  await prisma.session.create({ data: { sessionToken, userId: usuario.id, expires: new Date(Date.now() + 1000 * 60 * 60) } });
  const contexto = await browser.newContext();
  await contexto.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: new URL(baseURL ?? "http://localhost:3000").hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
  try {
    const anulada = await s.compra({ proveedorId: s.molino.id, nroFactura: `ANUL-${s.marca}` });
    await prisma.operacion.update({ where: { id: anulada.id }, data: { anuladaEn: new Date() } });
    const vigente = await s.compra({ proveedorId: s.molino.id, nroFactura: `VIG-${s.marca}` });

    // El admin: la vigente ofrece corregir; la anulada, no.
    await page.goto(`/reportes/compras?proveedorId=${s.molino.id}`);
    const tVigente = page.locator(`[data-compra="${vigente.id}"]`);
    const tAnulada = page.locator(`[data-compra="${anulada.id}"]`);
    await tVigente.locator("summary").click();
    await tAnulada.locator("summary").click();
    await expect(tVigente.getByRole("button", { name: /^Corregir proveedor y factura/ })).toBeVisible();
    await expect(tAnulada.getByRole("button", { name: /Corregir proveedor y factura/ })).toHaveCount(0);

    // Quien ve los reportes de dinero pero no tiene «corregir_compra»: ve la compra, sin el botón.
    await admin.cambiar({ corregir_compra: null });
    const otra = await contexto.newPage();
    await otra.goto(`/reportes/compras?proveedorId=${s.molino.id}`);
    const tOtra = otra.locator(`[data-compra="${vigente.id}"]`);
    await expect(tOtra).toBeVisible();
    await tOtra.locator("summary").click();
    await expect(tOtra).toContainText(`VIG-${s.marca}`);
    await expect(tOtra.getByRole("button", { name: /Corregir proveedor y factura/ })).toHaveCount(0);
  } finally {
    await contexto.close();
    await s.limpiar();
    await prisma.session.deleteMany({ where: { userId: usuario.id } });
    await prisma.usuarioSucursal.deleteMany({ where: { usuarioId: usuario.id } });
    await prisma.usuarioEmpresa.deleteMany({ where: { usuarioId: usuario.id } });
    await prisma.user.deleteMany({ where: { id: usuario.id } });
    await admin.restaurar();
  }
});
