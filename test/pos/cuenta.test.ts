import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import {
  agruparPorEnvio,
  lineasDeVenta,
  obtenerDetalleDeMesa,
  restanteDe,
  validarCantidadPedido,
  validarComensales,
  validarMotivoAnulacion,
} from "../../src/core/pos/cuenta";

/** Núcleo de la cuenta de una mesa (src/core/pos/cuenta.ts): funciones puras y la consulta del detalle. */

describe("restanteDe (lo que queda de un ítem = cantidad + Σ espejos)", () => {
  it("sin anulaciones queda todo; con espejos parciales, la resta; con la anulación total, cero", () => {
    expect(restanteDe({ cantidad: 3 }, [])).toBe(3);
    expect(restanteDe({ cantidad: 3 }, [{ cantidad: -1 }])).toBe(2);
    expect(restanteDe({ cantidad: 3 }, [{ cantidad: -1 }, { cantidad: -2 }])).toBe(0);
  });

  it("no arrastra error de coma flotante", () => {
    expect(restanteDe({ cantidad: 0.3 }, [{ cantidad: -0.1 }, { cantidad: -0.1 }])).toBe(0.1);
  });
});

describe("lineasDeVenta (neto por producto + precio congelado)", () => {
  it("suma originales y espejos del mismo producto y precio", () => {
    expect(
      lineasDeVenta([
        { productoId: "a", cantidad: 2, precioUnitario: 100 },
        { productoId: "a", cantidad: 1, precioUnitario: 100 },
        { productoId: "a", cantidad: -1, precioUnitario: 100 },
      ])
    ).toEqual([{ productoId: "a", precioUnitario: 100, cantidad: 2 }]);
  });

  it("el mismo producto a precios distintos queda en líneas separadas, en orden de aparición", () => {
    expect(
      lineasDeVenta([
        { productoId: "a", cantidad: 1, precioUnitario: 100 },
        { productoId: "b", cantidad: 1, precioUnitario: 50 },
        { productoId: "a", cantidad: 2, precioUnitario: 120 },
      ])
    ).toEqual([
      { productoId: "a", precioUnitario: 100, cantidad: 1 },
      { productoId: "b", precioUnitario: 50, cantidad: 1 },
      { productoId: "a", precioUnitario: 120, cantidad: 2 },
    ]);
  });

  it("una línea anulada entera (neto 0) no se vende; sin nada, ninguna línea", () => {
    expect(
      lineasDeVenta([
        { productoId: "a", cantidad: 2, precioUnitario: 100 },
        { productoId: "a", cantidad: -2, precioUnitario: 100 },
        { productoId: "b", cantidad: 1, precioUnitario: 50 },
      ])
    ).toEqual([{ productoId: "b", precioUnitario: 50, cantidad: 1 }]);
    expect(lineasDeVenta([])).toEqual([]);
  });

  it("Task #16: un suelto y un componente de promo del MISMO producto al MISMO precio quedan en líneas separadas (D4)", () => {
    expect(
      lineasDeVenta([
        { productoId: "a", cantidad: 1, precioUnitario: 100 },
        { productoId: "a", cantidad: 1, precioUnitario: 100, promoCuentaId: "promo-1" },
      ])
    ).toEqual([
      { productoId: "a", precioUnitario: 100, cantidad: 1 },
      { productoId: "a", precioUnitario: 100, cantidad: 1, promoCuentaId: "promo-1" },
    ]);
  });

  it("Task #16: componentes de DOS promos distintas, mismo producto y precio, no se mezclan entre sí", () => {
    expect(
      lineasDeVenta([
        { productoId: "a", cantidad: 1, precioUnitario: 100, promoCuentaId: "promo-1" },
        { productoId: "a", cantidad: 1, precioUnitario: 100, promoCuentaId: "promo-2" },
      ])
    ).toEqual([
      { productoId: "a", precioUnitario: 100, cantidad: 1, promoCuentaId: "promo-1" },
      { productoId: "a", precioUnitario: 100, cantidad: 1, promoCuentaId: "promo-2" },
    ]);
  });

  it("Task #16: originales y espejos de un MISMO componente de promo se suman igual que un suelto", () => {
    expect(
      lineasDeVenta([
        { productoId: "a", cantidad: 2, precioUnitario: 100, promoCuentaId: "promo-1" },
        { productoId: "a", cantidad: -1, precioUnitario: 100, promoCuentaId: "promo-1" },
      ])
    ).toEqual([{ productoId: "a", precioUnitario: 100, cantidad: 1, promoCuentaId: "promo-1" }]);
  });

  it("Task #16: `promoCuentaId` null o ausente es EXACTAMENTE lo mismo — sin la clave en la salida", () => {
    const conNull = lineasDeVenta([{ productoId: "a", cantidad: 1, precioUnitario: 100, promoCuentaId: null }]);
    const sinCampo = lineasDeVenta([{ productoId: "a", cantidad: 1, precioUnitario: 100 }]);
    expect(conNull).toEqual(sinCampo);
    expect(conNull[0]).not.toHaveProperty("promoCuentaId");
  });
});

