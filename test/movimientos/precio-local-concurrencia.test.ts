import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { setPrecioLocalProducto } from "../../src/server/actions/catalogo/precio-local";
import type { ResultadoConSincronizable } from "../../src/server/actions/tipos";

/**
 * Precio local de un producto con control del VALOR VISTO (ola «precio y carta», Fase 2, paso A2), por la Server Action pública y contra Postgres real: lo que
 * vio la pantalla (la fila como estaba, o «no había») se compara con la base DENTRO de una transacción SERIALIZABLE antes de escribir. Dos personas con la
 * misma pantalla no se pisan en silencio; el mismo pedido repetido es un solo cambio.
 */
const ITERACIONES = 8;

describe("precio local: control del valor visto (A2)", () => {
  let sucursalId: string;
  let unidadId: string;
  let n = 0;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
  });

  const producto = async (nombre: string) =>
    (await sembrarProductoDisponible({ codigo: `PV_PL_${n++}`, nombre, tipo: "PV", precioVenta: 1000, unidadStockId: unidadId }, sucursalId)).id;
  const conLocal = async (nombre: string, precio: number, habilitado = true) => {
    const id = await producto(nombre);
    await prisma.precioLocalProducto.create({ data: { sucursalId, productoId: id, precio, habilitado } });
    return id;
  };
  const local = async (productoId: string) => {
    const f = await prisma.precioLocalProducto.findUnique({ where: { sucursalId_productoId: { sucursalId, productoId } } });
    return f ? `${f.precio.toFixed(2)}${f.habilitado ? "" : " (deshabilitado)"}` : null;
  };
  const auditorias = async (productoId: string) => {
    const f = await prisma.precioLocalProducto.findUnique({ where: { sucursalId_productoId: { sucursalId, productoId } } });
    return f ? prisma.registroAuditoria.count({ where: { entidad: "PrecioLocalProducto", entidadId: f.id } }) : 0;
  };
  const resumen = (res: PromiseSettledResult<ResultadoConSincronizable>[]) =>
    res.map((r) => (r.status === "rejected" ? `error:${String(r.reason)}` : r.value.ok ? "ok" : r.value.mensaje.includes("cambió mientras lo editabas") ? "PRECIO_DESACTUALIZADO" : r.value.mensaje)).sort();

  it(`concurrencia (${ITERACIONES} vueltas): dos guardados DISTINTOS con el mismo valor visto → uno gana y el otro PRECIO_DESACTUALIZADO; queda el del ganador, con UNA auditoría`, async () => {
    for (let i = 0; i < ITERACIONES; i++) {
      const id = await conLocal(`Coca ${i}`, 1000);
      const visto = { precio: 1000, habilitado: true };
      const res = await Promise.allSettled([setPrecioLocalProducto(id, 1100, true, visto), setPrecioLocalProducto(id, 1200, true, visto)]);
      expect(resumen(res), `vuelta ${i}`).toEqual(["PRECIO_DESACTUALIZADO", "ok"]);
      const gano = res.findIndex((r) => r.status === "fulfilled" && r.value.ok);
      expect(await local(id), `vuelta ${i}`).toBe(gano === 0 ? "1100.00" : "1200.00");
      expect(await auditorias(id), `vuelta ${i}`).toBe(1); // solo el precio cambió (habilitado ya era true)
    }
  });

  it(`concurrencia (${ITERACIONES} vueltas): el MISMO guardado dos veces a la vez → dos ok, una sola escritura y una sola auditoría`, async () => {
    for (let i = 0; i < ITERACIONES; i++) {
      const id = await conLocal(`Fanta ${i}`, 1000);
      const pedido = () => setPrecioLocalProducto(id, 1100, true, { precio: 1000, habilitado: true });
      expect(resumen(await Promise.allSettled([pedido(), pedido()])), `vuelta ${i}`).toEqual(["ok", "ok"]);
      expect(await local(id), `vuelta ${i}`).toBe("1100.00");
      expect(await auditorias(id), `vuelta ${i}`).toBe(1);
    }
  });

  it(`concurrencia (${ITERACIONES} vueltas): la PRIMERA alta de la misma celda con dos precios → una gana y la otra PRECIO_DESACTUALIZADO`, async () => {
    for (let i = 0; i < ITERACIONES; i++) {
      const id = await producto(`Sprite ${i}`);
      const res = await Promise.allSettled([setPrecioLocalProducto(id, 1100, true), setPrecioLocalProducto(id, 1200, true, null)]);
      expect(resumen(res), `vuelta ${i}`).toEqual(["PRECIO_DESACTUALIZADO", "ok"]);
      expect(await prisma.precioLocalProducto.count({ where: { productoId: id } })).toBe(1);
      expect(await auditorias(id), `vuelta ${i}`).toBe(2); // alta: precio y habilitado
    }
  });

  it("IDEMPOTENTE: repetir el mismo pedido (con el valor visto de antes) es éxito con el mismo mensaje, sin escribir ni auditar de nuevo", async () => {
    const id = await conLocal("Tónica", 1000);
    const pedido = () => setPrecioLocalProducto(id, 1500.5, true, { precio: 1000, habilitado: true });
    expect(await pedido()).toEqual({ ok: true, mensaje: 'Precio local de "Tónica" fijado en 1500.5.' });
    expect(await pedido()).toEqual({ ok: true, mensaje: 'Precio local de "Tónica" fijado en 1500.5.' });
    expect([await local(id), await auditorias(id)]).toEqual(["1500.50", 1]);
  });

  it("un valor visto viejo (otro lo cambió) → PRECIO_DESACTUALIZADO con el precio de ahora, sin escribir ni auditar", async () => {
    const id = await conLocal("Agua", 1100);
    expect(await setPrecioLocalProducto(id, 1300, true, { precio: 1000, habilitado: true })).toEqual({
      ok: false,
      mensaje: 'El precio local de "Agua" cambió mientras lo editabas (ahora es $1.100). Recargá la pantalla y volvé a hacer el cambio.',
    });
    // Habilitar/Deshabilitar desde la fila con el estado viejo: el otro ya lo había deshabilitado.
    await prisma.precioLocalProducto.update({ where: { sucursalId_productoId: { sucursalId, productoId: id } }, data: { habilitado: false } });
    expect(await setPrecioLocalProducto(id, 1100, false, { precio: 1100, habilitado: true })).toMatchObject({ ok: true }); // ya estaba así
    expect(await setPrecioLocalProducto(id, 1200, false, { precio: 1100, habilitado: true })).toEqual({
      ok: false,
      mensaje: 'El precio local de "Agua" cambió mientras lo editabas (ahora es $1.100, deshabilitado). Recargá la pantalla y volvé a hacer el cambio.',
    });
    expect([await local(id), await auditorias(id)]).toEqual(["1100.00 (deshabilitado)", 0]);
  });

  it("falla cerrado: sin valor visto («no había») y con una fila en la base → no pisa; con «había» y sin fila → tampoco crea", async () => {
    const id = await conLocal("Pomelo", 1000);
    expect(await setPrecioLocalProducto(id, 900, true)).toMatchObject({ ok: false, mensaje: expect.stringContaining("cambió mientras lo editabas (ahora es $1.000)") });
    const otro = await producto("Limón");
    expect(await setPrecioLocalProducto(otro, 900, true, { precio: 800, habilitado: true })).toMatchObject({ ok: false, mensaje: expect.stringContaining("(ahora no tiene precio local)") });
    expect([await local(id), await local(otro)]).toEqual(["1000.00", null]);
  });

  it("el valor visto se compara al centavo (el Decimal de la base y el número de la pantalla)", async () => {
    const id = await conLocal("Pera", 3500.5);
    expect(await setPrecioLocalProducto(id, 3600, true, { precio: 3500.5, habilitado: true })).toMatchObject({ ok: true });
    expect(await local(id)).toBe("3600.00");
  });

  it("un valor visto con mal formato se rechaza antes de tocar la base", async () => {
    const id = await conLocal("Uva", 1000);
    const mensaje = "El precio local que mostraba la pantalla no es válido: recargala.";
    for (const malo of ["1000", { precio: -1, habilitado: true }, { precio: 1000 }, { precio: "x", habilitado: true }]) {
      expect(await setPrecioLocalProducto(id, 1100, true, malo as never)).toEqual({ ok: false, mensaje });
    }
    expect(await local(id)).toBe("1000.00");
  });
});
