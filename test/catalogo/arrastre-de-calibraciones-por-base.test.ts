import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { fijarRendimientoLocal } from "../../src/server/actions/catalogo/rendimiento-local";
import { guardarRecetaConBase } from "../setup/guardar-receta-con-base";
import type { BaseDeCantidad } from "../../src/core/catalogo/public";

/**
 * M3d (docs/diseno-merma-m3d-rendimiento-y-calibracion-2026-11-17.md, R-6, R-7): la calibración por sucursal hereda la base de su línea. Al guardar una versión central nueva en OTRA base que la
 * vieja (neta → bruta), las calibraciones se DESCARTAN con registro (quién, cuándo, valor descartado, sucursal), nunca en silencio y sin convertir (dueño, 2026-11-17: «no habria problema con
 * removerlas o cualquier solución barata»). Con la misma base se arrastran como siempre (D3). Contra Postgres real.
 */
describe("arrastre de calibraciones según la base de la versión (M3d)", () => {
  let sucursalId: string;
  let sucursalNorteId: string;
  let unidadKgId: string;
  let adminId: string;
  let pv: { id: string; nombre: string };
  let mp: { id: string; nombre: string };

  /** La v1 se escribe directo con la base pedida (hoy ningún camino de la aplicación escribe BRUTA). Devuelve el id de su única línea. */
  async function sembrarV1(base: BaseDeCantidad): Promise<string> {
    const receta = await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, baseDeCantidad: base, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, mermaPorcentaje: 10, unidadId: unidadKgId }] } },
      include: { ingredientes: true },
    });
    return receta.ingredientes[0].id;
  }
  const linea = () => [{ insumoProductoId: mp.id, cantidad: 1, mermaPorcentaje: 10, unidadId: unidadKgId }];
  const entidadId = () => `${sucursalId}:${pv.id}:${mp.id}`;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    sucursalNorteId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    const { kg } = await sembrarCatalogoBase();
    unidadKgId = kg.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    adminId = admin.id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    mp = await sembrarProductoDisponible({ codigo: "MP_BASE", nombre: "Bife", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    pv = await sembrarProductoDisponible({ codigo: "PV_BASE", nombre: "Bife a la criolla", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
  });

  it("neta → neta: la calibración se arrastra a la versión nueva (como siempre)", async () => {
    const lineaV1 = await sembrarV1("NETA");
    expect((await fijarRendimientoLocal(lineaV1, { cantidad: 1.8, mermaPorcentaje: 20 })).ok).toBe(true);

    const r = await guardarRecetaConBase(pv.id, linea(), "NETA");
    expect(r.ok, r.mensaje).toBe(true);
    expect(r.mensaje).not.toContain("descartó");

    const v2 = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: pv.id, version: 2 }, include: { ingredientes: true } });
    const fila = await prisma.rendimientoLocalIngrediente.findUniqueOrThrow({ where: { recetaIngredienteId_sucursalId: { recetaIngredienteId: v2.ingredientes[0].id, sucursalId } } });
    expect(Number(fila.cantidad)).toBe(1.8);
  });

  it("bruta → bruta: la calibración (en bruto) se arrastra a la versión nueva", async () => {
    const lineaV1 = await sembrarV1("BRUTA");
    expect((await fijarRendimientoLocal(lineaV1, { cantidad: 1.8, mermaPorcentaje: 20 })).ok).toBe(true);

    const r = await guardarRecetaConBase(pv.id, linea(), "BRUTA");
    expect(r.ok, r.mensaje).toBe(true);
    expect(r.mensaje).not.toContain("descartó");

    const v2 = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: pv.id, version: 2 }, include: { ingredientes: true } });
    expect(v2.baseDeCantidad).toBe("BRUTA");
    const fila = await prisma.rendimientoLocalIngrediente.findUniqueOrThrow({ where: { recetaIngredienteId_sucursalId: { recetaIngredienteId: v2.ingredientes[0].id, sucursalId } } });
    expect(Number(fila.cantidad)).toBe(1.8);
    expect(Number(fila.mermaPorcentaje)).toBe(20);
  });

  it("neta → bruta: las calibraciones de TODAS las sucursales se descartan con registro (quién, valor y sucursal), nunca en silencio, y no se convierten", async () => {
    const lineaV1 = await sembrarV1("NETA");
    expect((await fijarRendimientoLocal(lineaV1, { cantidad: 1.8, mermaPorcentaje: 20 })).ok).toBe(true);
    // La calibración de otra sucursal (la acción solo escribe en la activa): se arma directo, como la dejaría esa sucursal.
    await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId: lineaV1, sucursalId: sucursalNorteId, cantidad: 0.9, mermaPorcentaje: null } });

    const r = await guardarRecetaConBase(pv.id, linea(), "BRUTA");
    expect(r.ok, r.mensaje).toBe(true);
    expect(r.mensaje).toContain("descartó");
    expect(r.mensaje).toContain("la receta pasó de neta a bruta");

    const v2 = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: pv.id, version: 2 }, include: { ingredientes: true } });
    expect(v2.baseDeCantidad).toBe("BRUTA");
    // Nada colgado de la línea nueva: ni copiado ni convertido.
    expect(await prisma.rendimientoLocalIngrediente.count({ where: { recetaIngredienteId: v2.ingredientes[0].id } })).toBe(0);
    // Las filas de la versión vieja no se tocan (solo se agrega).
    expect(await prisma.rendimientoLocalIngrediente.count({ where: { recetaIngredienteId: lineaV1 } })).toBe(2);

    // El registro: una fila por campo con el valor descartado, el actor y la sucursal de CADA calibración.
    const central = await prisma.registroAuditoria.findMany({ where: { entidad: "RendimientoLocalIngrediente", entidadId: entidadId(), valorNuevo: null }, orderBy: { campo: "asc" } });
    expect(central.map((x) => [x.campo, Number(x.valorAnterior)])).toEqual([["cantidad", 1.8], ["mermaPorcentaje", 20]]);
    expect(central.every((x) => x.actorId === adminId && x.sucursalId === sucursalId && x.descripcion.includes("la receta pasó de neta a bruta") && x.descripcion.includes("versión 2"))).toBe(true);
    expect(central.every((x) => x.creadoEn instanceof Date)).toBe(true);
    const norte = await prisma.registroAuditoria.findMany({ where: { entidad: "RendimientoLocalIngrediente", entidadId: `${sucursalNorteId}:${pv.id}:${mp.id}`, campo: "cantidad", valorNuevo: null } });
    expect(norte).toHaveLength(1);
    expect(Number(norte[0].valorAnterior)).toBe(0.9);
    expect(norte[0].sucursalId).toBe(sucursalNorteId);
  });

  it("bruta → neta (al revés) también descarta: nunca se reinterpreta un número en otra base", async () => {
    const lineaV1 = await sembrarV1("BRUTA");
    expect((await fijarRendimientoLocal(lineaV1, { cantidad: 1.8, mermaPorcentaje: 20 })).ok).toBe(true);

    const r = await guardarRecetaConBase(pv.id, linea(), "NETA");
    expect(r.ok, r.mensaje).toBe(true);
    expect(r.mensaje).toContain("la receta pasó de bruta a neta");
    const v2 = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: pv.id, version: 2 }, include: { ingredientes: true } });
    expect(await prisma.rendimientoLocalIngrediente.count({ where: { recetaIngredienteId: v2.ingredientes[0].id } })).toBe(0);
  });

  it("sin calibraciones, pasar de neta a bruta no descarta ni audita nada (no hay aviso)", async () => {
    await sembrarV1("NETA");
    const r = await guardarRecetaConBase(pv.id, linea(), "BRUTA");
    expect(r.ok, r.mensaje).toBe(true);
    expect(r.mensaje).not.toContain("descartó");
    expect(await prisma.registroAuditoria.count({ where: { entidad: "RendimientoLocalIngrediente" } })).toBe(0);
  });

  it("IDEMPOTENCIA: repetir el mismo guardado con la misma versión esperada no vuelve a descartar ni duplica el registro", async () => {
    const lineaV1 = await sembrarV1("NETA");
    expect((await fijarRendimientoLocal(lineaV1, { cantidad: 1.8, mermaPorcentaje: 20 })).ok).toBe(true);
    const antes = await prisma.registroAuditoria.count({ where: { entidad: "RendimientoLocalIngrediente", valorNuevo: null } });

    const primera = await guardarRecetaConBase(pv.id, linea(), "BRUTA", 1);
    const repetida = await guardarRecetaConBase(pv.id, linea(), "BRUTA", 1);
    expect(primera.ok, primera.mensaje).toBe(true);
    expect(repetida.ok).toBe(false);
    expect(repetida.mensaje).toContain("cambió");
    expect(await prisma.recetaVersion.count({ where: { productoId: pv.id } })).toBe(2);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "RendimientoLocalIngrediente", valorNuevo: null } })).toBe(antes + 2);
  });

  it("CONCURRENCIA: calibrar la línea y guardar la versión bruta a la vez — nunca queda una calibración neta colgada de una línea bruta", async () => {
    const ITERACIONES = 6;
    for (let i = 0; i < ITERACIONES; i++) {
      await limpiarBaseDeTest();
      const base = await sembrarBase();
      const suc = base.sucursal.id;
      const { kg } = await sembrarCatalogoBase();
      const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: suc, rolId: base.admin.id });
      await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
      const insumo = await sembrarProductoDisponible({ codigo: "MP_C", nombre: "Bife", tipo: "MP", unidadStockId: kg.id }, suc);
      const plato = await sembrarProductoDisponible({ codigo: "PV_C", nombre: "Plato", tipo: "PV", unidadStockId: kg.id, precioVenta: 100 }, suc);
      const v1 = await prisma.recetaVersion.create({
        data: { productoId: plato.id, version: 1, ingredientes: { create: [{ insumoProductoId: insumo.id, cantidad: 1, mermaPorcentaje: 10, unidadId: kg.id }] } },
        include: { ingredientes: true },
      });

      const [calibracion, guardado] = await Promise.all([
        fijarRendimientoLocal(v1.ingredientes[0].id, { cantidad: 1.8, mermaPorcentaje: 20 }),
        guardarRecetaConBase(plato.id, [{ insumoProductoId: insumo.id, cantidad: 1, mermaPorcentaje: 10, unidadId: kg.id }], "BRUTA"),
      ]);
      expect(guardado.ok, guardado.mensaje).toBe(true);
      // O la calibración entró antes (y el guardado la descartó) o se rechazó por «la receta cambió»: en ningún caso hay una fila colgada de una línea de la versión BRUTA.
      if (!calibracion.ok) expect(calibracion.mensaje).toContain("cambió");
      const v2 = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: plato.id, version: 2 }, include: { ingredientes: true } });
      expect(v2.baseDeCantidad).toBe("BRUTA");
      expect(await prisma.rendimientoLocalIngrediente.count({ where: { recetaIngredienteId: { in: v2.ingredientes.map((x) => x.id) } } })).toBe(0);
    }
  });
});
