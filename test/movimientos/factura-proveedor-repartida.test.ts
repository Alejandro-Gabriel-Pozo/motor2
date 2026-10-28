import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarSeccion, baseDeTest } from "../setup/test-db";
import { crearMembresia } from "../setup/membresia";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";
import { aceptarPropuestaDeFactura, anularFacturaProveedor, registrarFacturaProveedor } from "../../src/server/actions/movimientos/facturas-proveedor";
import { listarPropuestasEnviadas, listarPropuestasParaAceptar } from "../../src/server/consultas/movimientos/facturas-proveedor";
import { obtenerCostoActualPorMP } from "../../src/server/lecturas/reportes/comun";
import { mediodiaDelDia, ZONA_ARGENTINA, diaDeCalendario, sumarDias } from "../../src/core/tiempo/zona-horaria";
import type { DatosFacturaProveedorInput } from "../../src/core/features/compras/factura-proveedor.schema";

/**
 * E3a (ADR-041; docs/diseno-factura-de-proveedor-e3a-2026-10-27.md): la factura de proveedor repartida entre sucursales por PROPUESTA (la que compra) y ACEPTACIÓN (cada destino), contra Postgres real.
 *
 * Escenario: tres sucursales (3, 4 y 6, como el ejemplo del dueño). El operario de cada una tiene membresía SOLO en la suya (ADR-028). Al rol operador se le asigna `compra_repartir` como lo haría el gerente en la
 * matriz (sin migración de datos). El administrador tiene membresía en la 3 y la 4 (no en la 6).
 *
 * Mutaciones (anotadas en el commit): sin el `exigirTambienPermisoDeEmpresa("compra_repartir")` → rojo «sin compra_repartir»; la parte de otra sucursal escrita RECIBIDA en vez de propuesta → rojo «la 4 no tiene
 * stock hasta aceptar»; sin el chequeo de destino en la aceptación → rojo «el operario de la 3 no acepta por la 4»; sin la guarda `WHERE estado = 'PENDIENTE'` (y sin el único de la parte) → rojo «8 aceptaciones»;
 * sin el `FOR UPDATE` + chequeo de anulada → rojo «aceptar contra anular»; anular sin evaluar TODAS las partes antes de escribir → rojo «algo consumido en la 4».
 */
const hoy = () => new Date();
const mediodiaDeHoy = () => mediodiaDelDia(diaDeCalendario(new Date(), ZONA_ARGENTINA), ZONA_ARGENTINA);

let s3: string, s4: string, s6: string;
let sec3: string, sec4: string, sec6: string;
let op3: string, op4: string, op6: string, admin: string;
let harina: string, aceite: string, proveedorId: string;
let rolOperadorId: string;

const como = async (usuarioId: string, email: string, sucursalId: string) => {
  __setCookieDeTestParaSucursal(sucursalId);
  await mockearUsuarioActual({ id: usuarioId, email, nombre: null });
};
const comoOp3 = () => como(op3, "op3@test.com", s3);
const comoOp4 = () => como(op4, "op4@test.com", s4);
const comoOp6 = () => como(op6, "op6@test.com", s6);
const comoAdminEn = (sucursalId: string) => como(admin, "admin@test.com", sucursalId);

/** La factura del ejemplo: 3.000.000 en dos renglones (harina 2.400.000 por 240 kg y aceite 600.000 por 60 l). */
const factura = (extra: Partial<DatosFacturaProveedorInput> = {}): DatosFacturaProveedorInput => ({
  fecha: mediodiaDeHoy(),
  proveedorId,
  nroFactura: "0001-00000077",
  seccionId: sec3,
  items: [
    { productoId: harina, cantidad: 240, precioTotal: 2_400_000, referenciaProveedor: "HARINA 000 X 25" },
    { productoId: aceite, cantidad: 60, precioTotal: 600_000 },
  ],
  reparto: { modo: "IMPORTE", partes: [{ sucursalId: s3, valor: 1_500_000 }, { sucursalId: s4, valor: 1_000_000 }, { sucursalId: s6, valor: 500_000 }] },
  claveIdempotencia: randomUUID(),
  ...extra,
});

