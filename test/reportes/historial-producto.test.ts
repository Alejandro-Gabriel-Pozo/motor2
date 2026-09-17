import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarConteoFisico } from "../../src/server/actions/movimientos/conteo-fisico";
import { obtenerHistorialProducto, buscarProductoParaHistorial } from "../../src/core/reportes/historial-producto";

describe("obtenerHistorialProducto", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;
  let mpId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    mpId = (await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } })).id;
  });

  it("calcula el saldo corriente acumulado y mergea los conteos físicos en la misma línea de tiempo", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId, items: [{ productoId: mpId, cantidad: 10 }] });
    await registrarMovimiento({ proceso: "AJUSTE", fecha: new Date("2026-01-02"), seccionId, items: [{ productoId: mpId, cantidad: -2 }] });
    // DESCARTAR con diferencia != 0: queda registrado como bitácora, sin generar ningún movimiento de Kardex.
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 20, fechaConteo: new Date("2026-01-03"), accion: "DESCARTAR" });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-04"), seccionId, items: [{ productoId: mpId, cantidad: 5 }] });

    const historial = await obtenerHistorialProducto(sucursalId, mpId, undefined, undefined, undefined);
    expect(historial?.saldoActual).toBe(10 - 2 + 5);
    expect(historial?.totalMovimientos).toBe(3);
    expect(historial?.totalConteos).toBe(1);

    const eventoConteo = historial?.eventos.find((e) => e.tipo === "conteo");
    expect(eventoConteo?.conteoReal).toBe(20);

    // El saldo corriente de la última compra tiene que reflejar TODO lo anterior, sin resetear por el conteo descartado.
    const ultimaCompra = historial?.eventos.filter((e) => e.tipo === "movimiento").at(-1);
    expect(ultimaCompra?.saldoCorriente).toBe(13);
  });

  it("desde/hasta solo recorta qué se MUESTRA — el saldo corriente sigue arrancando del primer movimiento real", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId, items: [{ productoId: mpId, cantidad: 10 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-15"), seccionId, items: [{ productoId: mpId, cantidad: 5 }] });

    const historial = await obtenerHistorialProducto(sucursalId, mpId, undefined, new Date("2026-01-10"), new Date("2026-01-31"));
    expect(historial?.eventos.length).toBe(1); // solo la segunda compra queda visible
    expect(historial?.eventos[0].saldoCorriente).toBe(15); // pero ya arrastra la primera compra
    expect(historial?.saldoActual).toBe(15);
  });

  it("REGRESIÓN (Plan R2): totalMovimientos/totalConteos siguen siendo el total DE SIEMPRE, incluso con un filtro `desde` que oculta movimientos anteriores", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId, items: [{ productoId: mpId, cantidad: 10 }] });
    await registrarMovimiento({ proceso: "AJUSTE", fecha: new Date("2026-01-02"), seccionId, items: [{ productoId: mpId, cantidad: -2 }] });
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 20, fechaConteo: new Date("2026-01-03"), accion: "DESCARTAR" });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-15"), seccionId, items: [{ productoId: mpId, cantidad: 5 }] });

    // Filtro que deja fuera del rango visible a los 2 primeros movimientos
    // y al conteo — igual deben contarse en el total.
    const historial = await obtenerHistorialProducto(sucursalId, mpId, undefined, new Date("2026-01-10"), new Date("2026-01-31"));
    expect(historial?.eventos.length).toBe(1); // solo la compra del 15 es visible
    expect(historial?.totalMovimientos).toBe(3); // pero el total sigue contando los 3 movimientos reales
    expect(historial?.totalConteos).toBe(1); // y el conteo, aunque quedó fuera del rango visible
  });

  it("REGRESIÓN (Plan R2): con solo `hasta` (sin `desde`), se sigue viendo TODO desde el principio hasta esa fecha — sin necesidad de un saldo inicial separado", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId, items: [{ productoId: mpId, cantidad: 10 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-15"), seccionId, items: [{ productoId: mpId, cantidad: 5 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-02-01"), seccionId, items: [{ productoId: mpId, cantidad: 3 }] });

    const historial = await obtenerHistorialProducto(sucursalId, mpId, undefined, undefined, new Date("2026-01-31"));
    expect(historial?.eventos.length).toBe(2); // las dos compras de enero, no la de febrero
    expect(historial?.eventos[0].saldoCorriente).toBe(10);
    expect(historial?.eventos[1].saldoCorriente).toBe(15);
    expect(historial?.saldoActual).toBe(18); // el saldo REAL de hoy incluye la de febrero también
  });

  it("REGRESIÓN (Plan R2): con seccionId + rango de fechas combinados, el saldo inicial y el detalle respetan AMBOS filtros a la vez", async () => {
    const seccionB = (await sembrarSeccion(sucursalId, "Depósito B")).id;
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId, items: [{ productoId: mpId, cantidad: 10 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId: seccionB, items: [{ productoId: mpId, cantidad: 100 }] }); // otra sección, no debe contaminar
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-15"), seccionId, items: [{ productoId: mpId, cantidad: 5 }] });

    const historial = await obtenerHistorialProducto(sucursalId, mpId, seccionId, new Date("2026-01-10"), new Date("2026-01-31"));
    expect(historial?.eventos.length).toBe(1);
    expect(historial?.eventos[0].saldoCorriente).toBe(15); // 10 (saldo inicial de ESTA sección) + 5, sin la seccionB
    expect(historial?.totalMovimientos).toBe(2); // solo los 2 de seccionId, no el de seccionB
  });
});

describe("buscarProductoParaHistorial", () => {
  it("incluye productos inactivos a propósito", async () => {
    await limpiarBaseDeTest();
    await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    const inactivo = await prisma.producto.create({ data: { codigo: "MP_VIEJA", nombre: "Descontinuada", tipo: "MP", unidadStockId: catalogo.kg.id, activo: false } });

    const filas = await buscarProductoParaHistorial("Descontinuada");
    expect(filas.map((f) => f.productoId)).toContain(inactivo.id);
    expect(filas.find((f) => f.productoId === inactivo.id)?.activo).toBe(false);
  });
});
