import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import {
  aceptarTransferencia,
  aprobarYEnviarTransferencia,
  confirmarReingresoTransferencia,
  crearEnvioDirectoTransferencia,
  crearSolicitudTransferencia,
  rechazarTransferencia,
} from "../../src/server/actions/traspasos/traspasos";
import { obtenerCostoActualPorMP } from "../../src/server/lecturas/reportes/comun";
import { calcularValuacionInventario } from "../../src/server/consultas/reportes/valuacion";
import { valorizarLineaDeTraspaso } from "../../src/core/stock/public";

/**
 * E2 «el costo viaja con el traspaso» (ADR-040, docs/diseno-costo-en-el-traspaso-2026-10-27.md, §11 «¿qué pasa si…?»). Por las acciones reales (permiso → guard → caso de uso → base):
 * el origen copia su costo al ENVIAR (en la misma transacción que la salida), la salida, la entrada y el reingreso se valorizan con esa copia, y el costo de reposición del
 * destino pasa a ser la entrada valorizada más reciente (V-T1). Cada prueba nombra la mutación que la pone en rojo (evidencia en el documento de diseño, §14).
 */
describe("E2: el costo viaja con el traspaso", () => {
  let sucursalAId: string;
  let sucursalBId: string;
  let seccionAId: string;
  let seccionBId: string;
  let kgId: string;
  let adminAId: string;
  let adminBId: string;
  let rolAdminId: string;

  const comoA = () => mockearUsuarioActual({ id: adminAId, email: "admin-a@test.com", nombre: null });
  const comoB = () => mockearUsuarioActual({ id: adminBId, email: "admin-b@test.com", nombre: null });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    rolAdminId = base.admin.id;
    sucursalAId = base.sucursal.id;
    kgId = (await sembrarCatalogoBase()).kg.id;
    seccionAId = (await sembrarSeccion(sucursalAId, "Depósito A")).id;
    sucursalBId = (await prisma.sucursal.create({ data: { nombre: "Sucursal B" } })).id;
    seccionBId = (await sembrarSeccion(sucursalBId, "Depósito B")).id;
    adminAId = (await crearUsuarioConMembresia({ email: "admin-a@test.com", sucursalId: sucursalAId, rolId: rolAdminId })).id;
    adminBId = (await crearUsuarioConMembresia({ email: "admin-b@test.com", sucursalId: sucursalBId, rolId: rolAdminId })).id;
  });

  async function producto(codigo: string) {
    const p = await prisma.producto.create({ data: { codigo, nombre: codigo, tipo: "MP", unidadStockId: kgId } });
    await prisma.disponibilidadProducto.createMany({ data: [sucursalAId, sucursalBId].map((sucursalId) => ({ sucursalId, productoId: p.id, disponible: true })) });
    return p;
  }

  /** Una compra por la acción real; `precioTotal` undefined = sin precio. */
  async function comprar(seccionId: string, productoId: string, cantidad: number, precioTotal: number | undefined, fecha: Date) {
    const r = await registrarMovimiento({ proceso: "COMPRA", fecha, seccionId, items: [{ productoId, cantidad, ...(precioTotal === undefined ? {} : { precioTotal }) }], claveIdempotencia: crypto.randomUUID() });
    expect(r.ok, r.mensaje).toBe(true);
  }

  async function enviar(productoId: string, cantidad: number): Promise<string> {
    await comoA();
    const envio = await crearEnvioDirectoTransferencia({ destinoSucursalId: sucursalBId, productoId, cantidad, seccionOrigenId: seccionAId });
    if (!envio.ok) throw new Error(envio.mensaje);
    return envio.id;
  }

  async function aceptar(traspasoId: string) {
    await comoB();
    const r = await aceptarTransferencia(traspasoId, seccionBId, crypto.randomUUID());
    expect(r.ok, r.mensaje).toBe(true);
  }

  const lineas = (traspasoId: string) =>
    prisma.movimientoStock.findMany({ where: { traspasoSucursalId: traspasoId } }).then((ls) =>
      ls
        .map((l) => ({ proceso: l.proceso, cantidad: Number(l.cantidad), precioTotal: l.precioTotal.toString(), precioPorUnidadStock: l.precioPorUnidadStock.toString() }))
        .sort((a, b) => a.proceso.localeCompare(b.proceso))
    );
  const copia = async (traspasoId: string) => (await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: traspasoId } })).costoUnitarioOrigen?.toString() ?? null;
  const costoEn = async (sucursalId: string, productoId: string) => (await obtenerCostoActualPorMP(sucursalId, prisma)).get(productoId)?.precioPorUnidadStock ?? null;

  // Mutación: volver `precioTotal`/`precioPorUnidadStock` a 0 en `escribirMovimientoDeTraspaso` → rojo (la salida y la entrada a 0, el destino sin costo).
  it("envío directo: copia el costo del origen y valoriza la salida; la entrada del destino lleva la MISMA copia y el destino pasa a tener ese costo", async () => {
    const harina = await producto("MP_HARINA");
    await comoA();
    await comprar(seccionAId, harina.id, 10, 1200, new Date("2026-09-01T12:00:00Z")); // 120 el kg

    const id = await enviar(harina.id, 2.5);
    expect(await copia(id)).toBe("120");
    expect(await lineas(id)).toEqual([{ proceso: "TRANSFERENCIA_SALIDA_SUCURSAL", cantidad: -2.5, precioTotal: "300", precioPorUnidadStock: "120" }]);
    expect(await costoEn(sucursalBId, harina.id)).toBeNull(); // todavía no entró

    await aceptar(id);
    expect(await lineas(id)).toEqual([
      { proceso: "TRANSFERENCIA_ENTRADA_SUCURSAL", cantidad: 2.5, precioTotal: "300", precioPorUnidadStock: "120" },
      { proceso: "TRANSFERENCIA_SALIDA_SUCURSAL", cantidad: -2.5, precioTotal: "300", precioPorUnidadStock: "120" },
    ]);
    expect(await costoEn(sucursalBId, harina.id)).toBe(120);
    const fila = (await calcularValuacionInventario(sucursalBId, prisma)).filas.find((f) => f.productoId === harina.id);
    expect(fila).toMatchObject({ saldo: 2.5, costoUnitario: 120, valor: 300, sinCosto: false });
  });

  // Mutación: no pasar la copia en `aprobarYEnviarTraspasoCasoDeUso` (`costoUnitarioOrigen: null`) → rojo.
  it("PULL: la solicitud no fija costo; la aprobación del origen lo copia y valoriza la salida", async () => {
    const harina = await producto("MP_HARINA_PULL");
    await comoA();
    await comprar(seccionAId, harina.id, 4, 500, new Date("2026-09-01T12:00:00Z")); // 125 el kg
    await comoB();
    const sol = await crearSolicitudTransferencia({ origenSucursalId: sucursalAId, productoId: harina.id, cantidad: 2, seccionDestinoId: seccionBId });
    if (!sol.ok) throw new Error(sol.mensaje);
    expect(await copia(sol.id)).toBeNull();

    await comoA();
    const aprobar = await aprobarYEnviarTransferencia(sol.id, seccionAId);
    expect(aprobar.ok, aprobar.mensaje).toBe(true);
    expect(await copia(sol.id)).toBe("125");
    await aceptar(sol.id);
    expect((await lineas(sol.id)).map((l) => [l.proceso, l.precioTotal, l.precioPorUnidadStock])).toEqual([
      ["TRANSFERENCIA_ENTRADA_SUCURSAL", "250", "125"],
      ["TRANSFERENCIA_SALIDA_SUCURSAL", "250", "125"],
    ]);
    expect(await costoEn(sucursalBId, harina.id)).toBe(125);
  });

  // Mutación: en `aceptarTraspasoCasoDeUso`, valorizar con el costo del origen de AHORA (`obtenerCostoActualDeProducto(traspaso.origenSucursalId, …)`) en vez de la copia → rojo.
  it("una compra posterior en el origen NO cambia el costo que ya viajó", async () => {
    const harina = await producto("MP_HARINA_POST");
    await comoA();
    await comprar(seccionAId, harina.id, 10, 1200, new Date("2026-09-01T12:00:00Z")); // 120
    const id = await enviar(harina.id, 3);
    await comoA();
    await comprar(seccionAId, harina.id, 4, 600, new Date()); // ahora 150 en el origen
    expect(await costoEn(sucursalAId, harina.id)).toBe(150);

    await aceptar(id);
    expect(await copia(id)).toBe("120");
    expect((await lineas(id)).find((l) => l.proceso === "TRANSFERENCIA_ENTRADA_SUCURSAL")).toMatchObject({ precioTotal: "360", precioPorUnidadStock: "120" });
    expect(await costoEn(sucursalBId, harina.id)).toBe(120);
    expect(await costoEn(sucursalAId, harina.id)).toBe(150);
  });

  // Mutaciones: escribir 0 en vez de NULL cuando no hay costo (`?? 0`) → rojo en la copia; quitar `> 0` de la lectura de V-T1 → rojo (el destino tomaría 0 y perdería su 80).
  it("sin costo en el origen: el traspaso funciona, la copia queda NULL y el destino queda «pendiente de completar» (conserva su costo anterior si lo tenía)", async () => {
    const harina = await producto("MP_HARINA_SIN");
    const azucar = await producto("MP_AZUCAR_SIN");
    await comoA();
    await comprar(seccionAId, harina.id, 10, undefined, new Date("2026-09-01T12:00:00Z")); // sin precio
    await comprar(seccionAId, azucar.id, 10, undefined, new Date("2026-09-01T12:00:00Z"));
    await comoB();
    await comprar(seccionBId, azucar.id, 1, 80, new Date("2026-09-02T12:00:00Z")); // B ya tenía azúcar a 80

    const idHarina = await enviar(harina.id, 2);
    const idAzucar = await enviar(azucar.id, 2);
    await aceptar(idHarina);
    await aceptar(idAzucar);

    expect(await copia(idHarina)).toBeNull();
    expect((await lineas(idHarina)).map((l) => [l.precioTotal, l.precioPorUnidadStock])).toEqual([["0", "0"], ["0", "0"]]);
    expect(await costoEn(sucursalBId, harina.id)).toBeNull();
    const valuacion = await calcularValuacionInventario(sucursalBId, prisma);
    expect(valuacion.filas.find((f) => f.productoId === harina.id)).toMatchObject({ saldo: 2, costoUnitario: null, valor: null, sinCosto: true });
    // La entrada sin costo no borra el costo que el destino ya tenía (I5).
    expect(await copia(idAzucar)).toBeNull();
    expect(await costoEn(sucursalBId, azucar.id)).toBe(80);
  });

  // Mutación: sumar REINGRESO_TRANSFERENCIA_SUCURSAL a `PROCESOS_QUE_FIJAN_EL_COSTO` → rojo (el origen volvería a 120).
  it("el reingreso vuelve con la misma copia y NO pisa el costo de reposición del origen", async () => {
    const harina = await producto("MP_HARINA_REING");
    await comoA();
    await comprar(seccionAId, harina.id, 10, 1200, new Date("2026-09-01T12:00:00Z")); // 120
    const id = await enviar(harina.id, 3);
    await comoA();
    await comprar(seccionAId, harina.id, 2, 300, new Date("2026-09-02T12:00:00Z")); // 150, antes del reingreso
    await comoB();
    expect((await rechazarTransferencia(id, "no lo necesitamos")).ok).toBe(true);
    await comoA();
    const reingreso = await confirmarReingresoTransferencia(id, crypto.randomUUID());
    expect(reingreso.ok, reingreso.mensaje).toBe(true);

    expect((await lineas(id)).find((l) => l.proceso === "REINGRESO_TRANSFERENCIA_SUCURSAL")).toMatchObject({ cantidad: 3, precioTotal: "360", precioPorUnidadStock: "120" });
    expect(await costoEn(sucursalAId, harina.id)).toBe(150);
    expect(await costoEn(sucursalBId, harina.id)).toBeNull();
  });

  // Mutación: quitar `chequearIdempotencia` de la aceptación → rojo (varias entradas). La copia es la misma para todas.
  it("8 aceptaciones simultáneas con la MISMA clave: una sola entrada, con la copia; el resto responde lo mismo sin escribir", async () => {
    const harina = await producto("MP_HARINA_CONC");
    await comoA();
    await comprar(seccionAId, harina.id, 10, 1200, new Date("2026-09-01T12:00:00Z"));
    const id = await enviar(harina.id, 4);
    await comoB();
    const clave = crypto.randomUUID();
    const resultados = await Promise.all(Array.from({ length: 8 }, () => aceptarTransferencia(id, seccionBId, clave)));
    expect(resultados.every((r) => r.ok), JSON.stringify(resultados)).toBe(true);
    expect(new Set(resultados.map((r) => r.mensaje)).size).toBe(1);

    const entradas = await prisma.movimientoStock.findMany({ where: { traspasoSucursalId: id, proceso: "TRANSFERENCIA_ENTRADA_SUCURSAL" } });
    expect(entradas).toHaveLength(1);
    expect([entradas[0].precioTotal.toString(), entradas[0].precioPorUnidadStock.toString()]).toEqual(["480", "120"]);
    expect(await prisma.operacion.count({ where: { claveIdempotencia: clave } })).toBe(1);
  });

  // Mutación: sacar el guard de transición de la aprobación → rojo (dos salidas, y la segunda copia pisaría la primera con 150).
  it("aprobar dos veces o aceptar dos veces (con claves distintas): una sola salida, una sola entrada y la copia del PRIMER envío", async () => {
    const harina = await producto("MP_HARINA_DOBLE");
    await comoA();
    await comprar(seccionAId, harina.id, 10, 1200, new Date("2026-09-01T12:00:00Z"));
    await comoB();
    const sol = await crearSolicitudTransferencia({ origenSucursalId: sucursalAId, productoId: harina.id, cantidad: 2, seccionDestinoId: seccionBId });
    if (!sol.ok) throw new Error(sol.mensaje);
    await comoA();
    expect((await aprobarYEnviarTransferencia(sol.id, seccionAId)).ok).toBe(true);
    await comprar(seccionAId, harina.id, 2, 300, new Date()); // el origen pasa a 150
    expect((await aprobarYEnviarTransferencia(sol.id, seccionAId)).ok).toBe(false);
    expect(await copia(sol.id)).toBe("120");

    await aceptar(sol.id);
    await comoB();
    expect((await aceptarTransferencia(sol.id, seccionBId, crypto.randomUUID())).ok).toBe(false);
    const ls = await lineas(sol.id);
    expect(ls.map((l) => l.proceso)).toEqual(["TRANSFERENCIA_ENTRADA_SUCURSAL", "TRANSFERENCIA_SALIDA_SUCURSAL"]);
    expect(ls.every((l) => l.precioPorUnidadStock === "120")).toBe(true);
  });

  // Dos barreras independientes: la sucursal ajena (C) ni siquiera VE el traspaso (RLS ENTRE_SUCURSALES: solo origen y destino), y el lado equivocado (el origen
  // aceptando su propio envío) lo frena el guard de transición. Mutación: sacar `guardTransicionTraspaso` de la aceptación → rojo en el origen (escribiría una entrada
  // valorizada en su propio Kardex); con C sigue verde porque la RLS la frena igual (la matriz de denegación de test/aislamiento cubre además otra EMPRESA).
  it("una sucursal ajena al traspaso, o el lado equivocado, no pueden aceptarlo ni confirmar su reingreso: cero filas y la copia intacta", async () => {
    const harina = await producto("MP_HARINA_AJENA");
    await comoA();
    await comprar(seccionAId, harina.id, 10, 1200, new Date("2026-09-01T12:00:00Z"));
    const id = await enviar(harina.id, 2);
    const sucursalC = await prisma.sucursal.create({ data: { nombre: "Sucursal C" } });
    const seccionC = await sembrarSeccion(sucursalC.id, "Depósito C");
    await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursalC.id, productoId: harina.id, disponible: true } });
    const adminC = await crearUsuarioConMembresia({ email: "admin-c@test.com", sucursalId: sucursalC.id, rolId: rolAdminId });
    await mockearUsuarioActual({ id: adminC.id, email: "admin-c@test.com", nombre: null });
    const movimientosAntes = await prisma.movimientoStock.count();

    expect((await aceptarTransferencia(id, seccionC.id, crypto.randomUUID())).ok).toBe(false);
    expect((await confirmarReingresoTransferencia(id, crypto.randomUUID())).ok).toBe(false);
    await comoA();
    expect((await aceptarTransferencia(id, seccionAId, crypto.randomUUID())).ok).toBe(false);
    expect(await prisma.movimientoStock.count()).toBe(movimientosAntes);
    expect(await copia(id)).toBe("120");
    expect((await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id } })).estado).toBe("ENVIADA");
  });

  // Mutación: `precioTotal = Math.round(|cantidad| × costo × 100) / 100` (en float) → rojo en 0,3 × 1234,55 (370,36 en vez de 370,37).
  it("redondeo exacto con cantidades fraccionarias: decimal exacto y un solo redondeo a centavos", async () => {
    const casos = [
      { codigo: "MP_R1", compra: [1, 1234.55], envio: 0.3, total: "370.37", unidad: "1234.55" }, // en float: 370.36499999999995
      { codigo: "MP_R2", compra: [3, 1000], envio: 0.75, total: "250", unidad: "333.3333" }, // 0,75 × 333,3333 = 249,999975
      { codigo: "MP_R3", compra: [2, 0.02], envio: 0.5, total: "0.01", unidad: "0.01" }, // empate de medio centavo: 0,005 → 0,01
    ];
    for (const c of casos) {
      const p = await producto(c.codigo);
      await comoA();
      await comprar(seccionAId, p.id, c.compra[0], c.compra[1], new Date("2026-09-01T12:00:00Z"));
      const id = await enviar(p.id, c.envio);
      await aceptar(id);
      expect(await copia(id), c.codigo).toBe(c.unidad);
      for (const l of await lineas(id)) expect([l.precioTotal, l.precioPorUnidadStock], `${c.codigo} ${l.proceso}`).toEqual([c.total, c.unidad]);
    }
  });

  // Mutación: volver `PROCESOS_QUE_FIJAN_EL_COSTO` a solo COMPRA → rojo (la venta del destino queda sin costo congelado).
  it("la venta del destino congela el costo que trajo el traspaso (costo de la receta con el insumo recibido)", async () => {
    const harina = await producto("MP_HARINA_VENTA");
    const pan = await prisma.producto.create({ data: { codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: kgId, precioVenta: 1000 } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursalBId, productoId: pan.id, disponible: true } });
    await prisma.recetaVersion.create({ data: { productoId: pan.id, version: 1, ingredientes: { create: [{ insumoProductoId: harina.id, cantidad: 2, unidadId: kgId }] } } });
    await comoA();
    await comprar(seccionAId, harina.id, 10, 1200, new Date("2026-09-01T12:00:00Z"));
    const id = await enviar(harina.id, 4);
    await aceptar(id);

    await comoB();
    const venta = await registrarVenta({ fecha: new Date(), seccionId: seccionBId, ventas: [{ productoId: pan.id, cantidadVendida: 1 }] });
    expect(venta.ok, venta.mensaje).toBe(true);
    const linea = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: pan.id, proceso: "VENTA" } });
    expect(Number(linea.costoUnitarioVenta)).toBe(240); // 2 kg × 120
  });
});

