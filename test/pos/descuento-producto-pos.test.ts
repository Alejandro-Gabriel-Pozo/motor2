import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { entrarComo, sembrarSalon } from "./salon-fixture";
import { abrirCuenta, asignarClienteACuenta } from "../../src/server/actions/pos/cuenta-apertura";
import { agregarItems, enviarACocina } from "../../src/server/actions/pos/cuenta-pedido";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { guardarDescuentoProducto } from "../../src/server/actions/carta/descuento-producto";
import { altaCliente } from "../../src/server/actions/clientes/cliente";
import { resolverPrecioVenta } from "../../src/core/movimientos/precio-venta";
import { obtenerDetalleDeMesa } from "../../src/server/consultas/pos/detalle-de-mesa";
import { obtenerTicketsRecientes } from "../../src/server/consultas/pos/tickets";
import { cargarSelectorCartaPos } from "../../src/server/lecturas/pos/selector-carta";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";

/**
 * Producto con descuento en el POS (Fase 2), contra Postgres real y con las acciones reales: al AGREGAR el ítem se congela el precio descontado (y
 * el de lista en `precioCartaUnitario`); al CERRAR rige SOLO EL MAYOR entre el descuento del producto y el del cliente. `precioListaUnitario` del
 * movimiento sigue significando «descuento de CLIENTE» (solo se escribe cuando gana ese).
 */
