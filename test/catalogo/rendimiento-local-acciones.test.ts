import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { fijarRendimientoLocal, volverAlRendimientoCentral } from "../../src/server/actions/catalogo/rendimiento-local";
import { guardarRecetaACiegas as guardarReceta } from "../../src/server/actions/catalogo/receta-a-ciegas";

describe("fijarRendimientoLocal / volverAlRendimientoCentral (paso 6, D4/D6(a))", () => {
  let sucursalId: string;
  let sucursalBId: string;
  let unidadKgId: string;
  let unidadGId: string;
  let adminId: string;
  let operadorId: string;
  let pv: { id: string; nombre: string };
  let mp: { id: string; nombre: string };
  let recetaIngredienteId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    sucursalBId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    const { kg, g } = await sembrarCatalogoBase();
    unidadKgId = kg.id;
    unidadGId = g.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    adminId = admin.id;
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id });
    operadorId = operador.id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    mp = await sembrarProductoDisponible({ codigo: "MP_CAL", nombre: "Salsa", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    pv = await sembrarProductoDisponible({ codigo: "PV_CAL", nombre: "Pizza muzza", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    const receta = await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, mermaPorcentaje: 0, unidadId: unidadKgId }] } },
      include: { ingredientes: true },
    });
    recetaIngredienteId = receta.ingredientes[0].id;
  });

  it("fija el override de la sucursal ACTIVA, sin tocar RecetaIngrediente (la receta central no se mueve)", async () => {
    const r = await fijarRendimientoLocal(recetaIngredienteId, { cantidad: 1.8, mermaPorcentaje: 20 });
    expect(r.ok, r.mensaje).toBe(true);

    const fila = await prisma.rendimientoLocalIngrediente.findUniqueOrThrow({ where: { recetaIngredienteId_sucursalId: { recetaIngredienteId, sucursalId } } });
    expect(Number(fila.cantidad)).toBe(1.8);
    expect(Number(fila.mermaPorcentaje)).toBe(20);

    const ingredienteCentral = await prisma.recetaIngrediente.findUniqueOrThrow({ where: { id: recetaIngredienteId } });
    expect(Number(ingredienteCentral.cantidad)).toBe(1);
    expect(Number(ingredienteCentral.mermaPorcentaje)).toBe(0);
  });

  it("no hay forma de apuntar a otra sucursal: siempre escribe en ctx.sucursalId, nunca en la que declare el origen", async () => {
    // El origen trae `sucursalCalculoId` distinto de la activa — se RECHAZA la escritura entera (D6(c)), no se "corrige" a la
    // otra sucursal en silencio.
    const r = await fijarRendimientoLocal(recetaIngredienteId, { cantidad: 2, mermaPorcentaje: null }, { tipo: "manual", sucursalCalculoId: sucursalBId });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("Cambiaste de sucursal");
    expect(await prisma.rendimientoLocalIngrediente.count()).toBe(0);
  });

  it("un operador sin el permiso es rechazado", async () => {
    await mockearUsuarioActual({ id: operadorId, email: "operador@test.com", nombre: null });
    const r = await fijarRendimientoLocal(recetaIngredienteId, { cantidad: 2, mermaPorcentaje: null });
    expect(r.ok).toBe(false);
    expect(await prisma.rendimientoLocalIngrediente.count()).toBe(0);
  });

  it("una línea que ya no es la vigente (la receta cambió) se rechaza", async () => {
    const r0 = await guardarReceta(pv.id, [{ insumoProductoId: mp.id, cantidad: 1.5, unidadId: unidadKgId }]);
    expect(r0.ok, r0.mensaje).toBe(true); // ahora hay una v2 — recetaIngredienteId es de la v1, ya no vigente

    const r = await fijarRendimientoLocal(recetaIngredienteId, { cantidad: 2, mermaPorcentaje: null });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("cambió");
  });

  it("valores inválidos se rechazan: cantidad <= 0, merma fuera de rango, y los dos en null", async () => {
    expect((await fijarRendimientoLocal(recetaIngredienteId, { cantidad: 0, mermaPorcentaje: null })).ok).toBe(false);
    expect((await fijarRendimientoLocal(recetaIngredienteId, { cantidad: -1, mermaPorcentaje: null })).ok).toBe(false);
    expect((await fijarRendimientoLocal(recetaIngredienteId, { cantidad: null, mermaPorcentaje: -1 })).ok).toBe(false);
    expect((await fijarRendimientoLocal(recetaIngredienteId, { cantidad: null, mermaPorcentaje: 10000 })).ok).toBe(false);
    expect((await fijarRendimientoLocal(recetaIngredienteId, { cantidad: null, mermaPorcentaje: null })).ok).toBe(false);
    expect(await prisma.rendimientoLocalIngrediente.count()).toBe(0);
  });

  it("auditoría: dos registros (cantidad y mermaPorcentaje), clave estable, con la descripción correcta (manual y con sugerencia)", async () => {
    const r = await fijarRendimientoLocal(recetaIngredienteId, { cantidad: 1.8, mermaPorcentaje: 20 }, {
      tipo: "sugerencia_simple", sucursalCalculoId: sucursalId, sugerido: 2, comprado: 20, vendido: 10, semanas: 4, confianza: "media",
    });
    expect(r.ok, r.mensaje).toBe(true);

    const entidadId = `${sucursalId}:${pv.id}:${mp.id}`;
    const registros = await prisma.registroAuditoria.findMany({ where: { entidad: "RendimientoLocalIngrediente", entidadId }, orderBy: { campo: "asc" } });
    expect(registros).toHaveLength(2);
    expect(registros.map((r) => r.campo).sort()).toEqual(["cantidad", "mermaPorcentaje"]);
    expect(registros[0].sucursalId).toBe(sucursalId);
    expect(registros[0].actorId).toBe(adminId);
    const descCantidad = registros.find((r) => r.campo === "cantidad")!;
    expect(descCantidad.descripcion).toContain('Rendimiento de "Salsa" en "Pizza muzza" en «Central»');
    expect(descCantidad.descripcion).toContain("central: 1 kg, merma 0 %");
    expect(descCantidad.descripcion).toContain("sugerido 2, guardado 1.8");
    expect(descCantidad.descripcion).toContain("comprado 20, vendido 10");
    expect(descCantidad.descripcion).toContain("confianza media");
    expect(descCantidad.valorAnterior).toBeNull();
    expect(descCantidad.valorNuevo).toBe("1.8");
  });

  it("repetir los mismos valores no crea registros nuevos de auditoría", async () => {
    await fijarRendimientoLocal(recetaIngredienteId, { cantidad: 1.8, mermaPorcentaje: 20 });
    const antes = await prisma.registroAuditoria.count();
    const r = await fijarRendimientoLocal(recetaIngredienteId, { cantidad: 1.8, mermaPorcentaje: 20 });
    expect(r.ok, r.mensaje).toBe(true);
    expect(await prisma.registroAuditoria.count()).toBe(antes);
  });

  it("volverAlRendimientoCentral pone los dos campos en null (no borra la fila) y audita", async () => {
    await fijarRendimientoLocal(recetaIngredienteId, { cantidad: 1.8, mermaPorcentaje: 20 });
    const r = await volverAlRendimientoCentral(recetaIngredienteId);
    expect(r.ok, r.mensaje).toBe(true);

    const fila = await prisma.rendimientoLocalIngrediente.findUniqueOrThrow({ where: { recetaIngredienteId_sucursalId: { recetaIngredienteId, sucursalId } } });
    expect(fila.cantidad).toBeNull();
    expect(fila.mermaPorcentaje).toBeNull();

    const entidadId = `${sucursalId}:${pv.id}:${mp.id}`;
    const registros = await prisma.registroAuditoria.findMany({ where: { entidad: "RendimientoLocalIngrediente", entidadId, valorNuevo: null } });
    expect(registros.length).toBeGreaterThanOrEqual(2);
  });

  describe("arrastre entre versiones (D3)", () => {
    it("una versión nueva de la receta copia los overrides existentes al ingrediente nuevo", async () => {
      await fijarRendimientoLocal(recetaIngredienteId, { cantidad: 1.8, mermaPorcentaje: 20 });

      const r = await guardarReceta(pv.id, [{ insumoProductoId: mp.id, cantidad: 1, mermaPorcentaje: 0, unidadId: unidadKgId }]);
      expect(r.ok, r.mensaje).toBe(true);

      const v2 = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: pv.id, version: 2 }, include: { ingredientes: true } });
      const nuevoIngId = v2.ingredientes[0].id;
      const fila = await prisma.rendimientoLocalIngrediente.findUniqueOrThrow({ where: { recetaIngredienteId_sucursalId: { recetaIngredienteId: nuevoIngId, sucursalId } } });
      expect(Number(fila.cantidad)).toBe(1.8);
      expect(Number(fila.mermaPorcentaje)).toBe(20);
      // La fila vieja (colgada del ingrediente de la v1) sigue existiendo — nunca se mueve ni se borra, es una fila nueva.
      expect(await prisma.rendimientoLocalIngrediente.count({ where: { recetaIngredienteId } })).toBe(1);
    });

    it("un cambio de unidad DESCARTA la calibración (nunca la arrastra con otra unidad) y lo audita", async () => {
      await fijarRendimientoLocal(recetaIngredienteId, { cantidad: 1.8, mermaPorcentaje: 20 });

      const r = await guardarReceta(pv.id, [{ insumoProductoId: mp.id, cantidad: 1000, mermaPorcentaje: 0, unidadId: unidadGId }]);
      expect(r.ok, r.mensaje).toBe(true);
      expect(r.mensaje).toContain("descartó");

      const v2 = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: pv.id, version: 2 }, include: { ingredientes: true } });
      expect(await prisma.rendimientoLocalIngrediente.count({ where: { recetaIngredienteId: v2.ingredientes[0].id } })).toBe(0);

      const entidadId = `${sucursalId}:${pv.id}:${mp.id}`;
      const registro = await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "RendimientoLocalIngrediente", entidadId, valorNuevo: null, campo: "cantidad" } });
      expect(registro.descripcion).toContain("cambió la unidad de kg a g");
      expect(registro.descripcion).toContain("versión 2");
    });

    it("quitar el ingrediente de la receta DESCARTA su calibración y lo audita", async () => {
      await fijarRendimientoLocal(recetaIngredienteId, { cantidad: 1.8, mermaPorcentaje: 20 });

      const otraMp = await sembrarProductoDisponible({ codigo: "MP_CAL2", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
      const r = await guardarReceta(pv.id, [{ insumoProductoId: otraMp.id, cantidad: 1, mermaPorcentaje: 0, unidadId: unidadKgId }]);
      expect(r.ok, r.mensaje).toBe(true);
      expect(r.mensaje).toContain("se quitó de la receta");

      const entidadId = `${sucursalId}:${pv.id}:${mp.id}`;
      const registro = await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "RendimientoLocalIngrediente", entidadId, campo: "cantidad", valorNuevo: null } });
      expect(registro.descripcion).toContain("se quitó de la receta");
    });

    it("un cambio de cantidad/merma CENTRAL (misma unidad) NO descarta la calibración de la sucursal", async () => {
      await fijarRendimientoLocal(recetaIngredienteId, { cantidad: 1.8, mermaPorcentaje: 20 });

      const r = await guardarReceta(pv.id, [{ insumoProductoId: mp.id, cantidad: 5, mermaPorcentaje: 50, unidadId: unidadKgId }]);
      expect(r.ok, r.mensaje).toBe(true);
      expect(r.mensaje).not.toContain("descartó");

      const v2 = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: pv.id, version: 2 }, include: { ingredientes: true } });
      const fila = await prisma.rendimientoLocalIngrediente.findUniqueOrThrow({ where: { recetaIngredienteId_sucursalId: { recetaIngredienteId: v2.ingredientes[0].id, sucursalId } } });
      expect(Number(fila.cantidad)).toBe(1.8);
      expect(Number(fila.mermaPorcentaje)).toBe(20);
    });
  });

  describe("concurrencia real: fijarRendimientoLocal y guardarReceta sobre la misma receta", () => {
    it("al final, o el override está sobre la versión vigente, o la calibración devolvió 'la receta cambió' — nunca queda huérfano", async () => {
      const ITERACIONES = 8;
      for (let i = 0; i < ITERACIONES; i++) {
        const vigenteAntes = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: pv.id }, orderBy: { version: "desc" }, include: { ingredientes: true } });
        const ingredienteVigenteId = vigenteAntes.ingredientes[0].id;

        const settled = await Promise.allSettled([
          fijarRendimientoLocal(ingredienteVigenteId, { cantidad: 1 + i, mermaPorcentaje: null }),
          guardarReceta(pv.id, [{ insumoProductoId: mp.id, cantidad: 1, mermaPorcentaje: 0, unidadId: unidadKgId }]),
        ]);

        expect(settled.every((s) => s.status === "fulfilled"), `iteración ${i}: una promesa rechazó`).toBe(true);
        const [rCalibrar, rGuardar] = settled.map((s) => (s as PromiseFulfilledResult<{ ok: boolean; mensaje: string }>).value);
        expect(rGuardar.ok, `iteración ${i}: guardarReceta falló: ${rGuardar.mensaje}`).toBe(true);
        // fijarRendimientoLocal puede ganar (ok) o perder la carrera contra el guardado concurrente (rechazado con "cambió").
        if (!rCalibrar.ok) expect(rCalibrar.mensaje, `iteración ${i}`).toContain("cambió");

        // Una calibración que dijo «ok» NUNCA se pierde: tiene que estar sobre la línea de la versión VIGENTE al final (si ganó antes del guardado, se arrastró a la versión nueva; si llegó
        // después, la línea vieja ya no era la vigente y se rechazó). Antes el guardado leía la versión anterior fuera de su transacción y una calibración confirmada en ese hueco quedaba
        // colgada de la versión vieja, sin que nadie lo notara (H7, segundo hueco; lo vio la revisión independiente del PR #93).
        if (rCalibrar.ok) {
          const vigenteDespues = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: pv.id }, orderBy: { version: "desc" }, include: { ingredientes: true } });
          const enLaVigente = await prisma.rendimientoLocalIngrediente.findUnique({ where: { recetaIngredienteId_sucursalId: { recetaIngredienteId: vigenteDespues.ingredientes[0].id, sucursalId } } });
          expect(Number(enLaVigente?.cantidad), `iteración ${i}: la calibración confirmada se perdió al guardar la versión nueva`).toBe(1 + i);
        }

        // Ningún RendimientoLocalIngrediente queda colgado de un recetaIngredienteId que ya no exista.
        const todos = await prisma.rendimientoLocalIngrediente.findMany({ select: { recetaIngredienteId: true } });
        for (const fila of todos) {
          const existe = await prisma.recetaIngrediente.findUnique({ where: { id: fila.recetaIngredienteId } });
          expect(existe, `iteración ${i}: RendimientoLocalIngrediente huérfano`).not.toBeNull();
        }
      }
    });
  });
});
