import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { datosDeFactura, sembrarAjeno } from "../setup/factura-proveedor";
import { anularFacturaProveedor, registrarFacturaProveedor } from "../../src/server/actions/movimientos/facturas-proveedor";
import { anularPagoDeFacturaProveedor, declararPagoDeFacturaProveedor } from "../../src/server/actions/movimientos/pagos-factura-proveedor";
import { listarComprasRegistradas } from "../../src/server/consultas/reportes/compras-registradas";
import { ZONA_ARGENTINA, diaDeCalendario, mediodiaDelDia, sumarDias } from "../../src/core/tiempo/zona-horaria";
import type { DatosFacturaProveedorInput } from "../../src/core/features/compras/factura-proveedor.schema";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";

/**
 * Pagos X0 (docs/diseno-pagos-x0-2026-11-04.md): «declarar pago» y «anular pago» de una factura de proveedor, contra Postgres real y por las Server Actions de verdad (permiso, formato, caso de uso, base).
 *
 * Cubre: el permiso nuevo `declarar_pago_compra` (el operador no lo tiene; el gerente se lo da en la matriz), la factura «pagada al cargar» que no admite pago, las fechas (antes de la factura, hoy, mañana), la IDEMPOTENCIA (la
 * misma clave dos veces no duplica pago ni auditoría; la misma clave con otros datos es conflicto), la CONCURRENCIA (dos declaraciones simultáneas sobre la misma factura: una gana; la misma clave a la vez: un solo pago), la anulación
 * como registro nuevo y la posibilidad de volver a declarar, el aislamiento entre empresas y el estado de pago que muestra «Compras registradas».
 *
 * Mutaciones (anotadas en el commit): sin el chequeo `tienePagoVigente` y sin el índice parcial → rojo «dos declaraciones a la vez»; sin la clave en el pago → rojo «misma clave dos veces»; con `proceso_compra` en lugar de
 * `declarar_pago_compra` → rojo «el operador no puede declarar»; sin la comparación contra hoy → rojo «mañana».
 */
let s1: string, sec1: string;
let admin: string, operador: string;
let rolOperadorId: string;
let harina: string, proveedorId: string;
let numero = 0;

const como = async (usuarioId: string, email: string) => {
  __setCookieDeTestParaSucursal(s1);
  await mockearUsuarioActual({ id: usuarioId, email, nombre: null });
};
const comoAdmin = () => como(admin, "admin@test.com");
const comoOperador = () => como(operador, "operador@test.com");

const hoy = () => diaDeCalendario(new Date(), ZONA_ARGENTINA);
const haceDias = (n: number) => sumarDias(hoy(), -n);

/** Carga una factura de una sola parte (la de esta sucursal) y devuelve su id. `diasAtras`: qué tan vieja es la factura. */
async function cargarFactura(opciones: { condicionPago?: "CONTADO_PAGADA" | "PENDIENTE_DE_PAGO"; diasAtras?: number } = {}): Promise<string> {
  numero += 1;
  const nroFactura = `A-00001-${String(numero).padStart(8, "0")}`;
  const datos: DatosFacturaProveedorInput = {
    fecha: mediodiaDelDia(haceDias(opciones.diasAtras ?? 0), ZONA_ARGENTINA),
    proveedorId,
    nroFactura,
    seccionId: sec1,
    items: [{ productoId: harina, cantidad: 10, precioTotal: 1000, referenciaProveedor: REFERENCIA_DE_PRUEBA }],
    reparto: { modo: "PORCENTAJE", partes: [{ sucursalId: s1, valor: 100 }] },
    ...(opciones.condicionPago ? { condicionPago: opciones.condicionPago } : {}),
    claveIdempotencia: randomUUID(),
  };
  const r = await registrarFacturaProveedor(datos);
  expect(r.ok, r.mensaje).toBe(true);
  return (await prisma.facturaProveedor.findFirstOrThrow({ where: { nroFactura }, select: { id: true } })).id;
}
const pendiente = (diasAtras = 0) => cargarFactura({ condicionPago: "PENDIENTE_DE_PAGO", diasAtras });
const declarar = (facturaId: string, fechaPago = hoy(), medio = "TRANSFERENCIA", clave: string = randomUUID()) => declararPagoDeFacturaProveedor(facturaId, fechaPago, medio, clave);
const pagosDe = (facturaId: string) => prisma.pagoDeFacturaProveedor.findMany({ where: { facturaProveedorId: facturaId }, orderBy: { creadoEn: "asc" } });
const auditoriaDePagos = (facturaId: string) => prisma.registroAuditoria.count({ where: { entidad: "FacturaProveedor", entidadId: facturaId, campo: "pagoDeclarado" } });

