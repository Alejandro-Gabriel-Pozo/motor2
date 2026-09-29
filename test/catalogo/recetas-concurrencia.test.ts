import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { darDeAltaProducto } from "../../src/server/actions/catalogo/productos";
import { guardarReceta } from "../../src/server/actions/catalogo/recetas";

/**
 * Concurrencia REAL de `guardarReceta` (Promise.allSettled contra Postgres, sin mocks de base).
 *
 * La versión de una receta se calcula de forma optimista (MAX(version)+1) y el `@@unique([productoId, version])` es el árbitro final: dos
 * ediciones simultáneas de la MISMA receta calculan el mismo número, una choca (P2002) y tiene que reintentar releyendo el máximo. Este test
 * fija que las dos terminan bien, como versiones distintas y contiguas, sin mezclar sus ingredientes y sin una promesa rechazada — es lo que
 * vigila el reintento (`conReintento`, con backoff y jitter entre intentos).
 *
 * En loop porque el choque depende del timing. Y con una guarda contra el falso verde: si en NINGUNA iteración hubo un reintento (o sea, si
 * nunca se leyó el máximo más de una vez por guardado), el test no estaría probando nada.
 */
const ITERACIONES = 10;

describe("guardarReceta — concurrencia real", () => {
  let unidadKgId: string;
  let pvId: string;
  let mp1Id: string;
  let mp2Id: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    await darDeAltaProducto({ nombre: "Pizza muzza", tipo: "PV", unidadStockId: unidadKgId, factorConversion: 1 });
    await darDeAltaProducto({ nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1 });
    await darDeAltaProducto({ nombre: "Muzzarella", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1 });
    pvId = (await prisma.producto.findFirstOrThrow({ where: { nombre: "Pizza muzza" } })).id;
    mp1Id = (await prisma.producto.findFirstOrThrow({ where: { nombre: "Harina" } })).id;
    mp2Id = (await prisma.producto.findFirstOrThrow({ where: { nombre: "Muzzarella" } })).id;
  });

  it("dos guardados simultáneos de la MISMA receta terminan los dos, como versiones distintas y contiguas, sin mezclar ingredientes", async () => {
    // Un intento = una transacción interactiva (`fn` es una función) sobre el cliente base: `ctx.db` ya no es `prisma` (ADR-007, A5), así que
    // espiar `prisma.recetaVersion.findFirst` no vería nada. Las operaciones sueltas del contexto usan la forma de arreglo y no cuentan.
    const intentos = vi.spyOn(prisma, "$transaction");
    intentos.mockClear();

    for (let i = 0; i < ITERACIONES; i++) {
      const settled = await Promise.allSettled([
        guardarReceta(pvId, [{ insumoProductoId: mp1Id, cantidad: 0.3, unidadId: unidadKgId }]),
        guardarReceta(pvId, [{ insumoProductoId: mp2Id, cantidad: 0.2, unidadId: unidadKgId }]),
      ]);

      expect(settled.every((s) => s.status === "fulfilled"), `iteración ${i}: una promesa rechazó (un choque de versión no se absorbió con el reintento)`).toBe(true);
      for (const s of settled) {
        const r = (s as PromiseFulfilledResult<Awaited<ReturnType<typeof guardarReceta>>>).value;
        expect(r.ok, `iteración ${i}: ${r.ok ? "" : r.mensaje}`).toBe(true);
      }

      // Versiones únicas y contiguas: 1..2(i+1), nunca un hueco ni un duplicado.
      const versiones = await prisma.recetaVersion.findMany({ where: { productoId: pvId }, orderBy: { version: "asc" }, include: { ingredientes: true } });
      expect(versiones.map((v) => v.version), `iteración ${i}`).toEqual(Array.from({ length: 2 * (i + 1) }, (_, k) => k + 1));

      // Las dos versiones de ESTA iteración: cada una con SU ingrediente, ninguna con los dos (nunca una mezcla de v1+v2).
      const ultimasDos = versiones.slice(-2).map((v) => v.ingredientes.map((ing) => ing.insumoProductoId).sort());
      expect(ultimasDos.map((ids) => ids.length), `iteración ${i}: una versión quedó con ingredientes de más o de menos`).toEqual([1, 1]);
      expect(ultimasDos.flat().sort(), `iteración ${i}`).toEqual([mp1Id, mp2Id].sort());

      // Auditoría (paso 2 del plan de rendimiento por sucursal): tantos registros de RecetaVersion como versiones creadas
      // hasta acá, uno por cada una, nunca huérfano — el reintento no debe duplicar ni saltear ningún registro.
      const registros = await prisma.registroAuditoria.count({ where: { entidad: "RecetaVersion", entidadId: { in: versiones.map((v) => v.id) } } });
      expect(registros, `iteración ${i}: cantidad de registros de auditoría distinta de la cantidad de versiones`).toBe(versiones.length);
    }

    // Guarda contra el falso verde: cada guardado abre UNA transacción por intento; más de 2 por iteración = hubo reintentos.
    const transaccionesInteractivas = intentos.mock.calls.filter(([primero]) => typeof primero === "function").length;
    expect(transaccionesInteractivas, "en ninguna iteración hubo un choque: el test no ejercitó el reintento").toBeGreaterThan(2 * ITERACIONES);
    intentos.mockRestore();
  });
});
