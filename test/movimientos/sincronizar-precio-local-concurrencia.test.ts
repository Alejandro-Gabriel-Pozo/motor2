import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { setPrecioLocalProducto, sincronizarPrecioLocalGrupoCarta } from "../../src/server/actions/movimientos/precio-local";
import type { ResultadoAccion } from "../../src/server/actions/tipos";

/**
 * «Aplicar $X también» del precio local (sincronizar los hermanos de un ítem agrupado de la carta) con control del VALOR VISTO (ola «precio y carta», Fase 2,
 * paso A3), por la Server Action pública y contra Postgres real: el precio que la pantalla mostró de cada hermano se compara con el de hoy DENTRO de una
 * transacción SERIALIZABLE; si alguno cambió, no se toca ninguno.
 */
const ITERACIONES = 8;

describe("sincronizar el precio local de un ítem agrupado: control del valor visto (A3)", () => {
  let sucursalId: string;
  let unidadId: string;
  let seccionId: string;
  let n = 0;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    seccionId = (await prisma.seccionCarta.create({ data: { nombre: "Bebidas" } })).id;
  });

  /** Un ítem agrupado con tres gaseosas a $5000 (global): la primera es la que se acaba de cambiar; las otras dos, los hermanos que se ofrece igualar. */
  const grupo = async () => {
    const i = n++;
    const pv = async (nombre: string) => (await sembrarProductoDisponible({ codigo: `SPL_${i}_${nombre}`, nombre: `${nombre} ${i}`, tipo: "PV", precioVenta: 5000, unidadStockId: unidadId }, sucursalId)).id;
    const [fanta, coca, sprite] = [await pv("Fanta"), await pv("Coca"), await pv("Sprite")];
    const ag = await prisma.itemAgrupadoCarta.create({ data: { sucursalId, nombre: `Gaseosa ${i}`, seccionCartaId: seccionId } });
    await prisma.opcionItemAgrupadoCarta.createMany({ data: [fanta, coca, sprite].map((productoId, orden) => ({ sucursalId, itemAgrupadoCartaId: ag.id, productoId, orden })) });
    return { fanta, coca, sprite, nombreItem: ag.nombre, nombre: (id: string) => `${id === coca ? "Coca" : id === sprite ? "Sprite" : "Fanta"} ${i}` };
  };
  const local = async (productoId: string) => {
    const f = await prisma.precioLocalProducto.findUnique({ where: { sucursalId_productoId: { sucursalId, productoId } } });
    return f ? `${f.precio.toFixed(2)}${f.habilitado ? "" : " (deshabilitado)"}` : null;
  };
  const auditorias = async (ids: string[]) => {
    const filas = await prisma.precioLocalProducto.findMany({ where: { sucursalId, productoId: { in: ids } }, select: { id: true } });
    return prisma.registroAuditoria.count({ where: { entidad: "PrecioLocalProducto", entidadId: { in: filas.map((f) => f.id) } } });
  };
  const codigo = (r: PromiseSettledResult<ResultadoAccion>) =>
    r.status === "rejected" ? `error:${String(r.reason)}` : r.value.ok ? "ok" : /cambió (desde que se ofreció igualarlo|mientras lo editabas)/.test(r.value.mensaje) ? "PRECIO_DESACTUALIZADO" : r.value.mensaje;

  it("otro fijó el precio local de un hermano después de ofrecer igualarlo → PRECIO_DESACTUALIZADO y NO cambia ninguno", async () => {
    const g = await grupo();
    await setPrecioLocalProducto(g.coca, 6000, true);
    expect(await sincronizarPrecioLocalGrupoCarta(sucursalId, [g.coca, g.sprite], 5500, true, { [g.coca]: 5000, [g.sprite]: 5000 })).toEqual({
      ok: false,
      mensaje: `El precio de «${g.nombre(g.coca)}» en «Central» cambió desde que se ofreció igualarlo (ahora es $6.000): no se cambió ninguno. Recargá la pantalla y volvé a hacer el cambio.`,
    });
    expect([await local(g.coca), await local(g.sprite)]).toEqual(["6000.00", null]);
  });

  it("un hermano sin precio visto (y con algo que cambiar) → PRECIO_DESACTUALIZADO, sin escribir", async () => {
    const g = await grupo();
    expect(await sincronizarPrecioLocalGrupoCarta(sucursalId, [g.coca, g.sprite], 5500, true, { [g.coca]: 5000 })).toMatchObject({ ok: false, mensaje: expect.stringContaining(`«${g.nombre(g.sprite)}»`) });
    expect(await sincronizarPrecioLocalGrupoCarta(sucursalId, [g.coca, g.sprite], 5500, true)).toMatchObject({ ok: false, mensaje: expect.stringContaining("cambió desde que se ofreció igualarlo") });
    expect([await local(g.coca), await local(g.sprite)]).toEqual([null, null]);
  });

  it("IDEMPOTENTE: el mismo «Aplicar también» dos veces → el mismo éxito, una sola escritura y sin auditoría nueva", async () => {
    const g = await grupo();
    const pedido = () => sincronizarPrecioLocalGrupoCarta(sucursalId, [g.coca, g.sprite], 5500, true, { [g.coca]: 5000, [g.sprite]: 5000 });
    const mensaje = `Precio local de "${g.nombre(g.coca)}", "${g.nombre(g.sprite)}" fijado en 5500 en "Central" («${g.nombreItem}»).`;
    expect(await pedido()).toEqual({ ok: true, mensaje });
    expect(await pedido()).toEqual({ ok: true, mensaje });
    expect([await local(g.coca), await local(g.sprite), await auditorias([g.coca, g.sprite])]).toEqual(["5500.00", "5500.00", 4]);
  });

  it(`concurrencia (${ITERACIONES} vueltas): el mismo «Aplicar también» dos veces a la vez → dos ok, una sola escritura (4 auditorías: precio y habilitado de cada uno)`, async () => {
    for (let i = 0; i < ITERACIONES; i++) {
      const g = await grupo();
      const pedido = () => sincronizarPrecioLocalGrupoCarta(sucursalId, [g.coca, g.sprite], 5500, true, { [g.coca]: 5000, [g.sprite]: 5000 });
      const res = await Promise.allSettled([pedido(), pedido()]);
      expect(res.map(codigo), `vuelta ${i}`).toEqual(["ok", "ok"]);
      expect([await local(g.coca), await local(g.sprite), await auditorias([g.coca, g.sprite])], `vuelta ${i}`).toEqual(["5500.00", "5500.00", 4]);
    }
  });

  it(`concurrencia (${ITERACIONES} vueltas): «Aplicar también» mientras otro fija el precio local de un hermano → gana uno solo y el resultado es coherente`, async () => {
    for (let i = 0; i < ITERACIONES; i++) {
      const g = await grupo();
      const [sincronizar, fijar] = await Promise.allSettled([
        sincronizarPrecioLocalGrupoCarta(sucursalId, [g.coca, g.sprite], 5500, true, { [g.coca]: 5000, [g.sprite]: 5000 }),
        setPrecioLocalProducto(g.coca, 6000, true, null),
      ]);
      const resumen = [codigo(sincronizar), codigo(fijar)];
      expect([["ok", "PRECIO_DESACTUALIZADO"], ["PRECIO_DESACTUALIZADO", "ok"]], `vuelta ${i}: ${resumen.join(" / ")}`).toContainEqual(resumen);
      const esperado = resumen[0] === "ok" ? ["5500.00", "5500.00"] : ["6000.00", null];
      expect([await local(g.coca), await local(g.sprite)], `vuelta ${i}`).toEqual(esperado);
    }
  });

  it("los precios vistos con mal formato se rechazan antes de tocar la base", async () => {
    const g = await grupo();
    const mensaje = "Los precios que mostraba la pantalla no son válidos: recargala.";
    for (const malo of [[5000], "5000", { [g.coca]: -1 }, { [g.coca]: "x" }]) {
      expect(await sincronizarPrecioLocalGrupoCarta(sucursalId, [g.coca], 5500, true, malo as never)).toEqual({ ok: false, mensaje });
    }
    expect(await local(g.coca)).toBeNull();
  });
});
