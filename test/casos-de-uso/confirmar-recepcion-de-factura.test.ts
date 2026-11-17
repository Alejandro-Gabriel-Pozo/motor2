import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));
// La escritura de las líneas del Kardex pasa por el original salvo cuando un test le pide que falle (atomicidad).
vi.mock("../../src/server/persistencia/movimientos/escribir-movimiento-de-stock", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("../../src/server/persistencia/movimientos/escribir-movimiento-de-stock")>();
  return { ...original, escribirLineasDeMovimientoStock: vi.fn(original.escribirLineasDeMovimientoStock) };
});

// La auditoría pasa por la original salvo cuando un test le pide que falle (atomicidad del control).
vi.mock("../../src/server/auditoria/registrar-cambio-auditado", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("../../src/server/auditoria/registrar-cambio-auditado")>();
  return { ...original, registrarCambioAuditado: vi.fn(original.registrarCambioAuditado) };
});

import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "../setup/test-db";
import { encenderRecepcionDeCompras, fijarModulosActivos, MODULOS_VENDIBLES } from "../setup/modulos";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";
import { escribirLineasDeMovimientoStock } from "../../src/server/persistencia/movimientos/escribir-movimiento-de-stock";
import { registrarCambioAuditado } from "../../src/server/auditoria/registrar-cambio-auditado";
import { registrarControlDeRecepcionCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-control-de-recepcion";
import { azarDelProceso } from "../../src/lib/azar";
import { registrarFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-factura-proveedor";
import { confirmarRecepcionDeFacturaCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/confirmar-recepcion-de-factura";
import { confirmarParteRecibida } from "../../src/server/persistencia/compras/escribir-factura-proveedor";
import { conTransaccionSerializable } from "../../src/lib/transaccion-serializable";
import { anularFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/anular-factura-proveedor";
import { obtenerCostoActualPorMP } from "../../src/server/lecturas/reportes/comun";
import { mediodiaDelDia, ZONA_ARGENTINA, diaDeCalendario, sumarDias } from "../../src/core/tiempo/zona-horaria";
import { MENSAJE_RECEPCION_YA_RECIBIDA } from "../../src/core/compras/public";
import { MENSAJE_CONFLICTO_IDEMPOTENCIA } from "../../src/core/movimientos/idempotencia";
import type { ContextoDeAccion } from "../../src/server/actions/tipos";
import type { DatosFacturaProveedorInput } from "../../src/core/features/compras/factura-proveedor.schema";

/**
 * Compras N3-a y N3-b, recepción separada: cargar «pendiente de recibir» (módulo `recepcion_de_compras` encendido) y CONFIRMAR la recepción, con Postgres real. El permiso lo pide la Server Action (`compra_recibir`; lo prueba
 * `test/permisos/confirmar-recepcion-permisos.test.ts`); acá se prueba el caso de uso con el actor ya resuelto: lo que escribe, lo que rechaza, su idempotencia por estado, su atomicidad y su aislamiento por empresa.
 * La concurrencia (dos confirmaciones a la vez; confirmar contra anular) está en `test/movimientos/recepcion-de-compras-concurrencia.test.ts` y el recorrido de todas las combinaciones contra el oráculo en
 * `test/movimientos/combinaciones-compras-recepcion-integracion.test.ts`.
 *
 * Mutaciones (comprobadas a mano al escribirlo): cargar pendiente sin mirar el módulo (`moduloEncendido: false`) → rojos los casos de la carga pendiente y de la confirmación (14); sin la guarda `WHERE estadoRecepcion = 'PENDIENTE'` → rojo
 * «la guarda de la persistencia» (las confirmaciones concurrentes por sí solas NO la detectan: las frena también la lectura del estado bajo SERIALIZABLE con reintento y el disparador de la base); fijar `esDeLaSucursalDelActor: true` →
 * rojos «sucursal ajena» y el oráculo de integración.
 */
const E = EMPRESA_POR_DEFECTO_ID;
const diaDeHoy = () => diaDeCalendario(new Date(), ZONA_ARGENTINA);
/** El mediodía argentino de hoy más `dias` (negativo = pasado). */
const mediodia = (dias: number) => mediodiaDelDia(sumarDias(diaDeHoy(), dias), ZONA_ARGENTINA);

let s3: string, s4: string, sec3: string, sec4: string;
let admin: string, admin4: string;
let harina: string, aceite: string, proveedorId: string;

const baseDe = (sucursal: string) => baseDeTest({ lectura: [sucursal], escritura: [sucursal] });
const actorDe = (usuarioId: string, sucursalId: string, sucursalNombre: string, ahora = new Date()) =>
  ({ usuarioId, empresaId: E, sucursalId, sucursalNombre, ahora, membresias: [{ sucursalId: s3 }, { sucursalId: s4 }] as never, ...baseDe(sucursalId) }) as unknown as ContextoDeAccion;
const actor3 = (ahora?: Date) => actorDe(admin, s3, "Central", ahora);

const encenderRecepcion = () => fijarModulosActivos(E, [...MODULOS_VENDIBLES, "recepcion_de_compras"]);

/** Una factura de UNA parte en la 3: dos renglones (harina 10 kg a $100/kg y aceite 5 l a $200/l). */
const datosDeFactura = (extra: Partial<DatosFacturaProveedorInput> = {}): DatosFacturaProveedorInput => ({
  fecha: mediodia(-3),
  proveedorId,
  nroFactura: "A-00001-00000100",
  seccionId: sec3,
  items: [
    { productoId: harina, cantidad: 10, precioTotal: 1000, referenciaProveedor: REFERENCIA_DE_PRUEBA },
    { productoId: aceite, cantidad: 5, precioTotal: 1000, referenciaProveedor: REFERENCIA_DE_PRUEBA },
  ],
  reparto: { modo: "PORCENTAJE", partes: [{ sucursalId: s3, valor: 100 }] },
  claveIdempotencia: randomUUID(),
  ...extra,
});

async function cargar(extra: Partial<DatosFacturaProveedorInput> = {}) {
  const r = await registrarFacturaProveedorCasoDeUso(actor3(), datosDeFactura(extra));
  expect(r.ok, r.mensaje).toBe(true);
  return r;
}
async function cargarPendiente(extra: Partial<DatosFacturaProveedorInput> = {}): Promise<string> {
  await encenderRecepcion();
  const r = await cargar(extra);
  return (r.ok && r.datos.facturaId) as string;
}
/** Un destino por renglón de mercadería de la factura, todos en la sección dada (un renglón, una sección, con la cantidad total del renglón). */
const entradasEnteras = async (facturaId: string, seccionId: string) =>
  (await prisma.facturaProveedorRenglon.findMany({ where: { facturaProveedorId: facturaId, productoId: { not: null } }, orderBy: { orden: "asc" } })).map((r) => ({ renglonId: r.id, seccionId }));
const confirmar = async (facturaId: string, o: { seccionId?: string; ahora?: Date; entradas?: { renglonId: string; seccionId: string }[] } = {}) =>
  confirmarRecepcionDeFacturaCasoDeUso(actor3(o.ahora), { facturaId, entradas: o.entradas ?? (await entradasEnteras(facturaId, o.seccionId ?? sec3)) });

const comprasDeStock = () => prisma.operacion.count({ where: { proceso: "COMPRA" } });
const movimientosDeCompra = () => prisma.movimientoStock.count({ where: { proceso: "COMPRA" } });
const parteDe = (facturaId: string, sucursalId = s3) => prisma.facturaProveedorSucursal.findFirstOrThrow({ where: { facturaProveedorId: facturaId, sucursalId } });

/** Base limpia con dos sucursales (3 y 4), un administrador en cada una, dos productos disponibles en las dos y un proveedor. */
async function sembrarEscenario() {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  s3 = base.sucursal.id;
  s4 = (await prisma.sucursal.create({ data: { nombre: "Sucursal 4" } })).id;
  [sec3, sec4] = await Promise.all([s3, s4].map(async (s) => (await sembrarSeccion(s)).id));
  admin = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: s3, rolId: base.admin.id })).id;
  admin4 = (await crearUsuarioConMembresia({ email: "admin4@test.com", sucursalId: s4, rolId: base.admin.id })).id;
  const { kg, insumo } = await sembrarCatalogoBase();
  const litro = await prisma.unidad.create({ data: { nombre: "l", magnitud: "VOLUMEN", decimales: 2 } });
  const aceiteInsumo = await prisma.insumo.create({ data: { nombre: "Aceite" } });
  harina = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } })).id;
  aceite = (await prisma.producto.create({ data: { codigo: "MP_ACEITE", nombre: "Aceite", tipo: "MP", unidadStockId: litro.id, insumoId: aceiteInsumo.id } })).id;
  await prisma.disponibilidadProducto.createMany({ data: [s3, s4].flatMap((sucursalId) => [harina, aceite].map((productoId) => ({ sucursalId, productoId, disponible: true }))) });
  proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
}