describe("producto con descuento en el POS", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
  });

  const abrir = async () => {
    expect((await abrirCuenta(s.mesa.id, 2)).ok).toBe(true);
    return prisma.cuenta.findFirstOrThrow({ where: { mesaId: s.mesa.id, cerradaEn: null } });
  };
  const itemsDe = (cuentaId: string) => prisma.cuentaItem.findMany({ where: { cuentaId }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
  const enviarTodo = async (cuentaId: string) => {
    const ids = (await itemsDe(cuentaId)).filter((i) => i.numeroEnvio === null).map((i) => i.id);
    expect((await enviarACocina(cuentaId, ids)).ok).toBe(true);
  };
  const crearCliente = async (nombre: string, pct: number) => {
    const r = await altaCliente(nombre, pct);
    if (!r.ok) throw new Error(r.mensaje);
    return r.id;
  };
  const ventaDe = () => prisma.movimientoStock.findMany({ where: { proceso: "VENTA", productoId: s.flan.id } });

  it("agregar: congela el precio descontado y guarda el de lista; un producto sin descuento no guarda lista", async () => {
    expect((await guardarDescuentoProducto(s.flan.id, 15)).ok).toBe(true);
    const cuenta = await abrir();
    expect((await agregarItems(cuenta.id, [{ productoId: s.flan.id, cantidad: 2 }, { productoId: s.milanesa.id, cantidad: 1 }])).ok).toBe(true);

    const items = await itemsDe(cuenta.id);
    const flan = items.find((i) => i.productoId === s.flan.id)!;
    expect(Number(flan.precioUnitario)).toBe(2550); // 3000 × 0,85
    expect(Number(flan.precioCartaUnitario)).toBe(3000);
    const milanesa = items.find((i) => i.productoId === s.milanesa.id)!;
    expect(Number(milanesa.precioUnitario)).toBe(9000);
    expect(milanesa.precioCartaUnitario).toBeNull();
  });

  it("agregar usa el precio LOCAL vigente como base del descuento", async () => {
    await prisma.precioLocalProducto.create({ data: { productoId: s.flan.id, sucursalId: s.sucursalId, precio: 4000, habilitado: true } });
    await guardarDescuentoProducto(s.flan.id, 10);
    const cuenta = await abrir();
    await agregarItems(cuenta.id, [{ productoId: s.flan.id, cantidad: 1 }]);
    const [flan] = await itemsDe(cuenta.id);
    const lista = await resolverPrecioVenta(s.sucursalId, s.flan.id, 3000, prisma);
    expect(Number(flan.precioCartaUnitario)).toBe(lista);
    expect(Number(flan.precioUnitario)).toBe(Math.round(lista * 90) / 100);
  });

  it("el selector de carta del POS muestra el precio descontado y el de lista tachado", async () => {
    await guardarDescuentoProducto(s.flan.id, 15);
    const selector = await cargarSelectorCartaPos(s.sucursalId, prisma, AHORA_DE_LA_CORRIDA);
    const productos = [
      ...selector.fueraDeCarta,
      ...selector.seccionesCarta.flatMap((sec) => sec.entradas.flatMap((e) => (e.tipo === "producto" ? [e.producto] : []))),
    ];
    const flan = productos.find((p) => p.productoId === s.flan.id)!;
    expect(flan.precio).toBe(2550);
    expect(flan.precioLista).toBe(3000);
  });

  it("cerrar: sin cliente se cobra el precio descontado y precioListaUnitario queda null (no es descuento de cliente)", async () => {
    await guardarDescuentoProducto(s.flan.id, 15);
    const cuenta = await abrir();
    await agregarItems(cuenta.id, [{ productoId: s.flan.id, cantidad: 2 }]);
    await enviarTodo(cuenta.id);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);

    const [mov] = await ventaDe();
    expect(Number(mov.precioTotal)).toBe(5100); // 2 × 2550
    expect(mov.precioListaUnitario).toBeNull();
    const [item] = await itemsDe(cuenta.id);
    expect(item.operacionId).toBe(mov.operacionId);
    expect(Number(item.precioCartaUnitario)).toBe(3000);
  });

  it("solo el MAYOR: cliente 20 % contra producto 15 % → gana el cliente, sobre la lista (no en cascada)", async () => {
    await guardarDescuentoProducto(s.flan.id, 15);
    const cuenta = await abrir();
    await asignarClienteACuenta(cuenta.id, await crearCliente("Fulano", 20));
    await agregarItems(cuenta.id, [{ productoId: s.flan.id, cantidad: 1 }]);
    await enviarTodo(cuenta.id);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);

    const [mov] = await ventaDe();
    expect(Number(mov.precioTotal)).toBe(2400); // 3000 × 0,80 — NO 2040 (cascada)
    expect(Number(mov.precioListaUnitario)).toBe(3000);
  });

  it("solo el MAYOR: cliente 10 % contra producto 15 % → gana el producto y el cliente no suma", async () => {
    await guardarDescuentoProducto(s.flan.id, 15);
    const cuenta = await abrir();
    await asignarClienteACuenta(cuenta.id, await crearCliente("Mengano", 10));
    await agregarItems(cuenta.id, [{ productoId: s.flan.id, cantidad: 1 }]);
    await enviarTodo(cuenta.id);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);

    const [mov] = await ventaDe();
    expect(Number(mov.precioTotal)).toBe(2550);
    expect(mov.precioListaUnitario).toBeNull();
  });

  it("un producto SIN descuento con un cliente con descuento sigue como siempre (Task #14)", async () => {
    const cuenta = await abrir();
    await asignarClienteACuenta(cuenta.id, await crearCliente("Zutano", 20));
    await agregarItems(cuenta.id, [{ productoId: s.flan.id, cantidad: 1 }]);
    await enviarTodo(cuenta.id);
    await cerrarCuenta(cuenta.id);
    const [mov] = await ventaDe();
    expect(Number(mov.precioTotal)).toBe(2400);
    expect(Number(mov.precioListaUnitario)).toBe(3000);
    expect((await itemsDe(cuenta.id))[0].precioCartaUnitario).toBeNull();
  });

  it("el total EN PANTALLA antes de cerrar ya refleja solo el mayor (producto 15 % contra cliente 10 % y 20 %)", async () => {
    await guardarDescuentoProducto(s.flan.id, 15);
    const cuenta = await abrir();
    await agregarItems(cuenta.id, [{ productoId: s.flan.id, cantidad: 2 }]);
    await enviarTodo(cuenta.id);
    expect((await obtenerDetalleDeMesa(s.sucursalId, s.mesa.id, prisma, new Date()))?.cuenta?.total).toBe(5100);

    await asignarClienteACuenta(cuenta.id, await crearCliente("Menor", 10));
    expect((await obtenerDetalleDeMesa(s.sucursalId, s.mesa.id, prisma, new Date()))?.cuenta?.total).toBe(5100);

    await asignarClienteACuenta(cuenta.id, await crearCliente("Mayor", 20));
    expect((await obtenerDetalleDeMesa(s.sucursalId, s.mesa.id, prisma, new Date()))?.cuenta?.total).toBe(4800);
  });

  it("el ticket muestra el precio cobrado y el de lista tachado cuando rige el descuento del producto, con y sin cliente", async () => {
    await guardarDescuentoProducto(s.flan.id, 15);
    const cuenta = await abrir();
    await agregarItems(cuenta.id, [{ productoId: s.flan.id, cantidad: 2 }]);
    await enviarTodo(cuenta.id);
    await cerrarCuenta(cuenta.id);
    const [ticket] = await obtenerTicketsRecientes(s.sucursalId, s.mesa.id, prisma, undefined, new Date());
    expect(ticket.lineas).toEqual([{ producto: "Flan", cantidad: 2, precioUnitario: 2550, precioListaUnitario: 3000, subtotal: 5100 }]);
    expect(ticket.total).toBe(5100);
  });

  it("el ticket con un cliente de MAYOR descuento muestra su precio (sobre la lista) y el de lista tachado", async () => {
    await guardarDescuentoProducto(s.flan.id, 15);
    const cuenta = await abrir();
    await asignarClienteACuenta(cuenta.id, await crearCliente("Mayor", 20));
    await agregarItems(cuenta.id, [{ productoId: s.flan.id, cantidad: 1 }]);
    await enviarTodo(cuenta.id);
    await cerrarCuenta(cuenta.id);
    const [ticket] = await obtenerTicketsRecientes(s.sucursalId, s.mesa.id, prisma, undefined, new Date());
    expect(ticket.lineas).toEqual([{ producto: "Flan", cantidad: 1, precioUnitario: 2400, precioListaUnitario: 3000, subtotal: 2400 }]);
    expect(ticket.total).toBe(2400);
  });

  it("el precio queda CONGELADO: si el descuento cambia o se saca después de pedir, la cuenta cobra el de cuando se pidió", async () => {
    await guardarDescuentoProducto(s.flan.id, 15);
    const cuenta = await abrir();
    await agregarItems(cuenta.id, [{ productoId: s.flan.id, cantidad: 1 }]);
    await guardarDescuentoProducto(s.flan.id, null);
    await enviarTodo(cuenta.id);
    await cerrarCuenta(cuenta.id);
    const [mov] = await ventaDe();
    expect(Number(mov.precioTotal)).toBe(2550);
  });

  it("pedir el mismo producto antes y después de un cambio de descuento: dos líneas con su precio cada una (la lista es parte de la clave)", async () => {
    await guardarDescuentoProducto(s.flan.id, 15);
    const cuenta = await abrir();
    await agregarItems(cuenta.id, [{ productoId: s.flan.id, cantidad: 1 }]);
    await guardarDescuentoProducto(s.flan.id, null);
    await agregarItems(cuenta.id, [{ productoId: s.flan.id, cantidad: 1 }]);
    await enviarTodo(cuenta.id);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
    const movs = await ventaDe();
    expect(movs.map((m) => Number(m.precioTotal)).sort((a, b) => a - b)).toEqual([2550, 3000]);
  });
});
