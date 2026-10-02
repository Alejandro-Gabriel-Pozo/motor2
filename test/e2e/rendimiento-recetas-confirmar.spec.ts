import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { crearMembresia } from "../setup/membresia";
import { prismaAdmin } from "../setup/cliente-duenio";

/**
 * "Usar este valor" (Rendimiento real de recetas) nunca aplica directo: pide confirmación en la misma fila, con el porqué a
 * la vista, y calibra el rendimiento de LA SUCURSAL ACTIVA (docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, paso
 * 9) — nunca la receta central, y nunca otra sucursal. Se siembra directo en la base (compra de 20, venta de 10, receta
 * que dice 1 → sugiere 2) con fecha de HOY, para caer dentro del rango por defecto de la pantalla (últimos 30 días)
 * cualquier día del mes. Se crea una sucursal B TEMPORAL solo para confirmar que calibrar en A nunca la toca.
 */
test("pide confirmación con comprado/vendido, calibra SOLO la sucursal activa (nunca la central ni otra sucursal), y se puede volver al valor central", async ({
  paginaAutenticada: page,
  sucursalId,
  seccionId,
}) => {
  const marca = Date.now();
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const mp = await prisma.producto.create({ data: { codigo: `E2E-RR-MP-${marca}`, nombre: `E2E Salsa Rendimiento ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  const pv = await prisma.producto.create({ data: { codigo: `E2E-RR-PV-${marca}`, nombre: `E2E Pizza Rendimiento ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
  // construirPools (P7) filtra whereDisponibleEn(sucursalId).
  await prisma.disponibilidadProducto.createMany({ data: [mp.id, pv.id].map((productoId) => ({ sucursalId, productoId, disponible: true })) });
  const receta = await prisma.recetaVersion.create({
    data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: kg.id }] } },
    include: { ingredientes: true },
  });
  const recetaIngredienteId = receta.ingredientes[0].id;

  // Sucursal B TEMPORAL: el admin también es miembro (para que la comparación por sucursal la muestre), pero NUNCA la
  // activa en este spec — sirve para confirmar que calibrar en A no le mueve un solo número.
  const membresiaA = await prisma.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: admin.id, sucursalId } });
  const sucursalB = await prisma.sucursal.create({ data: { nombre: `E2E Norte ${marca}` } });
  await crearMembresia({ usuarioId: admin.id, sucursalId: sucursalB.id, rolId: membresiaA.rolId, activo: true });

  const hoy = new Date();
  const compra = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: hoy, usuarioId: admin.id } });
  await prisma.movimientoStock.create({ data: { operacionId: compra.id, productoId: mp.id, seccionId, proceso: "COMPRA", cantidad: 20, detalle: "Compra", precioTotal: 200, precioPorUnidadStock: 10 } });
  const venta = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: hoy, usuarioId: admin.id } });
  await prisma.movimientoStock.create({ data: { operacionId: venta.id, productoId: pv.id, seccionId, proceso: "VENTA", cantidad: -10, detalle: "Venta", precioTotal: 1000, precioPorUnidadStock: 100 } });

  try {
    await page.goto("/reportes/rendimiento-recetas");
    await expect(page.getByRole("heading", { name: "Rendimiento real de recetas" })).toBeVisible();
    const fila = page.getByRole("row", { name: new RegExp(pv.nombre) });
    await expect(fila).toContainText("1 kg"); // receta actual
    await expect(fila).toContainText("2 kg"); // rendimiento real: 20 ÷ 10

    // Abrir: pide confirmación, no calibra todavía.
    const botonUsar = fila.getByRole("button", { name: `Usar este valor para ${pv.nombre} — ${mp.nombre}` });
    await botonUsar.click();
    const aviso = page.getByRole("alert").filter({ hasText: "¿Calibrar el rendimiento" });
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText(`en «${await sucursalNombreDe(sucursalId)}»`);
    await expect(aviso).toContainText("de 1 a 2 kg");
    const contexto = page.getByText(/Comprado: 20 · Vendido: 10/);
    await expect(contexto).toBeVisible();
    // D7: la línea informativa deja claro que la receta central y las otras sucursales no se tocan, con el link a comparar.
    await expect(page.getByText(/Esto cambia solo el rendimiento de/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Comparar con otras sucursales" })).toBeVisible();

    // Cancelar: no calibra nada, vuelve el foco al botón que lo abrió.
    await page.keyboard.press("Escape");
    await expect(aviso).toHaveCount(0);
    await expect(botonUsar).toBeFocused();
    expect(await prisma.rendimientoLocalIngrediente.count()).toBe(0);

    // Confirmar de verdad: ahora sí calibra, con los defaults (2 / 0 merma). La fila vuelve a su estado normal, mostrando
    // el efectivo calibrado + el central entre paréntesis (la propia fila cambiando ES la confirmación, mismo criterio
    // que el resto del proyecto para una mutación en línea — no hace falta un toast que se vea, ver refrescar.ts).
    await botonUsar.click();
    await page.getByRole("button", { name: /Guardar como rendimiento de/ }).click();
    await expect(fila.getByText(/calibrado acá; central: 1 kg/)).toBeVisible();
    await expect(fila).toContainText("2 kg");

    // En la base: override SOLO en A, la receta central no se movió, y la comparación entre sucursales lo confirma.
    const overrideA = await prisma.rendimientoLocalIngrediente.findUniqueOrThrow({ where: { recetaIngredienteId_sucursalId: { recetaIngredienteId, sucursalId } } });
    expect(Number(overrideA.cantidad)).toBe(2);
    expect(await prisma.rendimientoLocalIngrediente.count({ where: { sucursalId: sucursalB.id } })).toBe(0);
    const ingredienteCentral = await prisma.recetaIngrediente.findUniqueOrThrow({ where: { id: recetaIngredienteId } });
    expect(Number(ingredienteCentral.cantidad)).toBe(1);
    const registroAuditoria = await prisma.registroAuditoria.findFirstOrThrow({
      where: { entidad: "RendimientoLocalIngrediente", entidadId: `${sucursalId}:${pv.id}:${mp.id}`, campo: "cantidad" },
    });
    expect(registroAuditoria.descripcion).toContain("sugerencia");

    await page.goto("/reportes/rendimiento-recetas/por-sucursal");
    await expect(page.getByRole("heading", { name: "Rendimiento por sucursal" })).toBeVisible();
    const filaComparacion = page.getByRole("row", { name: new RegExp(pv.nombre) });
    await expect(filaComparacion).toContainText("2 kg"); // A, calibrado
    await expect(filaComparacion.getByText("(calibrado)")).toBeVisible();
    await expect(filaComparacion.getByText("(sin calibrar)")).toBeVisible(); // B

    // "Volver al valor central".
    await page.goto("/reportes/rendimiento-recetas");
    const botonVolver = fila.getByRole("button", { name: "Volver al valor central" });
    await botonVolver.click();
    const avisoVolver = page.getByRole("alert").filter({ hasText: "¿Volver" });
    await page.getByRole("button", { name: "Sí, volver al valor central" }).click();
    await expect(avisoVolver).toHaveCount(0); // espera a que la mutación termine de verdad (no un match casual de texto)
    await expect(fila.getByText(/calibrado acá/)).toHaveCount(0);

    const overrideVuelto = await prisma.rendimientoLocalIngrediente.findUniqueOrThrow({ where: { recetaIngredienteId_sucursalId: { recetaIngredienteId, sucursalId } } });
    expect(overrideVuelto.cantidad).toBeNull();
    expect(await prisma.registroAuditoria.count({ where: { entidad: "RendimientoLocalIngrediente", entidadId: `${sucursalId}:${pv.id}:${mp.id}`, valorNuevo: null } })).toBeGreaterThanOrEqual(2);
  } finally {
    await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "RendimientoLocalIngrediente", entidadId: { in: [`${sucursalId}:${pv.id}:${mp.id}`] } } });
    await prisma.rendimientoLocalIngrediente.deleteMany({ where: { recetaIngredienteId } });
    await prisma.usuarioSucursal.deleteMany({ where: { usuarioId: admin.id, sucursalId: sucursalB.id } });
    await prisma.movimientoStock.deleteMany({ where: { productoId: { in: [mp.id, pv.id] } } });
    await prisma.operacion.deleteMany({ where: { id: { in: [compra.id, venta.id] } } });
    await prisma.recetaVersion.deleteMany({ where: { productoId: pv.id } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: [pv.id, mp.id] } } });
    await prisma.producto.deleteMany({ where: { id: { in: [pv.id, mp.id] } } });
    await prisma.sucursal.delete({ where: { id: sucursalB.id } });
  }
});

async function sucursalNombreDe(sucursalId: string): Promise<string> {
  return (await prisma.sucursal.findUniqueOrThrow({ where: { id: sucursalId } })).nombre;
}
