import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Comportamiento nuevo de §3 (docs/plan-rendimiento-recetas-2026-09-22.md, paso P10) que
 * `rendimiento-recetas-confirmar.spec.ts` no cubre (ese spec sigue verde sin cambios de
 * comportamiento — el caso más simple posible, sin merma ni rótulo). Acá: el caso real del
 * Agua (Δ stock, banda de ruido, rótulo "Producto de reventa", orden por impacto en $ y no por
 * %) y un caso con merma que confirma que `?sugerido=` lleva el valor NETO, no el bruto.
 */
test("caso real del Agua: Δ stock, banda de ruido, rótulo 'Producto de reventa' y orden por impacto en $ (no por %)", async ({
  paginaAutenticada: page,
  sucursalId,
  seccionId,
}) => {
  const marca = Date.now();
  const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });

  // Agua: compra de 72 (un solo lote, caja x12), 63 vendidos, receta 1:1 — desvío crudo +14,3%, Δstock +9, banda ±114,3% (cae
  // dentro). Costo bajo → impacto en $ chico.
  const aguaCaja = await prisma.producto.create({ data: { codigo: `E2E-AGUA-MP-${marca}`, nombre: `E2E Agua caja x12 ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  const aguaBotella = await prisma.producto.create({ data: { codigo: `E2E-AGUA-PV-${marca}`, nombre: `E2E Agua botella ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 50 } });
  await prisma.recetaVersion.create({ data: { productoId: aguaBotella.id, version: 1, ingredientes: { create: [{ insumoProductoId: aguaCaja.id, cantidad: 1, unidadId: kg.id }] } } });

  // Aceite: desvío MENOR en % (+10%) pero con costo alto → impacto en $ mucho mayor. Tiene que aparecer ANTES que el Agua en la
  // tabla (decisión 5, §3: se ordena por plata, no por %).
  const aceite = await prisma.producto.create({ data: { codigo: `E2E-ACEITE-MP-${marca}`, nombre: `E2E Aceite caro ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  const frito = await prisma.producto.create({ data: { codigo: `E2E-FRITO-PV-${marca}`, nombre: `E2E Papas fritas ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 50 } });
  await prisma.recetaVersion.create({ data: { productoId: frito.id, version: 1, ingredientes: { create: [{ insumoProductoId: aceite.id, cantidad: 1, unidadId: kg.id }] } } });
  // construirPools (P7) filtra whereDisponibleEn(sucursalId) — sin esto ninguno de los 4 aparece en la tabla.
  await prisma.disponibilidadProducto.createMany({
    data: [aguaCaja.id, aguaBotella.id, aceite.id, frito.id].map((productoId) => ({ sucursalId, productoId, disponible: true })),
  });

  const hoy = new Date();
  const compraAgua = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: hoy, usuarioId: admin.id } });
  await prisma.movimientoStock.create({
    data: { operacionId: compraAgua.id, productoId: aguaCaja.id, seccionId, proceso: "COMPRA", cantidad: 72, detalle: "Compra", precioTotal: 72, precioPorUnidadStock: 1 },
  });
  const ventaAgua = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: hoy, usuarioId: admin.id } });
  await prisma.movimientoStock.create({
    data: { operacionId: ventaAgua.id, productoId: aguaBotella.id, seccionId, proceso: "VENTA", cantidad: -63, detalle: "Venta", precioTotal: 3150, precioPorUnidadStock: 50 },
  });
  // El consumo físico del insumo (lo que en producción hace registrarVenta vía la receta) — sin esto, Δ stock del pool
  // quedaría en +72 (solo la compra) en vez de +9: calcularStockAperturaYCierre mide TODO movimiento del insumo, no
  // "comprado − vendido del PV" (docstring de la función, rendimiento-recetas.ts).
  await prisma.movimientoStock.create({
    data: { operacionId: ventaAgua.id, productoId: aguaCaja.id, seccionId, proceso: "VENTA", cantidad: -63, detalle: "Consumo por venta" },
  });

  const compraAceite = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: hoy, usuarioId: admin.id } });
  await prisma.movimientoStock.create({
    data: { operacionId: compraAceite.id, productoId: aceite.id, seccionId, proceso: "COMPRA", cantidad: 110, detalle: "Compra", precioTotal: 110_000, precioPorUnidadStock: 1000 },
  });
  const ventaAceite = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: hoy, usuarioId: admin.id } });
  await prisma.movimientoStock.create({
    data: { operacionId: ventaAceite.id, productoId: frito.id, seccionId, proceso: "VENTA", cantidad: -100, detalle: "Venta", precioTotal: 5000, precioPorUnidadStock: 50 },
  });
  await prisma.movimientoStock.create({
    data: { operacionId: ventaAceite.id, productoId: aceite.id, seccionId, proceso: "VENTA", cantidad: -100, detalle: "Consumo por venta" },
  });

  try {
    await page.goto("/reportes/rendimiento-recetas");
    await expect(page.getByRole("heading", { name: "Rendimiento real de recetas" })).toBeVisible();

    const filaAgua = page.getByRole("row", { name: new RegExp(aguaBotella.nombre) });
    const filaAceite = page.getByRole("row", { name: new RegExp(frito.nombre) });
    await expect(filaAgua).toBeVisible();
    await expect(filaAceite).toBeVisible();

    // Rótulo declarado: ninguno de los dos insumos se produce, receta 1:1 sin merma → "Producto de reventa" en ambos.
    await expect(filaAgua.getByText("(Producto de reventa)")).toBeVisible();

    // Δ stock del Agua: +9 (72 comprados - 63 consumidos), con el detalle apertura→cierre en el title.
    const celdaDeltaStock = filaAgua.locator("td", { hasText: "+9" });
    await expect(celdaDeltaStock).toBeVisible();
    await expect(celdaDeltaStock).toHaveAttribute("title", "Antes de este rango: 0 — después: 9");

    // Banda de ruido del Agua: ±114,3% de un solo lote de 72 sobre 63 vendidos — el desvío de +14,3% cae dentro.
    await expect(filaAgua.getByText(/±114[.,]3% de ruido esperable por comprar de a lotes — el desvío cae dentro de esa banda/)).toBeVisible();

    // Orden: Aceite (+10% de desvío, pero impacto ~$10.000) ANTES que Agua (+14,3% de desvío, pero impacto ~$9) — por plata, no por %.
    const indiceAceite = await filaAceite.evaluate((el) => Array.from(el.parentElement!.children).indexOf(el));
    const indiceAgua = await filaAgua.evaluate((el) => Array.from(el.parentElement!.children).indexOf(el));
    expect(indiceAceite, "el mayor impacto en $ va primero, aunque tenga menor % de desvío").toBeLessThan(indiceAgua);
  } finally {
    await prisma.movimientoStock.deleteMany({ where: { productoId: { in: [aguaCaja.id, aguaBotella.id, aceite.id, frito.id] } } });
    await prisma.operacion.deleteMany({ where: { id: { in: [compraAgua.id, ventaAgua.id, compraAceite.id, ventaAceite.id] } } });
    await prisma.recetaVersion.deleteMany({ where: { productoId: { in: [aguaBotella.id, frito.id] } } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: [aguaBotella.id, aguaCaja.id, frito.id, aceite.id] } } });
    await prisma.producto.deleteMany({ where: { id: { in: [aguaBotella.id, aguaCaja.id, frito.id, aceite.id] } } });
  }
});

