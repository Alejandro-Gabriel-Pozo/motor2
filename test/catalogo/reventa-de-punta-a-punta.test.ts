import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { EMPRESA_TESTIGO_ID, clienteConEmpresaDePrueba } from "../setup/empresa-de-prueba";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";
import { comprobanteDePrueba } from "../setup/comprobante-de-prueba";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";
import { actualizarDisponibilidadProducto, actualizarProducto, darDeAltaProducto, listarProductosPagina } from "../../src/server/actions/catalogo/productos";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { anularVenta, registrarVenta } from "../../src/server/actions/movimientos/venta";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { enviarACocina } from "../../src/server/actions/pos/cuenta-pedido";
import { agregarItems } from "../../src/server/actions/pos/cuenta-pedido";
import { detalleDeLaLista } from "../../src/server/consultas/catalogo/detalle-de-la-lista";
import { calcularValuacionInventario } from "../../src/server/consultas/reportes/valuacion";

/**
 * E4-5 de la Reventa (docs/diseno-reventa-e4-2026-11-17.md §7): el ALTA la ofrece, y la cadena entera anda de punta a punta contra Postgres real: alta por `darDeAltaProducto` con la clase «Reventa» (queda PV, no
 * se produce, clase REVENTA y NO disponible hasta tener precio) → quien tiene la clave le carga precio y alícuota y la activa → se COMPRA (entra stock propio, con costo) → se VENDE por el registro de venta y por
 * el POS descontando SU stock → se ANULA la venta (vuelve el saldo con un movimiento nuevo) → aparece en la lista con su clase «Reventa» y en la valuación con su costo de compra. Además: idempotencia (repetir el alta
 * no duplica), concurrencia (dos altas simultáneas del mismo nombre dejan UNA) y aislamiento por empresa.
 *
 * Mutaciones: sacar REVENTA de `CLASES_DE_ALTA` o de `CLAVES_DE_CLASE_DE_ALTA` pone en rojo el alta; volver `motivoDeClaseDeAltaInvalida` a la lista de cuatro clases también; quitar el chip de `TIPOS_FILTRABLES`
 * pone en rojo la lista.
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let reventaId: string;

const alta = (nombre: string) =>
  darDeAltaProducto({ nombre, unidadStockId: s.unidad.id, factorConversion: 1, tipo: "PV", seProduce: false, claseDeUso: "REVENTA" } as Parameters<typeof darDeAltaProducto>[0]);
const guardado = (nombre: string) => prismaAdmin.producto.findFirstOrThrow({ where: { nombre } });
const compra = async (cantidad: number, precioTotal = 1200) =>
  registrarMovimiento({ proceso: "COMPRA", ...(await comprobanteDePrueba()), fecha: new Date(), seccionId: s.seccion.id, items: [{ productoId: reventaId, cantidad, precioTotal, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: randomUUID() });
const saldo = () => calcularSaldoTotal(reventaId, s.seccion.id, prisma);
const FECHA = new Date("2026-11-17T15:00:00Z");
const venta = (cantidadVendida: number) => registrarVenta({ fecha: FECHA, seccionId: s.seccion.id, ventas: [{ productoId: reventaId, cantidadVendida }] });

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  await entrarComo(s.admin);
});

describe("alta de una Reventa", () => {
  it("queda PV, no se produce, con la clase REVENTA, y nace NO disponible hasta tener precio", async () => {
    const r = await alta("Gaseosa lata");
    expect(r.ok, r.mensaje).toBe(true);
    const p = await guardado("Gaseosa lata");
    expect({ tipo: p.tipo, seProduce: p.seProduce, claseDeUso: p.claseDeUso, precio: Number(p.precioVenta) }).toEqual({ tipo: "PV", seProduce: false, claseDeUso: "REVENTA", precio: 0 });
    const disp = await prisma.disponibilidadProducto.findMany({ where: { productoId: p.id } });
    expect(disp.length).toBeGreaterThan(0);
    expect(disp.every((d) => !d.disponible)).toBe(true);
  });

  it("IDEMPOTENCIA: repetir el alta no crea otra Reventa", async () => {
    expect((await alta("Gaseosa lata")).ok).toBe(true);
    expect((await alta("Gaseosa lata")).ok).toBe(false);
    expect(await prismaAdmin.producto.count({ where: { nombre: "Gaseosa lata" } })).toBe(1);
  });

  it("CONCURRENCIA: dos altas simultáneas del mismo nombre dejan UNA Reventa", async () => {
    const [a, b] = await Promise.all([alta("Gaseosa lata"), alta("Gaseosa lata")]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const filas = await prismaAdmin.producto.findMany({ where: { nombre: "Gaseosa lata" } });
    expect(filas).toHaveLength(1);
    expect(filas[0]!.claseDeUso).toBe("REVENTA");
  });

  it("AISLAMIENTO: otra empresa no la ve, y el mismo nombre en esa empresa no choca", async () => {
    expect((await alta("Gaseosa lata")).ok).toBe(true);
    const otra = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
    expect(await otra.producto.count({ where: { nombre: "Gaseosa lata" } })).toBe(0);
    const u = await otra.unidad.create({ data: { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 } });
    await otra.producto.create({ data: { codigo: "PV_AJENA", nombre: "Gaseosa lata", tipo: "PV", seProduce: false, claseDeUso: "REVENTA", unidadStockId: u.id } });
    expect(await prismaAdmin.producto.count({ where: { nombre: "Gaseosa lata" } })).toBe(2);
    expect(await prisma.producto.count({ where: { nombre: "Gaseosa lata" } })).toBe(1);
  });

  it("no se crea una Reventa con IVA de compra (el alta solo trae la alícuota de venta): se rechaza cerrado", async () => {
    const r = await darDeAltaProducto({ nombre: "Con IVA de compra", unidadStockId: s.unidad.id, factorConversion: 1, tipo: "PV", seProduce: false, claseDeUso: "REVENTA", alicuotaIvaCompra: "IVA_21" } as Parameters<typeof darDeAltaProducto>[0]);
    expect(r.ok).toBe(false);
    expect(await prismaAdmin.producto.count({ where: { nombre: "Con IVA de compra" } })).toBe(0);
  });
});

describe("de punta a punta: alta → precio y activación → compra → venta → anulación → lista y reporte", () => {
  beforeEach(async () => {
    expect((await alta("Gaseosa lata")).ok).toBe(true);
    reventaId = (await guardado("Gaseosa lata")).id;
  });

  it("la cadena completa", async () => {
    // Quien tiene la clave le carga precio y alícuota y la activa (el alta no pide precio).
    const edit = await actualizarProducto(reventaId, { nombre: "Gaseosa lata", tipo: "PV", unidadStockId: s.unidad.id, factorConversion: 1, seProduce: false, precioVenta: 1500, precioVentaVisto: 0, alicuotaIvaVenta: "IVA_21", alicuotaVista: null } as Parameters<typeof actualizarProducto>[1]);
    expect(edit.ok, edit.mensaje).toBe(true);
    expect((await actualizarDisponibilidadProducto(reventaId, true)).ok).toBe(true);
    expect((await guardado("Gaseosa lata")).claseDeUso).toBe("REVENTA");

    // Se compra: entra stock propio.
    expect((await compra(10, 5000)).ok).toBe(true);
    expect(await saldo()).toBe(10);

    // Se vende por el registro de venta, descontando su propio stock (sin receta).
    const v = await venta(2);
    expect(v.ok, JSON.stringify(v)).toBe(true);
    expect(await saldo()).toBe(8);

    // Y por el POS.
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
    expect((await agregarItems(cuenta.id, [{ productoId: reventaId, cantidad: 3 }])).ok).toBe(true);
    const items = await prisma.cuentaItem.findMany({ where: { cuentaId: cuenta.id } });
    expect((await enviarACocina(cuenta.id, items.map((i) => i.id))).ok).toBe(true);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
    expect(await saldo()).toBe(5);

    // Se anula la venta del mostrador: el saldo vuelve con un movimiento NUEVO (el original no se edita).
    const operaciones = await prisma.operacion.findMany({ where: { proceso: "VENTA", movimientos: { some: { productoId: reventaId } } }, orderBy: { creadoEn: "asc" } });
    expect(operaciones).toHaveLength(2);
    const [original] = await prisma.movimientoStock.findMany({ where: { operacionId: operaciones[0]!.id, productoId: reventaId } });
    expect((await anularVenta(operaciones[0]!.id, "Error de carga")).ok).toBe(true);
    expect(await saldo()).toBe(7);
    expect(Number((await prisma.movimientoStock.findUniqueOrThrow({ where: { id: original!.id } })).cantidad)).toBe(-2);

    // Aparece en la lista con su clase «Reventa» y en el chip «Reventa».
    const d = await detalleDeLaLista(prisma, s.sucursalId, [reventaId]);
    expect(d.get(reventaId)?.clase).toBe("reventa");
    const delChip = (await listarProductosPagina(undefined, undefined, { tipo: "reventa" })).items.map((i) => i.nombre);
    expect(delChip).toEqual(["Gaseosa lata"]);
    expect((await listarProductosPagina(undefined, undefined, { tipo: "venta" })).items.map((i) => i.nombre)).not.toContain("Gaseosa lata");

    // En la valuación, con su costo de compra (5000 / 10 = 500 por unidad × 7).
    const valuacion = await calcularValuacionInventario(s.sucursalId, prisma);
    const fila = valuacion.filas.find((f) => f.productoId === reventaId);
    expect(fila?.saldo).toBe(7);
    expect(fila?.sinCosto).toBe(false);
    expect(fila?.valor).toBe(3500);
  });

  it("sin precio ni activación no se compra ni se vende (nace cerrada) y el saldo queda en cero", async () => {
    expect((await compra(5)).ok).toBe(false);
    expect((await venta(1)).ok).toBe(false);
    expect(await saldo()).toBe(0);
  });
});