beforeEach(async () => {
  vi.mocked(escribirLineasDeMovimientoStock).mockClear();
  vi.mocked(registrarCambioAuditado).mockClear();
  await sembrarEscenario();
});

describe("cargar con el módulo recepcion_de_compras encendido", () => {
  it("una sola parte propia: nace PENDIENTE, sin compra ni stock ni costo; sin sección en el pedido no se exige; el vínculo con el proveedor y la auditoría quedan", async () => {
    await encenderRecepcion();

    const r = await registrarFacturaProveedorCasoDeUso(actor3(), datosDeFactura({ seccionId: undefined }));

    expect(r).toMatchObject({ ok: true, mensaje: "Factura cargada: queda pendiente de recibir. El stock entra cuando un gerente o administrador la confirma.", datos: { repetida: false, operacionPropiaId: null, movimientosPropios: 0 } });
    const facturaId = (r.ok && r.datos.facturaId) as string;
    const parte = await parteDe(facturaId);
    expect([parte.estadoRecepcion, parte.operacionId, parte.recibidaEn, parte.recibidaPorId, parte.porcentajeDeclaradoBp]).toEqual(["PENDIENTE", null, null, null, 10000]);
    expect(await comprasDeStock()).toBe(0);
    expect(await movimientosDeCompra()).toBe(0);
    expect(await calcularSaldoTotal(harina, sec3, prisma)).toBe(0);
    expect((await obtenerCostoActualPorMP(s3, prisma)).get(harina)).toBeUndefined();
    const cabecera = await prisma.facturaProveedor.findUniqueOrThrow({ where: { id: facturaId }, include: { renglones: true } });
    expect([cabecera.estado, Number(cabecera.importeTotal), cabecera.renglones.length, cabecera.resultadoMensaje]).toEqual(["CONFIRMADA", 2000, 2, r.mensaje]);
    expect(await prisma.proveedorPorProducto.count({ where: { proveedorId } })).toBe(2);
    const auditoria = await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "FacturaProveedor", entidadId: facturaId, campo: "reparto" } });
    expect(auditoria.descripcion).toBe("Factura de proveedor A-00001-00000100 cargada en «Central»");
  });

  it("fallo cerrado: con una sección en el pedido, la carga pendiente la valida: de OTRA sucursal, de OTRA empresa, inexistente o desactivada se rechaza y no queda nada escrito; una propia activa carga pendiente", async () => {
    await encenderRecepcion();
    await prisma.empresa.create({ data: { id: "empresa_b", nombre: "Empresa B", slug: "empresa-b", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "PROVISIONING" } });
    const sucursalOtraEmpresa = await prismaAdmin.sucursal.create({ data: { empresaId: "empresa_b", nombre: "Sucursal ajena" } });
    const seccionOtraEmpresa = (await prismaAdmin.seccion.create({ data: { empresaId: "empresa_b", sucursalId: sucursalOtraEmpresa.id, nombre: "Ajena" } })).id;
    const inactiva = (await prisma.seccion.create({ data: { sucursalId: s3, nombre: "Vieja", activa: false } })).id;

    const ajenaSucursal = await registrarFacturaProveedorCasoDeUso(actor3(), datosDeFactura({ seccionId: sec4 }));
    const ajenaEmpresa = await registrarFacturaProveedorCasoDeUso(actor3(), datosDeFactura({ seccionId: seccionOtraEmpresa }));
    const inexistente = await registrarFacturaProveedorCasoDeUso(actor3(), datosDeFactura({ seccionId: "una-seccion-que-no-existe" }));
    const desactivada = await registrarFacturaProveedorCasoDeUso(actor3(), datosDeFactura({ seccionId: inactiva }));

    for (const r of [ajenaSucursal, ajenaEmpresa, inexistente]) expect(r).toMatchObject({ ok: false, codigo: "SECCION_NO_ENCONTRADA", mensaje: "No se encontró la sección." });
    expect(desactivada).toMatchObject({ ok: false, codigo: "SECCION_INACTIVA" });
    expect(await prisma.facturaProveedor.count()).toBe(0);
    expect(await prisma.facturaProveedorSucursal.count()).toBe(0);
    expect(await comprasDeStock()).toBe(0);
    expect(await movimientosDeCompra()).toBe(0);

    const buena = await registrarFacturaProveedorCasoDeUso(actor3(), datosDeFactura({ seccionId: sec3 }));
    expect(buena.ok, buena.mensaje).toBe(true);
    expect((await parteDe((buena.ok && buena.datos.facturaId) as string)).estadoRecepcion).toBe("PENDIENTE");
    expect(await comprasDeStock()).toBe(0);
  });

  it("módulo APAGADO (no regresión): la parte nace RECIBIDA con su compra y el stock entra al cargar, como siempre", async () => {
    await fijarModulosActivos(E, MODULOS_VENDIBLES);

    const r = await cargar();

    expect(r).toMatchObject({ ok: true, datos: { repetida: false, movimientosPropios: 2 } });
    const parte = await parteDe((r.ok && r.datos.facturaId) as string);
    expect([parte.estadoRecepcion, Boolean(parte.operacionId), Boolean(parte.recibidaEn)]).toEqual(["RECIBIDA", true, true]);
    expect(await calcularSaldoTotal(harina, sec3, prisma)).toBe(10);
    expect(r.mensaje).toBe("Se guardaron 2 movimiento(s).");
  });

  it("factura REPARTIDA con el módulo encendido (no entra a esta etapa): la parte propia entra al cargar como siempre y la de la otra sucursal queda propuesta", async () => {
    await encenderRecepcion();

    const r = await cargar({ reparto: { modo: "PORCENTAJE", partes: [{ sucursalId: s3, valor: 50 }, { sucursalId: s4, valor: 50 }] } });

    const facturaId = (r.ok && r.datos.facturaId) as string;
    const propia = await parteDe(facturaId);
    expect([propia.estadoRecepcion, Boolean(propia.operacionId)]).toEqual(["RECIBIDA", true]);
    expect(await calcularSaldoTotal(harina, sec3, prisma)).toBe(5);
    expect((await prisma.facturaProveedorPropuesta.findFirstOrThrow({ where: { facturaProveedorId: facturaId } })).estado).toBe("PENDIENTE");
    expect(await prisma.facturaProveedorSucursal.count({ where: { facturaProveedorId: facturaId, sucursalId: s4 } })).toBe(0);
  });

  it("idempotencia de la carga (I3): repetir con la misma clave devuelve el mismo mensaje sin otra factura ni otra parte; la misma clave con otro contenido es un conflicto", async () => {
    await encenderRecepcion();
    const datos = datosDeFactura();
    const primera = await registrarFacturaProveedorCasoDeUso(actor3(), datos);

    const reenvio = await registrarFacturaProveedorCasoDeUso(actor3(), datos);
    const otroContenido = await registrarFacturaProveedorCasoDeUso(actor3(), { ...datos, items: [{ productoId: harina, cantidad: 99, precioTotal: 1, referenciaProveedor: REFERENCIA_DE_PRUEBA }] });

    expect(reenvio).toEqual({ ok: true, mensaje: primera.mensaje, datos: { repetida: true, facturaId: null, operacionPropiaId: null, movimientosPropios: null } });
    expect(otroContenido).toMatchObject({ ok: false, codigo: "CONFLICTO_IDEMPOTENCIA", mensaje: MENSAJE_CONFLICTO_IDEMPOTENCIA });
    expect([await prisma.facturaProveedor.count(), await prisma.facturaProveedorSucursal.count(), await comprasDeStock()]).toEqual([1, 1, 0]);
  });

  it("un reintento de la carga DESPUÉS de confirmar la recepción devuelve el mensaje original y no toca el stock ya entrado", async () => {
    await encenderRecepcion();
    const datos = datosDeFactura();
    const primera = await registrarFacturaProveedorCasoDeUso(actor3(), datos);
    expect((await confirmar((primera.ok && primera.datos.facturaId) as string)).ok).toBe(true);

    const reenvio = await registrarFacturaProveedorCasoDeUso(actor3(), datos);

    expect(reenvio).toMatchObject({ ok: true, mensaje: primera.mensaje, datos: { repetida: true } });
    expect(await comprasDeStock()).toBe(1);
    expect(await calcularSaldoTotal(harina, sec3, prisma)).toBe(10);
  });
});