test("con merma, calibrar «Usar este valor» congela el estimado NETO y la merma EFECTIVA (no el bruto)", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const marca = Date.now();
  const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });

  // Receta neta 2 kg + 25% de merma → teórico bruto 2,5. Compra 30, venta 10 → estimado bruto 3 (+20% de desvío contra el
  // teórico bruto) → estimado NETO 3 ÷ 1,25 = 2,4. Si el bug volviera (escribir el bruto en la receta neta), sugeriría 3.
  const mp = await prisma.producto.create({ data: { codigo: `E2E-MERMA-MP-${marca}`, nombre: `E2E Papa con Merma ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  const pv = await prisma.producto.create({ data: { codigo: `E2E-MERMA-PV-${marca}`, nombre: `E2E Puré con Merma ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
  // construirPools (P7) filtra whereDisponibleEn(sucursalId).
  await prisma.disponibilidadProducto.createMany({ data: [mp.id, pv.id].map((productoId) => ({ sucursalId, productoId, disponible: true })) });
  const receta = await prisma.recetaVersion.create({
    data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 2, mermaPorcentaje: 25, unidadId: kg.id }] } },
    include: { ingredientes: true },
  });
  const recetaIngredienteId = receta.ingredientes[0].id;

  const hoy = new Date();
  const compra = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: hoy, usuarioId: admin.id } });
  await prisma.movimientoStock.create({ data: { operacionId: compra.id, productoId: mp.id, seccionId, proceso: "COMPRA", cantidad: 30, detalle: "Compra", precioTotal: 300, precioPorUnidadStock: 10 } });
  const venta = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: hoy, usuarioId: admin.id } });
  await prisma.movimientoStock.create({ data: { operacionId: venta.id, productoId: pv.id, seccionId, proceso: "VENTA", cantidad: -10, detalle: "Venta", precioTotal: 1000, precioPorUnidadStock: 100 } });

  try {
    await page.goto("/reportes/rendimiento-recetas");
    await expect(page.getByRole("heading", { name: "Rendimiento real de recetas" })).toBeVisible();
    const fila = page.getByRole("row", { name: new RegExp(pv.nombre) });
    await expect(fila).toContainText("2 kg"); // receta actual (neta)
    await expect(fila).toContainText("2.4 kg"); // rendimiento real (ya en neto, no 3)

    const botonUsar = fila.getByRole("button", { name: `Usar este valor para ${pv.nombre} — ${mp.nombre}` });
    await botonUsar.click();
    const aviso = page.getByRole("alert").filter({ hasText: "¿Calibrar el rendimiento" });
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText("de 2 a 2.4 kg");
    // Los campos del formulario ya traen los defaults: cantidad = estimado NETO (2.4), merma = la EFECTIVA usada en el
    // cálculo (25, la central — todavía no hay ningún override en esta sucursal).
    await expect(page.locator('input[name="cantidad"]')).toHaveValue("2.4");
    await expect(page.locator('input[name="mermaPorcentaje"]')).toHaveValue("25");

    await page.getByRole("button", { name: /Guardar como rendimiento de/ }).click();
    await expect(fila.getByText(/calibrado acá; central: 2 kg/)).toBeVisible();

    // En la base: se congeló el NETO (2.4) junto con la merma EFECTIVA (25) — nunca el bruto (3).
    const override = await prisma.rendimientoLocalIngrediente.findUniqueOrThrow({ where: { recetaIngredienteId_sucursalId: { recetaIngredienteId, sucursalId } } });
    expect(Number(override.cantidad)).toBe(2.4);
    expect(Number(override.mermaPorcentaje)).toBe(25);
  } finally {
    await prisma.rendimientoLocalIngrediente.deleteMany({ where: { recetaIngredienteId } });
    await prisma.registroAuditoria.deleteMany({ where: { entidad: "RendimientoLocalIngrediente", entidadId: `${sucursalId}:${pv.id}:${mp.id}` } });
    await prisma.movimientoStock.deleteMany({ where: { productoId: { in: [mp.id, pv.id] } } });
    await prisma.operacion.deleteMany({ where: { id: { in: [compra.id, venta.id] } } });
    await prisma.recetaVersion.deleteMany({ where: { productoId: pv.id } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: [pv.id, mp.id] } } });
    await prisma.producto.deleteMany({ where: { id: { in: [pv.id, mp.id] } } });
  }
});
