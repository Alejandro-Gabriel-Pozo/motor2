import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { impresiones, interceptarImpresion } from "./fixtures/impresion";
import { prismaAdmin } from "../setup/cliente-duenio";

/**
 * «Corregir una línea» con «cuántas unidades quitar» (E1 de la corrección por ajuste, docs/diseno-correccion-por-ajuste-2026-11-06.md): el diálogo de la fila de «Cuentas cerradas».
 * Se siembra directo con Prisma una cuenta cerrada con su ticket 1-A (una línea de 3 unidades a $5.000 y otra de 1 unidad a $2.000, con la fila VENTA de cada venta en el Kardex),
 * con productos y mesa propios de la prueba (marca única); lo que se ejercita acá es la PANTALLA y la Server Action reales (− / +, vista previa, toda la línea, motivo, el 1-B sin
 * recargar). Los casos de concurrencia, idempotencia y todo-o-nada están en test/casos-de-uso/quitar-unidades-de-linea.test.ts. Cada prueba limpia lo que creó.
 */
async function sembrar(sucursalId: string, seccionId: string) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const gaseosa = await prisma.producto.create({ data: { codigo: `E2E-QU-G-${marca}`, nombre: `E2E Gaseosa Quitar ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 5000 } });
  const flan = await prisma.producto.create({ data: { codigo: `E2E-QU-F-${marca}`, nombre: `E2E Flan Quitar ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 2000 } });
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 900 + Math.floor(Math.random() * 90) } });
  const cerradaEn = new Date(Date.now() - 5 * 60_000);
  const ventaDe = async (producto: { id: string }, unidades: number, precio: number) => {
    const op = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: cerradaEn, usuarioId: admin.id, detalleLibre: `Mesa E2E QU ${marca}` } });
    await prisma.movimientoStock.create({ data: { operacionId: op.id, productoId: producto.id, seccionId, proceso: "VENTA", cantidad: -unidades, precioTotal: unidades * precio, precioPorUnidadStock: precio, detalle: "Venta" } });
    return op;
  };
  const ventaGaseosa = await ventaDe(gaseosa, 3, 5000);
  const ventaFlan = await ventaDe(flan, 1, 2000);
  const cuenta = await prisma.cuenta.create({
    data: {
      mesaId: mesa.id,
      abiertaPorId: admin.id,
      cerradaEn,
      cerradaPorId: admin.id,
      items: {
        create: [
          { productoId: gaseosa.id, cantidad: 3, precioUnitario: 5000, numeroEnvio: 1, operacionId: ventaGaseosa.id, creadoPorId: admin.id },
          { productoId: flan.id, cantidad: 1, precioUnitario: 2000, numeroEnvio: 1, operacionId: ventaFlan.id, creadoPorId: admin.id },
        ],
      },
    },
  });
  const numero = 300000 + Math.floor(Math.random() * 90000);
  const a = await prisma.ejemplarTicket.create({ data: { sucursalId, cuentaId: cuenta.id, numero, ejemplar: 1, emitidoEn: cerradaEn, emitidoPorId: admin.id } });

  const limpiar = async () => {
    const ventas = [ventaGaseosa.id, ventaFlan.id];
    const reversiones = (await prisma.operacion.findMany({ where: { revierteAOperacionId: { in: ventas } }, select: { id: true } })).map((o) => o.id);
    const reemplazos = (await prisma.operacion.findMany({ where: { reemplazaAOperacionId: { in: ventas } }, select: { id: true } })).map((o) => o.id);
    await prisma.movimientoStock.deleteMany({ where: { operacionId: { in: [...ventas, ...reversiones, ...reemplazos] } } });
    // Las reversiones y las ventas nuevas apuntan a la original (FK RESTRICT): primero ellas.
    await prisma.operacion.deleteMany({ where: { id: { in: [...reversiones, ...reemplazos] } } });
    await prisma.cuentaItem.deleteMany({ where: { cuentaId: cuenta.id } });
    await prisma.ejemplarTicket.deleteMany({ where: { cuentaId: cuenta.id, corrigeAId: { not: null } } });
    await prisma.ejemplarTicket.deleteMany({ where: { cuentaId: cuenta.id } });
    await prisma.cuenta.deleteMany({ where: { id: cuenta.id } });
    await prisma.operacion.deleteMany({ where: { id: { in: ventas } } });
    await prismaAdmin.registroAuditoria.deleteMany({ where: { OR: [{ entidad: "Operacion", entidadId: { in: ventas } }, { entidad: "Cuenta", entidadId: cuenta.id }] } });
    await prisma.mesa.deleteMany({ where: { id: mesa.id } });
    await prisma.producto.deleteMany({ where: { id: { in: [gaseosa.id, flan.id] } } });
  };
  return { marca, mesa, cuenta, gaseosa, flan, ventaGaseosa, ventaFlan, numero, a, limpiar };
}