beforeEach(async () => {
  __setCookieDeTestParaSucursal(undefined);
  await limpiarBaseDeTest();
  numero = 0;
  const base = await sembrarBase();
  rolOperadorId = base.operador.id;
  s1 = base.sucursal.id;
  sec1 = (await sembrarSeccion(s1)).id;
  admin = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: s1, rolId: base.admin.id })).id;
  operador = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: s1, rolId: base.operador.id })).id;
  const { kg, insumo } = await sembrarCatalogoBase();
  harina = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } })).id;
  await prisma.disponibilidadProducto.create({ data: { sucursalId: s1, productoId: harina, disponible: true } });
  proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
  await comoAdmin();
});

describe("cargar la factura pendiente de pago", () => {
  it("una carga SIN condición sigue siendo «pagada al cargar»; con PENDIENTE_DE_PAGO queda pendiente y el stock entra igual", async () => {
    const pagada = await cargarFactura();
    const pendienteId = await pendiente();
    expect((await prisma.facturaProveedor.findUniqueOrThrow({ where: { id: pagada } })).condicionPago).toBe("CONTADO_PAGADA");
    expect((await prisma.facturaProveedor.findUniqueOrThrow({ where: { id: pendienteId } })).condicionPago).toBe("PENDIENTE_DE_PAGO");
    const kardex = await prisma.movimientoStock.count({ where: { proceso: "COMPRA", facturaProveedorRenglon: { facturaProveedorId: pendienteId } } });
    expect(kardex, "la compra pendiente de pago mueve el stock como cualquier otra").toBe(1);
  });

  it("una condición inventada se rechaza en el servidor", async () => {
    const r = await registrarFacturaProveedor({
      fecha: mediodiaDelDia(hoy(), ZONA_ARGENTINA),
      proveedorId,
      nroFactura: "A-00001-00009999",
      seccionId: sec1,
      items: [{ productoId: harina, cantidad: 1, precioTotal: 100, referenciaProveedor: REFERENCIA_DE_PRUEBA }],
      reparto: { modo: "PORCENTAJE", partes: [{ sucursalId: s1, valor: 100 }] },
      condicionPago: "A_CREDITO" as never,
      claveIdempotencia: randomUUID(),
    });
    expect(r.ok).toBe(false);
    expect(await prisma.facturaProveedor.count()).toBe(0);
  });
});

describe("declarar pago", () => {
  it("la factura del viernes se paga el martes: queda el pago con su fecha, medio y quién lo declaró; la lista de compras muestra «Pagada»", async () => {
    const id = await pendiente(5);
    const antes = await listarComprasRegistradas(s1, {}, prisma);
    expect(antes.items[0]!.pago).toEqual({ estado: "PENDIENTE", pagoVigente: null });
    const r = await declarar(id, haceDias(2), "EFECTIVO");
    expect(r.ok, r.mensaje).toBe(true);
    const [pago] = await pagosDe(id);
    expect(pago).toMatchObject({ medio: "EFECTIVO", anuladoEn: null, creadoPorId: admin });
    expect(pago!.fechaPago.toISOString().slice(0, 10)).toBe(haceDias(2));
    const despues = await listarComprasRegistradas(s1, {}, prisma);
    expect(despues.items[0]!.pago).toEqual({ estado: "PAGADA", pagoVigente: { pagoId: pago!.id, dia: haceDias(2), medio: "EFECTIVO" } });
    expect(await auditoriaDePagos(id)).toBe(1);
  });

  it("una factura «pagada al cargar» no admite que se le declare un pago", async () => {
    const id = await cargarFactura();
    const r = await declarar(id);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/se cargó como pagada/);
    expect(await pagosDe(id)).toHaveLength(0);
    expect((await listarComprasRegistradas(s1, {}, prisma)).items[0]!.pago).toEqual({ estado: "PAGADA_AL_CARGAR", pagoVigente: null });
  });

  it("fechas: hoy y el día de la factura entran; antes de la factura y mañana no", async () => {
    const id = await pendiente(3);
    expect((await declarar(id, haceDias(4))).ok, "antes de la factura").toBe(false);
    expect((await declarar(id, sumarDias(hoy(), 1))).ok, "mañana").toBe(false);
    expect(await pagosDe(id)).toHaveLength(0);
    const ok = await declarar(id, haceDias(3));
    expect(ok.ok, "el mismo día de la factura").toBe(true);
    const otra = await pendiente(3);
    expect((await declarar(otra, hoy())).ok, "hoy").toBe(true);
  });

  it("medio inválido o fecha mal formada: se rechaza sin escribir", async () => {
    const id = await pendiente();
    expect((await declarar(id, hoy(), "BITCOIN")).ok).toBe(false);
    expect((await declarar(id, "2026-02-30")).ok).toBe(false);
    expect(await pagosDe(id)).toHaveLength(0);
  });

  it("una factura anulada no admite pago", async () => {
    const id = await pendiente();
    const anulada = await anularFacturaProveedor(id, "cargada por error", randomUUID());
    expect(anulada.ok, anulada.mensaje).toBe(true);
    const r = await declarar(id);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/anulada/);
    expect(await pagosDe(id)).toHaveLength(0);
  });

  it("una factura que no existe se informa como no encontrada", async () => {
    const r = await declarar("no-existe");
    expect(r).toMatchObject({ ok: false });
    expect(r.mensaje).toMatch(/No se encontró/);
  });

  it("ya con un pago vigente, declarar otro (clave nueva) se rechaza: hay que anular primero", async () => {
    const id = await pendiente();
    expect((await declarar(id)).ok).toBe(true);
    const r = await declarar(id, hoy(), "CHEQUE");
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/ya tiene un pago/);
    expect(await pagosDe(id)).toHaveLength(1);
  });
});

