import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase } from "../setup/test-db";
import { fijarModulosActivos, MODULOS_VENDIBLES } from "../setup/modulos";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { anularOrdenDeCompra, cerrarOrdenDeCompra, configurarControlDeExceso, crearOrdenDeCompra, listarOrdenesParaElegir, pedirOrdenDeCompra } from "../../src/server/actions/movimientos/ordenes-de-compra";
import { requierePermisoDeEmpresa } from "../../src/server/acceso/gate";

/**
 * Compras, orden de compra (etapa OC) — PERMISOS EN EL SERVIDOR con las Server Actions REALES y Postgres real. Crear, pedir, anular y cerrar piden `orden_de_compra_gestionar` y configurar el control pide `compras_configurar` (módulo `ordenes_de_compra`,
 * empresa, piso administrador): el OPERADOR es rechazado aunque la matriz le dé la fila (el piso manda sobre la matriz); el administrador y el gerente alcanzan; con el módulo apagado se rechaza por módulo para todos. Ver las órdenes
 * (`orden_de_compra_ver`, piso operario) las alcanza el operador. El recorrido de todas las combinaciones de la puerta está en `test/core/combinaciones-compras-orden.test.ts`.
 *
 * Mutaciones (comprobadas a mano al escribirlo): `orden_de_compra_gestionar` con piso operario → rojo «el OPERADOR es rechazado»; con `modulo: "compras"` → rojo «módulo APAGADO».
 */
const E = EMPRESA_POR_DEFECTO_ID;
type U = { id: string; email: string };
let s3: string;
let admin: U, gerente: U, operador: U;
let harina: string, proveedorId: string;

const como = async (u: U) => {
  __setCookieDeTestParaSucursal(s3);
  await mockearUsuarioActual({ id: u.id, email: u.email, nombre: null });
};
const datos = () => ({ proveedorId, lineas: [{ productoId: harina, cantidad: 10, precio: 100 }], claveIdempotencia: randomUUID() });
const ordenes = () => prisma.ordenDeCompra.count();
async function ordenPedidaPorAdmin(): Promise<string> {
  await como(admin);
  const c = await crearOrdenDeCompra(datos());
  expect(c.ok, c.mensaje).toBe(true);
  const id = (await prisma.ordenDeCompra.findFirstOrThrow({ orderBy: { creadoEn: "desc" } })).id;
  expect((await pedirOrdenDeCompra(id)).ok).toBe(true);
  return id;
}

beforeEach(async () => {
  __setCookieDeTestParaSucursal(undefined);
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  s3 = base.sucursal.id;
  admin = { id: (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: s3, rolId: base.admin.id })).id, email: "admin@test.com" };
  const g = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: s3, rolId: base.admin.id });
  await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: g.id, empresaId: E } }, data: { rolEmpresa: "gerente" } });
  gerente = { id: g.id, email: "gerente@test.com" };
  operador = { id: (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: s3, rolId: base.operador.id })).id, email: "operador@test.com" };
  // La semilla del código la da la migración o el alta de la empresa; en la base de pruebas se asegura la fila de cada rol. El operador recibe TAMBIÉN las de gestionar y configurar: el piso manda sobre la matriz.
  for (const accionClave of ["orden_de_compra_gestionar", "compras_configurar", "orden_de_compra_ver"]) {
    for (const rolId of [base.admin.id, base.operador.id]) await prisma.permisoRol.upsert({ where: { rolId_accionClave: { rolId, accionClave } }, update: { puedeVer: true, puedeEditar: true }, create: { rolId, accionClave, puedeVer: true, puedeEditar: true } });
  }
  const { kg, insumo } = await sembrarCatalogoBase();
  harina = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } })).id;
  proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
  await fijarModulosActivos(E, [...MODULOS_VENDIBLES, "ordenes_de_compra"]);
});

