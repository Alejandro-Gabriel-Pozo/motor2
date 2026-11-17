import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "../setup/test-db";
import { fijarModulosActivos, MODULOS_VENDIBLES } from "../setup/modulos";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";
import { confirmarRecepcionDeFactura, registrarControlDeRecepcion } from "../../src/server/actions/movimientos/facturas-proveedor";
import { registrarFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-factura-proveedor";
import { requierePermiso } from "../../src/server/acceso/gate";
import { mediodiaDelDia, ZONA_ARGENTINA, diaDeCalendario, sumarDias } from "../../src/core/tiempo/zona-horaria";
import type { ContextoDeAccion } from "../../src/server/actions/tipos";

/**
 * Compras N3-a, recepción separada — PERMISOS EN EL SERVIDOR de «Confirmar recepción» (`compra_recibir`, del módulo `recepcion_de_compras`, de sucursal, piso administrador), con la Server Action REAL y Postgres real:
 * el operador es rechazado aunque la matriz le dé la fila (el piso manda sobre la matriz), el administrador y el gerente alcanzan, y con el módulo apagado se rechaza por módulo (`MODULO_NO_ACTIVO`) para todos.
 * El oráculo de combinaciones recorre estas mismas puertas en `test/movimientos/combinaciones-compras-recepcion-integracion.test.ts`.
 *
 * Mutaciones (comprobadas a mano al escribirlo): `compra_recibir` con piso operario → rojo «el OPERADOR es rechazado» y la fila OPERADOR del oráculo; con `modulo: "compras"` en la acción → rojo «módulo APAGADO».
 */
const E = EMPRESA_POR_DEFECTO_ID;
const mediodia = (dias: number) => mediodiaDelDia(sumarDias(diaDeCalendario(new Date(), ZONA_ARGENTINA), dias), ZONA_ARGENTINA);

let s3: string, sec3: string;
let admin: { id: string; email: string };
let gerente: { id: string; email: string };
let operador: { id: string; email: string };
let facturaId: string;
let harina: string;

const como = async (u: { id: string; email: string }) => {
  __setCookieDeTestParaSucursal(s3);
  await mockearUsuarioActual({ id: u.id, email: u.email, nombre: null });
};
const entradasEnteras = async (seccionId = sec3) =>
  (await prisma.facturaProveedorRenglon.findMany({ where: { facturaProveedorId: facturaId, productoId: { not: null } }, orderBy: { orden: "asc" } })).map((r) => ({ renglonId: r.id, seccionId }));
const recibir = async () => confirmarRecepcionDeFactura(facturaId, await entradasEnteras());
const renglonId = async () => (await prisma.facturaProveedorRenglon.findFirstOrThrow({ where: { facturaProveedorId: facturaId } })).id;
const controles = () => prisma.controlDeLineaDeRecepcion.count();
const compras = () => prisma.operacion.count({ where: { proceso: "COMPRA" } });
const parte = () => prisma.facturaProveedorSucursal.findFirstOrThrow({ where: { facturaProveedorId: facturaId } });

beforeEach(async () => {
  __setCookieDeTestParaSucursal(undefined);
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  s3 = base.sucursal.id;
  sec3 = (await sembrarSeccion(s3)).id;
  const usuarioAdmin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: s3, rolId: base.admin.id });
  admin = { id: usuarioAdmin.id, email: "admin@test.com" };
  // El gerente de la empresa es, en la práctica, quien tiene además el rol administrador (ADR-007: el primer admin es el «gerente»).
  const usuarioGerente = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: s3, rolId: base.admin.id });
  await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: usuarioGerente.id, empresaId: E } }, data: { rolEmpresa: "gerente" } });
  gerente = { id: usuarioGerente.id, email: "gerente@test.com" };
  const usuarioOperador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: s3, rolId: base.operador.id });
  operador = { id: usuarioOperador.id, email: "operador@test.com" };
  // El gerente le asigna la clave al rol operador en la matriz: el piso (administrador) manda sobre la fila y no le sirve.
  await prisma.permisoRol.updateMany({ where: { rolId: base.operador.id, accionClave: "compra_recibir" }, data: { puedeVer: true, puedeEditar: true } });
  // La semilla del código (`compra_controlar_recepcion`: admin y operador) la da la migración o el alta de la empresa; en la base de pruebas se asegura la fila de cada rol.
  for (const rolId of [base.admin.id, base.operador.id]) await prisma.permisoRol.upsert({ where: { rolId_accionClave: { rolId, accionClave: "compra_controlar_recepcion" } }, update: { puedeVer: true, puedeEditar: true }, create: { rolId, accionClave: "compra_controlar_recepcion", puedeVer: true, puedeEditar: true } });
  const { kg, insumo } = await sembrarCatalogoBase();
  harina = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } })).id;
  await prisma.disponibilidadProducto.create({ data: { sucursalId: s3, productoId: harina, disponible: true } });
  const proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
  await fijarModulosActivos(E, [...MODULOS_VENDIBLES, "recepcion_de_compras"]);
  const actor = { usuarioId: admin.id, empresaId: E, sucursalId: s3, sucursalNombre: "Central", ahora: new Date(), membresias: [{ sucursalId: s3 }] as never, ...baseDeTest({ lectura: [s3], escritura: [s3] }) } as unknown as ContextoDeAccion;
  const r = await registrarFacturaProveedorCasoDeUso(actor, {
    fecha: mediodia(-3),
    proveedorId,
    nroFactura: "A-00001-00000400",
    seccionId: sec3,
    items: [{ productoId: harina, cantidad: 10, precioTotal: 1000, referenciaProveedor: REFERENCIA_DE_PRUEBA }],
    reparto: { modo: "PORCENTAJE", partes: [{ sucursalId: s3, valor: 100 }] },
    claveIdempotencia: randomUUID(),
  });
  expect(r.ok, r.mensaje).toBe(true);
  facturaId = (r.ok && r.datos.facturaId) as string;
});

