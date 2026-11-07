import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";
import { registrarMovimientoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-movimiento";
import { registrarFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-factura-proveedor";
import { MENSAJE_FACTURA_DUPLICADA } from "../../src/core/movimientos/factura-unica";
import { mediodiaDelDia, ZONA_ARGENTINA, diaDeCalendario, sumarDias } from "../../src/core/tiempo/zona-horaria";
import type { DatosMovimientoInput } from "../../src/core/features/movimientos/movimiento.schema";

/**
 * U0 de «una sola compra» (docs/diseno-una-sola-compra-2026-11-06.md §8.1 y §12.2): toda compra entra por la puerta de la factura. Postgres real, caso de uso real.
 *
 *  - U-I1: una COMPRA cargada por `registrarMovimiento` (el adaptador) queda como factura de UNA parte: cabecera `CONFIRMADA`/`CARGA`/`CONTADO_PAGADA`, renglón, parte `RECIBIDA` al 100 % atada a su compra, y toda línea de
 *    Kardex lleva su renglón. I-NUM de base: el número y el proveedor de la compra son los de la cabecera.
 *  - Mensaje de una parte igual al de siempre («Se guardaron N movimiento(s).») con los avisos (conversión de unidad y C25 de posible repetida), también cuando se llama directo a la factura.
 *  - Idempotencia: reenviar la misma compra (clic doble, reintento) devuelve el mismo mensaje y deja UNA factura; la misma clave con otro contenido es conflicto.
 *  - Concurrencia: 8 cargas a la vez con la misma clave = 1 factura y 1 Operacion; el mismo número con dos claves = 1 éxito y la otra `FACTURA_DUPLICADA`, sin nada a medias.
 *
 * Mutaciones (anotadas en el commit): sin el `aviso` C25 en el escritor de la factura → rojo «avisa de la posible repetida»; el adaptador sin `condicionPago: "CONTADO_PAGADA"` → rojo «contado»; sin la huella en la cabecera
 * (`claveIdempotencia`) → rojo «8 cargas a la vez».
 */
const mediodiaDeHoy = () => mediodiaDelDia(diaDeCalendario(new Date(), ZONA_ARGENTINA), ZONA_ARGENTINA);

let central: string, norte: string, seccionCentral: string, seccionNorte: string, adminId: string, adminNorteId: string, proveedorId: string, productoId: string, cajaId: string, productoCajaId: string;

const actorDe = (usuarioId: string, sucursalId: string, nombre: string) => ({ usuarioId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId, sucursalNombre: nombre, ahora: new Date(), ...baseDeTest({ lectura: [sucursalId], escritura: [sucursalId] }) });
const enCentral = () => actorDe(adminId, central, "Central");
const enNorte = () => actorDe(adminNorteId, norte, "Norte");

const compra = (extra: Partial<DatosMovimientoInput> & { nroFactura?: string; claveIdempotencia?: string } = {}): DatosMovimientoInput => ({
  proceso: "COMPRA",
  fecha: mediodiaDeHoy(),
  seccionId: seccionCentral,
  proveedorId,
  nroFactura: "A-00001-00000500",
  items: [{ productoId, cantidad: 10, precioTotal: 123.45, referenciaProveedor: REFERENCIA_DE_PRUEBA }],
  claveIdempotencia: randomUUID(),
  ...extra,
}) as DatosMovimientoInput;

const conteos = async () => ({
  facturas: await prisma.facturaProveedor.count(),
  operaciones: await prisma.operacion.count({ where: { proceso: "COMPRA" } }),
  movimientos: await prisma.movimientoStock.count({ where: { proceso: "COMPRA" } }),
  partes: await prisma.facturaProveedorSucursal.count(),
});

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  central = base.sucursal.id;
  norte = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
  seccionCentral = (await sembrarSeccion(central)).id;
  seccionNorte = (await sembrarSeccion(norte)).id;
  adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: central, rolId: base.admin.id })).id;
  adminNorteId = (await crearUsuarioConMembresia({ email: "admin-norte@test.com", sucursalId: norte, rolId: base.admin.id })).id;
  const { kg, insumo } = await sembrarCatalogoBase();
  cajaId = (await prisma.unidad.create({ data: { nombre: "caja", magnitud: "CANTIDAD", decimales: 0 } })).id;
  productoId = (await sembrarProductoDisponible({ codigo: "MP_A", nombre: "Harina", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id }, central)).id;
  await prisma.disponibilidadProducto.create({ data: { sucursalId: norte, productoId, disponible: true } });
  productoCajaId = (await sembrarProductoDisponible({ codigo: "MP_CAJA", nombre: "Azúcar", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id, unidadCompraId: cajaId, factorConversion: "25" }, central)).id;
  proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
});