const kardexDe = async (sucursalId: string) =>
  prisma.movimientoStock.findMany({ where: { seccion: { sucursalId }, proceso: "COMPRA" }, select: { productoId: true, cantidad: true, precioTotal: true, facturaProveedorRenglonId: true } });
const pesosEn = async (sucursalId: string) => Math.round((await kardexDe(sucursalId)).reduce((s, m) => s + Number(m.precioTotal), 0) * 100) / 100;
const propuestaDe = (destino: string) => prisma.facturaProveedorPropuesta.findFirstOrThrow({ where: { destinoSucursalId: destino }, include: { renglones: true } });

beforeEach(async () => {
  __setCookieDeTestParaSucursal(undefined);
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  rolOperadorId = base.operador.id;
  s3 = base.sucursal.id;
  s4 = (await prisma.sucursal.create({ data: { nombre: "Sucursal 4" } })).id;
  s6 = (await prisma.sucursal.create({ data: { nombre: "Sucursal 6" } })).id;
  [sec3, sec4, sec6] = await Promise.all([s3, s4, s6].map(async (s) => (await sembrarSeccion(s)).id));
  op3 = (await crearUsuarioConMembresia({ email: "op3@test.com", sucursalId: s3, rolId: base.operador.id })).id;
  op4 = (await crearUsuarioConMembresia({ email: "op4@test.com", sucursalId: s4, rolId: base.operador.id })).id;
  op6 = (await crearUsuarioConMembresia({ email: "op6@test.com", sucursalId: s6, rolId: base.operador.id })).id;
  admin = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: s3, rolId: base.admin.id })).id;
  await crearMembresia({ usuarioId: admin, sucursalId: s4, rolId: base.admin.id });
  // El gerente le da `compra_repartir` al rol operador en la matriz (E3a: piso operario, sin migración de datos).
  await prisma.permisoRol.updateMany({ where: { rolId: base.operador.id, accionClave: "compra_repartir" }, data: { puedeVer: true, puedeEditar: true } });
  const { kg, insumo } = await sembrarCatalogoBase();
  const litro = await prisma.unidad.create({ data: { nombre: "l", magnitud: "VOLUMEN", decimales: 2 } });
  const aceiteInsumo = await prisma.insumo.create({ data: { nombre: "Aceite" } });
  harina = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } })).id;
  aceite = (await prisma.producto.create({ data: { codigo: "MP_ACEITE", nombre: "Aceite", tipo: "MP", unidadStockId: litro.id, insumoId: aceiteInsumo.id } })).id;
  await prisma.disponibilidadProducto.createMany({ data: [s3, s4, s6].flatMap((sucursalId) => [harina, aceite].map((productoId) => ({ sucursalId, productoId, disponible: true }))) });
  proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
});