describe("confirmarRecepcionDeFactura: permisos en el servidor", () => {
  it("el OPERADOR es rechazado (aunque la matriz le dé la fila: el piso es administrador): no entra stock y la parte sigue pendiente", async () => {
    await como(operador);
    const gate = await requierePermiso(operador.id, s3, "compra_recibir", prisma);

    const r = await recibir();

    expect(gate.ok).toBe(false);
    expect(r).toEqual({ ok: false, mensaje: gate.ok ? "" : gate.mensaje });
    expect(await compras()).toBe(0);
    expect((await parte()).estadoRecepcion).toBe("PENDIENTE");
  });

  it("el ADMINISTRADOR confirma: entra el stock y la parte queda recibida por él", async () => {
    await como(admin);

    const r = await recibir();

    expect(r.ok, r.mensaje).toBe(true);
    expect(await calcularSaldoTotal(harina, sec3, prisma)).toBe(10);
    const p = await parte();
    expect([p.estadoRecepcion, p.recibidaPorId]).toEqual(["RECIBIDA", admin.id]);
  });

  it("el GERENTE de la empresa confirma", async () => {
    await como(gerente);

    const r = await recibir();

    expect(r.ok, r.mensaje).toBe(true);
    expect((await parte()).recibidaPorId).toBe(gerente.id);
  });

  it("con el módulo recepcion_de_compras APAGADO se rechaza por módulo para todos (administrador y gerente también): MODULO_NO_ACTIVO, sin tocar nada", async () => {
    await fijarModulosActivos(E, MODULOS_VENDIBLES);
    for (const u of [admin, gerente, operador]) {
      await como(u);
      const gate = await requierePermiso(u.id, s3, "compra_recibir", prisma);

      const r = await recibir();

      expect(gate).toMatchObject({ ok: false, motivo: "MODULO_NO_ACTIVO", modulo: "recepcion_de_compras" });
      expect(r).toEqual({ ok: false, mensaje: gate.ok ? "" : gate.mensaje });
    }
    expect(await compras()).toBe(0);
    expect((await parte()).estadoRecepcion).toBe("PENDIENTE");
  });

  it("un administrador de OTRA sucursal pasa el guard en la suya, pero la parte no es de ella: «no se encontró» y no se toca nada", async () => {
    const otraSucursal = (await prisma.sucursal.create({ data: { nombre: "Sucursal 4" } })).id;
    const base = await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } });
    const ajeno = await crearUsuarioConMembresia({ email: "ajeno@test.com", sucursalId: otraSucursal, rolId: base.id });
    __setCookieDeTestParaSucursal(otraSucursal);
    await mockearUsuarioActual({ id: ajeno.id, email: "ajeno@test.com", nombre: null });

    const r = await recibir();

    expect(r).toEqual({ ok: false, mensaje: "No se encontró esa compra para recibir en esta sucursal." });
    expect(await compras()).toBe(0);
    expect((await parte()).estadoRecepcion).toBe("PENDIENTE");
  });
});

