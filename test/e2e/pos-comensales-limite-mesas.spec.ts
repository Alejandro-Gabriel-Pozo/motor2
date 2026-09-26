import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Comensales al abrir mesa y límite de mesas abiertas por sucursal (docs/plan-comensales-y-limite-mesas-2026-09-26.md):
 * - el modal «¿Cuántos comensales?» al abrir cuenta (obligatorio, sin default; botones rápidos 1-6 + «Otro»);
 * - corregir los comensales mientras la cuenta sigue abierta;
 * - el límite de mesas abiertas por sucursal (bloqueo en seco, D6) y su control en el mapa de mesas;
 * - el reporte de rotación de mesas.
 *
 * Cada caso que toca `Sucursal.maxMesasAbiertas` lo restaura a `null` en `finally`: es un dato compartido de «Central», no algo
 * propio de la mesa que siembra el caso.
 */

const aviso = (page: Page) => page.locator('[role="status"][aria-live="polite"]');

test("modal de comensales: sin elegir, error y no abre la cuenta; con un botón rápido, abre con ese valor", async ({ paginaAutenticada: page, sucursalId }) => {
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 990 } });
  try {
    await page.goto(`/mesas/${mesa.id}`);
    await page.getByRole("button", { name: "Abrir cuenta" }).click();
    const dialogo = page.getByRole("dialog", { name: "¿Cuántos comensales?" });
    await expect(dialogo).toBeVisible();

    // Sin elegir nada: error, el diálogo sigue abierto y no se creó ninguna cuenta.
    await dialogo.getByRole("button", { name: "Confirmar apertura" }).click();
    await expect(dialogo.getByRole("alert")).toHaveText("Elegí cuántos comensales son.");
    expect(await prisma.cuenta.count({ where: { mesaId: mesa.id } })).toBe(0);

    // Botón rápido "4" y confirmar: abre con 4 comensales.
    await dialogo.getByRole("button", { name: "4", exact: true }).click();
    await dialogo.getByRole("button", { name: "Confirmar apertura" }).click();
    await expect(dialogo).toHaveCount(0);
    await expect(aviso(page)).toHaveText("Cuenta de la mesa 990 abierta.");
    const cuenta = await prisma.cuenta.findFirstOrThrow({ where: { mesaId: mesa.id } });
    expect(cuenta.comensales).toBe(4);
  } finally {
    await prisma.cuenta.deleteMany({ where: { mesaId: mesa.id } });
    await prisma.mesa.deleteMany({ where: { id: mesa.id } });
  }
});

test('modal de comensales: el campo "Otro" abre con cualquier cantidad entre 1 y 99', async ({ paginaAutenticada: page, sucursalId }) => {
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 991 } });
  try {
    await page.goto(`/mesas/${mesa.id}`);
    await page.getByRole("button", { name: "Abrir cuenta" }).click();
    const dialogo = page.getByRole("dialog", { name: "¿Cuántos comensales?" });
    await dialogo.getByLabel("Otro").fill("12");
    await dialogo.getByRole("button", { name: "Confirmar apertura" }).click();
    await expect(aviso(page)).toHaveText("Cuenta de la mesa 991 abierta.");
    expect((await prisma.cuenta.findFirstOrThrow({ where: { mesaId: mesa.id } })).comensales).toBe(12);
  } finally {
    await prisma.cuenta.deleteMany({ where: { mesaId: mesa.id } });
    await prisma.mesa.deleteMany({ where: { id: mesa.id } });
  }
});

test("corregir comensales con la cuenta abierta: se puede editar, y la cuenta ya cerrada no lo permite (el control desaparece)", async ({ paginaAutenticada: page, sucursalId }) => {
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 992 } });
  try {
    await page.goto(`/mesas/${mesa.id}`);
    await page.getByRole("button", { name: "Abrir cuenta" }).click();
    const dialogo = page.getByRole("dialog", { name: "¿Cuántos comensales?" });
    await dialogo.getByRole("button", { name: "2", exact: true }).click();
    await dialogo.getByRole("button", { name: "Confirmar apertura" }).click();
    await expect(page.getByText("2 comensales")).toBeVisible();

    await page.getByRole("button", { name: "Editar" }).click();
    await page.getByLabel("Comensales").fill("6");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(aviso(page)).toHaveText("Comensales de la mesa 992 actualizados a 6.");
    await expect(page.getByText("6 comensales")).toBeVisible();

    const cuenta = await prisma.cuenta.findFirstOrThrow({ where: { mesaId: mesa.id } });
    expect(cuenta.comensales).toBe(6);

    // Ya cerrada: el dato queda congelado y sin control para editarlo (liberarMesa exige 0 ítems, así que se cierra a mano).
    await prisma.cuenta.update({ where: { id: cuenta.id }, data: { cerradaEn: new Date(), cerradaPorId: cuenta.abiertaPorId } });
    await page.goto(`/mesas/${mesa.id}`);
    await expect(page.getByText("La mesa está libre.")).toBeVisible();
    await expect(page.getByText("6 comensales")).toHaveCount(0);
  } finally {
    await prisma.cuenta.deleteMany({ where: { mesaId: mesa.id } });
    await prisma.mesa.deleteMany({ where: { id: mesa.id } });
  }
});