describe("cargar factura", () => {
  it("una sola sucursal: cabecera CONFIRMADA, renglones, parte RECIBIDA con su compra y el stock entra en el acto", async () => {
    await comoOp3();
    const r = await registrarFacturaProveedor(factura({ reparto: { modo: "PORCENTAJE", partes: [{ sucursalId: s3, valor: 100 }] } }));
    expect(r.ok, r.mensaje).toBe(true);
    const cab = await prisma.facturaProveedor.findFirstOrThrow({ include: { renglones: true, partes: true } });
    expect([cab.estado, Number(cab.importeTotal), cab.nroFacturaNormalizado, cab.renglones.length]).toEqual(["CONFIRMADA", 3_000_000, "1-77", 2]);
    expect(cab.partes.map((p) => [p.sucursalId, p.porcentajeDeclaradoBp, p.estadoRecepcion, Boolean(p.operacionId)])).toEqual([[s3, 10000, "RECIBIDA", true]]);
    expect(await calcularSaldoTotal(harina, sec3, prisma)).toBe(240);
    expect(await pesosEn(s3)).toBe(3_000_000);
    expect(await prisma.facturaProveedorPropuesta.count()).toBe(0);
    // La referencia del proveedor queda en el vínculo proveedor↔producto, como en la compra simple (decisión 10).
    expect((await prisma.proveedorPorProducto.findFirstOrThrow({ where: { productoId: harina, proveedorId } })).referenciaProveedor).toBe("HARINA 000 X 25");
  });

  it("reparto 3/4/6: la parte de la 3 entra; las de la 4 y la 6 quedan PROPUESTAS, sin stock ni costo ni gasto hasta aceptar; las sumas cierran exacto", async () => {
    await comoOp3();
    const r = await registrarFacturaProveedor(factura());
    expect(r.ok, r.mensaje).toBe(true);
    expect(r.mensaje).toContain("Quedan para aceptar");
    expect(await pesosEn(s3)).toBe(1_500_000);
    expect(await kardexDe(s4)).toEqual([]);
    expect(await kardexDe(s6)).toEqual([]);
    expect((await obtenerCostoActualPorMP(s4, prisma)).get(harina)).toBeUndefined();
    const p4 = await propuestaDe(s4);
    const p6 = await propuestaDe(s6);
    expect([p4.estado, p4.origenSucursalId, p6.estado]).toEqual(["PENDIENTE", s3, "PENDIENTE"]);
    const pesos = (p: typeof p4) => Math.round(p.renglones.reduce((s, x) => s + Number(x.precioTotal), 0) * 100) / 100;
    expect([pesos(p4), pesos(p6)]).toEqual([1_000_000, 500_000]);
    const parte3 = await prisma.facturaProveedorSucursal.findFirstOrThrow({ where: { sucursalId: s3 } });
    expect(parte3.porcentajeDeclaradoBp + p4.porcentajeDeclaradoBp + p6.porcentajeDeclaradoBp).toBe(10000);
    // Cada renglón suma exacto su importe y su cantidad entre la parte propia y las propuestas.
    for (const renglon of await prisma.facturaProveedorRenglon.findMany()) {
      const enPropuestas = await prisma.facturaProveedorPropuestaRenglon.findMany({ where: { facturaProveedorRenglonId: renglon.id } });
      const enKardex = await prisma.movimientoStock.findMany({ where: { facturaProveedorRenglonId: renglon.id } });
      const total = [...enPropuestas, ...enKardex].reduce((s, x) => s + Math.round(Number(x.precioTotal) * 100), 0);
      const cantidad = [...enPropuestas, ...enKardex].reduce((s, x) => s + Math.round(Number("cantidadStock" in x ? x.cantidadStock : x.cantidad) * 10000), 0);
      expect(total).toBe(Math.round(Number(renglon.precioTotal) * 100));
      expect(cantidad).toBe(Math.round(Number(renglon.cantidadStock) * 10000));
    }
  });

  it("la prueba del dueño: 3.000.000 = 2.000.000 + 1.000.000 EXACTO, la parte de la 4 recién al aceptar", async () => {
    await comoOp3();
    const r = await registrarFacturaProveedor(factura({ reparto: { modo: "IMPORTE", partes: [{ sucursalId: s3, valor: 2_000_000 }, { sucursalId: s4, valor: 1_000_000 }] } }));
    expect(r.ok, r.mensaje).toBe(true);
    expect(await pesosEn(s3)).toBe(2_000_000);
    await comoOp4();
    const a = await aceptarPropuestaDeFactura((await propuestaDe(s4)).id, sec4, mediodiaDeHoy(), randomUUID());
    expect(a.ok, a.mensaje).toBe(true);
    expect(await pesosEn(s4)).toBe(1_000_000);
  });

  it("sin `compra_repartir` el reparto a otras sucursales se rechaza y no se escribe nada; la carga en una sola sucursal sigue andando", async () => {
    await prisma.permisoRol.updateMany({ where: { rolId: rolOperadorId, accionClave: "compra_repartir" }, data: { puedeVer: false, puedeEditar: false } });
    await comoOp3();
    const r = await registrarFacturaProveedor(factura());
    expect(r.ok).toBe(false);
    expect(await prisma.facturaProveedor.count()).toBe(0);
    expect(await prisma.operacion.count()).toBe(0);
    const sola = await registrarFacturaProveedor(factura({ reparto: { modo: "PORCENTAJE", partes: [{ sucursalId: s3, valor: 100 }] } }));
    expect(sola.ok, sola.mensaje).toBe(true);
  });

  it("8 envíos simultáneos con la MISMA clave dejan una sola factura, una sola compra y las propuestas una vez", async () => {
    await comoOp3();
    const datos = factura();
    const rs = await Promise.all(Array.from({ length: 8 }, () => registrarFacturaProveedor(datos)));
    expect(rs.every((r) => r.ok), rs.map((r) => r.mensaje).join(" | ")).toBe(true);
    expect(await prisma.facturaProveedor.count()).toBe(1);
    expect(await prisma.operacion.count({ where: { proceso: "COMPRA" } })).toBe(1);
    expect(await prisma.facturaProveedorPropuesta.count()).toBe(2);
    const otraVez = await registrarFacturaProveedor(datos);
    expect([otraVez.ok, otraVez.mensaje]).toEqual([true, rs[0]!.mensaje]);
    const conflicto = await registrarFacturaProveedor({ ...datos, nroFactura: "0001-00000099" });
    expect(conflicto.ok).toBe(false);
  });

  it("dos cargas simultáneas del mismo número (claves distintas): una sola factura; la otra recibe «ya hay una factura»", async () => {
    await comoOp3();
    const rs = await Promise.all([registrarFacturaProveedor(factura()), registrarFacturaProveedor(factura({ nroFactura: "1-77" }))]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.find((r) => !r.ok)?.mensaje).toMatch(/Ya hay una factura de este proveedor con ese número|Ya hay una compra registrada con esa factura/);
    expect(await prisma.facturaProveedor.count()).toBe(1);
  });

  it("rechazos: sucursal de otra empresa o inexistente, producto indivisible, importes que no suman (con lo que falta)", async () => {
    await comoOp3();
    expect((await registrarFacturaProveedor(factura({ reparto: { modo: "IMPORTE", partes: [{ sucursalId: s3, valor: 2_000_000 }, { sucursalId: "no-existe", valor: 1_000_000 }] } }))).mensaje).toContain("No se encontró una de las sucursales");
    const indivisible = await registrarFacturaProveedor(factura({ items: [{ productoId: harina, cantidad: 1, precioTotal: 90 }], reparto: { modo: "PORCENTAJE", partes: [{ sucursalId: s3, valor: 33.33 }, { sucursalId: s4, valor: 33.33 }, { sucursalId: s6, valor: 33.34 }] } }));
    // La harina es en kg con 2 decimales: 1 kg sí se parte (0,33 / 0,33 / 0,34). El indivisible se prueba con una unidad entera.
    expect(indivisible.ok, indivisible.mensaje).toBe(true);
    const unidad = await prisma.unidad.create({ data: { nombre: "bolsa", magnitud: "CANTIDAD", decimales: 0 } });
    const insumo = await prisma.insumo.create({ data: { nombre: "Bolsa" } });
    const bolsa = await prisma.producto.create({ data: { codigo: "MP_BOLSA", nombre: "Bolsa 25 kg", tipo: "MP", unidadStockId: unidad.id, insumoId: insumo.id } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId: s3, productoId: bolsa.id, disponible: true } });
    const r = await registrarFacturaProveedor(factura({ nroFactura: "0001-00000088", items: [{ productoId: bolsa.id, cantidad: 1, precioTotal: 90 }], reparto: { modo: "PORCENTAJE", partes: [{ sucursalId: s3, valor: 33.33 }, { sucursalId: s4, valor: 33.33 }, { sucursalId: s6, valor: 33.34 }] } }));
    expect(r.mensaje).toContain("«Bolsa 25 kg» no se puede partir");
    const noSuma = await registrarFacturaProveedor(factura({ nroFactura: "0001-00000089", reparto: { modo: "IMPORTE", partes: [{ sucursalId: s3, valor: 2_000_000 }, { sucursalId: s4, valor: 900_000 }] } }));
    expect(noSuma.mensaje).toBe("Los importes de las sucursales no llegan al total: faltan $100000.00.");
  });
});