describe("U-I1: registrarMovimiento COMPRA deja una factura de una parte", () => {
  it("cabecera CONFIRMADA/CARGA/contado, renglón, parte RECIBIDA al 100 % atada a la compra, y toda línea de Kardex con su renglón", async () => {
    const r = await registrarMovimientoCasoDeUso(enCentral(), compra());
    expect(r.ok, r.mensaje).toBe(true);

    const cabecera = await prisma.facturaProveedor.findFirstOrThrow({ include: { renglones: true, partes: true } });
    expect([cabecera.estado, cabecera.origen, cabecera.condicionPago, cabecera.nroFactura, cabecera.proveedorId, Number(cabecera.importeTotal)]).toEqual(["CONFIRMADA", "CARGA", "CONTADO_PAGADA", "A-00001-00000500", proveedorId, 123.45]);
    expect(cabecera.renglones).toHaveLength(1);
    expect(cabecera.partes.map((p) => [p.sucursalId, p.estadoRecepcion, p.porcentajeDeclaradoBp])).toEqual([[central, "RECIBIDA", 10000]]);

    const operacion = await prisma.operacion.findFirstOrThrow({ where: { proceso: "COMPRA" } });
    expect(cabecera.partes[0]!.operacionId, "la parte apunta a la compra").toBe(operacion.id);
    expect(r.ok && r.datos.repetida === false && r.datos.operacionId, "el adaptador devuelve la operacionId de la parte").toBe(operacion.id);
    // I-NUM de base: la compra de la parte lleva el número y el proveedor de su factura.
    expect([operacion.nroFactura, operacion.proveedorId]).toEqual([cabecera.nroFactura, cabecera.proveedorId]);
    const lineas = await prisma.movimientoStock.findMany({ where: { operacionId: operacion.id } });
    expect(lineas.length).toBeGreaterThan(0);
    expect(lineas.every((l) => l.facturaProveedorRenglonId === cabecera.renglones[0]!.id)).toBe(true);
  });

  it("también cuando la llama el camino directo de la factura de una parte: toda COMPRA nueva tiene parte de factura", async () => {
    const r = await registrarFacturaProveedorCasoDeUso(enCentral(), {
      fecha: mediodiaDeHoy(), proveedorId, nroFactura: "A-00001-00000501", seccionId: seccionCentral,
      items: [{ productoId, cantidad: 2, precioTotal: 50, referenciaProveedor: REFERENCIA_DE_PRUEBA }],
      reparto: { modo: "PORCENTAJE", partes: [{ sucursalId: central, valor: 100 }] }, claveIdempotencia: randomUUID(),
    });
    expect(r.ok, r.mensaje).toBe(true);
    const sinParte = await prisma.operacion.findMany({ where: { proceso: "COMPRA", movimientos: { none: { facturaProveedorRenglonId: { not: null } } } } });
    expect(sinParte).toEqual([]);
  });
});

describe("el mensaje de una parte es el de siempre, con sus avisos", () => {
  it("sin avisos: «Se guardaron 1 movimiento(s).»", async () => {
    const r = await registrarMovimientoCasoDeUso(enCentral(), compra());
    expect(r.mensaje).toBe("Se guardaron 1 movimiento(s).");
  });

  it("con conversión de unidad de compra a unidad de stock: lo avisa", async () => {
    const r = await registrarMovimientoCasoDeUso(enCentral(), compra({ items: [{ productoId: productoCajaId, cantidad: 3, precioTotal: 1000, referenciaProveedor: REFERENCIA_DE_PRUEBA }] }));
    expect(r.mensaje).toBe("Se guardaron 1 movimiento(s). Algunas cantidades se convirtieron automáticamente de unidad de compra a unidad de stock.");
  });

  it("C25: la misma compra con otro número, el mismo proveedor e importe en la ventana, avisa de la posible repetida y NO bloquea (por el adaptador y por la factura directa)", async () => {
    expect((await registrarMovimientoCasoDeUso(enCentral(), compra({ nroFactura: "A-00001-00000510" }))).ok).toBe(true);
    const otra = await registrarMovimientoCasoDeUso(enCentral(), compra({ nroFactura: "A-00001-00000511" }));
    expect(otra.ok, otra.mensaje).toBe(true);
    expect(otra.mensaje).toContain("Posible factura repetida");

    const directa = await registrarFacturaProveedorCasoDeUso(enCentral(), {
      fecha: mediodiaDeHoy(), proveedorId, nroFactura: "A-00001-00000512", seccionId: seccionCentral,
      items: [{ productoId, cantidad: 10, precioTotal: 123.45, referenciaProveedor: REFERENCIA_DE_PRUEBA }],
      reparto: { modo: "PORCENTAJE", partes: [{ sucursalId: central, valor: 100 }] }, claveIdempotencia: randomUUID(),
    });
    expect(directa.ok, directa.mensaje).toBe(true);
    expect(directa.mensaje).toContain("Posible factura repetida");
    expect((await conteos()).facturas, "las tres se guardaron").toBe(3);
  });

  it("C25: otro importe o fuera de la ventana de días, no avisa", async () => {
    expect((await registrarMovimientoCasoDeUso(enCentral(), compra({ nroFactura: "A-00001-00000520" }))).ok).toBe(true);
    const otroImporte = await registrarMovimientoCasoDeUso(enCentral(), compra({ nroFactura: "A-00001-00000521", items: [{ productoId, cantidad: 10, precioTotal: 999, referenciaProveedor: REFERENCIA_DE_PRUEBA }] }));
    expect(otroImporte.mensaje).not.toContain("Posible factura repetida");
    const lejos = mediodiaDelDia(sumarDias(diaDeCalendario(new Date(), ZONA_ARGENTINA), -20), ZONA_ARGENTINA);
    const fueraDeLaVentana = await registrarMovimientoCasoDeUso(enCentral(), compra({ nroFactura: "A-00001-00000522", fecha: lejos }));
    expect(fueraDeLaVentana.mensaje).not.toContain("Posible factura repetida");
  });

  it("el mensaje con aviso se guarda: un reenvío devuelve EL MISMO texto", async () => {
    await registrarMovimientoCasoDeUso(enCentral(), compra({ nroFactura: "A-00001-00000530" }));
    const clave = randomUUID();
    const primero = await registrarMovimientoCasoDeUso(enCentral(), compra({ nroFactura: "A-00001-00000531", claveIdempotencia: clave }));
    expect(primero.mensaje).toContain("Posible factura repetida");
    const reenvio = await registrarMovimientoCasoDeUso(enCentral(), compra({ nroFactura: "A-00001-00000531", claveIdempotencia: clave }));
    expect(reenvio.mensaje).toBe(primero.mensaje);
  });
});

