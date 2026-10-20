import { ZONA_ARGENTINA } from "../../src/core/tiempo/zona-horaria";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { cerrarConexiones } from "../setup/gasto";
import { elegida, sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { agregarItemsCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/agregar-items";
import { guardComandoAgregarItems } from "../../src/core/features/cuentas/cuenta-pedido.guard";
import type { ComandoAgregarItems } from "../../src/core/features/cuentas/cuenta-pedido.schema";

/**
 * El PRECIO DE LISTA QUE VIO EL MOZO (`precioDeListaEsperado`) al agregar un ítem, contra Postgres real y por el caso de uso. Si el precio cambió desde que lo eligió (el de la empresa, el
 * local de la sucursal o el de una opción), no se cobra otro en silencio: `PRECIO_CAMBIO` y no se escribe nada. Con el precio de hoy, entra. Sin precio esperado, entra como siempre.
 *
 * Rescatado de `agregar-combinacion-go3.test.ts` (Fase 3 de la ola «precio y carta»: GO-3a se retira y este control NO es de GO-3a, vale para todo producto).
 *
 * Mutación demostrada (roja y revertida): `cambioElPrecio` de `agregar-items.ts` que siempre dice «no cambió» (rojo: los tres rechazos).
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let c: CafeDelSalon;
let cuentaId: string;

const actor = () => ({
  usuarioId: s.admin.id,
  empresaId: EMPRESA_POR_DEFECTO_ID,
  sucursalId: s.sucursalId,
  sucursalNombre: s.sucursal.nombre,
  empresaZonaHoraria: ZONA_ARGENTINA,
  ahora: new Date(),
  ...baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }),
});
const agregar = (items: ComandoAgregarItems["items"]) => agregarItemsCasoDeUso(actor(), { cuentaId, items, promos: [] });

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  c = await sembrarCafeDelSalon(s);
  cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
});
afterEach(cerrarConexiones);

describe("agregar con el precio de lista que vio el mozo", () => {
  describe("PRECIO_CAMBIO: el precio de hoy no es el que vio, y no se escribe nada", () => {
    const casos: [string, () => Promise<ComandoAgregarItems["items"]>][] = [
      ["un producto sin opciones (la milanesa está a 9.000; vio 8.500)", async () => [{ productoId: s.milanesa.id, cantidad: 1, precioDeListaEsperado: 8500 }]],
      // El café grande con almendras: 1000 + 100 + 150 = 1250.
      ["un producto configurado (el café grande con almendras está a 1.250; vio 1.100)", async () => [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId), elegida(c, c.almendrasId)], precioDeListaEsperado: 1100 }]],
      [
        "el precio local de la sucursal cambió el del producto (la milanesa a 9.500 en la sucursal; vio 9.000, el de la empresa)",
        async () => {
          await prisma.precioLocalProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.milanesa.id, precio: "9500.00", habilitado: true } });
          return [{ productoId: s.milanesa.id, cantidad: 1, precioDeListaEsperado: 9000 }];
        },
      ],
    ];
    it.each(casos)("%s", async (_caso, items) => {
      const r = await agregar(await items());
      expect(r).toMatchObject({ ok: false, codigo: "PRECIO_CAMBIO" });
      if (!r.ok) expect(r.mensaje).toMatch(/el precio cambió desde que lo elegiste/);
      expect(await prisma.cuentaItem.count({ where: { cuentaId } })).toBe(0);
    });
  });

  it("con el precio que vio (el de hoy), entra: un producto sin opciones y uno configurado, cada uno a su precio", async () => {
    const r = await agregar([
      { productoId: s.milanesa.id, cantidad: 1, precioDeListaEsperado: 9000 },
      { productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId), elegida(c, c.almendrasId)], precioDeListaEsperado: 1250 },
    ]);
    expect(r.ok, r.mensaje).toBe(true);
    const lineas = await prisma.cuentaItem.findMany({ where: { cuentaId }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
    expect(lineas.map((l) => [l.productoId, Number(l.precioUnitario)]).sort()).toEqual([[c.cafeId, 1250], [s.milanesa.id, 9000]].sort());
  });

  it("sin precio esperado, entra como siempre (al precio de hoy)", async () => {
    expect((await agregar([{ productoId: s.milanesa.id, cantidad: 1 }])).ok).toBe(true);
    expect(Number((await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId } })).precioUnitario)).toBe(9000);
  });

  it("el guard: un precio esperado que no es un importe (texto, negativo, 3 decimales, NaN, infinito, null) se rechaza; 0 y 12,34 pasan; sin él, pasa", () => {
    const g = (precioDeListaEsperado: unknown) => guardComandoAgregarItems({ cuentaId: "c", items: [{ productoId: "p", cantidad: 1, precioDeListaEsperado }], promos: [] }).ok;
    for (const malo of ["1550", -1, 12.345, Number.NaN, Number.POSITIVE_INFINITY, null]) expect(g(malo), String(malo)).toBe(false);
    for (const bueno of [0, 12.34, 0.07, 1550]) expect(g(bueno), String(bueno)).toBe(true);
    expect(guardComandoAgregarItems({ cuentaId: "c", items: [{ productoId: "p", cantidad: 1 }], promos: [] }).ok).toBe(true);
  });
});
