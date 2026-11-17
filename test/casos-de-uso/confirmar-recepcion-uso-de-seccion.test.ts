import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));
// La escritura de las líneas del Kardex pasa por la original salvo cuando un test le pone una compuerta (para sostener la confirmación a mitad de camino con el candado de las secciones tomado).
const compuerta: { espera: Promise<void> | null } = { espera: null };
vi.mock("../../src/server/persistencia/movimientos/escribir-movimiento-de-stock", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("../../src/server/persistencia/movimientos/escribir-movimiento-de-stock")>();
  return {
    ...original,
    escribirLineasDeMovimientoStock: vi.fn(async (...args: Parameters<typeof original.escribirLineasDeMovimientoStock>) => {
      if (compuerta.espera) await compuerta.espera;
      return original.escribirLineasDeMovimientoStock(...args);
    }),
  };
});

import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "../setup/test-db";
import { EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { fijarModulosActivos, MODULOS_VENDIBLES } from "../setup/modulos";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";
import { registrarFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-factura-proveedor";
import { confirmarRecepcionDeFacturaCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/confirmar-recepcion-de-factura";
import { registrarControlDeRecepcionCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-control-de-recepcion";
import { actualizarActivaSeccionCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/actualizar-activa-seccion";
import { crearSeccionCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/crear-seccion";
import { azarDelProceso } from "../../src/lib/azar";
import { mediodiaDelDia, ZONA_ARGENTINA, diaDeCalendario, sumarDias } from "../../src/core/tiempo/zona-horaria";
import { MENSAJE_RECEPCION_YA_RECIBIDA, MENSAJE_SIN_DEPOSITO_DE_CUARENTENA, MENSAJE_SIN_DEPOSITO_DE_RECHAZO } from "../../src/core/compras/public";
import type { ContextoDeAccion } from "../../src/server/actions/tipos";

/**
 * Compras, depósitos de uso RECHAZO y CUARENTENA, etapa (i) (2026-11-17; docs/diseno-compras-cuarentena-y-rechazo-2026-11-17.md): confirmar la recepción con el destino propuesto según el control, el bloqueo ESTRICTO si falta el depósito del uso que pide una línea,
 * lo elegido contra lo propuesto en la auditoría, la idempotencia, la concurrencia (dos confirmaciones a la vez con líneas mixtas; desactivar el depósito de rechazo mientras se confirma, en los dos órdenes) y el aislamiento (depósito de otra sucursal o de otra empresa).
 * Contra Postgres real. El recorrido de TODAS las combinaciones contra el oráculo escrito aparte está en `test/movimientos/combinaciones-compras-cuarentena-y-rechazo-integracion.test.ts`.
 *
 * Mutaciones (comprobadas a mano al escribirlo): sacar el `FOR SHARE` de `bloquearSeccionesDeLaSucursal` → rojo «desactivar mientras se confirma (la desactivación gana)»; no mirar el control (proponer siempre la normal) → rojos los de propuesta y bloqueo; contar
 * una sección inactiva como «tiene» → rojo «un depósito de rechazo desactivado».
 */
const E = EMPRESA_POR_DEFECTO_ID;
const diaDeHoy = () => diaDeCalendario(new Date(), ZONA_ARGENTINA);
const mediodia = (dias: number) => mediodiaDelDia(sumarDias(diaDeHoy(), dias), ZONA_ARGENTINA);

let s3: string, s4: string, sec3: string, sec4: string;
let admin: string;
let harina: string, aceite: string, proveedorId: string;

const baseDe = (sucursal: string) => baseDeTest({ lectura: [sucursal], escritura: [sucursal] });
const actorDe = (sucursalId: string, sucursalNombre: string) =>
  ({ usuarioId: admin, empresaId: E, sucursalId, sucursalNombre, ahora: new Date(), membresias: [{ sucursalId: s3 }, { sucursalId: s4 }] as never, ...baseDe(sucursalId) }) as unknown as ContextoDeAccion;
const actor3 = () => actorDe(s3, "Central");

async function cargarPendiente(nroFactura = "A-00001-00000100"): Promise<string> {
  const r = await registrarFacturaProveedorCasoDeUso(actor3(), {
    fecha: mediodia(-3),
    proveedorId,
    nroFactura,
    seccionId: sec3,
    items: [
      { productoId: harina, cantidad: 10, precioTotal: 1000, referenciaProveedor: REFERENCIA_DE_PRUEBA },
      { productoId: aceite, cantidad: 5, precioTotal: 1000, referenciaProveedor: REFERENCIA_DE_PRUEBA },
    ],
    reparto: { modo: "PORCENTAJE", partes: [{ sucursalId: s3, valor: 100 }] },
    claveIdempotencia: randomUUID(),
  });
  expect(r.ok, r.mensaje).toBe(true);
  return (r.ok && r.datos.facturaId) as string;
}
const renglonesDe = (facturaId: string) => prisma.facturaProveedorRenglon.findMany({ where: { facturaProveedorId: facturaId, productoId: { not: null } }, orderBy: { orden: "asc" } });
const controlar = async (facturaId: string, condiciones: ("CONFORME" | "CON_OBSERVACIONES" | "RECHAZADA" | null)[]) => {
  const renglones = await renglonesDe(facturaId);
  const controles = condiciones.flatMap((c, i) => (c ? [{ renglonId: renglones[i]!.id, condicion: c, observacion: c === "CONFORME" ? null : "Observación de prueba" }] : []));
  const r = await registrarControlDeRecepcionCasoDeUso(actor3(), { facturaId, controles }, azarDelProceso);
  expect(r.ok, r.mensaje).toBe(true);
};
/** Un destino por renglón (en el orden de la factura: harina, aceite). */
const entradas = async (facturaId: string, destinos: string[]) => (await renglonesDe(facturaId)).map((r, i) => ({ renglonId: r.id, seccionId: destinos[i]! }));
const confirmar = async (facturaId: string, destinos: string[], actor = actor3()) => confirmarRecepcionDeFacturaCasoDeUso(actor, { facturaId, entradas: await entradas(facturaId, destinos) });
const movimientosDeCompra = () => prisma.movimientoStock.count({ where: { proceso: "COMPRA" } });
const parteDe = (facturaId: string) => prisma.facturaProveedorSucursal.findFirstOrThrow({ where: { facturaProveedorId: facturaId, sucursalId: s3 } });
const auditoriasDe = (facturaId: string) => prisma.registroAuditoria.findMany({ where: { entidadId: facturaId, campo: "recepcion" } });
const nada = async (facturaId: string) => {
  expect([await movimientosDeCompra(), await prisma.operacion.count({ where: { proceso: "COMPRA" } }), (await parteDe(facturaId)).estadoRecepcion, (await auditoriasDe(facturaId)).length]).toEqual([0, 0, "PENDIENTE", 0]);
};

beforeEach(async () => {
  compuerta.espera = null;
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  s3 = base.sucursal.id;
  s4 = (await prisma.sucursal.create({ data: { nombre: "Sucursal 4" } })).id;
  sec3 = (await sembrarSeccion(s3, "Depósito")).id;
  sec4 = (await sembrarSeccion(s4, "Depósito")).id;
  admin = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: s3, rolId: base.admin.id })).id;
  const { kg, insumo } = await sembrarCatalogoBase();
  const litro = await prisma.unidad.create({ data: { nombre: "l", magnitud: "VOLUMEN", decimales: 2 } });
  const aceiteInsumo = await prisma.insumo.create({ data: { nombre: "Aceite" } });
  harina = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } })).id;
  aceite = (await prisma.producto.create({ data: { codigo: "MP_ACEITE", nombre: "Aceite", tipo: "MP", unidadStockId: litro.id, insumoId: aceiteInsumo.id } })).id;
  await prisma.disponibilidadProducto.createMany({ data: [s3, s4].flatMap((sucursalId) => [harina, aceite].map((productoId) => ({ sucursalId, productoId, disponible: true }))) });
  proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
  await fijarModulosActivos(E, [...MODULOS_VENDIBLES, "recepcion_de_compras"]);
});