test("quitar 1 de 3 unidades: − / +, vista previa, «toda la línea» y motivo; sale el 1-B sin recargar y queda enlazado en la base", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const s = await sembrar(sucursalId, seccionId);
  try {
    await interceptarImpresion(page);
    await page.goto(`/mesas/${s.mesa.id}`);
    await expect(page.getByRole("heading", { name: "Cuentas cerradas" })).toBeVisible();
    await expect(page.getByText(`N.º ${s.numero}-A`)).toBeVisible();
    await expect(page.getByText("$ 17.000,00").first()).toBeVisible();

    await page.getByRole("button", { name: /^Corregir una línea/ }).click();
    const dialogo = page.getByRole("dialog", { name: /Corregir una línea/ });
    await expect(dialogo).toBeVisible();
    // Sin elegir línea todavía no hay nada para decidir ni para confirmar.
    await expect(dialogo.getByText("¿Qué corregís de esa línea?")).toHaveCount(0);
    await expect(dialogo.getByRole("button", { name: "Corregir e imprimir" })).toBeDisabled();

    // La línea de 3 unidades ofrece «solo algunas unidades»; la de 1 unidad, no.
    await dialogo.locator("label", { hasText: "3 × E2E Gaseosa Quitar" }).first().click();
    await expect(dialogo.getByText("¿Qué corregís de esa línea?")).toBeVisible();
    await expect(dialogo.getByText("Unidades a quitar (de 3)")).toBeVisible();
    await expect(dialogo.getByText("Queda 2 × E2E Gaseosa Quitar", { exact: false })).toBeVisible();
    await expect(dialogo.getByText("Total del ticket corregido").locator("..").getByText("$ 12.000,00")).toBeVisible();

    // − y + respetan los límites: de 1 a (unidades − 1).
    await expect(dialogo.getByRole("button", { name: "Quitar una unidad menos" })).toBeDisabled();
    await dialogo.getByRole("button", { name: "Quitar una unidad más" }).click();
    await expect(dialogo.getByText("Queda 1 × E2E Gaseosa Quitar", { exact: false })).toBeVisible();
    await expect(dialogo.getByText("Total del ticket corregido").locator("..").getByText("$ 7.000,00")).toBeVisible();
    await expect(dialogo.getByRole("button", { name: "Quitar una unidad más" })).toBeDisabled();
    await dialogo.getByRole("button", { name: "Quitar una unidad menos" }).click();
    await expect(dialogo.getByText("Queda 2 × E2E Gaseosa Quitar", { exact: false })).toBeVisible();

    // «Toda la línea»: sin selector de unidades, el total corregido es sin la línea; se puede volver a «algunas unidades».
    await dialogo.locator("label", { hasText: "Quitar toda la línea" }).click();
    await expect(dialogo.getByText("Unidades a quitar (de 3)")).toHaveCount(0);
    await expect(dialogo.getByText("Total del ticket corregido").locator("..").getByText("$ 2.000,00")).toBeVisible();
    await dialogo.locator("label", { hasText: "Quitar solo algunas unidades" }).click();
    await expect(dialogo.getByText("Unidades a quitar (de 3)")).toBeVisible();

    // Sin motivo no se confirma.
    const confirmar = dialogo.getByRole("button", { name: "Corregir e imprimir" });
    await expect(confirmar).toBeDisabled();
    await dialogo.getByLabel("Motivo (obligatorio)").fill("La mesa tomó dos gaseosas");
    await expect(confirmar).toBeEnabled();
    await confirmar.click();

    // El 1-B aparece SIN recargar, con el total corregido, y se mandó a imprimir.
    await expect(dialogo).toBeHidden();
    await expect(page.getByText(`N.º ${s.numero}-B`).first()).toBeVisible();
    await expect(page.getByText("$ 12.000,00").first()).toBeVisible();
    await expect.poll(async () => (await impresiones(page)).length).toBeGreaterThan(0);

    // En la base: la original marcada con el motivo, su contra-asiento, UNA venta nueva con 2 unidades y $10.000, el 1-B que corrige al 1-A y la auditoría de las unidades.
    const original = await prisma.operacion.findUniqueOrThrow({ where: { id: s.ventaGaseosa.id } });
    expect(original.anuladaEn).not.toBeNull();
    expect(original.motivoAnulacion).toBe("La mesa tomó dos gaseosas");
    expect(await prisma.operacion.count({ where: { revierteAOperacionId: s.ventaGaseosa.id } })).toBe(1);
    const nuevas = await prisma.operacion.findMany({ where: { reemplazaAOperacionId: s.ventaGaseosa.id }, include: { movimientos: true } });
    expect(nuevas).toHaveLength(1);
    expect(nuevas[0]).toMatchObject({ anuladaEn: null, proceso: "VENTA" });
    expect(nuevas[0].fecha.getTime()).toBe(original.fecha.getTime());
    expect(Number(nuevas[0].movimientos[0].cantidad)).toBe(-2);
    expect(Number(nuevas[0].movimientos[0].precioTotal)).toBe(10000);
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: s.ventaFlan.id } })).anuladaEn).toBeNull();
    const b = await prisma.ejemplarTicket.findFirstOrThrow({ where: { cuentaId: s.cuenta.id, ejemplar: 2 } });
    expect(b).toMatchObject({ numero: s.numero, corrigeAId: s.a.id, motivo: "La mesa tomó dos gaseosas" });
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "Operacion", entidadId: s.ventaGaseosa.id, campo: "unidadesVendidas", valorAnterior: "3", valorNuevo: "2" } })).toBe(1);

    // Recargar: el ticket sigue en 1-B ($ 12.000) y la línea se puede volver a corregir (ahora vende 2): la venta vigente es la nueva.
    await page.reload();
    await expect(page.getByText(`N.º ${s.numero}-B`).first()).toBeVisible();
    await page.getByRole("button", { name: /^Corregir una línea/ }).click();
    await expect(page.getByRole("dialog", { name: /Corregir una línea/ }).locator("label", { hasText: "2 × E2E Gaseosa Quitar" })).toBeVisible();
  } finally {
    await s.limpiar();
  }
});

