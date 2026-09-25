import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { calcularMetricas, filtrarMesas, obtenerMapaDeMesas, resolverEstadoMesa, tiempoDesde, type MesaEnMapa } from "../../src/core/pos/mesas";

/** Núcleo del mapa de mesas (src/core/pos/mesas.ts): derivación del estado, métricas, tiempos, filtros y la consulta real. */

describe("resolverEstadoMesa (el estado se deriva de la cuenta abierta, no se persiste)", () => {
  it("sin cuenta abierta → libre", () => {
    expect(resolverEstadoMesa(null)).toBe("libre");
    expect(resolverEstadoMesa(undefined)).toBe("libre");
  });

  it("cuenta abierta sin ítems → en_pedido (se abrió y todavía no se cargó nada)", () => {
    expect(resolverEstadoMesa({ items: [] })).toBe("en_pedido");
  });

  it("con ítems sin enviar y ninguno enviado → en_pedido", () => {
    expect(resolverEstadoMesa({ items: [{ numeroEnvio: null }, { numeroEnvio: null }] })).toBe("en_pedido");
  });

  it("todo enviado (uno o más envíos) → ocupada", () => {
    expect(resolverEstadoMesa({ items: [{ numeroEnvio: 1 }] })).toBe("ocupada");
    expect(resolverEstadoMesa({ items: [{ numeroEnvio: 1 }, { numeroEnvio: 2 }] })).toBe("ocupada");
  });

  it("segunda ronda en una mesa ocupada (enviados + uno nuevo sin enviar) → vuelve a en_pedido", () => {
    expect(resolverEstadoMesa({ items: [{ numeroEnvio: 1 }, { numeroEnvio: null }] })).toBe("en_pedido");
  });
});

describe("calcularMetricas", () => {
  it("cuenta el total y cada estado", () => {
    const estados = ["libre", "libre", "en_pedido", "ocupada", "ocupada", "ocupada"] as const;
    expect(calcularMetricas(estados.map((estado) => ({ estado })))).toEqual({ total: 6, libres: 2, enPedido: 1, ocupadas: 3 });
  });

  it("sin mesas, todo en cero", () => {
    expect(calcularMetricas([])).toEqual({ total: 0, libres: 0, enPedido: 0, ocupadas: 0 });
  });
});

describe("tiempoDesde (solo informativo: no hay vencimiento automático)", () => {
  const ahora = new Date("2026-09-24T20:00:00Z");
  const hace = (ms: number) => new Date(ahora.getTime() - ms);

  it("menos de un minuto (o un reloj apenas adelantado) → «hace instantes»", () => {
    expect(tiempoDesde(hace(30_000), ahora)).toBe("hace instantes");
    expect(tiempoDesde(hace(-5_000), ahora)).toBe("hace instantes");
  });

  it("minutos y horas", () => {
    expect(tiempoDesde(hace(60_000), ahora)).toBe("hace 1 min");
    expect(tiempoDesde(hace(42 * 60_000 + 59_000), ahora)).toBe("hace 42 min");
    expect(tiempoDesde(hace(60 * 60_000), ahora)).toBe("hace 1 h");
    expect(tiempoDesde(hace(125 * 60_000), ahora)).toBe("hace 2 h 5 min");
  });

  it("una cuenta abierta hace días sigue mostrando el tiempo, sin vencer", () => {
    expect(tiempoDesde(hace(3 * 24 * 60 * 60_000), ahora)).toBe("hace 72 h");
  });
});