describe("confirmar la recepción", () => {
  it("éxito: entra el stock con la fecha de la confirmación (compra COMPRA con un movimiento por renglón, su renglón, sus pesos y su costo), la parte pasa a RECIBIDA con su compra, quién y cuándo, y queda la auditoría", async () => {
    const facturaId = await cargarPendiente();
    const fechaStock = mediodia(0);

    const r = await confirmar(facturaId);

    expect(r).toMatchObject({ ok: true, mensaje: `Recepción confirmada: 2 movimiento(s) entraron al stock de esta sucursal con fecha ${diaDeCalendario(fechaStock, ZONA_ARGENTINA)}.`, datos: { movimientos: 2, yaExistia: false } });
    const parte = await parteDe(facturaId);
    expect([parte.estadoRecepcion, parte.recibidaPorId, parte.recibidaEn]).toEqual(["RECIBIDA", admin, fechaStock]);
    const operacion = await prisma.operacion.findUniqueOrThrow({ where: { id: parte.operacionId as string }, include: { movimientos: true } });
    expect([operacion.proceso, operacion.sucursalId, operacion.proveedorId, operacion.nroFactura, operacion.fecha, operacion.usuarioId]).toEqual(["COMPRA", s3, proveedorId, "A-00001-00000100", fechaStock, admin]);
    const renglones = await prisma.facturaProveedorRenglon.findMany({ where: { facturaProveedorId: facturaId }, orderBy: { orden: "asc" } });
    expect(operacion.movimientos.map((m) => [m.facturaProveedorRenglonId, m.productoId, m.seccionId, Number(m.cantidad), Number(m.precioTotal), Number(m.precioPorUnidadStock)]).sort()).toEqual(
      [[renglones[0]!.id, harina, sec3, 10, 1000, 100], [renglones[1]!.id, aceite, sec3, 5, 1000, 200]].sort()
    );
    expect([await calcularSaldoTotal(harina, sec3, prisma), await calcularSaldoTotal(aceite, sec3, prisma)]).toEqual([10, 5]);
    expect((await obtenerCostoActualPorMP(s3, prisma)).get(harina)?.precioPorUnidadStock).toBe(100);
    const auditoria = await prisma.registroAuditoria.findMany({ where: { entidad: "FacturaProveedor", entidadId: facturaId, campo: "recepcion" } });
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      actorId: admin,
      sucursalId: s3,
      valorAnterior: "PENDIENTE",
      valorNuevo: "RECIBIDA",
      descripcion: `Recepción de la compra A-00001-00000100 confirmada en «Central» (sección «Depósito», fecha de stock ${diaDeCalendario(fechaStock, ZONA_ARGENTINA)})`,
    });
  });

  it("idempotencia por estado (paridad con Pedernal): confirmar de nuevo es ÉXITO con yaExistia, devuelve la compra original y NO crea un segundo stock ni otra compra ni otra auditoría", async () => {
    const facturaId = await cargarPendiente();
    const primera = await confirmar(facturaId);
    expect(primera).toMatchObject({ ok: true, datos: { yaExistia: false } });

    const segunda = await confirmar(facturaId);

    expect(segunda).toEqual({ ok: true, mensaje: MENSAJE_RECEPCION_YA_RECIBIDA, datos: { operacionId: (await parteDe(facturaId)).operacionId, movimientos: 0, yaExistia: true } });
    expect(primera.ok && segunda.ok && primera.datos.operacionId === segunda.datos.operacionId).toBe(true);
    expect([await comprasDeStock(), await movimientosDeCompra(), await calcularSaldoTotal(harina, sec3, prisma), await calcularSaldoTotal(aceite, sec3, prisma)]).toEqual([1, 2, 10, 5]);
    expect(await prisma.registroAuditoria.count({ where: { entidadId: facturaId, campo: "recepcion" } })).toBe(1);
    const parte = await parteDe(facturaId);
    expect([parte.estadoRecepcion, parte.recibidaPorId]).toEqual(["RECIBIDA", admin]);
  });

  it("repetir confirmar con OTRA sección tampoco mueve nada: la recepción original no se pisa", async () => {
    const facturaId = await cargarPendiente();
    expect((await confirmar(facturaId)).ok).toBe(true);
    const otra = (await sembrarSeccion(s3, "Cámara")).id;

    const repetida = await confirmar(facturaId, { seccionId: otra });

    expect(repetida).toMatchObject({ ok: true, datos: { yaExistia: true } });
    expect([await calcularSaldoTotal(harina, sec3, prisma), await calcularSaldoTotal(harina, otra, prisma)]).toEqual([10, 0]);
    expect(await movimientosDeCompra()).toBe(2);
  });

  it("una compra ANULADA sigue siendo error (no es una repetición): «ya anulada», aunque la parte esté recibida", async () => {
    const facturaId = await cargarPendiente();
    expect((await confirmar(facturaId)).ok).toBe(true);
    expect((await anularFacturaProveedorCasoDeUso(actor3(), { facturaId, motivo: "Prueba", claveIdempotencia: randomUUID() })).ok).toBe(true);

    const r = await confirmar(facturaId);

    expect(r).toMatchObject({ ok: false, codigo: "YA_ANULADA" });
  });

  it("la compra confirmada sale con el mismo costo y los mismos pesos que si hubiera entrado al cargar (módulo apagado): misma cantidad, mismo importe", async () => {
    const pendiente = await cargarPendiente({ nroFactura: "A-00001-00000101" });
    await confirmar(pendiente);
    const forma = async () =>
      (await prisma.movimientoStock.findMany({ where: { proceso: "COMPRA" }, select: { cantidad: true, precioTotal: true, precioPorUnidadStock: true, detalle: true } })).map((m) => [Number(m.cantidad), Number(m.precioTotal), Number(m.precioPorUnidadStock), m.detalle]).sort();
    const conRecepcion = await forma();
    await sembrarEscenario();
    await fijarModulosActivos(E, MODULOS_VENDIBLES);

    await cargar({ nroFactura: "A-00001-00000102" });

    expect(conRecepcion).toHaveLength(2);
    expect(await forma()).toEqual(conRecepcion);
  });

  it("la factura anulada no se confirma: «ya anulada», sin stock", async () => {
    const facturaId = await cargarPendiente();
    expect((await anularFacturaProveedorCasoDeUso(actor3(), { facturaId, motivo: "Se cargó mal", claveIdempotencia: randomUUID() })).ok).toBe(true);

    const r = await confirmar(facturaId);

    expect(r).toMatchObject({ ok: false, codigo: "YA_ANULADA" });
    expect([await comprasDeStock(), await movimientosDeCompra()]).toEqual([0, 0]);
    expect((await parteDe(facturaId)).estadoRecepcion).toBe("PENDIENTE");
  });

  it("anular una compra PENDIENTE no revierte stock (no lo hay): queda anulada, sin ajustes, y la parte sigue sin compra", async () => {
    const facturaId = await cargarPendiente();

    const r = await anularFacturaProveedorCasoDeUso(actor3(), { facturaId, motivo: "No llegó nunca", claveIdempotencia: randomUUID() });

    expect(r).toMatchObject({ ok: true, datos: { facturaId } });
    expect(r.mensaje).toContain("se revirtieron 0 movimiento(s) en 0 sucursal(es)");
    expect(await prisma.operacion.count({ where: { proceso: "AJUSTE" } })).toBe(0);
    expect([await comprasDeStock(), await movimientosDeCompra()]).toEqual([0, 0]);
    const factura = await prisma.facturaProveedor.findUniqueOrThrow({ where: { id: facturaId }, include: { anulaciones: true } });
    expect([Boolean(factura.anuladaEn), factura.anulaciones.map((a) => a.motivo)]).toEqual([true, ["No llegó nunca"]]);
    const parte = await parteDe(facturaId);
    expect([parte.estadoRecepcion, parte.operacionId]).toEqual(["PENDIENTE", null]);
  });

  it("anular una compra ya CONFIRMADA sí revierte lo que entró (control del caso anterior)", async () => {
    const facturaId = await cargarPendiente();
    await confirmar(facturaId);

    const r = await anularFacturaProveedorCasoDeUso(actor3(), { facturaId, motivo: "Devuelta", claveIdempotencia: randomUUID() });

    expect(r.ok, r.mensaje).toBe(true);
    expect(await calcularSaldoTotal(harina, sec3, prisma)).toBe(0);
    expect(await prisma.operacion.count({ where: { proceso: "AJUSTE" } })).toBe(1);
  });

  it("no existe esa factura → «no se encontró», sin escribir nada", async () => {
    await encenderRecepcion();

    const r = await confirmar("factura-que-no-existe");

    expect(r).toMatchObject({ ok: false, codigo: "NO_ENCONTRADA" });
    expect(await comprasDeStock()).toBe(0);
  });

  it("la parte es de OTRA sucursal: quien confirma desde la 4 recibe «no se encontró» y la parte de la 3 sigue pendiente", async () => {
    const facturaId = await cargarPendiente();

    const r = await confirmarRecepcionDeFacturaCasoDeUso(actorDe(admin4, s4, "Sucursal 4"), { facturaId, entradas: await entradasEnteras(facturaId, sec4) });

    expect(r).toMatchObject({ ok: false, codigo: "NO_ES_DE_ESTA_SUCURSAL" });
    expect((await parteDe(facturaId)).estadoRecepcion).toBe("PENDIENTE");
    expect(await comprasDeStock()).toBe(0);
  });

  it("AISLAMIENTO por empresa: una factura pendiente de OTRA empresa es «no se encontró» y no se toca", async () => {
    await encenderRecepcion();
    await prisma.empresa.create({ data: { id: "empresa_b", nombre: "Empresa B", slug: "empresa-b", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "PROVISIONING" } });
    const sucursalB = await prismaAdmin.sucursal.create({ data: { empresaId: "empresa_b", nombre: "Sucursal B" } });
    const proveedorB = await prismaAdmin.proveedor.create({ data: { empresaId: "empresa_b", codigo: "PRV_B", nombre: "Proveedor B" } });
    const facturaB = await prismaAdmin.facturaProveedor.create({
      data: { empresaId: "empresa_b", proveedorId: proveedorB.id, fecha: mediodia(-3), importeTotal: 100, estado: "CONFIRMADA", confirmadaEn: new Date(), confirmadaPorId: admin, creadoPorId: admin },
    });
    await encenderRecepcionDeCompras("empresa_b"); // la base no deja nacer una parte pendiente con la recepción separada apagada (guarda de apagado)
    const parteB = await prismaAdmin.facturaProveedorSucursal.create({ data: { empresaId: "empresa_b", facturaProveedorId: facturaB.id, sucursalId: sucursalB.id, porcentajeDeclaradoBp: 10000, estadoRecepcion: "PENDIENTE" } });

    const r = await confirmar(facturaB.id);

    expect(r).toMatchObject({ ok: false, codigo: "NO_ENCONTRADA" });
    expect((await prismaAdmin.facturaProveedorSucursal.findUniqueOrThrow({ where: { id: parteB.id } })).estadoRecepcion).toBe("PENDIENTE");
    expect(await prismaAdmin.operacion.count({ where: { proceso: "COMPRA" } })).toBe(0);
  });

  it("la sección tiene que ser de esta sucursal y estar activa: ajena → «no se encontró la sección»; desactivada → su mensaje; en los dos casos la parte sigue pendiente", async () => {
    const facturaId = await cargarPendiente();
    await prisma.seccion.update({ where: { id: sec3 }, data: { activa: false } });
    const otraActiva = (await sembrarSeccion(s3, "Cámara")).id;

    const ajena = await confirmar(facturaId, { seccionId: sec4 });
    const inactiva = await confirmar(facturaId, { seccionId: sec3 });
    const buena = await confirmar(facturaId, { seccionId: otraActiva });

    expect(ajena).toMatchObject({ ok: false, codigo: "SECCION_NO_ENCONTRADA", mensaje: "No se encontró la sección." });
    expect(inactiva).toMatchObject({ ok: false, codigo: "SECCION_INACTIVA" });
    expect(inactiva.mensaje).toContain("«Depósito» está desactivada");
    expect(buena.ok, buena.mensaje).toBe(true);
    expect(await calcularSaldoTotal(harina, otraActiva, prisma)).toBe(10);
    expect(await calcularSaldoTotal(harina, sec3, prisma)).toBe(0);
  });

  it.each([
    ["22:30 hora argentina de ayer (01:30 UTC de hoy): el día es el de Argentina, ayer", -1, 10.5, -1],
    ["00:30 hora argentina de hoy (03:30 UTC): el día es hoy", 0, -11.5, 0],
    ["el mediodía de hoy", 0, 0, 0],
  ])("la fecha del stock es la de la confirmación, con el corte de día en hora argentina (reloj controlado): %s", async (_nombre, diaDelMediodia, horasDespues, diaEsperado) => {
    const facturaId = await cargarPendiente({ fecha: mediodia(-3) });
    const ahora = new Date(mediodia(diaDelMediodia).getTime() + horasDespues * 3_600_000);

    const r = await confirmar(facturaId, { ahora });

    const dia = sumarDias(diaDeHoy(), diaEsperado);
    expect(r).toMatchObject({ ok: true, mensaje: `Recepción confirmada: 2 movimiento(s) entraron al stock de esta sucursal con fecha ${dia}.` });
    const parte = await parteDe(facturaId);
    const operacion = await prisma.operacion.findUniqueOrThrow({ where: { id: parte.operacionId as string }, include: { movimientos: true } });
    // La compra (cuya fecha es la de sus movimientos) y la parte llevan la MISMA fecha: el mediodía argentino del día de la confirmación (como el resto de las compras).
    expect([operacion.fecha, parte.recibidaEn]).toEqual([mediodia(diaEsperado), mediodia(diaEsperado)]);
    expect(operacion.movimientos).toHaveLength(2);
    const auditoria = await prisma.registroAuditoria.findFirstOrThrow({ where: { entidadId: facturaId, campo: "recepcion" } });
    expect(auditoria.descripcion).toContain(`fecha de stock ${dia})`);
  });

  it("la fecha no se elige: un pedido que traiga una fechaStock de más (cliente viejo o manipulado) no la cambia", async () => {
    const facturaId = await cargarPendiente({ fecha: mediodia(-3) });
    const entradas = await entradasEnteras(facturaId, sec3);

    const r = await confirmarRecepcionDeFacturaCasoDeUso(actor3(), { facturaId, entradas, fechaStock: mediodia(-3) } as never);

    expect(r.ok, r.mensaje).toBe(true);
    const operacion = await prisma.operacion.findUniqueOrThrow({ where: { id: (await parteDe(facturaId)).operacionId as string } });
    expect(operacion.fecha).toEqual(mediodia(0));
  });

  it("un producto que ya no está disponible en la sucursal frena la confirmación (sin escribir nada) con el nombre del producto", async () => {
    const facturaId = await cargarPendiente();
    await prisma.disponibilidadProducto.updateMany({ where: { sucursalId: s3, productoId: aceite }, data: { disponible: false } });

    const r = await confirmar(facturaId);

    expect(r).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_DISPONIBLE" });
    expect(r.mensaje).toContain("«Aceite» no está disponible en «Central»");
    expect([await comprasDeStock(), await movimientosDeCompra()]).toEqual([0, 0]);
    expect((await parteDe(facturaId)).estadoRecepcion).toBe("PENDIENTE");
  });

  it("ATOMICIDAD: si falla la escritura de las líneas del Kardex, la parte sigue PENDIENTE y no queda una compra huérfana (todo o nada); el reintento posterior sí confirma", async () => {
    const facturaId = await cargarPendiente();
    vi.mocked(escribirLineasDeMovimientoStock).mockRejectedValueOnce(new Error("falla inyectada al escribir las líneas"));

    await expect(confirmar(facturaId)).rejects.toThrow("falla inyectada");

    const parte = await parteDe(facturaId);
    expect([parte.estadoRecepcion, parte.operacionId, parte.recibidaEn, parte.recibidaPorId]).toEqual(["PENDIENTE", null, null, null]);
    expect([await comprasDeStock(), await movimientosDeCompra()]).toEqual([0, 0]);
    expect(await prisma.registroAuditoria.count({ where: { entidadId: facturaId, campo: "recepcion" } })).toBe(0);
    const reintento = await confirmar(facturaId);
    expect(reintento.ok, reintento.mensaje).toBe(true);
    expect([await comprasDeStock(), await movimientosDeCompra()]).toEqual([1, 2]);
  });

  it("la guarda de la persistencia: confirmar una parte que ya no está PENDIENTE toca 0 filas (la segunda barrera: aunque dos confirmaciones llegaran hasta el UPDATE, solo una lo gana); la app puede actualizar `operacionId` (privilegio de la migración)", async () => {
    const facturaId = await cargarPendiente();
    const parte = await parteDe(facturaId);
    const operacion = await prisma.operacion.create({ data: { sucursalId: s3, proceso: "COMPRA", fecha: new Date(), usuarioId: admin, proveedorId } });
    const confirmarLaParte = () => conTransaccionSerializable(actor3().transaccion, (tx) => confirmarParteRecibida(tx, { parteId: parte.id, operacionId: operacion.id, recibidaEn: mediodia(-2), recibidaPorId: admin }));

    const primera = await confirmarLaParte();
    const segunda = await confirmarLaParte();

    expect([primera, segunda]).toEqual([1, 0]);
    expect((await parteDe(facturaId)).operacionId).toBe(operacion.id);
  });
});