describe("permisos (se verifican en el servidor)", () => {
  it("el operador NO puede declarar ni anular; si el gerente le da la clave en la matriz, sí", async () => {
    const id = await pendiente();
    await comoOperador();
    const sin = await declarar(id);
    expect(sin.ok).toBe(false);
    expect(await pagosDe(id)).toHaveLength(0);

    await prisma.permisoRol.updateMany({ where: { rolId: rolOperadorId, accionClave: "declarar_pago_compra" }, data: { puedeVer: true, puedeEditar: true } });
    const con = await declarar(id);
    expect(con.ok, con.mensaje).toBe(true);
    const [pago] = await pagosDe(id);
    expect(pago!.creadoPorId).toBe(operador);

    await prisma.permisoRol.updateMany({ where: { rolId: rolOperadorId, accionClave: "declarar_pago_compra" }, data: { puedeVer: false, puedeEditar: false } });
    const anular = await anularPagoDeFacturaProveedor(pago!.id, "error", randomUUID());
    expect(anular.ok, "se le retiró el permiso entre una acción y la otra").toBe(false);
    expect((await pagosDe(id))[0]!.anuladoEn).toBeNull();
  });

  it("quien carga la compra (proceso_compra) no puede por eso declarar el pago", async () => {
    const id = await pendiente();
    await comoOperador();
    expect((await declarar(id)).ok).toBe(false);
  });
});

describe("idempotencia", () => {
  it("la MISMA clave y los mismos datos, dos veces: un solo pago, una sola auditoría, mismo mensaje", async () => {
    const id = await pendiente();
    const clave = randomUUID();
    const a = await declarar(id, hoy(), "TRANSFERENCIA", clave);
    const b = await declarar(id, hoy(), "TRANSFERENCIA", clave);
    expect(a.ok && b.ok).toBe(true);
    expect(b.mensaje).toBe(a.mensaje);
    expect(await pagosDe(id)).toHaveLength(1);
    expect(await auditoriaDePagos(id)).toBe(1);
  });

  it("la misma clave con OTROS datos es conflicto y no escribe", async () => {
    const id = await pendiente();
    const clave = randomUUID();
    expect((await declarar(id, hoy(), "TRANSFERENCIA", clave)).ok).toBe(true);
    const r = await declarar(id, hoy(), "EFECTIVO", clave);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/ya se había enviado con datos distintos/);
    expect((await pagosDe(id))[0]!.medio).toBe("TRANSFERENCIA");
  });

  it("anular dos veces con la misma clave: una sola anulación", async () => {
    const id = await pendiente();
    await declarar(id);
    const [pago] = await pagosDe(id);
    const clave = randomUUID();
    const a = await anularPagoDeFacturaProveedor(pago!.id, "me equivoqué", clave);
    const b = await anularPagoDeFacturaProveedor(pago!.id, "me equivoqué", clave);
    expect(a.ok && b.ok).toBe(true);
    expect(await prisma.anulacionDePagoDeFacturaProveedor.count({ where: { pagoId: pago!.id } })).toBe(1);
    const otra = await anularPagoDeFacturaProveedor(pago!.id, "otro motivo", randomUUID());
    expect(otra.ok).toBe(false);
    expect(otra.mensaje).toMatch(/ya está anulado/);
  });
});

