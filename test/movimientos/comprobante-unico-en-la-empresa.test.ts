import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarMovimientoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-movimiento";
import { registrarFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-factura-proveedor";
import { corregirCompraCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/corregir-compra";
import { MENSAJE_FACTURA_DUPLICADA } from "../../src/core/movimientos/factura-unica";
import { mediodiaDelDia, ZONA_ARGENTINA, diaDeCalendario, sumarDias } from "../../src/core/tiempo/zona-horaria";
import { guardComandoRegistrarFacturaProveedor } from "../../src/core/features/compras/factura-proveedor.guard";
import type { DatosMovimientoInput } from "../../src/core/features/movimientos/movimiento.schema";
import type { DatosFacturaProveedorInput } from "../../src/core/features/compras/factura-proveedor.schema";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";

/**
 * Etapa 1 de Compras (docs/diseno-compras-factura-unica-y-rechazo-2026-11-03.md, I1, I2, I5, I15): el mismo número del mismo proveedor se rechaza en TODA la empresa, venga como compra simple, como factura repartida o
 * como corrección, escrito como se escriba («A-23-237728» es «A-00023-00237728»). Postgres real, tres sucursales de una empresa. Se llama a los casos de uso con el actor de cada sucursal (la cookie de sucursal de las
 * Server Actions es global y no sirve para dos sucursales a la vez); el mensaje no revela dónde está el otro comprobante, y se prueba por la Server Action con un usuario sin acceso a la otra sucursal.
 * Mutaciones (revertidas editando): sacar el cerrojo o el reintento (la carrera deja dos); abrir la transacción con `actor.transaccion` (la compra de otra sucursal no se ve); sacar la normalización (los ceros distinguen).
 */
const mediodiaDeHoy = () => mediodiaDelDia(diaDeCalendario(new Date(), ZONA_ARGENTINA), ZONA_ARGENTINA);

let s1: string, s2: string, s3: string;
let sec1: string, sec2: string, sec3: string;
let adminId: string, op2Id: string;
let harinaId: string, proveedorId: string, otroProveedorId: string;
let rolOperadorId: string;

const nombres: Record<string, string> = {};
const actorDe = (sucursalId: string) => ({ usuarioId: adminId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId, sucursalNombre: nombres[sucursalId]!, ahora: new Date(), ...baseDeTest({ lectura: [sucursalId], escritura: [sucursalId] }) });
const seccionDe = (sucursalId: string) => ({ [s1]: sec1, [s2]: sec2, [s3]: sec3 })[sucursalId]!;

const compra = (nroFactura: string | undefined, extra: Partial<DatosMovimientoInput> & { sucursalId?: string } = {}): DatosMovimientoInput => {
  const { sucursalId, ...resto } = extra;
  return {
    proceso: "COMPRA",
    fecha: mediodiaDeHoy(),
    seccionId: seccionDe(sucursalId ?? s1),
    proveedorId,
    nroFactura,
    items: [{ productoId: harinaId, cantidad: 10, precioTotal: 1000, referenciaProveedor: REFERENCIA_DE_PRUEBA }],
    claveIdempotencia: randomUUID(),
    ...resto,
  } as DatosMovimientoInput;
};
const cargar = (sucursalId: string, nroFactura: string | undefined, extra: Partial<DatosMovimientoInput> = {}) => registrarMovimientoCasoDeUso(actorDe(sucursalId), compra(nroFactura, { ...extra, sucursalId }));

const facturaRepartida = (sucursalId: string, nroFactura: string, extra: Partial<DatosFacturaProveedorInput> = {}): DatosFacturaProveedorInput => ({
  fecha: mediodiaDeHoy(),
  proveedorId,
  nroFactura,
  seccionId: seccionDe(sucursalId),
  items: [{ productoId: harinaId, cantidad: 10, precioTotal: 1000, referenciaProveedor: REFERENCIA_DE_PRUEBA }],
  reparto: { modo: "PORCENTAJE", partes: [{ sucursalId, valor: 100 }] },
  claveIdempotencia: randomUUID(),
  ...extra,
});
const cargarFactura = (sucursalId: string, nroFactura: string, extra: Partial<DatosFacturaProveedorInput> = {}) => registrarFacturaProveedorCasoDeUso(actorDe(sucursalId), facturaRepartida(sucursalId, nroFactura, extra));

/** Las compras vigentes con ese número (la parte propia de una factura repartida también es una compra: en estos escenarios, una por carga que entró). */
const vigentesConNumero = (nroFactura: string) => prisma.operacion.count({ where: { proceso: "COMPRA", anuladaEn: null, nroFactura } });

beforeEach(async () => {
  __setCookieDeTestParaSucursal(undefined);
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  rolOperadorId = base.operador.id;
  s1 = base.sucursal.id;
  s2 = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
  s3 = (await prisma.sucursal.create({ data: { nombre: "Sur" } })).id;
  Object.assign(nombres, { [s1]: "Central", [s2]: "Norte", [s3]: "Sur" });
  [sec1, sec2, sec3] = await Promise.all([s1, s2, s3].map(async (s) => (await sembrarSeccion(s)).id));
  adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: s1, rolId: base.admin.id })).id;
  op2Id = (await crearUsuarioConMembresia({ email: "op2@test.com", sucursalId: s2, rolId: rolOperadorId })).id;
  const { kg, insumo } = await sembrarCatalogoBase();
  harinaId = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } })).id;
  await prisma.disponibilidadProducto.createMany({ data: [s1, s2, s3].map((sucursalId) => ({ sucursalId, productoId: harinaId, disponible: true })) });
  proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
  otroProveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_2", nombre: "Distribuidora Sur" } })).id;
});

