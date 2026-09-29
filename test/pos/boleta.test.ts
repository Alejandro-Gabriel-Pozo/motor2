import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { liberarMesa } from "../../src/server/actions/pos/cuenta-apertura";
import { anularItemEnviado } from "../../src/server/actions/pos/cuenta-anulacion";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { anularVenta } from "../../src/server/actions/movimientos/venta";
import { BOLETAS_RECIENTES_POR_MESA, armarBoleta, armarBoletaImpresaEn, obtenerBoletasRecientes } from "../../src/core/pos/boleta";

/**
 * Boleta de cierre (src/core/pos/boleta.ts, docs/plan-imprimir-comanda-y-boleta-2026-09-25.md B5/B8): derivada de la cuenta cerrada con
 * las acciones reales, contra Postgres. Sus líneas y su total son exactamente la venta que registró `cerrarCuenta`.
 */
describe("obtenerBoletasRecientes", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
  });

  const MONEDA = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 });

  /** Una cuenta enviada a cocina y cerrada con venta en la mesa 4. */
  async function cerrarUna(cantidad: number) {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad, precioUnitario: 3000, numeroEnvio: 1 }]);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
    return cuenta;
  }

  it("con anulación parcial y el mismo producto a dos precios: las líneas son las Operaciones VENTA registradas y el total el del cierre", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
      { productoId: s.milanesa.id, cantidad: 3, precioUnitario: 9000, numeroEnvio: 1 },
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 },
      { productoId: s.milanesa.id, cantidad: 1, precioUnitario: 9500, numeroEnvio: 2 },
    ]);
    const [mila, flan] = cuenta.items;
    expect((await anularItemEnviado(mila.id, 1, "Una menos", 3)).ok).toBe(true);
    expect((await anularItemEnviado(flan.id, 1, "No quiso postre", 1)).ok).toBe(true);

    const cierre = await cerrarCuenta(cuenta.id);
    expect(cierre.ok).toBe(true);

    const [boleta, ...otras] = await obtenerBoletasRecientes(s.sucursalId, s.mesa.id, prisma);
    expect(otras).toEqual([]);
    expect(boleta).toMatchObject({ cuentaId: cuenta.id, mesero: "admin", total: 27500, ventaAnulada: false });
    expect(boleta.lineas).toEqual([
      { producto: "Milanesa", cantidad: 2, precioUnitario: 9000, subtotal: 18000 },
      { producto: "Milanesa", cantidad: 1, precioUnitario: 9500, subtotal: 9500 },
    ]);
    // El flan anulado entero no se vendió: no aparece.
    expect(boleta.lineas.some((l) => l.producto === "Flan")).toBe(false);

    const vendidas = await prisma.movimientoStock.findMany({ where: { proceso: "VENTA", operacion: { detalleLibre: "Mesa 4" } } });
    expect(vendidas.map((m) => [-Number(m.cantidad), Number(m.precioPorUnidadStock), Number(m.precioTotal)]).sort()).toEqual(
      boleta.lineas.map((l) => [l.cantidad, l.precioUnitario, l.subtotal]).sort()
    );
    expect(cierre.mensaje).toContain(MONEDA.format(boleta.total));
    const cerrada = await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } });
    expect(boleta.cerradaEn).toEqual(cerrada.cerradaEn);
  });

  it("una cuenta liberada sin ítems y una cerrada sin venta (todo anulado) no tienen boleta", async () => {
    const vacia = await sembrarCuenta(s.mesa.id, s.admin.id);
    expect((await liberarMesa(vacia.id)).ok).toBe(true);
    const anulada = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    expect((await anularItemEnviado(anulada.items[0].id, 1, "Se fue", 1)).ok).toBe(true);
    expect(await cerrarCuenta(anulada.id)).toEqual({ ok: true, mensaje: "Cuenta de la mesa 4 cerrada sin venta: no quedó nada por cobrar." });

    expect(await obtenerBoletasRecientes(s.sucursalId, s.mesa.id, prisma)).toEqual([]);
  });

  it(`como mucho ${BOLETAS_RECIENTES_POR_MESA}, de la más nueva a la más vieja`, async () => {
    const cuentas = [];
    for (const cantidad of [1, 2, 3, 4]) cuentas.push(await cerrarUna(cantidad));

    const boletas = await obtenerBoletasRecientes(s.sucursalId, s.mesa.id, prisma);
    expect(boletas.map((b) => b.cuentaId)).toEqual([cuentas[3].id, cuentas[2].id, cuentas[1].id]);
    expect(boletas.map((b) => b.total)).toEqual([12000, 9000, 6000]);
    expect(boletas.every((b, i) => i === 0 || b.cerradaEn <= boletas[i - 1].cerradaEn)).toBe(true);
  });

  it("aislada por sucursal: la misma mesa pedida desde otra sucursal no da nada", async () => {
    await cerrarUna(1);
    const otra = await prisma.sucursal.create({ data: { nombre: "Otra" } });
    expect(await obtenerBoletasRecientes(otra.id, s.mesa.id, prisma)).toEqual([]);
    expect(await obtenerBoletasRecientes(s.sucursalId, s.mesa.id, prisma)).toHaveLength(1);
  });

  it("cada boleta trae su número: el ejemplar A que emitió cerrarCuenta (docs/plan-numeracion-boleta-2026-09-25.md, paso 4)", async () => {
    const primera = await cerrarUna(1);
    const segunda = await cerrarUna(2);

    const boletas = await obtenerBoletasRecientes(s.sucursalId, s.mesa.id, prisma);
    expect(boletas.map((b) => [b.cuentaId, b.numero])).toEqual([
      [segunda.id, { numero: 2, ejemplar: 1 }],
      [primera.id, { numero: 1, ejemplar: 1 }],
    ]);
    const enLaBase = await prisma.ejemplarBoleta.findUniqueOrThrow({ where: { cuentaId_ejemplar: { cuentaId: segunda.id, ejemplar: 1 } } });
    expect(boletas[0].numero).toEqual({ numero: enLaBase.numero, ejemplar: enLaBase.ejemplar });
  });

  it("una cuenta cerrada antes de la numeración (sin ningún ejemplar) da `numero: null`", async () => {
    const venta = await prisma.operacion.create({ data: { sucursalId: s.sucursalId, proceso: "VENTA", fecha: new Date(), usuarioId: s.admin.id, detalleLibre: "Mesa 4" } });
    const vieja = await prisma.cuenta.create({
      data: {
        mesaId: s.mesa.id,
        abiertaPorId: s.admin.id,
        cerradaEn: new Date(),
        cerradaPorId: s.admin.id,
        items: { create: [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1, operacionId: venta.id }] },
      },
    });

    const [boleta] = await obtenerBoletasRecientes(s.sucursalId, s.mesa.id, prisma);
    expect(boleta).toMatchObject({ cuentaId: vieja.id, numero: null, total: 3000 });
  });

  it("después de anular la venta (anularVenta), la boleta queda marcada como de venta anulada", async () => {
    const cuenta = await cerrarUna(2);
    const item = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId: cuenta.id } });
    expect((await anularVenta(item.operacionId!)).ok).toBe(true);

    const [boleta] = await obtenerBoletasRecientes(s.sucursalId, s.mesa.id, prisma);
    expect(boleta).toMatchObject({ cuentaId: cuenta.id, ventaAnulada: true });
  });
});