const renglonesDe = (facturaId: string) => prisma.facturaProveedorRenglon.findMany({ where: { facturaProveedorId: facturaId }, orderBy: { orden: "asc" } });
const controlar = (facturaId: string, controles: { renglonId: string; condicion: "CONFORME" | "CON_OBSERVACIONES" | "RECHAZADA"; observacion?: string | null; cantidadSegunRemito?: number | null }[], actor = actor3()) =>
  registrarControlDeRecepcionCasoDeUso(actor, { facturaId, controles }, azarDelProceso);
const controlesGuardados = () => prisma.controlDeLineaDeRecepcion.count();
const movimientosDe = (renglonId: string) => prisma.movimientoStock.findMany({ where: { facturaProveedorRenglonId: renglonId }, orderBy: { cantidad: "asc" } });

describe("confirmar con UN solo destino por renglón (paridad con Pedernal)", () => {
  it("cada renglón recibe UNA entrada por su cantidad TOTAL en la sección elegida (secciones distintas por renglón): una línea del Kardex por renglón, con el precio del renglón y el precio por unidad tal cual; una sola compra", async () => {
    const facturaId = await cargarPendiente();
    const otra = (await sembrarSeccion(s3, "Cámara")).id;
    const [rHarina, rAceite] = await renglonesDe(facturaId);

    const r = await confirmar(facturaId, { entradas: [{ renglonId: rHarina!.id, seccionId: otra }, { renglonId: rAceite!.id, seccionId: sec3 }] });

    expect(r).toMatchObject({ ok: true, datos: { movimientos: 2 } });
    expect([await calcularSaldoTotal(harina, otra, prisma), await calcularSaldoTotal(harina, sec3, prisma), await calcularSaldoTotal(aceite, sec3, prisma)]).toEqual([10, 0, 5]);
    const deHarina = await movimientosDe(rHarina!.id);
    const deAceite = await movimientosDe(rAceite!.id);
    // UNA sola entrada por renglón.
    expect(deHarina.map((m) => [m.seccionId, Number(m.cantidad), Number(m.precioTotal), Number(m.precioPorUnidadStock)])).toEqual([[otra, 10, 1000, 100]]);
    expect(deAceite.map((m) => [m.seccionId, Number(m.cantidad), Number(m.precioTotal), Number(m.precioPorUnidadStock)])).toEqual([[sec3, 5, 1000, 200]]);
    expect(await comprasDeStock()).toBe(1);
    const auditoria = await prisma.registroAuditoria.findFirstOrThrow({ where: { entidadId: facturaId, campo: "recepcion" } });
    expect(auditoria.descripcion).toContain("secciones «Cámara», «Depósito»");
  });

  it("el precio con centavos entra TAL CUAL en la única entrada del renglón (100,01 de 3 unidades: una línea de 100,01)", async () => {
    await encenderRecepcion();
    const r = await cargar({ items: [{ productoId: harina, cantidad: 3, precioTotal: 100.01, referenciaProveedor: REFERENCIA_DE_PRUEBA }] });
    const facturaId = (r.ok && r.datos.facturaId) as string;
    const [renglon] = await renglonesDe(facturaId);

    const c = await confirmar(facturaId);

    expect(c.ok, c.mensaje).toBe(true);
    expect((await movimientosDe(renglon!.id)).map((m) => [Number(m.cantidad), Number(m.precioTotal)])).toEqual([[3, 100.01]]);
  });

  it("dividir un renglón entre secciones se rechaza (ENTRADA_REPETIDA), sea en dos secciones distintas o dos veces en la misma, sin escribir nada y con la parte pendiente", async () => {
    const facturaId = await cargarPendiente();
    const otra = (await sembrarSeccion(s3, "Cámara")).id;
    const [rHarina, rAceite] = await renglonesDe(facturaId);
    const aceite = { renglonId: rAceite!.id, seccionId: sec3 };

    const dividida = await confirmar(facturaId, { entradas: [{ renglonId: rHarina!.id, seccionId: sec3 }, { renglonId: rHarina!.id, seccionId: otra }, aceite] });
    const repetida = await confirmar(facturaId, { entradas: [{ renglonId: rHarina!.id, seccionId: sec3 }, { renglonId: rHarina!.id, seccionId: sec3 }, aceite] });

    for (const r of [dividida, repetida]) expect(r).toMatchObject({ ok: false, codigo: "ENTRADA_REPETIDA", mensaje: "Cada renglón entra entero en una sola sección." });
    expect([await comprasDeStock(), await movimientosDeCompra()]).toEqual([0, 0]);
    expect((await parteDe(facturaId)).estadoRecepcion).toBe("PENDIENTE");
  });

  it("un renglón sin destino, un renglón de otra compra y un pedido sin entradas se rechazan con su código, sin escribir nada", async () => {
    const facturaId = await cargarPendiente();
    const otraFactura = await cargarPendiente({ nroFactura: "A-00001-00000555", claveIdempotencia: randomUUID() });
    const [rHarina, rAceite] = await renglonesDe(facturaId);
    const [rAjeno] = await renglonesDe(otraFactura);
    const harinaSola = { renglonId: rHarina!.id, seccionId: sec3 };
    const aceiteSolo = { renglonId: rAceite!.id, seccionId: sec3 };

    const sinDestino = await confirmar(facturaId, { entradas: [harinaSola] });
    const ajeno = await confirmar(facturaId, { entradas: [harinaSola, aceiteSolo, { renglonId: rAjeno!.id, seccionId: sec3 }] });
    const sinEntradas = await confirmar(facturaId, { entradas: [] });

    expect(sinDestino).toMatchObject({ ok: false, codigo: "RENGLON_SIN_ENTRADAS" });
    expect(ajeno).toMatchObject({ ok: false, codigo: "RENGLON_AJENO" });
    expect(sinEntradas).toMatchObject({ ok: false, codigo: "SIN_ENTRADAS" });
    expect([await comprasDeStock(), await movimientosDeCompra()]).toEqual([0, 0]);
  });

  it("una sección AJENA o INACTIVA en UNO de los renglones frena toda la confirmación (la regla de secciones mira todas): nada entra", async () => {
    const facturaId = await cargarPendiente();
    const inactiva = (await prisma.seccion.create({ data: { sucursalId: s3, nombre: "Vieja", activa: false } })).id;
    const [rHarina, rAceite] = await renglonesDe(facturaId);
    const aceiteBien = { renglonId: rAceite!.id, seccionId: sec3 };

    const ajena = await confirmar(facturaId, { entradas: [{ renglonId: rHarina!.id, seccionId: sec4 }, aceiteBien] });
    const desactivada = await confirmar(facturaId, { entradas: [{ renglonId: rHarina!.id, seccionId: inactiva }, aceiteBien] });

    expect(ajena).toMatchObject({ ok: false, codigo: "SECCION_NO_ENCONTRADA" });
    expect(desactivada).toMatchObject({ ok: false, codigo: "SECCION_INACTIVA" });
    expect(desactivada.mensaje).toContain("«Vieja» está desactivada");
    expect([await comprasDeStock(), await movimientosDeCompra()]).toEqual([0, 0]);
  });

  it("una línea RECHAZADA (o con observaciones, o sin control) ENTRA al stock igual, en la sección que elige quien recibe: la condición del control no cambia cuánto entra", async () => {
    const facturaId = await cargarPendiente();
    const [rHarina, rAceite] = await renglonesDe(facturaId);
    const c = await controlar(facturaId, [{ renglonId: rHarina!.id, condicion: "RECHAZADA", observacion: "Llegó vencida" }]);
    expect(c.ok, c.mensaje).toBe(true);

    const r = await confirmar(facturaId);

    expect(r.ok, r.mensaje).toBe(true);
    // La rechazada (harina) y la que no se constató (aceite) entran con toda su cantidad.
    expect([await calcularSaldoTotal(harina, sec3, prisma), await calcularSaldoTotal(aceite, sec3, prisma)]).toEqual([10, 5]);
    expect((await movimientosDe(rHarina!.id)).map((m) => Number(m.precioTotal))).toEqual([1000]);
    expect((await movimientosDe(rAceite!.id)).map((m) => Number(m.precioTotal))).toEqual([1000]);
    // El control queda como se constató (no se toca al confirmar).
    expect((await prisma.controlDeLineaDeRecepcion.findFirstOrThrow()).condicion).toBe("RECHAZADA");
  });
});