describe("aceptar mi parte", () => {
  beforeEach(async () => {
    await comoOp3();
    const r = await registrarFacturaProveedor(factura());
    expect(r.ok, r.mensaje).toBe(true);
  });

  it("la 4 acepta exactamente lo propuesto: entra su stock con la fecha elegida, su costo y su gasto; la propuesta queda ACEPTADA con su parte", async () => {
    const p4 = await propuestaDe(s4);
    await comoOp4();
    const a = await aceptarPropuestaDeFactura(p4.id, sec4, mediodiaDeHoy(), randomUUID());
    expect(a.ok, a.mensaje).toBe(true);
    expect(await pesosEn(s4)).toBe(1_000_000);
    expect(await calcularSaldoTotal(harina, sec4, prisma)).toBe(80);
    expect((await obtenerCostoActualPorMP(s4, prisma)).get(harina)?.precioPorUnidadStock).toBe(10_000);
    const despues = await propuestaDe(s4);
    const parte = await prisma.facturaProveedorSucursal.findFirstOrThrow({ where: { sucursalId: s4 } });
    expect([despues.estado, despues.parteId, parte.estadoRecepcion, parte.porcentajeDeclaradoBp, parte.recibidaPorId]).toEqual(["ACEPTADA", parte.id, "RECIBIDA", p4.porcentajeDeclaradoBp, op4]);
    // La 6 sigue sin nada.
    expect(await kardexDe(s6)).toEqual([]);
  });

  it("el operario de la 3 no acepta por la 4 (la ve por ser el origen, pero no es su destino): rechazo y cero filas", async () => {
    const p4 = await propuestaDe(s4);
    await comoOp3();
    const a = await aceptarPropuestaDeFactura(p4.id, sec3, mediodiaDeHoy(), randomUUID());
    expect(a.ok).toBe(false);
    expect((await propuestaDe(s4)).estado).toBe("PENDIENTE");
    expect(await kardexDe(s4)).toEqual([]);
    expect(await prisma.facturaProveedorSucursal.count()).toBe(1);
  });

  it("también cuando la que compra no se quedó con parte (compra para otras): el operario de la 3 no acepta por la 4", async () => {
    await comoOp3();
    const r = await registrarFacturaProveedor(factura({ nroFactura: "0001-00000500", seccionId: undefined, reparto: { modo: "IMPORTE", partes: [{ sucursalId: s4, valor: 2_000_000 }, { sucursalId: s6, valor: 1_000_000 }] } }));
    expect(r.ok, r.mensaje).toBe(true);
    const nueva = await prisma.facturaProveedorPropuesta.findFirstOrThrow({ where: { destinoSucursalId: s4, facturaProveedor: { nroFactura: "0001-00000500" } } });
    const a = await aceptarPropuestaDeFactura(nueva.id, sec3, mediodiaDeHoy(), randomUUID());
    expect(a.ok).toBe(false);
    expect(await prisma.facturaProveedorSucursal.count({ where: { facturaProveedor: { nroFactura: "0001-00000500" } } })).toBe(0);
    expect((await prisma.facturaProveedorPropuesta.findUniqueOrThrow({ where: { id: nueva.id } })).estado).toBe("PENDIENTE");
  });

  it("la 6 no ve la propuesta de la 4 ni puede aceptarla", async () => {
    const p4 = await propuestaDe(s4);
    expect((await listarPropuestasParaAceptar(s6, baseDeTest({ lectura: [s6], escritura: [s6] }).db)).map((p) => p.id)).not.toContain(p4.id);
    expect(await baseDeTest({ lectura: [s6], escritura: [s6] }).db.facturaProveedorPropuesta.findUnique({ where: { id: p4.id } })).toBeNull();
    await comoOp6();
    expect((await aceptarPropuestaDeFactura(p4.id, sec6, mediodiaDeHoy(), randomUUID())).ok).toBe(false);
  });

  it("la bandeja de la 4 muestra solo productos y cantidades de su parte (nada de importes ni partes ajenas)", async () => {
    const bandeja = await listarPropuestasParaAceptar(s4, baseDeTest({ lectura: [s4], escritura: [s4] }).db);
    expect(bandeja).toHaveLength(1);
    expect(Object.keys(bandeja[0]!).sort()).toEqual(["fechaFactura", "id", "nroFactura", "origenNombre", "propuestaEn", "proveedorNombre", "renglones"]);
    expect(Object.keys(bandeja[0]!.renglones[0]!).sort()).toEqual(["cantidadStock", "productoNombre", "unidadNombre"]);
    expect(JSON.stringify(bandeja)).not.toMatch(/precio|importe|1000000|500000/i);
  });

  it("8 aceptaciones simultáneas de la 4 (claves distintas) dejan UNA compra, UNA parte y UN juego de líneas", async () => {
    const p4 = await propuestaDe(s4);
    await comoOp4();
    const rs = await Promise.allSettled(Array.from({ length: 8 }, () => aceptarPropuestaDeFactura(p4.id, sec4, mediodiaDeHoy(), randomUUID())));
    const oks = rs.filter((r) => r.status === "fulfilled" && r.value.ok);
    expect(oks).toHaveLength(1);
    expect(await prisma.facturaProveedorSucursal.count({ where: { sucursalId: s4 } })).toBe(1);
    expect(await prisma.operacion.count({ where: { sucursalId: s4, proceso: "COMPRA" } })).toBe(1);
    expect(await pesosEn(s4)).toBe(1_000_000);
  });

  it("8 aceptaciones simultáneas con la MISMA clave: una sola entrada y el mismo mensaje", async () => {
    const p4 = await propuestaDe(s4);
    await comoOp4();
    const clave = randomUUID();
    const rs = await Promise.all(Array.from({ length: 8 }, () => aceptarPropuestaDeFactura(p4.id, sec4, mediodiaDeHoy(), clave)));
    expect(rs.every((r) => r.ok), rs.map((r) => r.mensaje).join(" | ")).toBe(true);
    expect(await prisma.operacion.count({ where: { sucursalId: s4, proceso: "COMPRA" } })).toBe(1);
    expect(new Set(rs.map((r) => r.mensaje)).size).toBe(1);
  });

  it("fecha de stock fuera de rango (antes de la factura o después de hoy): rechazo sin escribir", async () => {
    const p4 = await propuestaDe(s4);
    await comoOp4();
    const ayer = mediodiaDelDia(sumarDias(diaDeCalendario(hoy(), ZONA_ARGENTINA), -1), ZONA_ARGENTINA);
    const manana = mediodiaDelDia(sumarDias(diaDeCalendario(hoy(), ZONA_ARGENTINA), 1), ZONA_ARGENTINA);
    for (const f of [ayer, manana]) expect((await aceptarPropuestaDeFactura(p4.id, sec4, f, randomUUID())).mensaje).toContain("La fecha de stock tiene que estar entre");
    expect(await kardexDe(s4)).toEqual([]);
  });
});