describe("agruparPorEnvio", () => {
  const item = (id: string, cantidad: number, numeroEnvio: number | null, anulaAItemId: string | null = null) => ({ id, cantidad, numeroEnvio, anulaAItemId });

  it("separa los sin enviar, agrupa por envío en orden y cuelga cada anulación de su original", () => {
    const { sinEnviar, envios } = agruparPorEnvio([
      item("x", 1, 2),
      item("a", 3, 1),
      item("b", 1, 1),
      item("n", 2, null),
      item("a-1", -1, 1, "a"),
      item("a-2", -1, 1, "a"),
    ]);
    expect(sinEnviar.map((i) => i.id)).toEqual(["n"]);
    expect(envios.map((e) => e.numero)).toEqual([1, 2]);
    expect(envios[0].items.map((i) => [i.id, i.restante, i.anulaciones.map((a) => a.id)])).toEqual([
      ["a", 1, ["a-1", "a-2"]],
      ["b", 1, []],
    ]);
    expect(envios[1].items.map((i) => [i.id, i.restante])).toEqual([["x", 1]]);
  });

  it("sin ítems: nada sin enviar y ningún envío", () => {
    expect(agruparPorEnvio([])).toEqual({ sinEnviar: [], envios: [] });
  });
});

describe("validarCantidadPedido", () => {
  it("acepta un número positivo y lo redondea a los decimales de la unidad", () => {
    expect(validarCantidadPedido(2, 0)).toEqual({ ok: true, cantidad: 2 });
    expect(validarCantidadPedido(1.256, 2)).toEqual({ ok: true, cantidad: 1.26 });
    expect(validarCantidadPedido(999, 0)).toEqual({ ok: true, cantidad: 999 });
  });

  it("rechaza cero, negativos, no números, infinitos, más de 999 y lo que el redondeo deja en cero", () => {
    for (const valor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "2", null, undefined, 1000, 0.4]) {
      expect(validarCantidadPedido(valor, 0).ok, String(valor)).toBe(false);
    }
    expect(validarCantidadPedido(1000, 0)).toEqual({ ok: false, mensaje: "La cantidad no puede superar 999." });
  });

  describe("con pasoVenta (Task #25, docs/plan-venta-fraccionada-2026-09-26.md)", () => {
    it("sin tercer parámetro, o con pasoVenta null/undefined, el comportamiento es IDÉNTICO al de siempre (redondea)", () => {
      expect(validarCantidadPedido(0.5, 0, null)).toEqual(validarCantidadPedido(0.5, 0));
      expect(validarCantidadPedido(1.256, 2, { pasoVenta: null, tieneStockReal: false })).toEqual(validarCantidadPedido(1.256, 2));
      expect(validarCantidadPedido(0.2, 0, { pasoVenta: undefined, tieneStockReal: true })).toEqual(validarCantidadPedido(0.2, 0));
    });

    it("un múltiplo exacto del paso se acepta TAL CUAL, sin redondear a los decimales de la unidad (sin stock real)", () => {
      expect(validarCantidadPedido(0.5, 0, { pasoVenta: 0.5, tieneStockReal: false })).toEqual({ ok: true, cantidad: 0.5 });
      expect(validarCantidadPedido(1, 0, { pasoVenta: 0.5, tieneStockReal: false })).toEqual({ ok: true, cantidad: 1 });
      expect(validarCantidadPedido(0.25, 0, { pasoVenta: 0.25, tieneStockReal: false })).toEqual({ ok: true, cantidad: 0.25 });
    });

    it("lo que NO es múltiplo exacto se RECHAZA, nunca se redondea en silencio", () => {
      const r = validarCantidadPedido(0.3, 0, { pasoVenta: 0.5, tieneStockReal: false });
      expect(r).toEqual({ ok: false, mensaje: "Se vende de a 0,5: la cantidad tiene que ser un múltiplo exacto." });
    });

    it("con stock real, redondea a los decimales de la unidad (no-op: R3 ya garantiza que el paso entra)", () => {
      expect(validarCantidadPedido(0.5, 1, { pasoVenta: 0.5, tieneStockReal: true })).toEqual({ ok: true, cantidad: 0.5 });
    });

    it("sigue rechazando lo de siempre (cero, negativo, más de 999) aunque tenga paso", () => {
      for (const valor of [0, -1, Number.NaN, 1000]) {
        expect(validarCantidadPedido(valor, 0, { pasoVenta: 0.5, tieneStockReal: false }).ok, String(valor)).toBe(false);
      }
    });
  });
});