describe("concurrencia: el mismo número a la vez desde dos sucursales", () => {
  it("dos compras simples, escrito distinto: una sola entra y la otra recibe el mensaje único", async () => {
    for (let i = 0; i < 4; i++) {
      const numero = 237_728 + i;
      const [a, b] = await Promise.all([cargar(s1, `A-23-${numero}`), cargar(s2, `A-00023-00${numero}`)]);
      expect([a.ok, b.ok].filter(Boolean), `iteración ${i}: exactamente una`).toHaveLength(1);
      const perdedora = a.ok ? b : a;
      expect(perdedora).toMatchObject({ ok: false, codigo: "FACTURA_DUPLICADA", mensaje: MENSAJE_FACTURA_DUPLICADA });
      expect(await vigentesConNumero(`A-00023-00${numero}`), `iteración ${i}: una sola vigente`).toBe(1);
    }
  }, 30_000);

  it("una compra simple y una factura repartida a la vez: una sola queda", async () => {
    for (let i = 0; i < 4; i++) {
      const numero = 500_100 + i;
      const [a, b] = await Promise.all([cargar(s1, `A-23-${numero}`), cargarFactura(s2, `A-00023-00${numero}`)]);
      expect([a.ok, b.ok].filter(Boolean), `iteración ${i}: exactamente una`).toHaveLength(1);
      expect((a.ok ? b : a), `iteración ${i}`).toMatchObject({ ok: false, codigo: "FACTURA_DUPLICADA", mensaje: MENSAJE_FACTURA_DUPLICADA });
      expect(await vigentesConNumero(`A-00023-00${numero}`), `iteración ${i}: una sola vigente`).toBe(1);
    }
  }, 30_000);
});

describe("idempotencia: la misma clave no duplica ni se confunde con un repetido", () => {
  it("dos veces seguidas: una sola Operacion, la segunda es «repetida» y el stock sube una vez", async () => {
    const datos = compra("A-23-1", { claveIdempotencia: randomUUID() });
    const primera = await registrarMovimientoCasoDeUso(actorDe(s1), datos);
    const segunda = await registrarMovimientoCasoDeUso(actorDe(s1), datos);
    expect(primera).toMatchObject({ ok: true, datos: { repetida: false } });
    expect(segunda).toMatchObject({ ok: true, datos: { repetida: true } });
    expect(await prisma.operacion.count({ where: { proceso: "COMPRA" } })).toBe(1);
    expect(await calcularSaldoTotal(harinaId, sec1, prisma)).toBe(10);
  });

  it("en paralelo: una sola Operacion y el stock sube una vez; ninguna recibe «duplicada»", async () => {
    const datos = compra("A-23-2", { claveIdempotencia: randomUUID() });
    const resultados = await Promise.all([registrarMovimientoCasoDeUso(actorDe(s1), datos), registrarMovimientoCasoDeUso(actorDe(s1), datos)]);
    expect(resultados.every((r) => r.ok)).toBe(true);
    expect(resultados.filter((r) => r.ok && r.datos.repetida)).toHaveLength(1);
    expect(await prisma.operacion.count({ where: { proceso: "COMPRA" } })).toBe(1);
    expect(await calcularSaldoTotal(harinaId, sec1, prisma)).toBe(10);
  });
});

