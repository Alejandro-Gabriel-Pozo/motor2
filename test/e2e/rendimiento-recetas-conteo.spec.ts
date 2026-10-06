import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * Camino CONTEO (Task #26, Diseño B — docs/plan-rendimiento-recetas-2026-09-22.md, sección nueva): con dos
 * `ConteoFisico` `RESUELTO` que cubren el insumo (una al principio del tramo, otra al final), el desvío se MIDE
 * directo en vez de estimarse por compras. `rendimiento-recetas-agua.spec.ts`/`rendimiento-recetas-confirmar.spec.ts`
 * ya cubren el camino sin conteo (método COMPRAS, sin cambios de comportamiento) — acá el caso nuevo.
 *
 * Los `ConteoFisico` se siembran directo por Prisma (mismo criterio que el resto de los E2E de este reporte: los
 * movimientos de Kardex se escriben directo, sin pasar por la acción — lo que se prueba con browser real es la
 * PANTALLA, no `registrarConteoFisico`, que ya tiene su propia cobertura en test/movimientos/conteo-fisico.test.ts).
 */
test("con dos anclas de Conteo Físico que cubren el insumo, la fila se mide (no se estima): 0% de desvío, 'Medido (Conteo Físico)' y 'contado dd → dd' en vez de Δ stock", async ({
  paginaAutenticada: page,
  sucursalId,
  seccionId,
}) => {
  const marca = Date.now();
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });

  const aguaCaja = await prisma.producto.create({ data: { codigo: `E2E-CONTEO-MP-${marca}`, nombre: `E2E Conteo Agua caja x12 ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  const aguaBotella = await prisma.producto.create({ data: { codigo: `E2E-CONTEO-PV-${marca}`, nombre: `E2E Conteo Agua botella ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 50 } });
  await prisma.recetaVersion.create({ data: { productoId: aguaBotella.id, version: 1, ingredientes: { create: [{ insumoProductoId: aguaCaja.id, cantidad: 1, unidadId: kg.id }] } } });
  // construirPools (P7) filtra whereDisponibleEn(sucursalId) — sin esto ninguno de los 2 productos aparece en la tabla.
  await prisma.disponibilidadProducto.createMany({ data: [aguaCaja.id, aguaBotella.id].map((productoId) => ({ sucursalId, productoId, disponible: true })) });

  // Ancla-desde (hace 10 días): conteo en 0, antes de cualquier movimiento — coincide (diferencia 0), RESUELTO sin ajuste.
  const hoy = new Date();
  const anclaDesde = new Date(hoy.getTime() - 10 * 86_400_000);
  anclaDesde.setUTCHours(0, 0, 0, 0);
  await prisma.conteoFisico.create({
    data: { sucursalId, fecha: anclaDesde, productoId: aguaCaja.id, seccionId, saldoSistema: 0, conteoReal: 0, diferencia: 0, accion: "AJUSTAR", estado: "RESUELTO", usuarioId: admin.id },
  });

  // Compra de 72 (un solo lote) + venta de 63 — el caso real del Agua, mismos números que rendimiento-recetas-agua.spec.ts.
  const fechaMovimientos = new Date(hoy.getTime() - 8 * 86_400_000);
  const compra = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: fechaMovimientos, usuarioId: admin.id } });
  await prisma.movimientoStock.create({
    data: { operacionId: compra.id, productoId: aguaCaja.id, seccionId, proceso: "COMPRA", cantidad: 72, detalle: "Compra", precioTotal: 72, precioPorUnidadStock: 1 },
  });
  const venta = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: fechaMovimientos, usuarioId: admin.id } });
  await prisma.movimientoStock.create({
    data: { operacionId: venta.id, productoId: aguaBotella.id, seccionId, proceso: "VENTA", cantidad: -63, detalle: "Venta", precioTotal: 3150, precioPorUnidadStock: 50 },
  });
  await prisma.movimientoStock.create({
    data: { operacionId: venta.id, productoId: aguaCaja.id, seccionId, proceso: "CONSUMO", cantidad: -63, detalle: "Consumo por venta" },
  });

  // Ancla-hasta (hoy): el sistema calcula 72 - 63 = 9 — el conteo confirma que coincide (acopio real, diferencia 0).
  await prisma.conteoFisico.create({
    data: { sucursalId, fecha: hoy, productoId: aguaCaja.id, seccionId, saldoSistema: 9, conteoReal: 9, diferencia: 0, accion: "AJUSTAR", estado: "RESUELTO", usuarioId: admin.id },
  });

  try {
    await page.goto("/reportes/rendimiento-recetas");
    await expect(page.getByRole("heading", { name: "Rendimiento real de recetas" })).toBeVisible();

    const fila = page.getByRole("row", { name: new RegExp(aguaBotella.nombre) });
    await expect(fila).toBeVisible();

    // Medido, no estimado — 0% de desvío (la fórmula sin conciliar daría +14,3%, ver rendimiento-recetas-agua.spec.ts).
    await expect(fila.getByText("Medido (Conteo Físico)")).toBeVisible();
    await expect(fila).toContainText("0%"); // sin "+" — 0 no es > 0 (mismo criterio que el resto de la fila)
    // El Δ stock deja de mostrarse: en su lugar, las dos fechas ancla — con las que se midió el tramo.
    const anclaDesdeIso = anclaDesde.toISOString().slice(0, 10);
    const anclaHastaIso = hoy.toISOString().slice(0, 10);
    await expect(fila.getByText(`contado ${anclaDesdeIso} → ${anclaHastaIso}`)).toBeVisible();
    await expect(fila.getByText(/de ruido esperable por comprar de a lotes/)).toHaveCount(0); // método CONTEO: sin banda de ruido de lote (D4)

    // "Usar este valor" sigue funcionando igual — colSpan 11 (accesibilidad.spec.ts) no cambia con este método.
    const botonUsar = fila.getByRole("button", { name: `Usar este valor para ${aguaBotella.nombre} — ${aguaCaja.nombre}` });
    await expect(botonUsar).toBeVisible();
    await botonUsar.click();
    const aviso = page.getByRole("alert").filter({ hasText: "¿Calibrar el rendimiento" });
    await expect(aviso).toContainText("de 1 a 1"); // receta actual 1, medido 1 (0% de desvío) — no cambia nada real, pero confirma el valor
  } finally {
    await prisma.conteoFisico.deleteMany({ where: { productoId: aguaCaja.id } });
    await prisma.movimientoStock.deleteMany({ where: { productoId: { in: [aguaCaja.id, aguaBotella.id] } } });
    await prisma.operacion.deleteMany({ where: { id: { in: [compra.id, venta.id] } } });
    await prisma.recetaVersion.deleteMany({ where: { productoId: aguaBotella.id } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: [aguaBotella.id, aguaCaja.id] } } });
    await prisma.producto.deleteMany({ where: { id: { in: [aguaBotella.id, aguaCaja.id] } } });
  }
});
