import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { cerrarConexiones, conexionComoApp } from "../setup/gasto";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { elegida, sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { agregarItems } from "../../src/server/actions/pos/cuenta-pedido";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";

/**
 * GO-2b (ADR-030): concurrencia de «agregar ítems» con opciones, contra Postgres real (transacciones SERIALIZABLE de verdad y, para las carreras con el catálogo, una
 * segunda conexión `pg` como `motor2_app`). Fija:
 *  (a) la MISMA clave dos veces a la vez: un solo juego de líneas y de fotos;
 *  (b) una versión nueva de la opción cargada a la vez: o la foto con la versión VIEJA (el pedido quedó antes en el orden serializado) o `OPCION_CAMBIO`; nunca una
 *      mezcla (la foto de una versión con el precio de otra), con la transacción abierta del otro lado y con `Promise.all`;
 *  (c) un apagado en la sucursal a la vez: o la línea con la opción, o el rechazo por apagada; nunca otra cosa;
 *  (d) un cierre a la vez: nunca queda una línea configurada sin enviar en una cuenta cerrada;
 *  (e) aislamiento: un pedido de otra empresa o de otra sucursal no ve las opciones ni la cuenta.
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let c: CafeDelSalon;
let cuentaId: string;

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  c = await sembrarCafeDelSalon(s);
  await entrarComo(s.admin);
  cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
});
afterEach(cerrarConexiones);

const grandeConShot = () => [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId), elegida(c, c.shotId)] }];
const INSERTAR_VERSION = `INSERT INTO "VersionDeOpcion" (id, "opcionId", numero, "tipoDeDiferencia", "diferenciaPrecio", "factorEscala", "creadoPorId") VALUES ($1, $2, $3, 'MONTO', 120.00, 1.5, $4)`;

describe("agregar con opciones: concurrencia (GO-2b)", () => {
  it("(a) la misma clave dos veces a la vez: un juego de líneas y de fotos, los dos con el mensaje original", async () => {
    const clave = randomUUID();
    const [r1, r2] = await Promise.all([agregarItems(cuentaId, grandeConShot(), [], clave), agregarItems(cuentaId, grandeConShot(), [], clave)]);
    expect([r1, r2]).toEqual([
      { ok: true, mensaje: "Se agregó 1 ítem a la mesa 4." },
      { ok: true, mensaje: "Se agregó 1 ítem a la mesa 4." },
    ]);
    expect(await prisma.cuentaItem.count({ where: { cuentaId } })).toBe(2);
    expect(await prisma.opcionElegidaEnLinea.count()).toBe(2);
  });

  it("(b) con la versión nueva SIN confirmar del otro lado, el pedido congela la vieja; confirmada antes, el pedido recibe OPCION_CAMBIO", async () => {
    const otro = await conexionComoApp();
    await otro.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await otro.query(INSERTAR_VERSION, [randomUUID(), c.grandeId, 2, s.admin.id]);
    expect(await agregarItems(cuentaId, grandeConShot())).toEqual({ ok: true, mensaje: "Se agregó 1 ítem a la mesa 4." });
    await otro.query("COMMIT");
    const foto = await prisma.opcionElegidaEnLinea.findFirstOrThrow({ where: { opcionId: c.grandeId } });
    expect([foto.versionDeOpcionId, Number(foto.importeUnitario)]).toEqual([c.versionDe[c.grandeId], 100]);

    expect(await agregarItems(cuentaId, grandeConShot())).toEqual({ ok: false, mensaje: "«Café»: «Grande» cambió desde que la elegiste: volvé a elegirla para ver el precio y el detalle actuales." });
    expect(await prisma.cuentaItem.count({ where: { cuentaId } })).toBe(2);
  });

  it("(b) con Promise.all, en varias vueltas: cada pedido aceptado congela la versión que vio con SU precio, o rechaza por OPCION_CAMBIO; nunca una mezcla", async () => {
    for (let vuelta = 2; vuelta <= 6; vuelta++) {
      const otro = await conexionComoApp();
      const vista = (await prisma.versionDeOpcion.findFirstOrThrow({ where: { opcionId: c.grandeId }, orderBy: { numero: "desc" } })).id;
      const [r] = await Promise.all([
        agregarItems(cuentaId, [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId, 1, vista)] }]),
        otro.query(INSERTAR_VERSION, [randomUUID(), c.grandeId, vuelta, s.admin.id]),
      ]);
      if (!r.ok) expect(r.mensaje).toMatch(/cambió desde que la elegiste/);
    }
    const fotos = await prisma.opcionElegidaEnLinea.findMany({ where: { opcionId: c.grandeId }, include: { versionDeOpcion: true, cuentaItem: true } });
    for (const f of fotos) {
      expect(Number(f.importeUnitario)).toBe(Number(f.versionDeOpcion.diferenciaPrecio));
      expect(Number(f.cuentaItem.precioUnitario)).toBe(1000 + Number(f.versionDeOpcion.diferenciaPrecio));
    }
  });

  it("(c) un apagado en la sucursal a la vez: o la línea con almendras, o el rechazo por apagada", async () => {
    const otro = await conexionComoApp(undefined, { lectura: [s.sucursalId], escritura: [s.sucursalId] });
    const [r] = await Promise.all([
      agregarItems(cuentaId, [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.medianoId), elegida(c, c.almendrasId)] }]),
      otro.query(`INSERT INTO "OpcionApagadaEnSucursal" (id, "sucursalId", "opcionId", apagada, "actualizadoPorId") VALUES ($1, $2, $3, true, $4)`, [randomUUID(), s.sucursalId, c.almendrasId, s.admin.id]),
    ]);
    const lineas = await prisma.cuentaItem.count({ where: { cuentaId } });
    if (r.ok) expect(lineas).toBe(1);
    else {
      expect(r.mensaje).toMatch(/no está disponible en esta sucursal/);
      expect(lineas).toBe(0);
    }
    // Y después del apagado, seguro que se rechaza.
    expect((await agregarItems(cuentaId, [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.medianoId), elegida(c, c.almendrasId)] }])).ok).toBe(false);
  });

  it("(d) agregar un café configurado contra cerrar la cuenta: nunca queda una línea (ni su adicional) sin enviar en una cuenta cerrada", async () => {
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      const mesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 100 + vuelta } });
      const cuenta = await sembrarCuenta(mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
      const [agregado, cierre] = await Promise.all([agregarItems(cuenta.id, grandeConShot()), cerrarCuenta(cuenta.id)]);
      const final = await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id }, include: { items: true } });
      if (final.cerradaEn) expect(final.items.filter((i) => i.numeroEnvio === null), `vuelta ${vuelta}`).toEqual([]);
      expect([agregado.ok, cierre.ok], `vuelta ${vuelta}: ${agregado.mensaje} / ${cierre.mensaje}`).not.toEqual([true, true]);
    }
  });

  it("(e) aislamiento: la cuenta de otra sucursal no se toca, y desde otra empresa el café ni existe", async () => {
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const mesaNorte = await prisma.mesa.create({ data: { sucursalId: norte.id, numero: 9 } });
    const cuentaNorte = await sembrarCuenta(mesaNorte.id, s.admin.id);
    expect(await agregarItems(cuentaNorte.id, grandeConShot())).toMatchObject({ ok: false });
    expect(await prisma.cuentaItem.count({ where: { cuentaId: cuentaNorte.id } })).toBe(0);

    const sucursalAjena = await prismaAdmin.sucursal.create({ data: { empresaId: EMPRESA_TESTIGO_ID, nombre: "Ajena" } });
    const ajena = await conexionComoApp(EMPRESA_TESTIGO_ID, { lectura: [sucursalAjena.id], escritura: [sucursalAjena.id] });
    const vistos = await ajena.query(`SELECT count(*)::int AS n FROM "Producto" WHERE id = $1`, [c.cafeId]);
    const opciones = await ajena.query(`SELECT count(*)::int AS n FROM "OpcionDeGrupo" WHERE "grupoId" = $1`, [c.grupoMedidaId]);
    expect([vistos.rows[0].n, opciones.rows[0].n]).toEqual([0, 0]);
  });
});