describe("el destino según el control", () => {
  it("la rechazada entra al depósito de RECHAZO y la con observaciones a CUARENTENA (lo propuesto), con toda su cantidad; el stock normal no se mueve", async () => {
    const rechazo = await sembrarSeccion(s3, "Rechazo", "RECHAZO");
    const cuarentena = await sembrarSeccion(s3, "Cuarentena", "CUARENTENA");
    const facturaId = await cargarPendiente();
    await controlar(facturaId, ["RECHAZADA", "CON_OBSERVACIONES"]);

    const r = await confirmar(facturaId, [rechazo.id, cuarentena.id]);

    expect(r.ok, r.mensaje).toBe(true);
    expect([await calcularSaldoTotal(harina, rechazo.id, prisma), await calcularSaldoTotal(aceite, cuarentena.id, prisma)]).toEqual([10, 5]);
    expect([await calcularSaldoTotal(harina, sec3, prisma), await calcularSaldoTotal(aceite, sec3, prisma)]).toEqual([0, 0]);
    const [a] = await auditoriasDe(facturaId);
    expect(a!.descripcion).toContain("Destino por renglón: Harina: propuesta «Rechazo», elegida «Rechazo», sin cambio; Aceite: propuesta «Cuarentena», elegida «Cuarentena», sin cambio");
  });

  it("la conforme y la sin control se proponen a la primera sección NORMAL por nombre", async () => {
    await sembrarSeccion(s3, "Almacén");
    const facturaId = await cargarPendiente();
    await controlar(facturaId, ["CONFORME", null]);
    const almacen = (await prisma.seccion.findFirstOrThrow({ where: { sucursalId: s3, nombre: "Almacén" } })).id;

    const r = await confirmar(facturaId, [almacen, almacen]);

    expect(r.ok, r.mensaje).toBe(true);
    expect((await auditoriasDe(facturaId))[0]!.descripcion).toContain("Harina: propuesta «Almacén», elegida «Almacén», sin cambio; Aceite: propuesta «Almacén», elegida «Almacén», sin cambio");
  });

  it("con varias secciones del mismo uso se propone la primera por nombre y se puede elegir otra (queda «cambiado» en la auditoría)", async () => {
    const r2 = await sembrarSeccion(s3, "Rechazo 2", "RECHAZO");
    await sembrarSeccion(s3, "Rechazo 1", "RECHAZO");
    const facturaId = await cargarPendiente();
    await controlar(facturaId, ["RECHAZADA", "CONFORME"]);

    const r = await confirmar(facturaId, [r2.id, sec3]);

    expect(r.ok, r.mensaje).toBe(true);
    expect((await auditoriasDe(facturaId))[0]!.descripcion).toContain("Harina: propuesta «Rechazo 1», elegida «Rechazo 2», cambiado; Aceite: propuesta «Depósito», elegida «Depósito», sin cambio");
  });

  it("quien confirma puede mandar la rechazada a un depósito normal SI la sucursal tiene el de rechazo (queda «cambiado»)", async () => {
    await sembrarSeccion(s3, "Rechazo", "RECHAZO");
    const facturaId = await cargarPendiente();
    await controlar(facturaId, ["RECHAZADA", null]);

    const r = await confirmar(facturaId, [sec3, sec3]);

    expect(r.ok, r.mensaje).toBe(true);
    expect([await calcularSaldoTotal(harina, sec3, prisma), await calcularSaldoTotal(aceite, sec3, prisma)]).toEqual([10, 5]);
    expect((await auditoriasDe(facturaId))[0]!.descripcion).toContain("Harina: propuesta «Rechazo», elegida «Depósito», cambiado");
  });
});