describe("registrar el control de las líneas (N3-b)", () => {
  it("éxito: guarda el control de cada línea pedida con su observación y su cantidad según remito, quién y cuándo, con id uuid, y audita; no toca el stock ni el estado de la parte; una línea sin control queda sin fila", async () => {
    const facturaId = await cargarPendiente();
    const [rHarina, rAceite] = await renglonesDe(facturaId);

    const r = await controlar(facturaId, [{ renglonId: rAceite!.id, condicion: "CON_OBSERVACIONES", observacion: "Envase abollado", cantidadSegunRemito: 4.5 }]);

    expect(r).toMatchObject({ ok: true, mensaje: "Control registrado: 1 línea(s).", datos: { controles: 1 } });
    const filas = await prisma.controlDeLineaDeRecepcion.findMany();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ facturaProveedorId: facturaId, facturaProveedorRenglonId: rAceite!.id, condicion: "CON_OBSERVACIONES", observacion: "Envase abollado", registradoPorId: admin });
    expect(Number(filas[0]!.cantidadSegunRemito)).toBe(4.5);
    expect(filas[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await prisma.controlDeLineaDeRecepcion.count({ where: { facturaProveedorRenglonId: rHarina!.id } })).toBe(0);
    expect([await comprasDeStock(), await movimientosDeCompra()]).toEqual([0, 0]);
    expect((await parteDe(facturaId)).estadoRecepcion).toBe("PENDIENTE");
    const auditoria = await prisma.registroAuditoria.findFirstOrThrow({ where: { entidadId: facturaId, campo: "controlDeRecepcion" } });
    expect(auditoria).toMatchObject({ actorId: admin, sucursalId: s3, valorAnterior: null, valorNuevo: "1" });
  });

  it("idempotencia: controlar de nuevo la misma línea devuelve YA_CONTROLADA y NO escribe nada (ni la línea nueva de un pedido mixto); el control ya guardado no se cambia", async () => {
    const facturaId = await cargarPendiente();
    const [rHarina, rAceite] = await renglonesDe(facturaId);
    expect((await controlar(facturaId, [{ renglonId: rHarina!.id, condicion: "CONFORME" }])).ok).toBe(true);

    const repetido = await controlar(facturaId, [{ renglonId: rHarina!.id, condicion: "RECHAZADA", observacion: "Otra cosa" }]);
    const mixto = await controlar(facturaId, [{ renglonId: rAceite!.id, condicion: "CONFORME" }, { renglonId: rHarina!.id, condicion: "CONFORME" }]);

    expect(repetido).toMatchObject({ ok: false, codigo: "YA_CONTROLADA" });
    expect(mixto).toMatchObject({ ok: false, codigo: "YA_CONTROLADA" });
    expect(await controlesGuardados()).toBe(1);
    expect((await prisma.controlDeLineaDeRecepcion.findFirstOrThrow()).condicion).toBe("CONFORME");
    expect(await prisma.registroAuditoria.count({ where: { entidadId: facturaId, campo: "controlDeRecepcion" } })).toBe(1);
  });

  it("CONCURRENCIA: dos registros del control del MISMO renglón a la vez: gana uno, el otro recibe YA_CONTROLADA y queda un solo control", async () => {
    const facturaId = await cargarPendiente();
    const [rHarina] = await renglonesDe(facturaId);

    const resultados = await Promise.all([
      controlar(facturaId, [{ renglonId: rHarina!.id, condicion: "CONFORME" }]),
      controlar(facturaId, [{ renglonId: rHarina!.id, condicion: "RECHAZADA", observacion: "Llegó rota" }]),
    ]);

    expect(resultados.filter((x) => x.ok)).toHaveLength(1);
    expect(resultados.filter((x) => !x.ok)).toEqual([expect.objectContaining({ ok: false, codigo: "YA_CONTROLADA" })]);
    expect(await controlesGuardados()).toBe(1);
  });

  it("estados: la parte ya RECIBIDA, la factura ANULADA, la compra de OTRA sucursal, la que no existe y la de OTRA empresa se rechazan sin escribir nada", async () => {
    const recibida = await cargarPendiente({ nroFactura: "A-00001-00000601" });
    const anulada = (await cargar({ nroFactura: "A-00001-00000602" })) && ((await prisma.facturaProveedor.findFirstOrThrow({ where: { nroFactura: "A-00001-00000602" } })).id as string);
    const pendiente = (await cargar({ nroFactura: "A-00001-00000603" })).ok && ((await prisma.facturaProveedor.findFirstOrThrow({ where: { nroFactura: "A-00001-00000603" } })).id as string);
    expect((await confirmar(recibida)).ok).toBe(true);
    expect((await anularFacturaProveedorCasoDeUso(actor3(), { facturaId: anulada, motivo: "Se cargó mal", claveIdempotencia: randomUUID() })).ok).toBe(true);
    const renglonDe = async (id: string) => (await renglonesDe(id))[0]!.id;

    const yaRecibida = await controlar(recibida, [{ renglonId: await renglonDe(recibida), condicion: "CONFORME" }]);
    const anuladaR = await controlar(anulada, [{ renglonId: await renglonDe(anulada), condicion: "CONFORME" }]);
    const deOtraSucursal = await controlar(pendiente as string, [{ renglonId: await renglonDe(pendiente as string), condicion: "CONFORME" }], actorDe(admin4, s4, "Sucursal 4"));
    const noExiste = await controlar("factura-que-no-existe", [{ renglonId: "x", condicion: "CONFORME" }]);

    expect(yaRecibida).toMatchObject({ ok: false, codigo: "YA_RECIBIDA" });
    expect(anuladaR).toMatchObject({ ok: false, codigo: "YA_ANULADA" });
    expect(deOtraSucursal).toMatchObject({ ok: false, codigo: "NO_ES_DE_ESTA_SUCURSAL" });
    expect(noExiste).toMatchObject({ ok: false, codigo: "NO_ENCONTRADA" });
    expect(await controlesGuardados()).toBe(0);
  });

  it("un renglón de OTRA compra no se controla (RENGLON_AJENO) y los renglones sin producto (gastos) tampoco: sin escribir nada", async () => {
    const facturaId = await cargarPendiente();
    const otra = await cargarPendiente({ nroFactura: "A-00001-00000700", claveIdempotencia: randomUUID() });
    const [rAjeno] = await renglonesDe(otra);

    const r = await controlar(facturaId, [{ renglonId: rAjeno!.id, condicion: "CONFORME" }]);

    expect(r).toMatchObject({ ok: false, codigo: "RENGLON_AJENO" });
    expect(await controlesGuardados()).toBe(0);
  });

  it("AISLAMIENTO por empresa: la compra pendiente de OTRA empresa es «no se encontró» y no recibe ningún control", async () => {
    await encenderRecepcion();
    await prisma.empresa.create({ data: { id: "empresa_b", nombre: "Empresa B", slug: "empresa-b", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "PROVISIONING" } });
    const sucursalB = await prismaAdmin.sucursal.create({ data: { empresaId: "empresa_b", nombre: "Sucursal B" } });
    const proveedorB = await prismaAdmin.proveedor.create({ data: { empresaId: "empresa_b", codigo: "PRV_B", nombre: "Proveedor B" } });
    const facturaB = await prismaAdmin.facturaProveedor.create({
      data: { empresaId: "empresa_b", proveedorId: proveedorB.id, fecha: mediodia(-3), importeTotal: 100, estado: "CONFIRMADA", confirmadaEn: new Date(), confirmadaPorId: admin, creadoPorId: admin },
    });
    await encenderRecepcionDeCompras("empresa_b"); // guarda de apagado: la base no deja nacer una parte pendiente con la recepción separada apagada
    await prismaAdmin.facturaProveedorSucursal.create({ data: { empresaId: "empresa_b", facturaProveedorId: facturaB.id, sucursalId: sucursalB.id, porcentajeDeclaradoBp: 10000, estadoRecepcion: "PENDIENTE" } });

    const r = await controlar(facturaB.id, [{ renglonId: "x", condicion: "CONFORME" }]);

    expect(r).toMatchObject({ ok: false, codigo: "NO_ENCONTRADA" });
    expect(await prismaAdmin.controlDeLineaDeRecepcion.count()).toBe(0);
  });

  it("ATOMICIDAD: si falla la auditoría después de insertar los controles, no queda NINGUNO (todo o nada) y el reintento posterior sí los guarda", async () => {
    const facturaId = await cargarPendiente();
    const [rHarina, rAceite] = await renglonesDe(facturaId);
    vi.mocked(registrarCambioAuditado).mockRejectedValueOnce(new Error("falla inyectada al auditar el control"));

    await expect(controlar(facturaId, [{ renglonId: rHarina!.id, condicion: "CONFORME" }, { renglonId: rAceite!.id, condicion: "RECHAZADA", observacion: "Rota" }])).rejects.toThrow("falla inyectada");

    expect(await controlesGuardados()).toBe(0);
    expect(await prisma.registroAuditoria.count({ where: { entidadId: facturaId, campo: "controlDeRecepcion" } })).toBe(0);
    const reintento = await controlar(facturaId, [{ renglonId: rHarina!.id, condicion: "CONFORME" }, { renglonId: rAceite!.id, condicion: "RECHAZADA", observacion: "Rota" }]);
    expect(reintento.ok, reintento.mensaje).toBe(true);
    expect(await controlesGuardados()).toBe(2);
  });
});

