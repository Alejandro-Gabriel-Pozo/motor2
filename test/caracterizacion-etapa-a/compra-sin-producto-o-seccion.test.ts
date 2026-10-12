import { beforeEach, describe, expect, it } from "vitest";

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, baseDeTest, EMPRESA_POR_DEFECTO_ID, prisma } from "../setup/test-db";
import { productoValidoParaProceso } from "../../src/core/movimientos/transiciones";
import { guardComandoRegistrarMovimiento } from "../../src/core/features/movimientos/movimiento.guard";
import { registrarMovimientoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-movimiento";
import type { DatosMovimientoInput } from "../../src/core/features/movimientos/movimiento.schema";

/**
 * Caracterización (Etapa A, punto 4a): una COMPRA se rechaza si el producto no es una materia prima o si la sección no es válida, y un rechazo no deja NINGUNA fila.
 * Es una FOTO de lo que hace hoy el código, no una decisión nueva: si el dueño cambia una de estas reglas, se edita el test a propósito.
 *
 * Qué línea sostiene cada regla:
 *  - producto de venta (PV): `productoValidoParaProceso` (`core/movimientos/transiciones.ts`, la línea `proceso === "COMPRA" && producto.tipo !== "MP"`), que llama
 *    `armarLineaMovimiento` (`casos-de-uso/armar-linea-de-movimiento.ts`) y devuelve el mensaje «no está habilitado para el proceso "COMPRA"»;
 *  - producto inexistente o `""`: `armarLineaMovimiento` → «El producto no existe.»;
 *  - sección en blanco: `guardComandoRegistrarMovimiento` (`core/features/movimientos/movimiento.guard.ts`) → «Elegí una sección.»;
 *  - sección de otra sucursal o inexistente: `obtenerSeccionPropia` al principio de `registrarMovimientoCasoDeUso` → «No se encontró la sección.».
 *
 * `exigeSeccion=false` de la pantalla de Compra solo la deja PRESELECCIONADA: el servidor siempre exige una sección propia (ver el cuerpo de
 * `registrar-movimiento.test.ts`, «Compra con sección: se registra …»).
 *
 * Sin base: las dos primeras partes (puro). Con base de datos: la tercera, por el caso de uso con un actor inyectado (no lee el reloj). No medido localmente (sin Postgres): lo corre el CI.
 */
const AHORA = new Date("2026-09-15T12:00:00Z");
const FECHA = new Date("2026-08-05T12:00:00Z");
const CLAVE = "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b";

describe("COMPRA: productoValidoParaProceso (puro)", () => {
  it("rechaza todo producto de venta, se produzca o no y sea o no de consignación", () => {
    for (const seProduce of [false, true]) {
      for (const esConsignacion of [false, true]) {
        expect(productoValidoParaProceso("COMPRA", { tipo: "PV", seProduce, esConsignacion }), `PV seProduce=${seProduce} consignación=${esConsignacion}`).toBe(false);
      }
    }
  });

  it("acepta una materia prima", () => {
    expect(productoValidoParaProceso("COMPRA", { tipo: "MP", seProduce: false, esConsignacion: false })).toBe(true);
  });
});

describe("COMPRA: guardComandoRegistrarMovimiento (puro)", () => {
  const compra = (seccionId: unknown) => ({ proceso: "COMPRA", fecha: FECHA, seccionId, items: [{ productoId: "p-1", cantidad: 1 }] });

  it("sin sección (vacía, en blanco o ausente) devuelve «Elegí una sección.»", () => {
    for (const seccionId of ["", "   ", undefined]) {
      expect(guardComandoRegistrarMovimiento(compra(seccionId), AHORA), JSON.stringify(seccionId)).toMatchObject({ ok: false, mensaje: "Elegí una sección." });
    }
  });

  it("con una sección pasa el guard", () => {
    expect(guardComandoRegistrarMovimiento(compra("sec-1"), AHORA).ok).toBe(true);
  });
});

describe("COMPRA rechazada por producto o sección: sin filas, y el rechazo se repite igual", () => {
  let sucursalId: string;
  let seccionId: string;
  let seccionDeOtraSucursalId: string;
  let adminId: string;
  let harinaId: string;
  let pvId: string;
  let pvSeProduceId: string;
  let pvConsignacionId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    seccionDeOtraSucursalId = (await sembrarSeccion(otraSucursal.id, "Depósito Norte")).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_CONSIGNA", nombre: "Consignante" } });

    harinaId = (await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id }, sucursalId)).id;
    pvId = (await sembrarProductoDisponible({ codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 100 }, sucursalId)).id;
    pvSeProduceId = (await sembrarProductoDisponible({ codigo: "PV_SALSA", nombre: "Salsa de la casa", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 100, seProduce: true }, sucursalId)).id;
    pvConsignacionId = (await sembrarProductoDisponible({ codigo: "PV_VINO", nombre: "Vino en consignación", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 100, esConsignacion: true, proveedorConsignacionId: proveedor.id, precioConsignacion: 50 }, sucursalId)).id;
  });

  // El actor lleva el alcance que tiene en producción: SOLO su sucursal activa (ADR-028).
  const actor = () => ({ usuarioId: adminId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId, sucursalNombre: "Central", ...baseDeTest({ lectura: [sucursalId], escritura: [sucursalId] }) });
  const compra = (productoId: string, seccion: string, extra: Partial<DatosMovimientoInput> = {}): DatosMovimientoInput => ({
    proceso: "COMPRA",
    fecha: FECHA,
    seccionId: seccion,
    items: [{ productoId, cantidad: 5, precioTotal: 100 }],
    ...extra,
  });
  const filas = async () => ({
    operaciones: await prisma.operacion.count(),
    movimientos: await prisma.movimientoStock.count(),
    proveedoresPorProducto: await prisma.proveedorPorProducto.count(),
  });
  const SIN_FILAS = { operaciones: 0, movimientos: 0, proveedoresPorProducto: 0 };

  it("comprar un producto de venta rechaza con el mensaje de «no habilitado para el proceso», con o sin se produce / consignación", async () => {
    for (const [nombre, productoId] of [["Pan", pvId], ["Salsa de la casa", pvSeProduceId], ["Vino en consignación", pvConsignacionId]] as const) {
      const r = await registrarMovimientoCasoDeUso(actor(), compra(productoId, seccionId));
      expect(r.ok, nombre).toBe(false);
      expect(r.mensaje, nombre).toBe(`"${nombre}" no está habilitado para el proceso "COMPRA" (revisá Tipo/"Se produce"/Consignación).`);
    }
    expect(await filas()).toEqual(SIN_FILAS);
  });

  it("un productoId inexistente o vacío rechaza con «El producto no existe.»", async () => {
    for (const productoId of ["producto-que-no-existe", ""]) {
      const r = await registrarMovimientoCasoDeUso(actor(), compra(productoId, seccionId));
      expect(r.ok, JSON.stringify(productoId)).toBe(false);
      expect(r.mensaje, JSON.stringify(productoId)).toBe("El producto no existe.");
    }
    expect(await filas()).toEqual(SIN_FILAS);
  });

  it("una sección de otra sucursal o inexistente rechaza con «No se encontró la sección.» (con una MP válida: lo único malo es la sección)", async () => {
    for (const seccion of [seccionDeOtraSucursalId, "seccion-que-no-existe"]) {
      const r = await registrarMovimientoCasoDeUso(actor(), compra(harinaId, seccion));
      expect(r.ok, seccion).toBe(false);
      expect(r.mensaje, seccion).toBe("No se encontró la sección.");
    }
    expect(await filas()).toEqual(SIN_FILAS);
  });

  it("control: la misma MP con la sección propia sí se registra (los rechazos de arriba son por producto o por sección, no por otra cosa)", async () => {
    const r = await registrarMovimientoCasoDeUso(actor(), compra(harinaId, seccionId));
    expect(r.ok, r.mensaje).toBe(true);
    expect(await prisma.operacion.count()).toBe(1);
    expect(await prisma.movimientoStock.count()).toBe(1);
  });

  const RECHAZADOS = [
    { nombre: "producto de venta", datos: () => compra(pvId, seccionId, { claveIdempotencia: CLAVE }), mensaje: '"Pan" no está habilitado para el proceso "COMPRA" (revisá Tipo/"Se produce"/Consignación).' },
    { nombre: "producto inexistente", datos: () => compra("producto-que-no-existe", seccionId, { claveIdempotencia: CLAVE }), mensaje: "El producto no existe." },
    { nombre: "sección de otra sucursal", datos: () => compra(harinaId, seccionDeOtraSucursalId, { claveIdempotencia: CLAVE }), mensaje: "No se encontró la sección." },
  ];

  for (const caso of RECHAZADOS) {
    it(`idempotencia: ${caso.nombre} con la misma claveIdempotencia, dos veces seguidas, rechaza igual y no deja filas`, async () => {
      const primera = await registrarMovimientoCasoDeUso(actor(), caso.datos());
      const segunda = await registrarMovimientoCasoDeUso(actor(), caso.datos());
      expect([primera.ok, primera.mensaje]).toEqual([false, caso.mensaje]);
      expect([segunda.ok, segunda.mensaje]).toEqual([false, caso.mensaje]);
      expect(await filas()).toEqual(SIN_FILAS);
    });

    it(`concurrencia: ${caso.nombre} con la misma claveIdempotencia, dos a la vez, rechazan igual y no dejan filas`, async () => {
      const [a, b] = await Promise.all([registrarMovimientoCasoDeUso(actor(), caso.datos()), registrarMovimientoCasoDeUso(actor(), caso.datos())]);
      expect([a.ok, a.mensaje]).toEqual([false, caso.mensaje]);
      expect([b.ok, b.mensaje]).toEqual([false, caso.mensaje]);
      expect(await filas()).toEqual(SIN_FILAS);
    });
  }
});