describe("idempotencia", () => {
  it("registrarMovimiento COMPRA reenviado 5 veces: mismo mensaje y UNA sola factura, una Operacion, una parte", async () => {
    const clave = randomUUID();
    const rs = [];
    for (let i = 0; i < 5; i++) rs.push(await registrarMovimientoCasoDeUso(enCentral(), compra({ claveIdempotencia: clave })));
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(new Set(rs.map((r) => r.mensaje)).size, "el mismo mensaje cada vez").toBe(1);
    expect(rs.filter((r) => r.ok && r.datos.repetida)).toHaveLength(4);
    expect(await conteos()).toEqual({ facturas: 1, operaciones: 1, movimientos: 1, partes: 1 });
  });

  it("la misma clave con otro contenido es conflicto y no escribe nada nuevo", async () => {
    const clave = randomUUID();
    expect((await registrarMovimientoCasoDeUso(enCentral(), compra({ claveIdempotencia: clave }))).ok).toBe(true);
    const antes = await conteos();
    const otro = await registrarMovimientoCasoDeUso(enCentral(), compra({ claveIdempotencia: clave, items: [{ productoId, cantidad: 99, precioTotal: 1, referenciaProveedor: REFERENCIA_DE_PRUEBA }] }));
    expect(otro).toMatchObject({ ok: false, codigo: "CONFLICTO_IDEMPOTENCIA" });
    expect(await conteos()).toEqual(antes);
  });

  it("el mismo número con OTRA clave es factura duplicada (no se carga dos veces por reintentar mal)", async () => {
    expect((await registrarMovimientoCasoDeUso(enCentral(), compra())).ok).toBe(true);
    const otra = await registrarMovimientoCasoDeUso(enCentral(), compra({ claveIdempotencia: randomUUID() }));
    expect(otra).toMatchObject({ ok: false, codigo: "FACTURA_DUPLICADA", mensaje: MENSAJE_FACTURA_DUPLICADA });
    expect((await conteos()).facturas).toBe(1);
  });
});

describe("concurrencia", () => {
  it("8 cargas a la vez con la misma clave: UNA factura y UNA Operacion", async () => {
    const clave = randomUUID();
    const rs = await Promise.all(Array.from({ length: 8 }, () => registrarMovimientoCasoDeUso(enCentral(), compra({ claveIdempotencia: clave }))));
    expect(rs.every((r) => r.ok), JSON.stringify(rs)).toBe(true);
    expect(rs.filter((r) => r.ok && !r.datos.repetida), "exactamente una la escribe").toHaveLength(1);
    expect(await conteos()).toEqual({ facturas: 1, operaciones: 1, movimientos: 1, partes: 1 });
  }, 60_000);

  it("el mismo número desde dos sucursales a la vez (claves distintas): un éxito y la otra FACTURA_DUPLICADA, sin nada a medias", async () => {
    const [a, b] = await Promise.all([
      registrarMovimientoCasoDeUso(enCentral(), compra({ seccionId: seccionCentral, claveIdempotencia: randomUUID() })),
      registrarMovimientoCasoDeUso(enNorte(), compra({ seccionId: seccionNorte, claveIdempotencia: randomUUID() })),
    ]);
    const resultados = [a, b];
    expect(resultados.filter((r) => r.ok), JSON.stringify(resultados)).toHaveLength(1);
    expect(resultados.filter((r) => !r.ok && r.codigo === "FACTURA_DUPLICADA"), JSON.stringify(resultados)).toHaveLength(1);
    expect(await conteos()).toEqual({ facturas: 1, operaciones: 1, movimientos: 1, partes: 1 });
  }, 60_000);
});