describe("el bloqueo ESTRICTO: sin el depósito del uso que pide una línea no entra nada", () => {
  it("línea RECHAZADA y sin depósito de RECHAZO: se bloquea la confirmación entera, aunque quien confirma elija un depósito normal", async () => {
    const facturaId = await cargarPendiente();
    await controlar(facturaId, ["RECHAZADA", "CONFORME"]);

    const r = await confirmar(facturaId, [sec3, sec3]);

    expect(r).toMatchObject({ ok: false, codigo: "SIN_DEPOSITO_DE_RECHAZO", mensaje: MENSAJE_SIN_DEPOSITO_DE_RECHAZO });
    await nada(facturaId);
  });

  it("línea CON_OBSERVACIONES y sin depósito de CUARENTENA: se bloquea igual (un depósito de RECHAZO no lo reemplaza)", async () => {
    await sembrarSeccion(s3, "Rechazo", "RECHAZO");
    const facturaId = await cargarPendiente();
    await controlar(facturaId, [null, "CON_OBSERVACIONES"]);

    const r = await confirmar(facturaId, [sec3, sec3]);

    expect(r).toMatchObject({ ok: false, codigo: "SIN_DEPOSITO_DE_CUARENTENA", mensaje: MENSAJE_SIN_DEPOSITO_DE_CUARENTENA });
    await nada(facturaId);
  });

  it("si faltan los dos se dice el de rechazo; con los dos presentes confirma", async () => {
    const facturaId = await cargarPendiente();
    await controlar(facturaId, ["RECHAZADA", "CON_OBSERVACIONES"]);
    expect(await confirmar(facturaId, [sec3, sec3])).toMatchObject({ ok: false, codigo: "SIN_DEPOSITO_DE_RECHAZO" });
    await sembrarSeccion(s3, "Rechazo", "RECHAZO");
    expect(await confirmar(facturaId, [sec3, sec3])).toMatchObject({ ok: false, codigo: "SIN_DEPOSITO_DE_CUARENTENA" });
    await nada(facturaId);
    await sembrarSeccion(s3, "Cuarentena", "CUARENTENA");
    expect((await confirmar(facturaId, [sec3, sec3])).ok).toBe(true);
  });

  it("un depósito de rechazo DESACTIVADO no cuenta como tenerlo", async () => {
    await prisma.seccion.create({ data: { sucursalId: s3, nombre: "Rechazo viejo", uso: "RECHAZO", activa: false } });
    const facturaId = await cargarPendiente();
    await controlar(facturaId, ["RECHAZADA", null]);

    expect(await confirmar(facturaId, [sec3, sec3])).toMatchObject({ ok: false, codigo: "SIN_DEPOSITO_DE_RECHAZO" });
    await nada(facturaId);
  });

  it("el depósito de rechazo de OTRA sucursal no satisface el bloqueo de esta (aislamiento)", async () => {
    await sembrarSeccion(s4, "Rechazo", "RECHAZO");
    const facturaId = await cargarPendiente();
    await controlar(facturaId, ["RECHAZADA", null]);

    expect(await confirmar(facturaId, [sec3, sec3])).toMatchObject({ ok: false, codigo: "SIN_DEPOSITO_DE_RECHAZO" });
    await nada(facturaId);
  });

  it("sin control en ninguna línea (o todas conformes) la sucursal no necesita ningún depósito especial", async () => {
    const facturaId = await cargarPendiente();
    await controlar(facturaId, ["CONFORME", null]);
    expect((await confirmar(facturaId, [sec3, sec3])).ok).toBe(true);
  });
});

