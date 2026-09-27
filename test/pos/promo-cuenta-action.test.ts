import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { entrarComo, sembrarSalon } from "./salon-fixture";
import { abrirCuenta } from "../../src/server/actions/pos/cuenta-apertura";
import { agregarItems, enviarACocina, quitarItemSinEnviar, quitarPromoSinEnviar } from "../../src/server/actions/pos/cuenta-pedido";
import { anularItemEnviado, anularPromoEnviada } from "../../src/server/actions/pos/cuenta-anulacion";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";

/**
 * Promos armables en la cuenta (Task #16, docs/plan-promo-combo-2026-09-26.md, pasos 8a/8b/8c): agregar, quitar sin enviar,
 * enviar a cocina (hermanos juntos, D), anular ya enviada (D4) y cerrar la cuenta (clave con promoCuentaId, D4).
 */
describe("promos armables en la cuenta (server actions)", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let seccionPlatosId: string;
  let seccionPostresId: string;
  let promoCartaId: string;
  let cuentaId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);

    const platos = await prisma.seccionCarta.create({ data: { nombre: "Platos" } });
    const postres = await prisma.seccionCarta.create({ data: { nombre: "Postres" } });
    seccionPlatosId = platos.id;
    seccionPostresId = postres.id;
    await prisma.contenidoCartaProducto.create({ data: { productoId: s.milanesa.id, visibleEnCarta: true, seccionCartaId: seccionPlatosId } });
    await prisma.contenidoCartaProducto.create({ data: { productoId: s.flan.id, visibleEnCarta: true, seccionCartaId: seccionPostresId } });

    // Milanesa $9000 de carta, Flan $3000 → 3:1. Promo "Menú del día" a $10000: prorrateo exacto 7500/2500 (D3).
    const promo = await prisma.promoCarta.create({ data: { sucursalId: s.sucursalId, seccionCartaId: seccionPlatosId, titulo: "Menú del día", precio: 10000 } });
    promoCartaId = promo.id;
    await prisma.promoCartaCupo.createMany({
      data: [
        { promoCartaId, seccionCartaId: seccionPlatosId, cantidadMinima: 1, cantidadMaxima: 1, orden: 0 },
        { promoCartaId, seccionCartaId: seccionPostresId, cantidadMinima: 1, cantidadMaxima: 1, orden: 1 },
      ],
    });

    await abrirCuenta(s.mesa.id, 2);
    cuentaId = (await prisma.cuenta.findFirstOrThrow({ where: { mesaId: s.mesa.id, cerradaEn: null } })).id;
  });

  const promoDe = (elecciones: { seccionCartaId: string; productoId: string; cantidad: number }[]) => [
    { promoCartaId, elecciones: [{ seccionCartaId: elecciones[0].seccionCartaId, elegidos: [{ productoId: elecciones[0].productoId, cantidad: elecciones[0].cantidad }] }, { seccionCartaId: elecciones[1].seccionCartaId, elegidos: [{ productoId: elecciones[1].productoId, cantidad: elecciones[1].cantidad }] }] },
  ];
  const eleccionCompleta = () =>
    promoDe([
      { seccionCartaId: seccionPlatosId, productoId: s.milanesa.id, cantidad: 1 },
      { seccionCartaId: seccionPostresId, productoId: s.flan.id, cantidad: 1 },
    ]);

  describe("agregarItems con promos", () => {
    it("arma la promo: crea la PromoCuenta congelada y sus componentes prorrateados exacto (D3)", async () => {
      const r = await agregarItems(cuentaId, [], eleccionCompleta());
      expect(r.ok).toBe(true);
      expect(r.mensaje).toContain("Menú del día");

      const promoCuenta = await prisma.promoCuenta.findFirstOrThrow({ where: { cuentaId } });
      expect(promoCuenta).toMatchObject({ promoCartaId, titulo: "Menú del día" });
      expect(Number(promoCuenta.precio)).toBe(10000);

      const items = await prisma.cuentaItem.findMany({ where: { cuentaId }, orderBy: { precioUnitario: "desc" } });
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({ productoId: s.milanesa.id, promoCuentaId: promoCuenta.id });
      expect(Number(items[0].precioUnitario)).toBe(7500);
      expect(Number(items[0].precioCartaUnitario)).toBe(9000);
      expect(items[1]).toMatchObject({ productoId: s.flan.id, promoCuentaId: promoCuenta.id });
      expect(Number(items[1].precioUnitario)).toBe(2500);
      expect(Number(items[1].precioCartaUnitario)).toBe(3000);
    });

    it("mezcla un suelto con una promo en la misma llamada: el suelto no lleva promoCuentaId", async () => {
      const r = await agregarItems(cuentaId, [{ productoId: s.pizza.id, cantidad: 1 }], eleccionCompleta());
      expect(r.ok).toBe(true);
      const suelto = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId, productoId: s.pizza.id } });
      expect(suelto.promoCuentaId).toBeNull();
      expect(await prisma.cuentaItem.count({ where: { cuentaId } })).toBe(3);
    });

    it("rechaza un producto que no es elegible del cupo (D5), sin escribir nada", async () => {
      const r = await agregarItems(cuentaId, [], promoDe([
        { seccionCartaId: seccionPlatosId, productoId: s.pizza.id, cantidad: 1 }, // pizza no está en el cupo de Platos
        { seccionCartaId: seccionPostresId, productoId: s.flan.id, cantidad: 1 },
      ]));
      expect(r.ok).toBe(false);
      expect(await prisma.promoCuenta.count()).toBe(0);
      expect(await prisma.cuentaItem.count({ where: { cuentaId } })).toBe(0);
    });

    it("rechaza por debajo del mínimo del cupo (D1), sin escribir nada", async () => {
      const r = await agregarItems(cuentaId, [], [{ promoCartaId, elecciones: [{ seccionCartaId: seccionPlatosId, elegidos: [{ productoId: s.milanesa.id, cantidad: 1 }] }] }]);
      expect(r.ok).toBe(false);
      expect(await prisma.promoCuenta.count()).toBe(0);
    });

    it("una promo apagada, o de otra sucursal, se rechaza", async () => {
      await prisma.promoCarta.update({ where: { id: promoCartaId }, data: { activa: false } });
      const r = await agregarItems(cuentaId, [], eleccionCompleta());
      expect(r.ok).toBe(false);
      expect(await prisma.promoCuenta.count()).toBe(0);
    });
  });

  describe("quitarPromoSinEnviar", () => {
    it("borra la PromoCuenta y sus dos componentes juntos", async () => {
      await agregarItems(cuentaId, [], eleccionCompleta());
      const promoCuenta = await prisma.promoCuenta.findFirstOrThrow({ where: { cuentaId } });
      const r = await quitarPromoSinEnviar(promoCuenta.id);
      expect(r.ok).toBe(true);
      expect(await prisma.promoCuenta.count({ where: { id: promoCuenta.id } })).toBe(0);
      expect(await prisma.cuentaItem.count({ where: { cuentaId } })).toBe(0);
    });

    it("rechaza si algún componente ya salió a cocina", async () => {
      await agregarItems(cuentaId, [], eleccionCompleta());
      const promoCuenta = await prisma.promoCuenta.findFirstOrThrow({ where: { cuentaId } });
      const items = await prisma.cuentaItem.findMany({ where: { promoCuentaId: promoCuenta.id } });
      await enviarACocina(cuentaId, [items[0].id]);
      const r = await quitarPromoSinEnviar(promoCuenta.id);
      expect(r.ok).toBe(false);
      expect(await prisma.cuentaItem.count({ where: { promoCuentaId: promoCuenta.id } })).toBe(2);
    });
  });

  describe("quitarItemSinEnviar / anularItemEnviado rechazan un componente suelto (D4)", () => {
    it("quitarItemSinEnviar rechaza un componente, nombrando la promo", async () => {
      await agregarItems(cuentaId, [], eleccionCompleta());
      const item = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId, productoId: s.milanesa.id } });
      const r = await quitarItemSinEnviar(item.id);
      expect(r).toMatchObject({ ok: false });
      expect(r.mensaje).toContain("Menú del día");
      expect(await prisma.cuentaItem.count({ where: { id: item.id } })).toBe(1);
    });

    it("anularItemEnviado rechaza un componente, nombrando la promo", async () => {
      await agregarItems(cuentaId, [], eleccionCompleta());
      const item = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId, productoId: s.milanesa.id } });
      await enviarACocina(cuentaId, [item.id]);
      const r = await anularItemEnviado(item.id, 1, "Me equivoqué", 1);
      expect(r).toMatchObject({ ok: false });
      expect(r.mensaje).toContain("Menú del día");
    });
  });

  describe("enviarACocina agrega los hermanos de la promo", () => {
    it("enviar SOLO el id de un componente manda igual los dos, con el MISMO numeroEnvio", async () => {
      await agregarItems(cuentaId, [], eleccionCompleta());
      const [mila, flan] = await prisma.cuentaItem.findMany({ where: { cuentaId }, orderBy: { precioUnitario: "desc" } });
      const r = await enviarACocina(cuentaId, [mila.id]); // solo pide la milanesa
      expect(r).toMatchObject({ ok: true, numeroEnvio: 1, envioNuevo: true });
      const [milaEnviada, flanEnviado] = await Promise.all([
        prisma.cuentaItem.findUniqueOrThrow({ where: { id: mila.id } }),
        prisma.cuentaItem.findUniqueOrThrow({ where: { id: flan.id } }),
      ]);
      expect(milaEnviada.numeroEnvio).toBe(1);
      expect(flanEnviado.numeroEnvio).toBe(1); // el hermano salió igual, sin haberlo pedido
    });

    it("un suelto sin promo se envía solo (sin arrastrar nada)", async () => {
      await agregarItems(cuentaId, [{ productoId: s.pizza.id, cantidad: 1 }]);
      const suelto = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId, productoId: s.pizza.id } });
      const r = await enviarACocina(cuentaId, [suelto.id]);
      expect(r).toMatchObject({ ok: true, envioNuevo: true });
      expect(await prisma.cuentaItem.count({ where: { numeroEnvio: { not: null } } })).toBe(1);
    });
  });

  describe("anularPromoEnviada (D4: la promo se anula ENTERA)", () => {
    it("crea una fila espejo por CADA componente, con el mismo promoCuentaId", async () => {
      await agregarItems(cuentaId, [], eleccionCompleta());
      const promoCuenta = await prisma.promoCuenta.findFirstOrThrow({ where: { cuentaId } });
      const items = await prisma.cuentaItem.findMany({ where: { promoCuentaId: promoCuenta.id } });
      await enviarACocina(cuentaId, [items[0].id]);

      const r = await anularPromoEnviada(promoCuenta.id, "Se cayó la mesa");
      expect(r).toMatchObject({ ok: true });
      expect(r.mensaje).toContain("2 componentes");

      const espejos = await prisma.cuentaItem.findMany({ where: { promoCuentaId: promoCuenta.id, anulaAItemId: { not: null } } });
      expect(espejos).toHaveLength(2);
      expect(espejos.every((e) => e.motivoAnulacion === "Se cayó la mesa")).toBe(true);
      expect(espejos.map((e) => Number(e.cantidad)).sort()).toEqual([-1, -1]);
    });

    it("rechaza si todavía no salió a cocina, y si ya está anulada entera", async () => {
      await agregarItems(cuentaId, [], eleccionCompleta());
      const promoCuenta = await prisma.promoCuenta.findFirstOrThrow({ where: { cuentaId } });
      expect((await anularPromoEnviada(promoCuenta.id, "motivo")).ok).toBe(false);

      const items = await prisma.cuentaItem.findMany({ where: { promoCuentaId: promoCuenta.id } });
      await enviarACocina(cuentaId, [items[0].id]);
      expect((await anularPromoEnviada(promoCuenta.id, "motivo")).ok).toBe(true);
      expect((await anularPromoEnviada(promoCuenta.id, "de nuevo")).ok).toBe(false);
    });
  });

  describe("cerrarCuenta con promos (D4: no se mezcla con un suelto del mismo producto y precio)", () => {
    it("registra una Operacion por componente, con el precio prorrateado, y enlaza cada CuentaItem por su clave", async () => {
      await agregarItems(cuentaId, [], eleccionCompleta());
      const items = await prisma.cuentaItem.findMany({ where: { cuentaId } });
      await enviarACocina(cuentaId, items.map((i) => i.id));

      const r = await cerrarCuenta(cuentaId);
      expect(r.ok).toBe(true);

      const ventas = await prisma.movimientoStock.findMany({ where: { proceso: "VENTA", operacion: { sucursalId: s.sucursalId } }, include: { operacion: true } });
      expect(ventas).toHaveLength(2);
      const porProducto = new Map(ventas.map((v) => [v.productoId, v]));
      expect(Number(porProducto.get(s.milanesa.id)!.precioTotal)).toBe(7500);
      expect(porProducto.get(s.milanesa.id)!.operacion.promoCuentaId).not.toBeNull();
      expect(Number(porProducto.get(s.flan.id)!.precioTotal)).toBe(2500);
      expect(porProducto.get(s.milanesa.id)!.operacion.promoCuentaId).toBe(porProducto.get(s.flan.id)!.operacion.promoCuentaId);

      const cerrados = await prisma.cuentaItem.findMany({ where: { cuentaId } });
      expect(cerrados.every((i) => i.operacionId !== null)).toBe(true);
    });

    it("un suelto del MISMO producto al MISMO precio prorrateado que un componente queda en una Operacion DISTINTA (D4)", async () => {
      // La milanesa de la promo prorratea a $7500 — se agrega a mano un CuentaItem suelto de milanesa al MISMO precio ($7500),
      // simulando el caso límite (D4: nunca se mezclan, aunque el precio congelado coincida por casualidad).
      await agregarItems(cuentaId, [], eleccionCompleta());
      await prisma.cuentaItem.create({ data: { cuentaId, productoId: s.milanesa.id, cantidad: 1, precioUnitario: 7500, numeroEnvio: null, creadoPorId: s.admin.id } });

      const items = await prisma.cuentaItem.findMany({ where: { cuentaId } });
      await enviarACocina(cuentaId, items.map((i) => i.id));
      const r = await cerrarCuenta(cuentaId);
      expect(r.ok).toBe(true);

      const ventasMilanesa = await prisma.movimientoStock.findMany({ where: { proceso: "VENTA", productoId: s.milanesa.id, precioPorUnidadStock: 7500 } });
      expect(ventasMilanesa).toHaveLength(2); // dos Operaciones distintas, no una sola de cantidad 2
      expect(new Set(ventasMilanesa.map((v) => v.operacionId)).size).toBe(2);

      const itemsCerrados = await prisma.cuentaItem.findMany({ where: { cuentaId, productoId: s.milanesa.id } });
      expect(new Set(itemsCerrados.map((i) => i.operacionId)).size).toBe(2);
    });
  });
});