/** Precisión de montos (plan 2026-09-25, Paso 5): 0,3 kg × $1.234,55 = 370,365 exacto; en float 370.36499999999995 redondeaba a 370,36. */
describe("armarBoleta — importes exactos", () => {
  it("una línea de 0,3 kg × $1.234,55: subtotal y total 370,37", () => {
    const boleta = armarBoleta([{ productoId: "p1", productoNombre: "Jamón crudo por kg", cantidad: 0.3, precioUnitario: 1234.55 }]);
    expect.soft(boleta.lineas).toEqual([{ producto: "Jamón crudo por kg", cantidad: 0.3, precioUnitario: 1234.55, subtotal: 370.37 }]);
    expect.soft(boleta.total).toBe(370.37);
  });

  it("dos líneas fraccionarias en medio centavo: el total es la suma de los subtotales, lo mismo que se registra (Paso 6)", () => {
    // 0,3 × 1234,55 = 370,365 → 370,37 y 0,5 × 1234,57 = 617,285 → 617,29. Redondear la suma cruda (987,65) no coincide con las
    // líneas VENTA que registra cerrarCuenta (370,37 + 617,29 = 987,66).
    const boleta = armarBoleta([
      { productoId: "p1", productoNombre: "Jamón crudo por kg", cantidad: 0.3, precioUnitario: 1234.55 },
      { productoId: "p2", productoNombre: "Queso por kg", cantidad: 0.5, precioUnitario: 1234.57 },
    ]);
    expect(boleta.lineas.map((l) => l.subtotal)).toEqual([370.37, 617.29]);
    expect(boleta.total).toBe(987.66);
  });
});