describe("anular la factura", () => {
  beforeEach(async () => {
    await comoOp3();
    const r = await registrarFacturaProveedor(factura());
    expect(r.ok, r.mensaje).toBe(true);
    await comoOp4();
    const a = await aceptarPropuestaDeFactura((await propuestaDe(s4)).id, sec4, mediodiaDeHoy(), randomUUID());
    expect(a.ok, a.mensaje).toBe(true);
  });
  const facturaId = async () => (await prisma.facturaProveedor.findFirstOrThrow()).id;

  it("entera y atómica: revierte la 3 y la 4, la propuesta pendiente de la 6 queda anulada (no se acepta más) y el número queda libre", async () => {
    await comoAdminEn(s3);
    const r = await anularFacturaProveedor(await facturaId(), "factura mal cargada", randomUUID());
    expect(r.ok, r.mensaje).toBe(true);
    expect(await calcularSaldoTotal(harina, sec3, prisma)).toBe(0);
    expect(await calcularSaldoTotal(harina, sec4, prisma)).toBe(0);
    const cab = await prisma.facturaProveedor.findFirstOrThrow({ include: { anulaciones: true } });
    expect([Boolean(cab.anuladaEn), cab.anulaciones[0]?.motivo]).toEqual([true, "factura mal cargada"]);
    expect(await listarPropuestasParaAceptar(s6, baseDeTest({ lectura: [s6], escritura: [s6] }).db)).toEqual([]);
    expect((await listarPropuestasEnviadas(s3, baseDeTest({ lectura: [s3], escritura: [s3] }).db)).find((p) => p.destinoNombre === "Sucursal 6")?.estado).toBe("ANULADA");
    await comoOp6();
    expect((await aceptarPropuestaDeFactura((await propuestaDe(s6)).id, sec6, mediodiaDeHoy(), randomUUID())).mensaje).toContain("La factura fue anulada");
    await comoOp3();
    expect((await registrarFacturaProveedor(factura())).ok).toBe(true);
  });

  it("si algo de la parte de la 4 ya se consumió, no se anula NADA (tampoco la 3)", async () => {
    const op = await prisma.operacion.create({ data: { sucursalId: s4, proceso: "CONSUMO", fecha: hoy(), usuarioId: op4 } });
    await prisma.movimientoStock.create({ data: { operacionId: op.id, productoId: harina, seccionId: sec4, proceso: "CONSUMO", cantidad: -5, detalle: "Consumo", precioTotal: 0, precioPorUnidadStock: 0 } });
    await comoAdminEn(s3);
    const r = await anularFacturaProveedor(await facturaId(), "error", randomUUID());
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("En «Sucursal 4»");
    expect(await calcularSaldoTotal(harina, sec3, prisma)).toBe(120);
    expect((await prisma.facturaProveedor.findFirstOrThrow()).anuladaEn).toBeNull();
    expect(await prismaAdmin.anulacionDeFacturaProveedor.count()).toBe(0);
  });

  it("sin permiso de anular en una sucursal donde ya entró una parte, se rechaza nombrándolo y no se escribe nada", async () => {
    const otro = await crearUsuarioConMembresia({ email: "admin3@test.com", sucursalId: s3, rolId: (await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } })).id });
    await como(otro.id, "admin3@test.com", s3);
    const r = await anularFacturaProveedor(await facturaId(), "error", randomUUID());
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("otra sucursal donde no tenés permiso");
    expect((await prisma.facturaProveedor.findFirstOrThrow()).anuladaEn).toBeNull();
  });

  it("misma clave dos veces: «repetida» con el mismo mensaje; dos administradores a la vez con claves distintas: una sola anulación", async () => {
    await comoAdminEn(s3);
    const id = await facturaId();
    const rs = await Promise.all([anularFacturaProveedor(id, "a", randomUUID()), anularFacturaProveedor(id, "b", randomUUID())]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.find((r) => !r.ok)?.mensaje).toContain("ya está anulada");
    expect(await prismaAdmin.anulacionDeFacturaProveedor.count()).toBe(1);
    expect(await prisma.operacion.count({ where: { proceso: "AJUSTE" } })).toBe(2);
  });

  it("I3: la misma clave reenviada devuelve el mismo mensaje sin escribir de nuevo", async () => {
    await comoAdminEn(s3);
    const id = await facturaId();
    const clave = randomUUID();
    const rs = await Promise.all(Array.from({ length: 4 }, () => anularFacturaProveedor(id, "motivo", clave)));
    expect(rs.every((r) => r.ok), rs.map((r) => r.mensaje).join(" | ")).toBe(true);
    expect(new Set(rs.map((r) => r.mensaje)).size).toBe(1);
    expect(await prisma.operacion.count({ where: { proceso: "AJUSTE" } })).toBe(2);
  });
});