describe("aislamiento: el destino tiene que ser de esta sucursal", () => {
  it("un depósito de otra sucursal de la empresa es «no se encontró la sección», aunque sea de uso RECHAZO", async () => {
    const ajeno = await sembrarSeccion(s4, "Rechazo ajeno", "RECHAZO");
    await sembrarSeccion(s3, "Rechazo", "RECHAZO");
    const facturaId = await cargarPendiente();
    await controlar(facturaId, ["RECHAZADA", null]);

    expect(await confirmar(facturaId, [ajeno.id, sec3])).toMatchObject({ ok: false, codigo: "SECCION_NO_ENCONTRADA" });
    expect(await confirmar(facturaId, [sec4, sec3])).toMatchObject({ ok: false, codigo: "SECCION_NO_ENCONTRADA" });
    await nada(facturaId);
  });

  it("un depósito de OTRA EMPRESA tampoco existe para esta: se rechaza y no entra nada", async () => {
    const suc = await prismaAdmin.sucursal.create({ data: { empresaId: EMPRESA_TESTIGO_ID, nombre: "Testigo" } });
    const ajena = await prismaAdmin.seccion.create({ data: { empresaId: EMPRESA_TESTIGO_ID, sucursalId: suc.id, nombre: "Rechazo testigo", uso: "RECHAZO" } });
    await sembrarSeccion(s3, "Rechazo", "RECHAZO");
    const facturaId = await cargarPendiente();
    await controlar(facturaId, ["RECHAZADA", null]);

    expect(await confirmar(facturaId, [ajena.id, sec3])).toMatchObject({ ok: false, codigo: "SECCION_NO_ENCONTRADA" });
    await nada(facturaId);
    // Higiene: no dejar nada de la empresa testigo para los tests que siguen.
    await prismaAdmin.seccion.deleteMany({ where: { id: ajena.id } });
    await prismaAdmin.sucursal.deleteMany({ where: { id: suc.id } });
  });

  it("una sección desactivada como destino se rechaza con su texto de siempre", async () => {
    const vieja = await prisma.seccion.create({ data: { sucursalId: s3, nombre: "Vieja", activa: false } });
    const facturaId = await cargarPendiente();
    expect(await confirmar(facturaId, [vieja.id, sec3])).toMatchObject({ ok: false, codigo: "SECCION_INACTIVA" });
    await nada(facturaId);
  });
});

