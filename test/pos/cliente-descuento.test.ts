import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma, sembrarProductoDisponible } from "../setup/test-db";
import { crearMozo, crearUsuarioConRol, entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { asignarClienteACuenta } from "../../src/server/actions/pos/cuenta-apertura";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { obtenerDetalleDeMesa } from "../../src/core/pos/cuenta";
import { obtenerBoletasRecientes } from "../../src/core/pos/boleta";
import { altaCliente, actualizarActivoCliente } from "../../src/server/actions/clientes/cliente";

/**
 * Cliente con descuento (Task #14, docs/plan-clientes-descuento-2026-09-26.md): `asignarClienteACuenta` (D3, cualquier mozo) y su
 * efecto en `cerrarCuenta` (precio COBRADO con descuento, `precioListaUnitario` cuando difiere, `Operacion.clienteId`) — mismo
 * molde que cerrar-cuenta-action.test.ts.
 */
describe("Cliente con descuento", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
  });

  const crearCliente = async (nombre: string, pct: number) => {
    const r = await altaCliente(nombre, pct);
    if (!r.ok) throw new Error(r.mensaje);
    return r.id;
  };

  describe("asignarClienteACuenta", () => {
    it("asigna el cliente y congela su % en la cuenta (snapshot, D7)", async () => {
      const clienteId = await crearCliente("Fulano", 15);
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, []);

      const r = await asignarClienteACuenta(cuenta.id, clienteId);
      expect(r).toEqual({ ok: true, mensaje: "«Fulano» asignado a la mesa 4, con 15% de descuento." });

      const actualizada = await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } });
      expect(actualizada.clienteId).toBe(clienteId);
      expect(Number(actualizada.descuentoPorcentaje)).toBe(15);
    });

    it("cambiar el % del cliente DESPUÉS de asignarlo no afecta a una cuenta ya asignada (snapshot congelado)", async () => {
      const clienteId = await crearCliente("Fulano", 15);
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, []);
      await asignarClienteACuenta(cuenta.id, clienteId);

      await prisma.cliente.update({ where: { id: clienteId }, data: { descuentoPorcentaje: 50 } });

      const actualizada = await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } });
      expect(Number(actualizada.descuentoPorcentaje)).toBe(15);
    });

    it("quitar el cliente (null) limpia clienteId y descuentoPorcentaje", async () => {
      const clienteId = await crearCliente("Fulano", 15);
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, []);
      await asignarClienteACuenta(cuenta.id, clienteId);

      const r = await asignarClienteACuenta(cuenta.id, null);
      expect(r).toEqual({ ok: true, mensaje: "Se quitó el cliente de la mesa 4." });
      const actualizada = await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } });
      expect(actualizada.clienteId).toBeNull();
      expect(actualizada.descuentoPorcentaje).toBeNull();
    });

    it("reasignar (otro cliente, u otra vez el mismo) actualiza el snapshot", async () => {
      const uno = await crearCliente("Uno", 10);
      const dos = await crearCliente("Dos", 20);
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, []);
      await asignarClienteACuenta(cuenta.id, uno);
      await asignarClienteACuenta(cuenta.id, dos);

      const actualizada = await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } });
      expect(actualizada.clienteId).toBe(dos);
      expect(Number(actualizada.descuentoPorcentaje)).toBe(20);
    });

    it("rechaza un cliente inexistente o desactivado; no toca la cuenta", async () => {
      const clienteId = await crearCliente("Fulano", 15);
      await actualizarActivoCliente(clienteId, false);
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, []);

      expect(await asignarClienteACuenta(cuenta.id, clienteId)).toEqual({ ok: false, mensaje: "«Fulano» está desactivado: no se puede asignar a una cuenta." });
      expect(await asignarClienteACuenta(cuenta.id, "no-existe")).toEqual({ ok: false, mensaje: "No se encontró ese cliente." });
      expect((await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } })).clienteId).toBeNull();
    });

    it("una cuenta ya cerrada, o de otra sucursal, no se puede tocar", async () => {
      const clienteId = await crearCliente("Fulano", 15);
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
      expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
      expect(await asignarClienteACuenta(cuenta.id, clienteId)).toEqual({ ok: false, mensaje: "La cuenta de la mesa 4 ya está cerrada." });

      const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
      const mesaNorte = await prisma.mesa.create({ data: { sucursalId: norte.id, numero: 1 } });
      const ajena = await sembrarCuenta(mesaNorte.id, s.admin.id, []);
      expect(await asignarClienteACuenta(ajena.id, clienteId)).toEqual({ ok: false, mensaje: "No se encontró esa cuenta en esta sucursal." });
    });

    it("D3: el mozo (pos_tomar_pedido) puede asignar — no hace falta ser admin", async () => {
      const clienteId = await crearCliente("Fulano", 15);
      const mozo = await crearMozo(s.sucursalId);
      const cuenta = await sembrarCuenta(s.mesa.id, mozo.id, []);
      await entrarComo(mozo);
      expect((await asignarClienteACuenta(cuenta.id, clienteId)).ok).toBe(true);
    });

    it("sin pos_asignar_cliente no se puede asignar", async () => {
      const clienteId = await crearCliente("Fulano", 15);
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, []);
      const soloTomaPedido = await crearUsuarioConRol(s.sucursalId, "sin-asignar", [{ clave: "pos_tomar_pedido", ver: true, editar: true }]);
      await entrarComo(soloTomaPedido);
      const r = await asignarClienteACuenta(cuenta.id, clienteId);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain('"pos_asignar_cliente"');
    });
  });

  describe("cerrarCuenta con cliente asignado", () => {
    const ventaDeLaMesa = () => prisma.operacion.findFirst({ where: { proceso: "VENTA", detalleLibre: "Mesa 4" }, include: { movimientos: true } });

    it("cobra con el % de descuento: precioPorUnidadStock/precioTotal COBRADOS, precioListaUnitario con lo de LISTA, Operacion.clienteId", async () => {
      const clienteId = await crearCliente("Fulano", 15);
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.milanesa.id, cantidad: 2, precioUnitario: 1000, numeroEnvio: 1 }]);
      await asignarClienteACuenta(cuenta.id, clienteId);

      const r = await cerrarCuenta(cuenta.id);
      expect(r.ok).toBe(true);
      expect(r.mensaje).toContain("con 15% de descuento a «Fulano»");
      const MONEDA = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 });
      expect(r.mensaje).toContain(MONEDA.format(1700)); // 2 × 1000 × 0,85 = 1700

      const venta = await ventaDeLaMesa();
      expect(venta?.clienteId).toBe(clienteId);
      const linea = venta!.movimientos.find((m) => m.proceso === "VENTA")!;
      expect([Number(linea.precioPorUnidadStock), Number(linea.precioTotal), linea.precioListaUnitario === null ? null : Number(linea.precioListaUnitario)]).toEqual([850, 1700, 1000]);

      // CuentaItem sigue enlazado por precio de LISTA (su precioUnitario NUNCA cambia de semántica) y apunta a esta Operacion.
      const item = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId: cuenta.id } });
      expect(Number(item.precioUnitario)).toBe(1000);
      expect(item.operacionId).toBe(venta!.id);
    });

    it("0% de descuento: cobra el precio de lista tal cual, sin precioListaUnitario (no se guarda redundante)", async () => {
      const clienteId = await crearCliente("Fulano", 0);
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
      await asignarClienteACuenta(cuenta.id, clienteId);

      expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
      const venta = await ventaDeLaMesa();
      const linea = venta!.movimientos.find((m) => m.proceso === "VENTA")!;
      expect(Number(linea.precioTotal)).toBe(3000);
      expect(linea.precioListaUnitario).toBeNull();
      expect(venta?.clienteId).toBe(clienteId);
    });

    it("sin cliente asignado: Operacion.clienteId null y precioListaUnitario null, como siempre", async () => {
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
      expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
      const venta = await ventaDeLaMesa();
      expect(venta?.clienteId).toBeNull();
      expect(venta!.movimientos.find((m) => m.proceso === "VENTA")!.precioListaUnitario).toBeNull();
    });

    it("el total EN PANTALLA (obtenerDetalleDeMesa), antes de cerrar, ya refleja el descuento", async () => {
      const clienteId = await crearCliente("Fulano", 15);
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.milanesa.id, cantidad: 2, precioUnitario: 1000, numeroEnvio: 1 }]);
      await asignarClienteACuenta(cuenta.id, clienteId);

      const detalle = await obtenerDetalleDeMesa(s.sucursalId, s.mesa.id);
      expect(detalle?.cuenta?.total).toBe(1700);
      expect(detalle?.cuenta?.cliente).toBe("Fulano");
      expect(detalle?.cuenta?.descuentoPorcentaje).toBe(15);
    });

    it("la boleta muestra el precio COBRADO, el de lista tachado (precioListaUnitario) y el cliente con su %", async () => {
      const clienteId = await crearCliente("Fulano", 15);
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.milanesa.id, cantidad: 2, precioUnitario: 1000, numeroEnvio: 1 }]);
      await asignarClienteACuenta(cuenta.id, clienteId);
      expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);

      const [boleta] = await obtenerBoletasRecientes(s.sucursalId, s.mesa.id);
      expect(boleta.cliente).toEqual({ nombre: "Fulano", descuentoPorcentaje: 15 });
      expect(boleta.lineas).toEqual([{ producto: "Milanesa", cantidad: 2, precioUnitario: 850, precioListaUnitario: 1000, subtotal: 1700 }]);
      expect(boleta.total).toBe(1700);
    });

    it("piso de 0,01 (Task #14): un % altísimo nunca deja una venta en $0", async () => {
      const clienteId = await crearCliente("Fulano", 99.99);
      const barato = await sembrarProductoDisponible({ codigo: "PV_BARATO", nombre: "Café", tipo: "PV", unidadStockId: s.unidad.id, precioVenta: 1 }, s.sucursalId);
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: barato.id, cantidad: 1, precioUnitario: 1, numeroEnvio: 1 }]);
      await asignarClienteACuenta(cuenta.id, clienteId);

      expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
      const venta = await ventaDeLaMesa();
      const linea = venta!.movimientos.find((m) => m.proceso === "VENTA")!;
      expect(Number(linea.precioPorUnidadStock)).toBe(0.01);
      expect(Number(linea.precioTotal)).toBe(0.01);
    });
  });
});