describe("órdenes de compra: permisos en el servidor", () => {
  it("el OPERADOR es rechazado en TODAS las acciones de gestión (crear, pedir, anular, cerrar) y de configuración, aunque la matriz le dé la fila", async () => {
    const id = await ordenPedidaPorAdmin();
    await como(operador);
    const gate = await requierePermisoDeEmpresa(operador.id, E, "orden_de_compra_gestionar", prisma);
    expect(gate.ok).toBe(false);
    const antes = await ordenes();

    const rs = [await crearOrdenDeCompra(datos()), await pedirOrdenDeCompra(id), await anularOrdenDeCompra(id, "Quiero anularla"), await cerrarOrdenDeCompra(id), await configurarControlDeExceso("BLOQUEAR")];

    for (const r of rs) expect(r.ok).toBe(false);
    expect(rs[0]).toEqual({ ok: false, mensaje: gate.ok ? "" : gate.mensaje });
    expect(await ordenes()).toBe(antes);
    expect((await prisma.ordenDeCompra.findUniqueOrThrow({ where: { id } })).estado).toBe("PEDIDA");
    expect(await prisma.nivelDeControl.count()).toBe(0);
  });

  it.each([["administrador"], ["gerente"]] as const)("el %s crea, pide, cierra y configura el control", async (rol) => {
    await como(rol === "gerente" ? gerente : admin);

    expect((await crearOrdenDeCompra(datos())).ok).toBe(true);
    const id = (await prisma.ordenDeCompra.findFirstOrThrow()).id;
    expect(await pedirOrdenDeCompra(id)).toMatchObject({ ok: true });
    expect(await configurarControlDeExceso("AVISAR")).toMatchObject({ ok: true });
    expect(await cerrarOrdenDeCompra(id)).toMatchObject({ ok: true });
    expect((await prisma.ordenDeCompra.findUniqueOrThrow({ where: { id } })).estado).toBe("CERRADA");
    expect((await prisma.ordenDeCompra.findUniqueOrThrow({ where: { id } })).creadoPorId).toBe(rol === "gerente" ? gerente.id : admin.id);
  });

  it("el administrador anula con motivo", async () => {
    await como(admin);
    await crearOrdenDeCompra(datos());
    const id = (await prisma.ordenDeCompra.findFirstOrThrow()).id;
    expect(await anularOrdenDeCompra(id, "Ya no hace falta")).toMatchObject({ ok: true });
    expect((await prisma.ordenDeCompra.findUniqueOrThrow({ where: { id } })).estado).toBe("ANULADA");
  });

  it("con el módulo ordenes_de_compra APAGADO se rechaza por módulo para todos (administrador y gerente también), sin tocar nada", async () => {
    await fijarModulosActivos(E, [...MODULOS_VENDIBLES, "recepcion_de_compras"]);
    for (const u of [admin, gerente, operador]) {
      await como(u);
      const gate = await requierePermisoDeEmpresa(u.id, E, "orden_de_compra_gestionar", prisma);
      const r = await crearOrdenDeCompra(datos());
      expect(gate).toMatchObject({ ok: false, motivo: "MODULO_NO_ACTIVO", modulo: "ordenes_de_compra" });
      expect(r).toEqual({ ok: false, mensaje: gate.ok ? "" : gate.mensaje });
      expect(await configurarControlDeExceso("AVISAR")).toMatchObject({ ok: false });
    }
    expect(await ordenes()).toBe(0);
    expect(await prisma.nivelDeControl.count()).toBe(0);
  });

  it("ver las órdenes pedidas para elegir una al cargar una compra lo alcanza el operador (piso operario, solo lectura) y no devuelve precios", async () => {
    const id = await ordenPedidaPorAdmin();
    await como(operador);

    const lista = await listarOrdenesParaElegir(proveedorId);

    expect(lista.map((o) => o.id)).toEqual([id]);
    expect(JSON.stringify(lista)).not.toContain("precio");
  });

  it("formato: el guard rechaza antes de tocar la base (sin proveedor, sin líneas, motivo vacío, nivel fuera de la lista)", async () => {
    await como(admin);
    expect(await crearOrdenDeCompra({ ...datos(), proveedorId: "" })).toMatchObject({ ok: false });
    expect(await crearOrdenDeCompra({ ...datos(), lineas: [] })).toMatchObject({ ok: false });
    expect(await crearOrdenDeCompra({ ...datos(), claveIdempotencia: "no-es-uuid" })).toMatchObject({ ok: false });
    expect(await ordenes()).toBe(0);
    const id = await ordenPedidaPorAdmin();
    expect(await anularOrdenDeCompra(id, "")).toMatchObject({ ok: false });
    expect(await pedirOrdenDeCompra("")).toMatchObject({ ok: false });
    expect(await configurarControlDeExceso("TAL_VEZ")).toMatchObject({ ok: false });
    expect((await prisma.ordenDeCompra.findUniqueOrThrow({ where: { id } })).estado).toBe("PEDIDA");
  });
});