describe("valorizarLineaDeTraspaso (núcleo puro)", () => {
  it("con copia: la copia exacta por unidad y |cantidad| × copia con un solo redondeo, siempre en positivo", () => {
    expect(valorizarLineaDeTraspaso(-2.5, 100.04)).toEqual({ precioPorUnidadStock: 100.04, precioTotal: 250.1 });
    expect(valorizarLineaDeTraspaso(0.3, 1234.55)).toEqual({ precioPorUnidadStock: 1234.55, precioTotal: 370.37 });
    expect(valorizarLineaDeTraspaso(3, 0.3333)).toEqual({ precioPorUnidadStock: 0.3333, precioTotal: 1 });
    expect(valorizarLineaDeTraspaso(-0.5, 0.01)).toEqual({ precioPorUnidadStock: 0.01, precioTotal: 0.01 });
    expect(valorizarLineaDeTraspaso(4, 0)).toEqual({ precioPorUnidadStock: 0, precioTotal: 0 });
  });

  it("sin copia (null): todo en 0, «pendiente de completar»; una copia negativa o no finita es un error", () => {
    expect(valorizarLineaDeTraspaso(3, null)).toEqual({ precioPorUnidadStock: 0, precioTotal: 0 });
    expect(() => valorizarLineaDeTraspaso(3, -1)).toThrow(/inválido/);
    expect(() => valorizarLineaDeTraspaso(3, Number.NaN)).toThrow(/inválido/);
    expect(() => valorizarLineaDeTraspaso(Number.POSITIVE_INFINITY, 10)).toThrow(/inválida/);
  });
});