describe("filtrarMesas", () => {
  const mesa = (numero: number, estado: MesaEnMapa["estado"], mesero: string | null = null) => ({ numero, estado, mesero });
  const mesas = [mesa(1, "libre"), mesa(3, "en_pedido", "Rocío"), mesa(10, "ocupada", "Julián"), mesa(21, "ocupada", "rocío b")];

  it("sin filtros devuelve todas, en el mismo orden", () => {
    expect(filtrarMesas(mesas, {}).map((m) => m.numero)).toEqual([1, 3, 10, 21]);
  });

  it("por estado; un estado desconocido no filtra", () => {
    expect(filtrarMesas(mesas, { estado: "ocupada" }).map((m) => m.numero)).toEqual([10, 21]);
    expect(filtrarMesas(mesas, { estado: "cualquiera" }).map((m) => m.numero)).toEqual([1, 3, 10, 21]);
  });

  it("por número: los dígitos de la búsqueda, con o sin ceros a la izquierda o la palabra «mesa»", () => {
    expect(filtrarMesas(mesas, { q: "1" }).map((m) => m.numero)).toEqual([1, 10, 21]);
    expect(filtrarMesas(mesas, { q: "03" }).map((m) => m.numero)).toEqual([3]);
    expect(filtrarMesas(mesas, { q: "mesa 10" }).map((m) => m.numero)).toEqual([10]);
  });

  it("por quien abrió la cuenta (sin distinguir mayúsculas), combinable con el estado", () => {
    expect(filtrarMesas(mesas, { q: "ROCÍO" }).map((m) => m.numero)).toEqual([3, 21]);
    expect(filtrarMesas(mesas, { q: "rocío", estado: "ocupada" }).map((m) => m.numero)).toEqual([21]);
    expect(filtrarMesas(mesas, { q: "nadie" })).toEqual([]);
  });

  it("una búsqueda en blanco no filtra", () => {
    expect(filtrarMesas(mesas, { q: "   " })).toHaveLength(4);
  });
});