describe("validarComensales (docs/plan-comensales-y-limite-mesas-2026-09-26.md: obligatorio, sin default)", () => {
  it("acepta enteros de 1 a 99", () => {
    expect(validarComensales(1)).toEqual({ ok: true, comensales: 1 });
    expect(validarComensales(4)).toEqual({ ok: true, comensales: 4 });
    expect(validarComensales(99)).toEqual({ ok: true, comensales: 99 });
  });

  it("rechaza cero, negativos, decimales, NaN, más de 99 y no-números", () => {
    for (const valor of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 100, "2", null, undefined, [], {}]) {
      expect(validarComensales(valor).ok, `comensales ${JSON.stringify(valor)}`).toBe(false);
    }
    expect(validarComensales(100)).toEqual({ ok: false, mensaje: "La cantidad de comensales tiene que ser un número entero entre 1 y 99." });
  });
});

describe("validarMotivoAnulacion", () => {
  it("obligatorio: vacío o solo espacios se rechaza", () => {
    expect(validarMotivoAnulacion("")).toEqual({ ok: false, mensaje: "Escribí el motivo de la anulación." });
    expect(validarMotivoAnulacion("   ")).toMatchObject({ ok: false });
    expect(validarMotivoAnulacion(undefined)).toMatchObject({ ok: false });
  });

  it("recorta espacios y acepta hasta 200 caracteres", () => {
    expect(validarMotivoAnulacion("  Salió frío  ")).toEqual({ ok: true, motivo: "Salió frío" });
    expect(validarMotivoAnulacion("a".repeat(200))).toMatchObject({ ok: true });
    expect(validarMotivoAnulacion("a".repeat(201))).toEqual({ ok: false, mensaje: "El motivo no puede superar los 200 caracteres." });
  });
});