describe("aceptar contra anular, a la vez", () => {
  it("el resultado es coherente: o la factura quedó anulada y la 4 sin stock (nunca entró o se revirtió), o la 4 aceptó y la factura sigue vigente", async () => {
    await comoOp3();
    expect((await registrarFacturaProveedor(factura())).ok).toBe(true);
    const p4 = await propuestaDe(s4);
    const id = (await prisma.facturaProveedor.findFirstOrThrow()).id;
    // El administrador (membresía en la 3 y la 4) anula y acepta la parte de la 4 a la vez, parado en la 4: un solo usuario y una sola sucursal activa, así el contexto de las dos acciones es el mismo.
    await comoAdminEn(s4);
    const [ra, rc] = await Promise.allSettled([anularFacturaProveedor(id, "carrera", randomUUID()), aceptarPropuestaDeFactura(p4.id, sec4, mediodiaDeHoy(), randomUUID())]);
    expect([ra.status, rc.status]).toEqual(["fulfilled", "fulfilled"]);
    const cab = await prisma.facturaProveedor.findFirstOrThrow();
    const saldo4 = await calcularSaldoTotal(harina, sec4, prisma);
    if (cab.anuladaEn) expect(saldo4).toBe(0);
    else expect([(await propuestaDe(s4)).estado, saldo4]).toEqual(["ACEPTADA", 80]);
  });
});