describe("obtenerMapaDeMesas (contra la base)", () => {
  const ahora = new Date("2026-09-24T20:00:00Z");
  let sucursalId: string;
  let otraSucursalId: string;
  let mozoId: string;
  let sinNombreId: string;
  let productoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    sucursalId = (await prisma.sucursal.create({ data: { nombre: "Central" } })).id;
    otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    mozoId = (await prisma.user.create({ data: { email: "rocio@test.com", name: "Rocío" } })).id;
    sinNombreId = (await prisma.user.create({ data: { email: "julian.perez@test.com" } })).id;
    const kg = await prisma.unidad.create({ data: { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 } });
    productoId = (await prisma.producto.create({ data: { codigo: "PV_1", nombre: "Milanesa", tipo: "PV", unidadStockId: kg.id, precioVenta: 9000 } })).id;
  });

  it("sin mesas: vacío, métricas en cero y el siguiente número es 1", async () => {
    expect(await obtenerMapaDeMesas(sucursalId, prisma, ahora)).toEqual({ mesas: [], metricas: { total: 0, libres: 0, enPedido: 0, ocupadas: 0 }, siguienteNumero: 1 });
  });

  it("solo las mesas de la sucursal pedida, ordenadas por número; el siguiente es el mayor + 1", async () => {
    for (const numero of [12, 3, 7]) await prisma.mesa.create({ data: { sucursalId, numero } });
    await prisma.mesa.create({ data: { sucursalId: otraSucursalId, numero: 99 } });

    const mapa = await obtenerMapaDeMesas(sucursalId, prisma, ahora);
    expect(mapa.mesas.map((m) => m.numero)).toEqual([3, 7, 12]);
    expect(mapa.mesas.every((m) => m.estado === "libre" && m.total === 0 && m.mesero === null && m.tiempoAbierta === null)).toBe(true);
    expect(mapa.siguienteNumero).toBe(13);
    expect((await obtenerMapaDeMesas(otraSucursalId, prisma, ahora)).mesas.map((m) => m.numero)).toEqual([99]);
  });

  it("en pedido: productos sin enviar (suma de cantidades), total, mozo y tiempo", async () => {
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 1 } });
    await prisma.cuenta.create({
      data: {
        mesaId: mesa.id,
        abiertaPorId: mozoId,
        abiertaEn: new Date(ahora.getTime() - 15 * 60_000),
        items: {
          create: [
            { productoId, cantidad: 2, precioUnitario: 9000 },
            { productoId, cantidad: 1.5, precioUnitario: 1000.1 },
          ],
        },
      },
    });

    const [m] = (await obtenerMapaDeMesas(sucursalId, prisma, ahora)).mesas;
    expect(m).toMatchObject({ numero: 1, estado: "en_pedido", productosSinEnviar: 3.5, total: 19500.15, mesero: "Rocío", tiempoAbierta: "hace 15 min", pedidosEnviados: 0 });
  });

  it("ocupada: pedidos enviados = envíos distintos (1 y 2); un mozo sin nombre se muestra por la parte local del email", async () => {
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 4 } });
    await prisma.cuenta.create({
      data: {
        mesaId: mesa.id,
        abiertaPorId: sinNombreId,
        abiertaEn: new Date(ahora.getTime() - 42 * 60_000),
        items: {
          create: [
            { productoId, cantidad: 2, precioUnitario: 15000, numeroEnvio: 1 },
            { productoId, cantidad: 1, precioUnitario: 900, numeroEnvio: 1 },
            { productoId, cantidad: 1, precioUnitario: 11000, numeroEnvio: 2 },
          ],
        },
      },
    });

    const mapa = await obtenerMapaDeMesas(sucursalId, prisma, ahora);
    expect(mapa.mesas[0]).toMatchObject({ estado: "ocupada", productosSinEnviar: 0, total: 41900, mesero: "julian.perez", tiempoAbierta: "hace 42 min", pedidosEnviados: 2 });
    expect(mapa.metricas).toEqual({ total: 1, libres: 0, enPedido: 0, ocupadas: 1 });
  });

  it("una cuenta cerrada no cuenta: la mesa se ve libre; la abierta nueva es la que manda", async () => {
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 2 } });
    await prisma.cuenta.create({
      data: { mesaId: mesa.id, abiertaPorId: mozoId, cerradaEn: ahora, items: { create: [{ productoId, cantidad: 3, precioUnitario: 9000, numeroEnvio: 1 }] } },
    });
    expect((await obtenerMapaDeMesas(sucursalId, prisma, ahora)).mesas[0]).toMatchObject({ estado: "libre", total: 0, pedidosEnviados: 0, mesero: null });

    await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: sinNombreId, abiertaEn: ahora } });
    expect((await obtenerMapaDeMesas(sucursalId, prisma, ahora)).mesas[0]).toMatchObject({ estado: "en_pedido", total: 0, mesero: "julian.perez", tiempoAbierta: "hace instantes" });
  });

  it("segunda ronda: una mesa con envíos y un ítem nuevo sin enviar vuelve a en_pedido, y las métricas lo reflejan", async () => {
    const [a, b] = await Promise.all([prisma.mesa.create({ data: { sucursalId, numero: 1 } }), prisma.mesa.create({ data: { sucursalId, numero: 2 } })]);
    await prisma.cuenta.create({
      data: {
        mesaId: a.id,
        abiertaPorId: mozoId,
        items: {
          create: [
            { productoId, cantidad: 1, precioUnitario: 100, numeroEnvio: 1 },
            { productoId, cantidad: 1, precioUnitario: 100 },
          ],
        },
      },
    });
    const mapa = await obtenerMapaDeMesas(sucursalId, prisma, ahora);
    expect(mapa.mesas.map((m) => [m.numero, m.estado])).toEqual([
      [a.numero, "en_pedido"],
      [b.numero, "libre"],
    ]);
    expect(mapa.mesas[0]).toMatchObject({ productosSinEnviar: 1, pedidosEnviados: 1, total: 200 });
    expect(mapa.metricas).toEqual({ total: 2, libres: 1, enPedido: 1, ocupadas: 0 });
  });
});
