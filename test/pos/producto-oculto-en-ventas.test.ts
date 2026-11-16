import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import { baseDeTest, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { agregarItems } from "../../src/server/actions/pos/cuenta-pedido";
import { cerrarCuentaCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/cerrar-cuenta";
import { registrarVentaCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-venta";
import { cargarSelectorCartaPos } from "../../src/server/lecturas/pos/selector-carta";
import { productoOcultoEn } from "../../src/server/lecturas/catalogo/ocultamiento";
import { MENSAJE_PRODUCTO_OCULTO } from "../../src/core/catalogo/public";

/**
 * «Ocultar» como Pedernal, etapa (c1) (docs/diseno-ocultar-como-pedernal-2026-11-15.md, I-6, R-1 a R-5; Pedernal `producto-oculto-en-ventas.test.ts`, `salon-oculto.test.ts`): un producto oculto en el local o en toda la
 * empresa no sale en el selector del POS, no admite una línea NUEVA (salón, cuenta de mostrador ni venta directa; «Este producto está oculto.», sin dejar nada), pero lo YA cargado se cobra al cerrar la cuenta;
 * mostrar de nuevo reabre; ocultar en un local no toca a otro; el desactivado gana sobre el oculto (decisión técnica 7). Postgres real con la RLS real (`motor2_app`).
 */
describe("Ocultar: ventas (salón, mostrador, selector)", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let otraSucursalId: string;
  const baseDe = (...sucursales: string[]) => baseDeTest({ lectura: sucursales, escritura: sucursales });

  /** Una marca de ocultar escrita por el dueño (el caso de uso de ocultar ya está probado aparte): del local, o de la empresa si `sucursalId` es null. */
  const ocultar = (productoId: string, sucursalId: string | null, oculto = true) =>
    prismaAdmin.ocultamientoProducto.create({ data: { id: randomUUID(), productoId, sucursalId, oculto, actualizadoPorId: s.admin.id, actualizadoEn: AHORA_DE_LA_CORRIDA } });
  const actorDeCierre = () => ({ usuarioId: s.admin.id, sucursalId: s.sucursalId, sucursalNombre: s.sucursal.nombre, email: "admin@test.com", ahora: new Date(), ...baseDe(s.sucursalId) });
  const items = (cuentaId: string) => prisma.cuentaItem.findMany({ where: { cuentaId } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    await entrarComo(s.admin);
  });

  it("agregar una línea NUEVA de un producto oculto en el local se rechaza con el texto aprobado y no deja nada; mostrar de nuevo reabre", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
    await ocultar(s.milanesa.id, s.sucursalId);
    expect(await agregarItems(cuenta.id, [{ productoId: s.milanesa.id, cantidad: 1 }], [])).toEqual({ ok: false, mensaje: MENSAJE_PRODUCTO_OCULTO });
    expect(await items(cuenta.id)).toHaveLength(0);
    expect((await agregarItems(cuenta.id, [{ productoId: s.flan.id, cantidad: 1 }], [])).ok, "otro producto sigue igual").toBe(true);
    await prismaAdmin.ocultamientoProducto.updateMany({ where: { productoId: s.milanesa.id }, data: { oculto: false } });
    expect((await agregarItems(cuenta.id, [{ productoId: s.milanesa.id, cantidad: 1 }], [])).ok).toBe(true);
  });

  it("oculto en TODA la empresa (marca sin sucursal) también se rechaza; ocultar en OTRO local no afecta a este", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
    await ocultar(s.milanesa.id, otraSucursalId);
    expect((await agregarItems(cuenta.id, [{ productoId: s.milanesa.id, cantidad: 1 }], [])).ok, "oculto solo en Norte").toBe(true);
    await ocultar(s.flan.id, null);
    expect(await agregarItems(cuenta.id, [{ productoId: s.flan.id, cantidad: 1 }], [])).toEqual({ ok: false, mensaje: MENSAJE_PRODUCTO_OCULTO });
  });

  it("un lote con un oculto se rechaza ENTERO (todo o nada): ni el otro producto se agrega", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
    await ocultar(s.flan.id, s.sucursalId);
    const r = await agregarItems(cuenta.id, [{ productoId: s.milanesa.id, cantidad: 1 }, { productoId: s.flan.id, cantidad: 1 }], []);
    expect(r.ok).toBe(false);
    expect(await items(cuenta.id)).toHaveLength(0);
  });

  it("lo YA cargado se cobra: ocultar después de agregar no impide cerrar la cuenta, y la existencia resta", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.milanesa.id, cantidad: 2, precioUnitario: 9000, numeroEnvio: 1 }]);
    await ocultar(s.milanesa.id, s.sucursalId);
    const r = await cerrarCuentaCasoDeUso(actorDeCierre(), { cuentaId: cuenta.id });
    expect(r).toMatchObject({ ok: true, datos: { desenlace: "CON_VENTA" } });
  });

  it("la venta DIRECTA de mostrador (línea nueva) de un oculto se rechaza sin dejar nada; con otro producto, igual que siempre", async () => {
    const seccionId = s.seccion.id;
    const datos = (productoId: string) => ({ fecha: AHORA_DE_LA_CORRIDA, seccionId, nroFactura: "F-1", ventas: [{ productoId, cantidadVendida: 1 }] });
    const actor = { usuarioId: s.admin.id, sucursalId: s.sucursalId, sucursalNombre: s.sucursal.nombre, ...baseDe(s.sucursalId) };
    await ocultar(s.milanesa.id, s.sucursalId);
    const antes = await prisma.operacion.count();
    expect(await registrarVentaCasoDeUso(actor, datos(s.milanesa.id))).toMatchObject({ ok: false, mensaje: MENSAJE_PRODUCTO_OCULTO });
    expect(await prisma.operacion.count(), "no escribió nada").toBe(antes);
    const otro = await registrarVentaCasoDeUso(actor, datos(s.flan.id));
    expect(otro.ok, otro.mensaje).toBe(true);
  });

  it("el selector del POS no ofrece un oculto (local o empresa) y sí lo ofrece al volver a mostrar; el selector de otro local no cambia", async () => {
    const ofrecidos = async (sucursalId: string) => {
      const sel = await cargarSelectorCartaPos(sucursalId, baseDe(sucursalId).db, AHORA_DE_LA_CORRIDA);
      return [...sel.fueraDeCarta.map((p) => p.productoId), ...sel.seccionesCarta.flatMap((x) => x.entradas.flatMap((e) => (e.tipo === "producto" ? [e.producto.productoId] : [])))];
    };
    const inicial = await ofrecidos(s.sucursalId);
    expect(inicial).toContain(s.milanesa.id);
    await ocultar(s.milanesa.id, s.sucursalId);
    await ocultar(s.flan.id, null);
    const oculto = await ofrecidos(s.sucursalId);
    expect(oculto).not.toContain(s.milanesa.id);
    expect(oculto).not.toContain(s.flan.id);
    expect(oculto).toContain(s.pizza.id);
    await prismaAdmin.ocultamientoProducto.deleteMany({ where: { productoId: s.milanesa.id } });
    expect(await ofrecidos(s.sucursalId), "al volver a mostrar reaparece").toContain(s.milanesa.id);
  });

  it("el desactivado gana sobre el oculto: un producto desactivado Y oculto dice «no está disponible», no «oculto»", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
    await prisma.disponibilidadProducto.updateMany({ where: { productoId: s.milanesa.id }, data: { disponible: false } });
    await ocultar(s.milanesa.id, s.sucursalId);
    const r = await agregarItems(cuenta.id, [{ productoId: s.milanesa.id, cantidad: 1 }], []);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/no está disponible/);
  });

  it("productoOcultoEn: sin marca = visible; la marca del local y la de la empresa ocultan; una marca en false no; la RLS acota por sucursal", async () => {
    expect(await productoOcultoEn(s.sucursalId, s.milanesa.id, baseDe(s.sucursalId).db)).toBe(false);
    await ocultar(s.milanesa.id, s.sucursalId, false);
    expect(await productoOcultoEn(s.sucursalId, s.milanesa.id, baseDe(s.sucursalId).db)).toBe(false);
    await ocultar(s.flan.id, otraSucursalId);
    expect(await productoOcultoEn(s.sucursalId, s.flan.id, baseDe(s.sucursalId).db), "la marca de OTRO local no cuenta").toBe(false);
    await ocultar(s.pizza.id, null);
    expect(await productoOcultoEn(s.sucursalId, s.pizza.id, baseDe(s.sucursalId).db), "la de la empresa sí").toBe(true);
    expect(await productoOcultoEn(otraSucursalId, s.pizza.id, baseDe(otraSucursalId).db), "y un local nuevo la hereda").toBe(true);
  });
});
