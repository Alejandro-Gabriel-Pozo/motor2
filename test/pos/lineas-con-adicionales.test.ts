import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { elegida, sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { agruparConAdicionales, elegidasDeLaLinea } from "../../src/core/pos/lineas-con-adicionales";
import { agregarItems, enviarACocina } from "../../src/server/actions/pos/cuenta-pedido";
import { obtenerDetalleDeMesa } from "../../src/server/consultas/pos/detalle-de-mesa";

/**
 * GO-2d (ADR-030): en la mesa, cada adicional va debajo de su producto y «Otro igual» arranca el diálogo con lo elegido en la línea. Puro: la agrupación respeta el orden, no
 * esconde nada (un adicional sin su producto en la lista queda como línea) y junta lo elegido del producto y de sus adicionales. Contra Postgres: el detalle de la mesa trae lo
 * necesario (el padre de cada adicional y lo elegido) y «Otro igual» con eso pide una línea IDÉNTICA (misma huella).
 *
 * Mutaciones (rojo → revertido → verde): en `agruparConAdicionales`, dejar el adicional también como línea propia (el primer caso ve una línea de más); en `elegidasDeLaLinea`,
 * no sumar las de los adicionales (el «Otro igual» de Postgres pide un café sin shot y la huella cambia).
 */
describe("agruparConAdicionales y elegidasDeLaLinea (puro)", () => {
  const items = [
    { id: "c1", elegidas: [{ opcionId: "grande", cantidad: 1 }] },
    { id: "m" },
    { id: "s1", lineaPadreId: "c1", elegidas: [{ opcionId: "shot", cantidad: 2 }] },
    { id: "c2", elegidas: [{ opcionId: "chico", cantidad: 1 }] },
    { id: "h", lineaPadreId: "c1", elegidas: [{ opcionId: "crema", cantidad: 1 }] },
  ];

  it("cada adicional va bajo su producto, en el orden de los productos", () => {
    expect(agruparConAdicionales(items).map((l) => [l.item.id, l.adicionales.map((a) => a.id)])).toEqual([
      ["c1", ["s1", "h"]],
      ["m", []],
      ["c2", []],
    ]);
  });

  it("un adicional cuyo producto no está en la lista queda como una línea más (nunca se esconde)", () => {
    expect(agruparConAdicionales([{ id: "s", lineaPadreId: "otro" }]).map((l) => l.item.id)).toEqual(["s"]);
  });

  it("«Otro igual» junta lo del producto y lo de cada adicional (por unidad); sin opciones, vacío", () => {
    const [cafe, mila] = agruparConAdicionales(items);
    expect(elegidasDeLaLinea(cafe!)).toEqual([
      { opcionId: "grande", cantidad: 1 },
      { opcionId: "shot", cantidad: 2 },
      { opcionId: "crema", cantidad: 1 },
    ]);
    expect(elegidasDeLaLinea(mila!)).toEqual([]);
  });
});

describe("el detalle de la mesa alcanza para «Otro igual» (contra Postgres)", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let c: CafeDelSalon;
  let cuentaId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    c = await sembrarCafeDelSalon(s);
    await entrarComo(s.admin);
    cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
    expect((await agregarItems(cuentaId, [{ productoId: c.cafeId, cantidad: 2, opciones: [elegida(c, c.grandeId), elegida(c, c.almendrasId), elegida(c, c.shotId, 2)] }, { productoId: s.flan.id, cantidad: 1 }])).ok).toBe(true);
  });

  const detalle = async () => (await obtenerDetalleDeMesa(s.sucursalId, s.mesa.id, baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }).db, new Date()))!.cuenta!;

  it("sin enviar: el shot cuelga del café, y lo elegido de la línea es lo que se pidió", async () => {
    const lineas = agruparConAdicionales((await detalle()).sinEnviar);
    // El orden entre las líneas de un mismo pedido es el de la consulta (creación y id); acá importa que el shot cuelgue del café.
    expect(lineas.map((l) => [l.item.productoNombre, l.adicionales.map((a) => a.productoId)])).toEqual(
      expect.arrayContaining([
        ["Café", [c.anclaDelShotId]],
        ["Flan", []],
      ])
    );
    expect(lineas).toHaveLength(2);
    const cafe = lineas.find((l) => l.item.productoNombre === "Café")!;
    const flan = lineas.find((l) => l.item.productoNombre === "Flan")!;
    expect(elegidasDeLaLinea(cafe)).toEqual(
      expect.arrayContaining([
        { opcionId: c.grandeId, cantidad: 1 },
        { opcionId: c.almendrasId, cantidad: 1 },
        { opcionId: c.shotId, cantidad: 2 },
      ])
    );
    expect(elegidasDeLaLinea(cafe)).toHaveLength(3);
    // El flan (sin opciones) llega como siempre: sin campos nuevos.
    expect(flan.item).not.toHaveProperty("elegidas");
    expect(flan.item).not.toHaveProperty("lineaPadreId");
  });

  it("«Otro igual» desde la línea ya enviada pide una línea idéntica: misma huella y el mismo adicional", async () => {
    const items = await prisma.cuentaItem.findMany({ where: { cuentaId } });
    expect((await enviarACocina(cuentaId, items.map((i) => i.id))).ok).toBe(true);
    const linea = agruparConAdicionales((await detalle()).envios[0]!.items).find((l) => l.item.productoNombre === "Café")!;
    const otra = elegidasDeLaLinea(linea).map((e) => elegida(c, e.opcionId, e.cantidad));
    expect(await agregarItems(cuentaId, [{ productoId: c.cafeId, cantidad: 1, opciones: otra }])).toMatchObject({ ok: true });

    const cafes = await prisma.cuentaItem.findMany({ where: { cuentaId, productoId: c.cafeId }, orderBy: { creadoEn: "asc" } });
    expect(cafes).toHaveLength(2);
    expect(cafes[1]!.huellaOpciones).toBe(cafes[0]!.huellaOpciones);
    expect(Number(cafes[1]!.precioUnitario)).toBe(Number(cafes[0]!.precioUnitario));
    const shots = await prisma.cuentaItem.findMany({ where: { cuentaId, lineaPadreId: cafes[1]!.id } });
    expect(shots.map((x) => [x.productoId, Number(x.cantidad)])).toEqual([[c.anclaDelShotId, 2]]);
  });
});