/** Task #16 (promo-combo, docs/plan-promo-combo-2026-09-26.md, paso 2.6/3): agrupación de los componentes de una promo bajo una
 *  cabecera, sin cambiar el total. */
describe("armarBoleta — Task #16, promos armables", () => {
  it("sin ningún ítem con `promo`, la salida es EXACTAMENTE la de siempre (sin la clave `promoCuentaId` en ninguna línea)", () => {
    const items = [
      { productoId: "p1", productoNombre: "Milanesa", cantidad: 1, precioUnitario: 9000 },
      { productoId: "p2", productoNombre: "Flan", cantidad: 1, precioUnitario: 3000 },
    ];
    const conPromoAusente = armarBoleta(items);
    for (const l of conPromoAusente.lineas) {
      expect(l).not.toHaveProperty("promoCuentaId");
      expect(l).not.toHaveProperty("indentado");
    }
  });

  it("agrupa los componentes de la MISMA promoCuentaId bajo una cabecera con el título y el total cobrado", () => {
    const boleta = armarBoleta([
      { productoId: "empanada", productoNombre: "Empanada de carne", cantidad: 2, precioUnitario: 500, promo: { promoCuentaId: "promo-1", titulo: "Menú del día" } },
      { productoId: "milanesa", productoNombre: "Milanesa", cantidad: 1, precioUnitario: 1000, promo: { promoCuentaId: "promo-1", titulo: "Menú del día" } },
    ]);
    expect(boleta.lineas).toEqual([
      { producto: "Menú del día", cantidad: 1, precioUnitario: 2000, subtotal: 2000, promoCuentaId: "promo-1" },
      { producto: "Empanada de carne", cantidad: 2, precioUnitario: 500, subtotal: 1000, promoCuentaId: "promo-1", indentado: true },
      { producto: "Milanesa", cantidad: 1, precioUnitario: 1000, subtotal: 1000, promoCuentaId: "promo-1", indentado: true },
    ]);
    // El total NO cambia por agrupar: sigue siendo la suma de los componentes netos, no de las cabeceras (que ya son esa suma).
    expect(boleta.total).toBe(2000);
  });

  it("una promo y un suelto en la misma boleta: el suelto queda tal cual, sin sangría ni cabecera", () => {
    const boleta = armarBoleta([
      { productoId: "empanada", productoNombre: "Empanada de carne", cantidad: 1, precioUnitario: 500, promo: { promoCuentaId: "promo-1", titulo: "Menú del día" } },
      { productoId: "gaseosa", productoNombre: "Gaseosa", cantidad: 1, precioUnitario: 800 },
    ]);
    expect(boleta.lineas).toEqual([
      { producto: "Menú del día", cantidad: 1, precioUnitario: 500, subtotal: 500, promoCuentaId: "promo-1" },
      { producto: "Empanada de carne", cantidad: 1, precioUnitario: 500, subtotal: 500, promoCuentaId: "promo-1", indentado: true },
      { producto: "Gaseosa", cantidad: 1, precioUnitario: 800, subtotal: 800 },
    ]);
    expect(boleta.total).toBe(1300);
  });

  it("dos instancias de la MISMA promo en la cuenta (dos menús con elecciones distintas): cada una su propia cabecera", () => {
    const boleta = armarBoleta([
      { productoId: "empanada", productoNombre: "Empanada de carne", cantidad: 1, precioUnitario: 500, promo: { promoCuentaId: "promo-1", titulo: "Menú del día" } },
      { productoId: "flan", productoNombre: "Flan", cantidad: 1, precioUnitario: 1500, promo: { promoCuentaId: "promo-2", titulo: "Menú del día" } },
    ]);
    expect(boleta.lineas.filter((l) => l.producto === "Menú del día")).toHaveLength(2);
    expect(boleta.total).toBe(2000);
  });

  it("un suelto y un componente de promo del MISMO producto al MISMO precio no se mezclan (D4)", () => {
    const boleta = armarBoleta([
      { productoId: "empanada", productoNombre: "Empanada de carne", cantidad: 3, precioUnitario: 500 },
      { productoId: "empanada", productoNombre: "Empanada de carne", cantidad: 1, precioUnitario: 500, promo: { promoCuentaId: "promo-1", titulo: "Menú del día" } },
    ]);
    const sueltas = boleta.lineas.filter((l) => l.producto === "Empanada de carne" && !l.promoCuentaId);
    const deLaPromo = boleta.lineas.filter((l) => l.producto === "Empanada de carne" && l.promoCuentaId);
    expect(sueltas).toEqual([{ producto: "Empanada de carne", cantidad: 3, precioUnitario: 500, subtotal: 1500 }]);
    expect(deLaPromo).toEqual([{ producto: "Empanada de carne", cantidad: 1, precioUnitario: 500, subtotal: 500, promoCuentaId: "promo-1", indentado: true }]);
  });
});