describe("idempotencia", () => {
  it("repetir la confirmación (con líneas mixtas) es éxito «ya recibida»: sin movimientos nuevos ni otra auditoría; y repetirla ya bloqueada vuelve a bloquear sin escribir", async () => {
    const facturaId = await cargarPendiente();
    await controlar(facturaId, ["RECHAZADA", null]);
    expect(await confirmar(facturaId, [sec3, sec3])).toMatchObject({ ok: false, codigo: "SIN_DEPOSITO_DE_RECHAZO" });
    expect(await confirmar(facturaId, [sec3, sec3])).toMatchObject({ ok: false, codigo: "SIN_DEPOSITO_DE_RECHAZO" });
    await nada(facturaId);

    const rechazo = await sembrarSeccion(s3, "Rechazo", "RECHAZO");
    const primera = await confirmar(facturaId, [rechazo.id, sec3]);
    expect(primera).toMatchObject({ ok: true, datos: { yaExistia: false } });
    const segunda = await confirmar(facturaId, [rechazo.id, sec3]);
    expect(segunda).toMatchObject({ ok: true, mensaje: MENSAJE_RECEPCION_YA_RECIBIDA, datos: { movimientos: 0, yaExistia: true } });
    expect([await movimientosDeCompra(), (await auditoriasDe(facturaId)).length]).toEqual([2, 1]);
  });
});