test("límite de mesas abiertas: al llegar al máximo, bloquea en seco con el mensaje de negocio; liberar una mesa lo destraba", async ({ paginaAutenticada: page, sucursalId }) => {
  const [mesaA, mesaB] = await Promise.all([
    prisma.mesa.create({ data: { sucursalId, numero: 993 } }),
    prisma.mesa.create({ data: { sucursalId, numero: 994 } }),
  ]);
  try {
    await prisma.sucursal.update({ where: { id: sucursalId }, data: { maxMesasAbiertas: 1 } });

    await page.goto(`/mesas/${mesaA.id}`);
    await page.getByRole("button", { name: "Abrir cuenta" }).click();
    let dialogo = page.getByRole("dialog", { name: "¿Cuántos comensales?" });
    await dialogo.getByRole("button", { name: "2", exact: true }).click();
    await dialogo.getByRole("button", { name: "Confirmar apertura" }).click();
    await expect(aviso(page)).toHaveText("Cuenta de la mesa 993 abierta.");

    await page.goto(`/mesas/${mesaB.id}`);
    await page.getByRole("button", { name: "Abrir cuenta" }).click();
    dialogo = page.getByRole("dialog", { name: "¿Cuántos comensales?" });
    await dialogo.getByRole("button", { name: "2", exact: true }).click();
    await dialogo.getByRole("button", { name: "Confirmar apertura" }).click();
    await expect(dialogo.getByRole("alert")).toHaveText("Se alcanzó el máximo de 1 mesas abiertas en «Central». Cerrá o liberá una antes de abrir otra.");
    expect(await prisma.cuenta.count({ where: { mesaId: mesaB.id } })).toBe(0);

    // Liberar la mesa A (sin ítems, se puede liberar) destraba: la B abre.
    await page.goto(`/mesas/${mesaA.id}`);
    await page.getByRole("button", { name: "Liberar mesa" }).click();
    await expect(aviso(page)).toHaveText("Mesa 993 liberada.");

    await page.goto(`/mesas/${mesaB.id}`);
    await page.getByRole("button", { name: "Abrir cuenta" }).click();
    dialogo = page.getByRole("dialog", { name: "¿Cuántos comensales?" });
    await dialogo.getByRole("button", { name: "2", exact: true }).click();
    await dialogo.getByRole("button", { name: "Confirmar apertura" }).click();
    await expect(aviso(page)).toHaveText("Cuenta de la mesa 994 abierta.");
  } finally {
    await prisma.cuenta.deleteMany({ where: { mesaId: { in: [mesaA.id, mesaB.id] } } });
    await prisma.mesa.deleteMany({ where: { id: { in: [mesaA.id, mesaB.id] } } });
    await prisma.sucursal.update({ where: { id: sucursalId }, data: { maxMesasAbiertas: null } });
  }
});

test("mapa de mesas: el control de límite se ve y se edita con pos_mesas Editar; muestra abiertas/máximo", async ({ paginaAutenticada: page, sucursalId }) => {
  try {
    await page.goto("/mesas");
    await expect(page.getByText("Sin límite de mesas abiertas")).toBeVisible();

    await page.getByRole("button", { name: "Editar límite" }).click();
    await page.getByLabel("Máx. mesas abiertas").fill("7");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText(/Máx\. 7 mesas abiertas/)).toBeVisible();
    expect((await prisma.sucursal.findUniqueOrThrow({ where: { id: sucursalId } })).maxMesasAbiertas).toBe(7);

    const auditoria = await prisma.registroAuditoria.findMany({ where: { entidad: "Sucursal", entidadId: sucursalId, campo: "maxMesasAbiertas" } });
    expect(auditoria.length).toBeGreaterThan(0);

    // Vaciar el campo vuelve a "sin límite".
    await page.getByRole("button", { name: "Editar límite" }).click();
    await page.getByLabel("Máx. mesas abiertas").fill("");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("Sin límite de mesas abiertas")).toBeVisible();
  } finally {
    await prisma.sucursal.update({ where: { id: sucursalId }, data: { maxMesasAbiertas: null } });
  }
});

test("reporte de rotación de mesas: cuenta atendida vs liberada sin consumo, comensales promedio y franja horaria", async ({ paginaAutenticada: page, sucursalId }) => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const unidad = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "unidad" } });
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const producto = await prisma.producto.create({ data: { codigo: `E2E-ROT-${marca}`, nombre: `E2E Rotación ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 1000 } });
  const mesaAtendida = await prisma.mesa.create({ data: { sucursalId, numero: 995 } });
  const mesaLiberada = await prisma.mesa.create({ data: { sucursalId, numero: 996 } });
  const ahora = new Date();
  const cuentaAtendida = await prisma.cuenta.create({
    data: {
      mesaId: mesaAtendida.id,
      abiertaPorId: admin.id,
      comensales: 4,
      abiertaEn: new Date(ahora.getTime() - 45 * 60_000),
      cerradaEn: ahora,
      cerradaPorId: admin.id,
      items: { create: [{ productoId: producto.id, cantidad: 1, precioUnitario: 1000, numeroEnvio: 1, creadoPorId: admin.id }] },
    },
  });
  const cuentaLiberada = await prisma.cuenta.create({
    data: { mesaId: mesaLiberada.id, abiertaPorId: admin.id, abiertaEn: ahora, cerradaEn: ahora, cerradaPorId: admin.id },
  });
  try {
    await page.goto("/reportes/rotacion-mesas?rango=personalizado&desde=2000-01-01");
    await expect(page.getByRole("heading", { level: 1, name: "Rotación de mesas" })).toBeVisible();
    await expect(page.locator("[data-metrica='atendidas']")).toHaveText("1");
    await expect(page.locator("[data-resumen]")).toContainText("1 liberada sin consumo (no entran en las métricas)");
    await expect(page.locator("[data-metrica='comensales-promedio']")).toHaveText("4");
  } finally {
    await prisma.cuentaItem.deleteMany({ where: { cuentaId: cuentaAtendida.id } });
    await prisma.cuenta.deleteMany({ where: { id: { in: [cuentaAtendida.id, cuentaLiberada.id] } } });
    await prisma.mesa.deleteMany({ where: { id: { in: [mesaAtendida.id, mesaLiberada.id] } } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  }
});