describe("confirmarRecepcionDeFactura: formato (el actor y la hora salen del servidor)", () => {
  it("rechaza sin factura, sin entradas o sin sección, antes de tocar nada", async () => {
    await como(admin);

    const entradas = await entradasEnteras();
    expect(await confirmarRecepcionDeFactura("", entradas)).toMatchObject({ ok: false });
    expect(await confirmarRecepcionDeFactura(facturaId, [])).toMatchObject({ ok: false });
    expect(await confirmarRecepcionDeFactura(facturaId, entradas.map((e) => ({ ...e, seccionId: "" })))).toMatchObject({ ok: false });
    expect(await compras()).toBe(0);
  });

  it("lista de permitidos: una cantidad o una fecha que el cliente mande de más se IGNORAN (entra la cantidad entera del renglón, con la fecha de la confirmación)", async () => {
    await como(admin);

    const entradas = (await entradasEnteras()).map((e) => ({ ...e, cantidad: 3, fechaStock: mediodia(-4) }));
    const r = await confirmarRecepcionDeFactura(facturaId, entradas as never);

    expect(r).toMatchObject({ ok: true, yaExistia: false });
    const m = await prisma.movimientoStock.findMany({ where: { proceso: "COMPRA" } });
    expect(m.map((x) => Number(x.cantidad))).toEqual([10]);
    const operacion = await prisma.operacion.findFirstOrThrow({ where: { proceso: "COMPRA" } });
    expect(diaDeCalendario(operacion.fecha, ZONA_ARGENTINA)).toBe(diaDeCalendario(new Date(), ZONA_ARGENTINA));
  });
});

describe("registrarControlDeRecepcion: permisos en el servidor (compra_controlar_recepcion, piso operario)", () => {
  const controlConforme = async () => [{ renglonId: await renglonId(), condicion: "CONFORME" as const }];

  it("el OPERADOR registra el control (piso operario) pero NO confirma la recepción: quien recibe controla, el gerente o el administrador confirma", async () => {
    await como(operador);

    const control = await registrarControlDeRecepcion(facturaId, await controlConforme());
    const confirmacion = await recibir();

    expect(control.ok, control.mensaje).toBe(true);
    expect(await controles()).toBe(1);
    expect(confirmacion.ok).toBe(false);
    expect(await compras()).toBe(0);
    expect((await parte()).estadoRecepcion).toBe("PENDIENTE");
    expect((await prisma.controlDeLineaDeRecepcion.findFirstOrThrow()).registradoPorId).toBe(operador.id);
  });

  it("el ADMINISTRADOR y el GERENTE también registran el control (cada uno su línea; la misma línea no se controla dos veces)", async () => {
    await prisma.facturaProveedorRenglon.findFirstOrThrow({ where: { facturaProveedorId: facturaId } });
    await como(admin);
    expect((await registrarControlDeRecepcion(facturaId, await controlConforme())).ok).toBe(true);
    await como(gerente);

    const segunda = await registrarControlDeRecepcion(facturaId, await controlConforme());

    expect(segunda.ok).toBe(false);
    expect(await controles()).toBe(1);
  });

  it("con el módulo recepcion_de_compras APAGADO se rechaza por módulo para todos: MODULO_NO_ACTIVO, sin escribir ningún control", async () => {
    await fijarModulosActivos(E, MODULOS_VENDIBLES);
    for (const u of [admin, gerente, operador]) {
      await como(u);
      const gate = await requierePermiso(u.id, s3, "compra_controlar_recepcion", prisma);

      const r = await registrarControlDeRecepcion(facturaId, await controlConforme());

      expect(gate).toMatchObject({ ok: false, motivo: "MODULO_NO_ACTIVO", modulo: "recepcion_de_compras" });
      expect(r).toEqual({ ok: false, mensaje: gate.ok ? "" : gate.mensaje });
    }
    expect(await controles()).toBe(0);
  });

  it("sin la fila en la matriz (el gerente se la quitó al operador) el operador es rechazado: el servidor re-valida, no confía en la pantalla", async () => {
    await prisma.permisoRol.updateMany({ where: { accionClave: "compra_controlar_recepcion", rol: { clave: "operador" } }, data: { puedeVer: false, puedeEditar: false } });
    await como(operador);

    const r = await registrarControlDeRecepcion(facturaId, await controlConforme());

    expect(r.ok).toBe(false);
    expect(await controles()).toBe(0);
  });

  it("formato: rechaza sin factura, sin controles, con una condición fuera de la lista, sin observación si no es conforme o con un carácter no permitido, antes de tocar nada", async () => {
    await como(operador);
    const id = await renglonId();

    expect(await registrarControlDeRecepcion("", [{ renglonId: id, condicion: "CONFORME" }])).toMatchObject({ ok: false });
    expect(await registrarControlDeRecepcion(facturaId, [])).toMatchObject({ ok: false });
    expect(await registrarControlDeRecepcion(facturaId, [{ renglonId: id, condicion: "DEVUELTA" as never }])).toMatchObject({ ok: false });
    expect(await registrarControlDeRecepcion(facturaId, [{ renglonId: id, condicion: "RECHAZADA" }])).toMatchObject({ ok: false });
    expect(await registrarControlDeRecepcion(facturaId, [{ renglonId: id, condicion: "CON_OBSERVACIONES", observacion: "Caja <rota>" }])).toMatchObject({ ok: false });
    expect(await controles()).toBe(0);
  });
});
