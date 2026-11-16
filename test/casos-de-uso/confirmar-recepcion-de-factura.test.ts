import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));
// La escritura de las líneas del Kardex pasa por el original salvo cuando un test le pide que falle (atomicidad).
vi.mock("../../src/server/persistencia/movimientos/escribir-movimiento-de-stock", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("../../src/server/persistencia/movimientos/escribir-movimiento-de-stock")>();
  return { ...original, escribirLineasDeMovimientoStock: vi.fn(original.escribirLineasDeMovimientoStock) };
});

import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "../setup/test-db";
import { fijarModulosActivos, MODULOS_VENDIBLES } from "../setup/modulos";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";
import { escribirLineasDeMovimientoStock } from "../../src/server/persistencia/movimientos/escribir-movimiento-de-stock";
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
 * Compras N3-a, recepción separada: cargar «pendiente de recibir» (módulo `recepcion_de_compras` encendido) y CONFIRMAR la recepción, con Postgres real. El permiso lo pide la Server Action (`compra_recibir`; lo prueba
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
const confirmar = (facturaId: string, o: { seccionId?: string; fechaStock?: Date; ahora?: Date } = {}) =>
  confirmarRecepcionDeFacturaCasoDeUso(actor3(o.ahora), { facturaId, seccionId: o.seccionId ?? sec3, fechaStock: o.fechaStock ?? mediodia(-2) });

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
  await sembrarEscenario();
});

describe("cargar con el módulo recepcion_de_compras encendido", () => {
  it("una sola parte propia: nace PENDIENTE, sin compra ni stock ni costo; la sección que venga se ignora; el vínculo con el proveedor y la auditoría quedan", async () => {
    await encenderRecepcion();

    const r = await registrarFacturaProveedorCasoDeUso(actor3(), datosDeFactura({ seccionId: "una-seccion-que-no-existe" }));

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
  it("éxito: entra el stock con la fecha elegida (compra COMPRA con un movimiento por renglón, su renglón, sus pesos y su costo), la parte pasa a RECIBIDA con su compra, quién y cuándo, y queda la auditoría", async () => {
    const facturaId = await cargarPendiente();
    const fechaStock = mediodia(-2);

    const r = await confirmar(facturaId, { fechaStock });

    expect(r).toMatchObject({ ok: true, mensaje: `Recepción confirmada: 2 movimiento(s) entraron al stock de esta sucursal con fecha ${diaDeCalendario(fechaStock, ZONA_ARGENTINA)}.`, datos: { movimientos: 2 } });
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

  it("idempotencia por estado: confirmar de nuevo devuelve «ya recibida» y NO crea un segundo stock ni otra compra ni otra auditoría", async () => {
    const facturaId = await cargarPendiente();
    expect((await confirmar(facturaId)).ok).toBe(true);

    const segunda = await confirmar(facturaId);

    expect(segunda).toMatchObject({ ok: false, codigo: "YA_RECIBIDA", mensaje: MENSAJE_RECEPCION_YA_RECIBIDA });
    expect([await comprasDeStock(), await movimientosDeCompra(), await calcularSaldoTotal(harina, sec3, prisma)]).toEqual([1, 2, 10]);
    expect(await prisma.registroAuditoria.count({ where: { entidadId: facturaId, campo: "recepcion" } })).toBe(1);
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

    const r = await confirmarRecepcionDeFacturaCasoDeUso(actorDe(admin4, s4, "Sucursal 4"), { facturaId, seccionId: sec4, fechaStock: mediodia(-2) });

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

  it("la fecha de stock vale desde el día de la factura hasta hoy (en hora argentina), ambos incluidos; antes o después se rechaza sin escribir nada", async () => {
    const facturaId = await cargarPendiente({ fecha: mediodia(-3) });
    const mensajeEsperado = `La fecha de stock tiene que estar entre la fecha de la factura (${sumarDias(diaDeHoy(), -3)}) y hoy (${diaDeHoy()}).`;

    const antes = await confirmar(facturaId, { fechaStock: mediodia(-4) });
    const despues = await confirmar(facturaId, { fechaStock: mediodia(1) });

    expect(antes).toEqual({ ok: false, codigo: "FECHA_FUERA_DE_RANGO", mensaje: mensajeEsperado });
    expect(despues).toEqual({ ok: false, codigo: "FECHA_FUERA_DE_RANGO", mensaje: mensajeEsperado });
    expect(await comprasDeStock()).toBe(0);
    expect((await confirmar(facturaId, { fechaStock: mediodia(-3) })).ok).toBe(true);
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

  it("la hora «hoy» de la regla de la fecha es la que entra por actor.ahora (Pureza 1.2), no la del reloj", async () => {
    const facturaId = await cargarPendiente({ fecha: mediodia(-3) });
    const unaSemanaAtras = mediodia(-7);

    // Con «ahora» una semana atrás, la fecha de stock del día -2 es FUTURA y la de la factura (-3) también.
    const r = await confirmar(facturaId, { ahora: unaSemanaAtras, fechaStock: mediodia(-2) });

    expect(r).toMatchObject({ ok: false, codigo: "FECHA_FUERA_DE_RANGO" });
  });
});