/**
 * `armarBoletaImpresaEn` (Task #17, reporte de boletas emitidas): la boleta como se veía en el instante de esa impresión, no como
 * está la cuenta ahora. `armarBoletaVigente` es el caso "ahora" sobre la misma base (ver su docstring).
 */
describe("armarBoletaImpresaEn", () => {
  const impresaEn = new Date("2026-09-25T20:00:00Z");
  const items = [
    { productoId: "p1", productoNombre: "Milanesa", cantidad: 2, precioUnitario: 9000, operacionId: "op1", anuladaEn: null },
    { productoId: "p2", productoNombre: "Flan", cantidad: 1, precioUnitario: 3000, operacionId: "op2", anuladaEn: new Date("2026-09-25T19:00:00Z") }, // anulada ANTES de imprimir
    { productoId: "p3", productoNombre: "Pizza", cantidad: 1, precioUnitario: 12000, operacionId: "op3", anuladaEn: new Date("2026-09-25T21:00:00Z") }, // anulada DESPUÉS de imprimir
  ];

  it("una línea anulada ANTES de imprimir no aparece; una anulada DESPUÉS sí (así se veía el papel ese día)", () => {
    const boleta = armarBoletaImpresaEn(items, impresaEn);
    expect(boleta.lineas.map((l) => l.producto)).toEqual(["Milanesa", "Pizza"]);
    expect(boleta.total).toBe(30000);
  });

  it("una anulación EXACTAMENTE en el instante de la impresión ya no vale (estrictamente posterior, mismo criterio que estadoDeBoleta)", () => {
    const boleta = armarBoletaImpresaEn(items, new Date("2026-09-25T21:00:00Z"));
    expect(boleta.lineas.map((l) => l.producto)).toEqual(["Milanesa"]);
  });

  it("armarBoletaVigente da lo mismo que armarBoletaImpresaEn(items, ahora): ninguna anulación real es posterior a ahora", () => {
    const vigente = armarBoleta(items.filter((i) => i.anuladaEn === null));
    const comoAhora = armarBoletaImpresaEn(items, new Date());
    expect(comoAhora).toEqual(vigente);
  });
});