describe("concurrencia", () => {
  it("dos confirmaciones a la vez con líneas mixtas (rechazada + conforme): una sola entrada por renglón y una sola auditoría; la otra recibe «ya recibida»", async () => {
    const rechazo = await sembrarSeccion(s3, "Rechazo", "RECHAZO");
    const facturaId = await cargarPendiente();
    await controlar(facturaId, ["RECHAZADA", "CONFORME"]);

    const resultados = await Promise.all([confirmar(facturaId, [rechazo.id, sec3]), confirmar(facturaId, [rechazo.id, sec3]), confirmar(facturaId, [rechazo.id, sec3])]);

    expect(resultados.every((r) => r.ok)).toBe(true);
    expect(resultados.filter((r) => r.ok && !r.datos.yaExistia)).toHaveLength(1);
    expect(await movimientosDeCompra()).toBe(2);
    expect(await prisma.operacion.count({ where: { proceso: "COMPRA" } })).toBe(1);
    expect([await calcularSaldoTotal(harina, rechazo.id, prisma), await calcularSaldoTotal(aceite, sec3, prisma)]).toEqual([10, 5]);
    expect((await auditoriasDe(facturaId)).length).toBe(1);
  });

  it("desactivar el depósito de rechazo MIENTRAS se confirma (la confirmación gana): la desactivación espera, la mercadería entra a un depósito que seguía activo y recién después queda desactivado", async () => {
    const rechazo = await sembrarSeccion(s3, "Rechazo", "RECHAZO");
    const facturaId = await cargarPendiente();
    await controlar(facturaId, ["RECHAZADA", null]);
    let soltar!: () => void;
    compuerta.espera = new Promise<void>((resolver) => (soltar = resolver));

    const confirmacion = confirmar(facturaId, [rechazo.id, sec3]);
    await new Promise((r) => setTimeout(r, 500)); // la confirmación ya tomó el candado de las secciones y quedó detenida antes de escribir
    let desactivada = false;
    const desactivacion = actualizarActivaSeccionCasoDeUso(actor3(), { seccionId: rechazo.id, activa: false }).then((x) => ((desactivada = true), x));
    await new Promise((r) => setTimeout(r, 500));
    expect(desactivada, "la desactivación tiene que esperar a que termine la confirmación").toBe(false);
    soltar();

    const [r, d] = await Promise.all([confirmacion, desactivacion]);

    expect(r.ok, r.mensaje).toBe(true);
    expect(d.ok).toBe(true);
    expect(await calcularSaldoTotal(harina, rechazo.id, prisma)).toBe(10);
    expect((await prisma.seccion.findUniqueOrThrow({ where: { id: rechazo.id } })).activa).toBe(false);
  });

  it("desactivar el depósito de rechazo MIENTRAS se confirma (la desactivación gana): se rechaza la confirmación y NUNCA entra stock a la sección ya desactivada", async () => {
    const rechazo = await sembrarSeccion(s3, "Rechazo", "RECHAZO");
    const facturaId = await cargarPendiente();
    await controlar(facturaId, ["RECHAZADA", null]);
    let confirmarLaDesactivacion!: () => void;
    const puedeConfirmarse = new Promise<void>((resolver) => (confirmarLaDesactivacion = resolver));
    // La desactivación abre su transacción, toma la fila y NO la confirma todavía.
    const tomada = new Promise<void>((resolver) => {
      void prismaAdmin.$transaction(async (tx) => {
        await tx.seccion.update({ where: { id: rechazo.id }, data: { activa: false } });
        resolver();
        await puedeConfirmarse;
      });
    });
    await tomada;

    const confirmacion = confirmar(facturaId, [rechazo.id, sec3]);
    await new Promise((r) => setTimeout(r, 500)); // la confirmación está esperando la fila de la sección
    confirmarLaDesactivacion();
    const r = await confirmacion;

    expect(r.ok, "con la desactivación ya confirmada no puede entrar stock a esa sección").toBe(false);
    expect(["SECCION_INACTIVA", "SIN_DEPOSITO_DE_RECHAZO"]).toContain(r.ok ? "" : r.codigo);
    await nada(facturaId);
    expect(await calcularSaldoTotal(harina, rechazo.id, prisma)).toBe(0);
  });
});

describe("crear una sección con su uso (caso de uso)", () => {
  it("crea con el uso elegido (NORMAL por defecto en el guard); un nombre repetido sigue rechazado; el uso queda en la base", async () => {
    const r = await crearSeccionCasoDeUso(actor3(), { nombre: "Cámara de rechazo", uso: "RECHAZO" });
    expect(r).toMatchObject({ ok: true, datos: { nombre: "Cámara de rechazo", uso: "RECHAZO" } });
    expect((await prisma.seccion.findFirstOrThrow({ where: { sucursalId: s3, nombre: "Cámara de rechazo" } })).uso).toBe("RECHAZO");
    expect(await crearSeccionCasoDeUso(actor3(), { nombre: "cámara de rechazo", uso: "NORMAL" })).toMatchObject({ ok: false, codigo: "NOMBRE_REPETIDO" });
    // Varias del mismo uso en la misma sucursal: permitido.
    expect((await crearSeccionCasoDeUso(actor3(), { nombre: "Otra de rechazo", uso: "RECHAZO" })).ok).toBe(true);
  });

  it("el uso no se cambia después: ni siquiera con el rol dueño (el disparador de la base lo impide)", async () => {
    const rechazo = await sembrarSeccion(s3, "Rechazo", "RECHAZO");
    await expect(prismaAdmin.seccion.update({ where: { id: rechazo.id }, data: { uso: "NORMAL" } })).rejects.toThrow(/no se cambia/);
    await expect(prisma.seccion.update({ where: { id: rechazo.id }, data: { uso: "CUARENTENA" } })).rejects.toThrow(/no se cambia/);
  });
});