describe("concurrencia", () => {
  it("DOS declaraciones a la vez sobre la misma factura (claves distintas): una gana y queda un solo pago vigente", async () => {
    const id = await pendiente();
    const [a, b] = await Promise.all([declarar(id, hoy(), "TRANSFERENCIA"), declarar(id, hoy(), "EFECTIVO")]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const perdedora = a.ok ? b : a;
    expect(perdedora.mensaje).toMatch(/ya tiene un pago/);
    const vigentes = (await pagosDe(id)).filter((p) => p.anuladoEn === null);
    expect(vigentes).toHaveLength(1);
    expect(await auditoriaDePagos(id)).toBe(1);
  });

  it("OCHO declaraciones a la vez: exactamente una escribe", async () => {
    const id = await pendiente();
    const medios = ["TRANSFERENCIA", "EFECTIVO", "CHEQUE", "TARJETA", "OTRO", "TRANSFERENCIA", "EFECTIVO", "CHEQUE"];
    const resultados = await Promise.all(medios.map((m) => declarar(id, hoy(), m)));
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(await pagosDe(id)).toHaveLength(1);
  });

  it("la MISMA clave a la vez (doble clic): ambas responden bien y hay un solo pago", async () => {
    const id = await pendiente();
    const clave = randomUUID();
    const [a, b] = await Promise.all([declarar(id, hoy(), "TRANSFERENCIA", clave), declarar(id, hoy(), "TRANSFERENCIA", clave)]);
    expect(a.ok && b.ok).toBe(true);
    expect(await pagosDe(id)).toHaveLength(1);
    expect(await auditoriaDePagos(id)).toBe(1);
  });

  it("dos anulaciones a la vez del mismo pago: una gana", async () => {
    const id = await pendiente();
    await declarar(id);
    const [pago] = await pagosDe(id);
    const [a, b] = await Promise.all([anularPagoDeFacturaProveedor(pago!.id, "uno", randomUUID()), anularPagoDeFacturaProveedor(pago!.id, "dos", randomUUID())]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await prisma.anulacionDePagoDeFacturaProveedor.count({ where: { pagoId: pago!.id } })).toBe(1);
  });
});

describe("anular el pago (registro nuevo, nada se borra)", () => {
  it("anula con motivo, la factura vuelve a pendiente y se puede declarar un pago nuevo; el historial queda", async () => {
    const id = await pendiente(2);
    await declarar(id, haceDias(1), "CHEQUE");
    const [primero] = await pagosDe(id);
    const anulado = await anularPagoDeFacturaProveedor(primero!.id, "Era otra fecha", randomUUID());
    expect(anulado.ok, anulado.mensaje).toBe(true);
    const marcado = await prisma.pagoDeFacturaProveedor.findUniqueOrThrow({ where: { id: primero!.id }, include: { anulaciones: true } });
    expect(marcado.anuladoEn).not.toBeNull();
    expect(marcado.anuladoPorId).toBe(admin);
    expect(marcado.anulaciones[0]).toMatchObject({ motivo: "Era otra fecha", creadoPorId: admin });
    expect((await listarComprasRegistradas(s1, {}, prisma)).items[0]!.pago).toEqual({ estado: "PENDIENTE", pagoVigente: null });

    const nuevo = await declarar(id, hoy(), "EFECTIVO");
    expect(nuevo.ok, nuevo.mensaje).toBe(true);
    const todos = await pagosDe(id);
    expect(todos, "el pago anulado no se borra").toHaveLength(2);
    expect(todos.filter((p) => p.anuladoEn === null)).toHaveLength(1);
    expect(await auditoriaDePagos(id)).toBe(3);
  });

  it("sin motivo no anula; un pago que no existe se informa", async () => {
    const id = await pendiente();
    await declarar(id);
    const [pago] = await pagosDe(id);
    expect((await anularPagoDeFacturaProveedor(pago!.id, "  ", randomUUID())).ok).toBe(false);
    expect((await anularPagoDeFacturaProveedor("no-existe", "x", randomUUID())).mensaje).toMatch(/No se encontró/);
    expect((await pagosDe(id))[0]!.anuladoEn).toBeNull();
  });
});

describe("aislamiento entre empresas", () => {
  it("una factura de OTRA empresa no se puede pagar ni anular el pago de otra empresa", async () => {
    const ajeno = await sembrarAjeno(admin);
    const factura = await ajeno.testigo.facturaProveedor.create({
      data: datosDeFactura({ usuarioId: admin }, { proveedorId: ajeno.proveedor.id, condicionPago: "PENDIENTE_DE_PAGO" }),
    });
    const r = await declarar(factura.id);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/No se encontró/);
    const pagoAjeno = await ajeno.testigo.pagoDeFacturaProveedor.create({
      data: { facturaProveedorId: factura.id, fechaPago: new Date("2026-11-03"), medio: "EFECTIVO", claveIdempotencia: randomUUID(), payloadHash: "h", resultadoMensaje: "ok", creadoPorId: admin },
    });
    const a = await anularPagoDeFacturaProveedor(pagoAjeno.id, "intento", randomUUID());
    expect(a.ok).toBe(false);
    expect(await prismaAdmin.pagoDeFacturaProveedor.count({ where: { id: pagoAjeno.id, anuladoEn: null } })).toBe(1);
    expect(await prisma.pagoDeFacturaProveedor.count(), "la empresa de prueba no ve el pago de la otra").toBe(0);
  });
});