describe("secuencial en la empresa", () => {
  it("el mismo número en otra sucursal se rechaza; otra letra, otro proveedor o la original anulada, no", async () => {
    expect((await cargar(s1, "A-23-237728")).ok).toBe(true);
    expect(await cargar(s2, "A-00023-00237728")).toMatchObject({ ok: false, codigo: "FACTURA_DUPLICADA", mensaje: MENSAJE_FACTURA_DUPLICADA });
    expect((await cargar(s2, "B-23-237728")).ok, "otra letra").toBe(true);
    expect((await cargar(s2, "A-23-237728", { proveedorId: otroProveedorId })).ok, "otro proveedor").toBe(true);
    const original = await prisma.operacion.findFirstOrThrow({ where: { sucursalId: s1, nroFactura: "A-00023-00237728" } });
    await prisma.operacion.update({ where: { id: original.id }, data: { anuladaEn: new Date(), anuladaPorId: adminId } });
    expect((await cargar(s2, "A-23-237728")).ok, "la original anulada deja libre el número").toBe(true);
  });

  it("factura repartida con un número que ya es compra simple en otra sucursal: rechazada; y al revés", async () => {
    expect((await cargar(s1, "A-23-100")).ok).toBe(true);
    expect(await cargarFactura(s2, "A-00023-00000100")).toMatchObject({ ok: false, codigo: "FACTURA_DUPLICADA", mensaje: MENSAJE_FACTURA_DUPLICADA });
    expect((await cargarFactura(s2, "A-23-200")).ok).toBe(true);
    expect(await cargar(s1, "A-00023-00000200")).toMatchObject({ ok: false, codigo: "FACTURA_DUPLICADA", mensaje: MENSAJE_FACTURA_DUPLICADA });
    expect(await cargarFactura(s3, "A-23-200")).toMatchObject({ ok: false, mensaje: MENSAJE_FACTURA_DUPLICADA });
  });

  it("lo viejo con texto libre no se toca y se compara normalizando al leer (I15)", async () => {
    await prisma.operacion.create({ data: { sucursalId: s1, proceso: "COMPRA", fecha: new Date(), usuarioId: adminId, proveedorId, nroFactura: "A 0023-237728" } });
    expect(await cargar(s2, "A-23-237728")).toMatchObject({ ok: false, mensaje: MENSAJE_FACTURA_DUPLICADA });
    expect(await prisma.operacion.count({ where: { nroFactura: "A 0023-237728" } })).toBe(1);
  });
});

describe("corrección", () => {
  it("corregir una compra de S2 al número de una compra vigente de S1 se rechaza con el mensaje único; con un número libre, pasa", async () => {
    expect((await cargar(s1, "A-23-300")).ok).toBe(true);
    expect((await cargar(s2, "A-23-301")).ok).toBe(true);
    const deS2 = await prisma.operacion.findFirstOrThrow({ where: { sucursalId: s2, proceso: "COMPRA" } });
    const vista = { proveedorId, nroFactura: deS2.nroFactura ?? "", detalleLibre: deS2.detalleLibre ?? "" };
    const pedir = (nroFactura: string) => corregirCompraCasoDeUso(actorDe(s2), { operacionId: deS2.id, nueva: { ...vista, nroFactura }, esperado: vista });
    expect(await pedir("A-23-300")).toEqual({ ok: false, codigo: "FACTURA_DUPLICADA", mensaje: MENSAJE_FACTURA_DUPLICADA });
    expect((await pedir("A-23-302")).ok).toBe(true);
  });

  it("quitar el número o el proveedor de una compra se rechaza", async () => {
    expect((await cargar(s1, "A-23-400")).ok).toBe(true);
    const op = await prisma.operacion.findFirstOrThrow({ where: { sucursalId: s1, proceso: "COMPRA" } });
    const vista = { proveedorId, nroFactura: op.nroFactura ?? "", detalleLibre: op.detalleLibre ?? "" };
    const sinNumero = await corregirCompraCasoDeUso(actorDe(s1), { operacionId: op.id, nueva: { ...vista, nroFactura: "" }, esperado: vista });
    expect(sinNumero).toMatchObject({ ok: false, codigo: "ENTRADA_INVALIDA" });
    const sinProveedor = await corregirCompraCasoDeUso(actorDe(s1), { operacionId: op.id, nueva: { ...vista, proveedorId: "" }, esperado: vista });
    expect(sinProveedor).toEqual({ ok: false, codigo: "ENTRADA_INVALIDA", mensaje: "La compra tiene que tener proveedor." });
  });
});

describe("el rechazo no revela datos de otra sucursal", () => {
  it("un usuario sin acceso a S1 carga en S2 el número que está en S1: el mensaje es el único, sin sucursal ni fecha", async () => {
    expect((await cargar(s1, "A-23-600")).ok).toBe(true);
    __setCookieDeTestParaSucursal(s2);
    await mockearUsuarioActual({ id: op2Id, email: "op2@test.com", nombre: null });
    const r = await registrarMovimiento({ ...compra("A-23-600", { sucursalId: s2 }) });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toBe(MENSAJE_FACTURA_DUPLICADA);
    expect(r.mensaje).not.toContain("Central");
    expect(r.mensaje).not.toMatch(/\d{1,4}[-/]\d{1,2}[-/]\d{1,4}/);
  });
});