test("la línea de 1 unidad se corrige entera (sin elegir unidades) y la última línea vigente no se puede quitar entera", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const s = await sembrar(sucursalId, seccionId);
  try {
    await page.goto(`/mesas/${s.mesa.id}`);
    await page.getByRole("button", { name: /^Corregir una línea/ }).click();
    const dialogo = page.getByRole("dialog", { name: /Corregir una línea/ });
    await dialogo.locator("label", { hasText: "1 × E2E Flan Quitar" }).first().click();
    await expect(dialogo.getByText("¿Qué corregís de esa línea?")).toHaveCount(0);
    await expect(dialogo.getByText("Total del ticket corregido").locator("..").getByText("$ 15.000,00")).toBeVisible();
    await dialogo.getByLabel("Motivo (obligatorio)").fill("No se pidió el flan");
    await dialogo.getByRole("button", { name: "Corregir e imprimir" }).click();
    await expect(dialogo).toBeHidden();
    await expect(page.getByText(`N.º ${s.numero}-B`).first()).toBeVisible();
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: s.ventaFlan.id } })).anuladaEn).not.toBeNull();
    // No se creó ninguna venta nueva: una línea entera se anula sin reemplazo.
    expect(await prisma.operacion.count({ where: { reemplazaAOperacionId: s.ventaFlan.id } })).toBe(0);

    // Queda una sola línea (la de 3 unidades): «toda la línea» está apagada con su motivo, pero por unidades sí se puede.
    await page.reload();
    await page.getByRole("button", { name: /^Corregir una línea/ }).click();
    const otra = page.getByRole("dialog", { name: /Corregir una línea/ });
    await otra.locator("label", { hasText: "3 × E2E Gaseosa Quitar" }).first().click();
    await expect(otra.getByText("Es la única línea que sigue vendida", { exact: false })).toBeVisible();
    await expect(otra.getByRole("radio", { name: "Quitar toda la línea" })).toBeDisabled();
    await expect(otra.getByText("Unidades a quitar (de 3)")).toBeVisible();
  } finally {
    await s.limpiar();
  }
});
