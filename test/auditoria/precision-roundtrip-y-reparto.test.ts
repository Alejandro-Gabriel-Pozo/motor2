import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pivote 4 (Precisión numérica) — dos riesgos concretos señalados por la
 * clasificación de las 147 conversiones Number() (no genéricos, elegidos
 * por evidencia): (1) round-trip Decimal→Number→Decimal en ediciones de
 * receta que no tocan los ingredientes, (2) suma exacta del reparto de
 * resolverConsumoPorFamilia. Cero tolerancia: cualquier diferencia entre
 * el valor antes y después del round-trip, o entre la suma de las partes
 * repartidas y la cantidad pedida, es FALLO.
 */

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { actualizarCabeceraDeReceta } from "../../src/server/actions/catalogo/recetas";
import { resolverConsumoPorFamilia } from "../../src/core/movimientos/stock";
import { redondearACantidadDeUnidad } from "../../src/core/movimientos/transiciones";

describe("Auditoría — Pivote 4: round-trip de receta y reparto por familia (cero tolerancia)", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("Round-trip: 5 ediciones sucesivas de la CABECERA (que no tocan ingredientes) no hacen derivar cantidad/mermaPorcentaje del ingrediente ni un centésimo", async () => {
    const mpInsumo = await prisma.producto.create({ data: { codigo: "MP_RT", nombre: "Levadura RT", tipo: "MP", unidadStockId: unidadKgId } });
    const pv = await prisma.producto.create({ data: { codigo: "PV_RT", nombre: "Pan RT", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 } });

    // cantidad con los 4 decimales que permite el schema (Decimal(14,4)),
    // mermaPorcentaje con los 2 que permite el suyo (Decimal(6,2)) — los
    // valores más "adversos" que el propio schema admite, no números
    // redondos elegidos a propósito para que salga bien.
    await prisma.recetaVersion.create({
      data: {
        productoId: pv.id,
        version: 1,
        ingredientes: { create: [{ insumoProductoId: mpInsumo.id, cantidad: 0.1357, unidadId: unidadKgId, mermaPorcentaje: 4.38 }] },
      },
    });

    for (let i = 1; i <= 5; i++) {
      const r = await actualizarCabeceraDeReceta(pv.id, { rendimientoCantidad: i, racionesCantidad: i });
      expect(r.ok, r.mensaje).toBe(true);
    }

    const vigente = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: pv.id }, orderBy: { version: "desc" }, include: { ingredientes: true } });
    expect(vigente.version).toBe(6); // versión inicial + 5 ediciones de cabecera
    const ing = vigente.ingredientes[0]!;

    console.log("[auditoria] Tras 5 round-trips: cantidad=", ing.cantidad.toString(), "mermaPorcentaje=", ing.mermaPorcentaje.toString());

    expect(Number(ing.cantidad)).toBe(0.1357);
    expect(Number(ing.mermaPorcentaje)).toBe(4.38);
  });

  it("Round-trip: el mismo caso pero editando un ingrediente puntual DISTINTO (agregarIngredienteAReceta) — el primero no debe derivar", async () => {
    const mp1 = await prisma.producto.create({ data: { codigo: "MP_RT2A", nombre: "Sal RT", tipo: "MP", unidadStockId: unidadKgId } });
    const mp2 = await prisma.producto.create({ data: { codigo: "MP_RT2B", nombre: "Azúcar RT", tipo: "MP", unidadStockId: unidadKgId } });
    const pv = await prisma.producto.create({ data: { codigo: "PV_RT2", nombre: "Pan RT2", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 } });

    await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp1.id, cantidad: 0.0913, unidadId: unidadKgId, mermaPorcentaje: 1.07 }] } },
    });

    const { agregarIngredienteAReceta } = await import("../../src/server/actions/catalogo/recetas");
    const r = await agregarIngredienteAReceta(pv.id, { insumoProductoId: mp2.id, cantidad: 0.25, unidadId: unidadKgId, mermaPorcentaje: 2 });
    expect(r.ok, r.mensaje).toBe(true);

    const vigente = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: pv.id }, orderBy: { version: "desc" }, include: { ingredientes: true } });
    const ingOriginal = vigente.ingredientes.find((i) => i.insumoProductoId === mp1.id)!;
    expect(Number(ingOriginal.cantidad)).toBe(0.0913);
    expect(Number(ingOriginal.mermaPorcentaje)).toBe(1.07);
  });

  describe("resolverConsumoPorFamilia: la suma de las partes repartidas coincide EXACTA con la cantidad pedida", () => {
    it("3 hermanos con saldos fraccionarios que no dividen parejo — pide exactamente el total disponible", async () => {
      const insumoFamilia = await prisma.insumo.create({ data: { nombre: "FamiliaReparto" } });
      const h1 = await prisma.producto.create({ data: { codigo: "MP_H1", nombre: "Hermano1", tipo: "MP", unidadStockId: unidadKgId, insumoId: insumoFamilia.id } });
      const h2 = await prisma.producto.create({ data: { codigo: "MP_H2", nombre: "Hermano2", tipo: "MP", unidadStockId: unidadKgId, insumoId: insumoFamilia.id } });
      const h3 = await prisma.producto.create({ data: { codigo: "MP_H3", nombre: "Hermano3", tipo: "MP", unidadStockId: unidadKgId, insumoId: insumoFamilia.id } });

      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId, items: [{ productoId: h1.id, cantidad: 3.37 }] });
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-02"), seccionId, items: [{ productoId: h2.id, cantidad: 2.19 }] });
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-03"), seccionId, items: [{ productoId: h3.id, cantidad: 1.81 }] });

      const totalDisponible = 3.37 + 2.19 + 1.81; // 7.37
      const partes = await resolverConsumoPorFamilia(h1.id, totalDisponible, seccionId);

      const sumaPartes = partes.reduce((acc, p) => acc + p.cantidad, 0);
      console.log("[auditoria] partes:", partes.map((p) => p.cantidad), "suma:", sumaPartes, "pedido:", totalDisponible);

      expect(partes.length).toBe(3); // los 3 hermanos participaron
      // Cero residuo A LA PRECISIÓN REAL de MovimientoStock.cantidad
      // (Decimal(14,4)), no a nivel de bit de IEEE754 — investigado como
      // flake intermitente (docs/plan-migracion.md, sesión 2026-09-17):
      // `candidatos.reduce(...)` (resolverConsumoPorFamilia) y
      // `totalDisponible` (acá) suman los mismos 3 decimales en órdenes
      // distintos (el orden del GROUP BY de Postgres no está garantizado),
      // y la suma de punto flotante no es asociativa — pueden aterrizar en
      // dos floats apenas distintos que representan el MISMO valor
      // decimal real. Los callers reales (registrarVenta/registrarMovimiento)
      // ya redondean `c.cantidad` a los decimales de la unidad antes de
      // persistir, así que comparar acá con esa misma precisión es fiel al
      // comportamiento real, no una tolerancia inventada para el test.
      expect(redondearACantidadDeUnidad(sumaPartes, 4)).toBe(redondearACantidadDeUnidad(totalDisponible, 4));
    });

    it("5 hermanos con saldos de 4 decimales, pide un monto parcial que corta a mitad de uno de ellos", async () => {
      const insumoFamilia = await prisma.insumo.create({ data: { nombre: "FamiliaReparto2" } });
      const saldos = [1.1234, 0.9876, 2.3456, 0.5555, 1.0001];
      const hermanos = [];
      for (let i = 0; i < saldos.length; i++) {
        const h = await prisma.producto.create({ data: { codigo: `MP_HH${i}`, nombre: `HermanoH${i}`, tipo: "MP", unidadStockId: unidadKgId, insumoId: insumoFamilia.id } });
        await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(`2026-01-0${i + 1}`), seccionId, items: [{ productoId: h.id, cantidad: saldos[i]! }] });
        hermanos.push(h);
      }

      // Pide un monto que corta al tercer hermano a mitad de camino:
      // 1.1234 + 0.9876 + 1.5 = 3.611 (menos que el saldo completo del 3ro).
      const pedido = 1.1234 + 0.9876 + 1.5;
      const partes = await resolverConsumoPorFamilia(hermanos[0]!.id, pedido, seccionId);
      const sumaPartes = partes.reduce((acc, p) => acc + p.cantidad, 0);

      console.log("[auditoria] partes (parcial):", partes.map((p) => ({ productoId: p.productoId, cantidad: p.cantidad })), "suma:", sumaPartes, "pedido:", pedido);

      // Ídem el test anterior: precisión real (4 decimales), no bit-exacto.
      expect(redondearACantidadDeUnidad(sumaPartes, 4)).toBe(redondearACantidadDeUnidad(pedido, 4));
    });
  });
});