describe("el control en la base: las reglas que no dependen del código (segunda barrera)", () => {
  const insertar = (datos: Record<string, unknown>) => prismaAdmin.controlDeLineaDeRecepcion.create({ data: { id: randomUUID(), condicion: "CONFORME", registradoPorId: admin, ...datos } as never });

  it("la base rechaza: una condición fuera de la lista, una observación faltante si no es conforme, un carácter no permitido, una observación de más de 500, una cantidad según remito en cero, un renglón de otra factura y un control después de confirmar", async () => {
    const facturaId = await cargarPendiente();
    const otra = await cargarPendiente({ nroFactura: "A-00001-00000800", claveIdempotencia: randomUUID() });
    const [rHarina] = await renglonesDe(facturaId);
    const [rAjeno] = await renglonesDe(otra);
    const parte = await parteDe(facturaId);
    const base = { facturaProveedorId: facturaId, facturaProveedorSucursalId: parte.id, facturaProveedorRenglonId: rHarina!.id, empresaId: E };

    await expect(insertar({ ...base, condicion: "DEVUELTA" })).rejects.toThrow(/condicion_chk/);
    await expect(insertar({ ...base, condicion: "RECHAZADA" })).rejects.toThrow(/observacion_requerida_chk/);
    await expect(insertar({ ...base, condicion: "CON_OBSERVACIONES", observacion: "Caja <rota>" })).rejects.toThrow(/observacion_chk/);
    await expect(insertar({ ...base, condicion: "CON_OBSERVACIONES", observacion: "  con espacios en los extremos " })).rejects.toThrow(/observacion_chk/);
    await expect(insertar({ ...base, condicion: "CON_OBSERVACIONES", observacion: "a".repeat(501) })).rejects.toThrow(/observacion_chk/);
    await expect(insertar({ ...base, cantidadSegunRemito: 0 })).rejects.toThrow(/cantidadSegunRemito_chk/);
    await expect(insertar({ ...base, facturaProveedorRenglonId: rAjeno!.id })).rejects.toThrow(/renglon_fkey/);
    // Dice otra factura: el disparador (que corre antes que las claves foráneas) ve que la parte no es de esa factura.
    await expect(insertar({ ...base, facturaProveedorId: otra })).rejects.toThrow(/el renglón no es de la factura de la parte/);
    expect(await controlesGuardados()).toBe(0);

    // Lo válido entra; el único (parte, renglón) frena el segundo; y después de confirmar la base no admite ninguno.
    await insertar({ ...base, condicion: "CON_OBSERVACIONES", observacion: "Faltó una caja (3 de 4)" });
    await expect(insertar({ ...base })).rejects.toThrow(/parte_renglon_key|Unique constraint/i);
    expect((await confirmar(facturaId)).ok).toBe(true);
    const [, rAceite] = await renglonesDe(facturaId);
    await expect(insertar({ ...base, facturaProveedorRenglonId: rAceite!.id })).rejects.toThrow(/solo se registra mientras la compra está pendiente de recibir/);
  });

  it("la app no puede cambiar ni borrar un control (solo SELECT e INSERT): UPDATE y DELETE dan permission denied", async (ctx) => {
    const hayRol = (await prismaAdmin.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_roles WHERE rolname = 'motor2_app'`)[0]!.n === BigInt(1);
    if (!hayRol) return ctx.skip();
    const facturaId = await cargarPendiente();
    const [rHarina] = await renglonesDe(facturaId);
    const parte = await parteDe(facturaId);
    const fila = await insertar({ facturaProveedorId: facturaId, facturaProveedorSucursalId: parte.id, facturaProveedorRenglonId: rHarina!.id, empresaId: E });

    await expect(baseDe(s3).db.controlDeLineaDeRecepcion.update({ where: { id: fila.id }, data: { condicion: "RECHAZADA", observacion: "Cambio" } })).rejects.toThrow(/permission denied/i);
    await expect(baseDe(s3).db.controlDeLineaDeRecepcion.delete({ where: { id: fila.id } })).rejects.toThrow(/permission denied/i);
    expect((await prismaAdmin.controlDeLineaDeRecepcion.findUniqueOrThrow({ where: { id: fila.id } })).condicion).toBe("CONFORME");
  });
});