describe("aceptar una parte queda cubierto por construcción", () => {
  it("compra simple en S3 con el número N: una factura con N repartida a S3 ni siquiera se carga (nunca llega una propuesta a aceptar)", async () => {
    expect((await cargar(s3, "A-23-700")).ok).toBe(true);
    const repartida = facturaRepartida(s1, "A-23-700", { reparto: { modo: "PORCENTAJE", partes: [{ sucursalId: s1, valor: 50 }, { sucursalId: s3, valor: 50 }] } });
    expect(await registrarFacturaProveedorCasoDeUso(actorDe(s1), repartida)).toMatchObject({ ok: false, codigo: "FACTURA_DUPLICADA", mensaje: MENSAJE_FACTURA_DUPLICADA });
    expect(await prisma.facturaProveedorPropuesta.count()).toBe(0);
  });
});

describe("proveedor y número obligatorios en una COMPRA", () => {
  it("sin proveedor, sin número o con un número mal formado: rechazos con su mensaje, y no se escribe nada", async () => {
    expect(await cargar(s1, "A-23-800", { proveedorId: undefined })).toEqual({ ok: false, codigo: "PROVEEDOR_OBLIGATORIO", mensaje: "Elegí el proveedor de la factura." });
    expect(await cargar(s1, undefined)).toMatchObject({ ok: false, codigo: "FACTURA_INVALIDA", mensaje: "Falta el número de la factura: letra, punto de venta y número." });
    expect(await cargar(s1, "#123")).toMatchObject({ ok: false, codigo: "FACTURA_INVALIDA" });
    expect(await cargar(s1, "A-0-5")).toMatchObject({ ok: false, codigo: "FACTURA_INVALIDA" });
    expect(await prisma.operacion.count()).toBe(0);
  });

  it("la compra guarda el texto canónico", async () => {
    expect((await cargar(s1, "a 23 5")).ok).toBe(true);
    expect((await prisma.operacion.findFirstOrThrow({ where: { proceso: "COMPRA" } })).nroFactura).toBe("A-00023-00000005");
  });

  it("la factura repartida también exige número estructurado, y deja el canónico en el comando", () => {
    const comando = (nroFactura: unknown) => guardComandoRegistrarFacturaProveedor({ ...facturaRepartida(s1, ""), nroFactura }, new Date(), s1);
    expect(comando(undefined)).toMatchObject({ ok: false, codigo: "vacio" });
    expect(comando("")).toMatchObject({ ok: false, codigo: "vacio" });
    expect(comando("0001-00000077")).toMatchObject({ ok: false, codigo: "formato" });
    expect(comando("a-23-77")).toMatchObject({ ok: true, valor: { nroFactura: "A-00023-00000077" } });
  });

  it("una Devolución a proveedor con texto libre sigue andando", async () => {
    expect((await cargar(s1, "A-23-900")).ok).toBe(true);
    const r = await registrarMovimientoCasoDeUso(actorDe(s1), { proceso: "DEVOLUCION_PROVEEDOR", fecha: mediodiaDeHoy(), seccionId: sec1, proveedorId, nroFactura: "#NC-123", items: [{ productoId: harinaId, cantidad: 1 }], claveIdempotencia: randomUUID() } as DatosMovimientoInput);
    expect(r.ok, r.mensaje).toBe(true);
    expect((await prisma.operacion.findFirstOrThrow({ where: { proceso: "DEVOLUCION_PROVEEDOR" } })).nroFactura).toBe("#NC-123");
  });
});

describe("I13: la fecha de una compra no puede ser posterior a hoy (etapa 1 de Compras)", () => {
  it("una compra con fecha de mañana por la Server Action se rechaza y no escribe nada", async () => {
    const antes = await prisma.operacion.count();
    const manana = mediodiaDelDia(sumarDias(diaDeCalendario(new Date(), ZONA_ARGENTINA), 1), ZONA_ARGENTINA);
    __setCookieDeTestParaSucursal(s2);
    await mockearUsuarioActual({ id: op2Id, email: "op2@test.com", nombre: null });
    const r = await registrarMovimiento({ ...compra("A-00023-00237728", { sucursalId: s2 }), fecha: manana });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toBe("La fecha de la compra no puede ser posterior a hoy.");
    expect(await prisma.operacion.count()).toBe(antes);
    expect(await prisma.movimientoStock.count()).toBe(0);
  });
});
