import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarProducto, sincronizarPrecioGrupoCarta } from "../../src/server/actions/catalogo/productos";
import type { ResultadoAccion, ResultadoConSincronizable } from "../../src/server/actions/tipos";

/**
 * «Aplicar $X también» del precio de venta GLOBAL (sincronizar los hermanos de un ítem agrupado de la carta) con control del VALOR VISTO (ola «precio y carta», Fase 2, paso A5), por la Server
 * Action pública y contra Postgres real: el precio de venta que la pantalla mostró de cada hermano se compara con el guardado DENTRO de una transacción SERIALIZABLE; si alguno cambió, no se
 * toca ninguno.
 */
const ITERACIONES = 8;

describe("sincronizar el precio de venta de un ítem agrupado: control del valor visto (A5)", () => {
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

  /** Un ítem agrupado con dos gaseosas a $5000: los hermanos que se ofrece igualar. */
  const grupo = async () => {
    const i = n++;
    const pv = async (nombre: string) => (await sembrarProductoDisponible({ codigo: `SPG_${i}_${nombre}`, nombre: `${nombre} ${i}`, tipo: "PV", precioVenta: 5000, unidadStockId: unidadId }, sucursalId)).id;
    const [coca, sprite] = [await pv("Coca"), await pv("Sprite")];
    const ag = await prisma.itemAgrupadoCarta.create({ data: { sucursalId, nombre: `Gaseosa ${i}`, seccionCartaId: seccionId } });
    await prisma.opcionItemAgrupadoCarta.createMany({ data: [coca, sprite].map((productoId, orden) => ({ sucursalId, itemAgrupadoCartaId: ag.id, productoId, orden })) });
    return { coca, sprite, i, nombreItem: ag.nombre };
  };
  const precios = async (ids: string[]) => Promise.all(ids.map(async (id) => Number((await prisma.producto.findUniqueOrThrow({ where: { id } })).precioVenta)));
  const auditorias = (ids: string[]) => prisma.registroAuditoria.count({ where: { entidad: "Producto", entidadId: { in: ids }, campo: "precioVenta" } });
  const codigo = (r: PromiseSettledResult<ResultadoAccion | ResultadoConSincronizable>) =>
    r.status === "rejected" ? `error:${String(r.reason)}` : r.value.ok ? "ok" : /desde que se ofreció igualarlo|mientras lo editabas/.test(r.value.mensaje) ? "PRECIO_DESACTUALIZADO" : r.value.mensaje;
  const datos = (nombre: string, precioVenta: number, precioVentaVisto: number) => ({ nombre, tipo: "PV" as const, unidadStockId: unidadId, factorConversion: 1, precioVenta, precioVentaVisto });

  it("otro cambió el precio de un hermano después de ofrecer igualarlo → PRECIO_DESACTUALIZADO y NO cambia ninguno", async () => {
    const g = await grupo();
    expect((await actualizarProducto(g.coca, datos(`Coca ${g.i}`, 6000, 5000))).ok).toBe(true);
    expect(await sincronizarPrecioGrupoCarta([g.coca, g.sprite], 5500, { [g.coca]: 5000, [g.sprite]: 5000 })).toEqual({
      ok: false,
      mensaje: `El precio de venta de «Coca ${g.i}» cambió desde que se ofreció igualarlo (ahora es $6.000): no se cambió ninguno. Recargá la pantalla y volvé a hacer el cambio.`,
    });
    expect([await precios([g.coca, g.sprite]), await auditorias([g.sprite])]).toEqual([[6000, 5000], 0]);
  });

  it("un hermano sin precio visto (y con algo que cambiar) → PRECIO_DESACTUALIZADO, sin escribir", async () => {
    const g = await grupo();
    expect(await sincronizarPrecioGrupoCarta([g.coca, g.sprite], 5500, { [g.coca]: 5000 })).toMatchObject({ ok: false, mensaje: expect.stringContaining(`«Sprite ${g.i}»`) });
    expect(await sincronizarPrecioGrupoCarta([g.coca, g.sprite], 5500)).toMatchObject({ ok: false, mensaje: expect.stringContaining("cambió desde que se ofreció igualarlo") });
    expect(await precios([g.coca, g.sprite])).toEqual([5000, 5000]);
  });

  it("IDEMPOTENTE: el mismo «Aplicar también» dos veces → el mismo éxito, una sola escritura y sin auditoría nueva", async () => {
    const g = await grupo();
    const pedido = () => sincronizarPrecioGrupoCarta([g.coca, g.sprite], 5500, { [g.coca]: 5000, [g.sprite]: 5000 });
    const mensaje = `Precio de venta de "Coca ${g.i}", "Sprite ${g.i}" actualizado a $5.500 («${g.nombreItem}»).`;
    expect(await pedido()).toEqual({ ok: true, mensaje });
    expect(await pedido()).toEqual({ ok: true, mensaje });
    expect([await precios([g.coca, g.sprite]), await auditorias([g.coca, g.sprite])]).toEqual([[5500, 5500], 2]);
  });

  it(`concurrencia (${ITERACIONES} vueltas): el mismo «Aplicar también» dos veces a la vez → dos ok, una auditoría por producto`, async () => {
    for (let i = 0; i < ITERACIONES; i++) {
      const g = await grupo();
      const pedido = () => sincronizarPrecioGrupoCarta([g.coca, g.sprite], 5500, { [g.coca]: 5000, [g.sprite]: 5000 });
      expect((await Promise.allSettled([pedido(), pedido()])).map(codigo), `vuelta ${i}`).toEqual(["ok", "ok"]);
      expect([await precios([g.coca, g.sprite]), await auditorias([g.coca, g.sprite])], `vuelta ${i}`).toEqual([[5500, 5500], 2]);
    }
  });

  it(`concurrencia (${ITERACIONES} vueltas): «Aplicar también» mientras otro edita el precio de un hermano → gana uno solo y el resultado es coherente`, async () => {
    for (let i = 0; i < ITERACIONES; i++) {
      const g = await grupo();
      const [sincronizar, editar] = await Promise.allSettled([
        sincronizarPrecioGrupoCarta([g.coca, g.sprite], 5500, { [g.coca]: 5000, [g.sprite]: 5000 }),
        actualizarProducto(g.coca, datos(`Coca ${g.i}`, 6000, 5000)),
      ]);
      const resumen = [codigo(sincronizar), codigo(editar)];
      expect([["ok", "PRECIO_DESACTUALIZADO"], ["PRECIO_DESACTUALIZADO", "ok"]], `vuelta ${i}: ${resumen.join(" / ")}`).toContainEqual(resumen);
      expect(await precios([g.coca, g.sprite]), `vuelta ${i}`).toEqual(resumen[0] === "ok" ? [5500, 5500] : [6000, 5000]);
    }
  });

  it("los precios vistos con mal formato se rechazan antes de tocar la base", async () => {
    const g = await grupo();
    const mensaje = "Los precios que mostraba la pantalla no son válidos: recargala.";
    for (const malo of [[5000], "5000", { [g.coca]: -1 }, { [g.coca]: 1.234 }]) {
      expect(await sincronizarPrecioGrupoCarta([g.coca], 5500, malo as never)).toEqual({ ok: false, mensaje });
    }
    expect(await precios([g.coca])).toEqual([5000]);
  });
});