describe("obtenerDetalleDeMesa (consulta real)", () => {
  const ahora = new Date("2026-09-25T20:00:00Z");
  let sucursalId: string;
  let otraSucursalId: string;
  let mozoId: string;
  let milanesaId: string;
  let flanId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    sucursalId = (await prisma.sucursal.create({ data: { nombre: "Central" } })).id;
    otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    mozoId = (await prisma.user.create({ data: { email: "rocio@test.com", name: "Rocío" } })).id;
    const unidad = await prisma.unidad.create({ data: { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 } });
    milanesaId = (await prisma.producto.create({ data: { codigo: "PV_1", nombre: "Milanesa", tipo: "PV", unidadStockId: unidad.id, precioVenta: 9000 } })).id;
    flanId = (await prisma.producto.create({ data: { codigo: "PV_2", nombre: "Flan", tipo: "PV", unidadStockId: unidad.id, precioVenta: 3000 } })).id;
  });

  it("una mesa de otra sucursal (o inexistente) → null", async () => {
    const ajena = await prisma.mesa.create({ data: { sucursalId: otraSucursalId, numero: 1 } });
    expect(await obtenerDetalleDeMesa(sucursalId, ajena.id, prisma, ahora)).toBeNull();
    expect(await obtenerDetalleDeMesa(sucursalId, "no-existe", prisma, ahora)).toBeNull();
    expect(await obtenerDetalleDeMesa(otraSucursalId, ajena.id, prisma, ahora)).toEqual({ mesa: { id: ajena.id, numero: 1 }, cuenta: null });
  });

  it("mesa libre: sin cuenta (las cerradas no cuentan)", async () => {
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 4 } });
    await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: mozoId, cerradaEn: ahora, items: { create: [{ productoId: flanId, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }] } } });
    expect(await obtenerDetalleDeMesa(sucursalId, mesa.id, prisma, ahora)).toEqual({ mesa: { id: mesa.id, numero: 4 }, cuenta: null });
  });

  it("cuenta abierta: sin enviar, envíos con restante y anulaciones (parcial y total), total neto, mozo y tiempo", async () => {
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 4 } });
    const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: mozoId, abiertaEn: new Date(ahora.getTime() - 20 * 60_000) } });
    const t = (min: number) => new Date(ahora.getTime() - min * 60_000);
    const mila = await prisma.cuentaItem.create({ data: { cuentaId: cuenta.id, productoId: milanesaId, cantidad: 3, precioUnitario: 9000, numeroEnvio: 1, creadoPorId: mozoId, creadoEn: t(19) } });
    const flan = await prisma.cuentaItem.create({ data: { cuentaId: cuenta.id, productoId: flanId, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1, creadoEn: t(18) } });
    // Misma milanesa, segunda ronda, a otro precio (cambió el Precio Local): línea aparte.
    await prisma.cuentaItem.create({ data: { cuentaId: cuenta.id, productoId: milanesaId, cantidad: 1, precioUnitario: 9500, numeroEnvio: 2, creadoEn: t(10) } });
    await prisma.cuentaItem.create({ data: { cuentaId: cuenta.id, productoId: flanId, cantidad: 2, precioUnitario: 3000, creadoEn: t(2) } });
    await prisma.cuentaItem.create({
      data: { cuentaId: cuenta.id, productoId: milanesaId, cantidad: -1, precioUnitario: 9000, numeroEnvio: 1, anulaAItemId: mila.id, motivoAnulacion: "Pidió sin papas", creadoPorId: mozoId, creadoEn: t(5) },
    });
    await prisma.cuentaItem.create({
      data: { cuentaId: cuenta.id, productoId: flanId, cantidad: -1, precioUnitario: 3000, numeroEnvio: 1, anulaAItemId: flan.id, motivoAnulacion: "Se cayó", creadoEn: t(4) },
    });

    const detalle = await obtenerDetalleDeMesa(sucursalId, mesa.id, prisma, ahora);
    expect(detalle?.mesa).toEqual({ id: mesa.id, numero: 4 });
    const c = detalle!.cuenta!;
    expect(c).toMatchObject({ id: cuenta.id, mesero: "Rocío", tiempoAbierta: "hace 20 min", itemsTotales: 6 });
    // 3×9000 − 9000 + 3000 − 3000 + 9500 + 2×3000 = 33.500
    expect(c.total).toBe(33500);
    expect(c.sinEnviar.map((i) => [i.productoNombre, i.cantidad])).toEqual([["Flan", 2]]);
    expect(c.envios.map((e) => e.numero)).toEqual([1, 2]);
    expect(c.envios[0].items.map((i) => [i.productoNombre, i.cantidad, i.restante, i.creadoPor])).toEqual([
      ["Milanesa", 3, 2, "Rocío"],
      ["Flan", 1, 0, null],
    ]);
    expect(c.envios[0].items[0].anulaciones.map((a) => [a.cantidad, a.motivoAnulacion, a.creadoPor])).toEqual([[-1, "Pidió sin papas", "Rocío"]]);
    expect(c.envios[1].items.map((i) => [i.productoNombre, i.precioUnitario, i.restante])).toEqual([["Milanesa", 9500, 1]]);
  });

  it("el total en vivo ya coincide centavo a centavo con lo que registraría un cierre (Σ importeDeLinea, no la suma cruda redondeada)", async () => {
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 4 } });
    const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: mozoId } });
    // 0,3 × 1234,55 = 370,365 → 370,37 y 0,5 × 1234,57 = 617,285 → 617,29: por línea suman 987,66; la suma cruda redondeada da 987,65
    // (mismo caso que test/pos/boleta.test.ts y test/pos/cerrar-cuenta-action.test.ts — el detalle de mesa tiene que coincidir con eso).
    await prisma.cuentaItem.create({ data: { cuentaId: cuenta.id, productoId: milanesaId, cantidad: 0.3, precioUnitario: 1234.55, numeroEnvio: 1 } });
    await prisma.cuentaItem.create({ data: { cuentaId: cuenta.id, productoId: flanId, cantidad: 0.5, precioUnitario: 1234.57, numeroEnvio: 1 } });

    const detalle = await obtenerDetalleDeMesa(sucursalId, mesa.id, prisma, ahora);
    expect(detalle!.cuenta!.total).toBe(987.66);
  });

  it("aislamiento: la misma consulta desde otra sucursal no ve la cuenta de esta", async () => {
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 1 } });
    await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: mozoId, items: { create: [{ productoId: flanId, cantidad: 1, precioUnitario: 3000 }] } } });
    expect(await obtenerDetalleDeMesa(otraSucursalId, mesa.id, prisma, ahora)).toBeNull();
    expect((await obtenerDetalleDeMesa(sucursalId, mesa.id, prisma, ahora))?.cuenta?.itemsTotales).toBe(1);
  });
});
