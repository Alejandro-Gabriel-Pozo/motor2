import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

/**
 * Interruptor para romper la auditoría DESPUÉS de que la escritura ya pasó (mismo molde que `test/catalogo/catalogo-auditoria-atomica.test.ts`):
 * `fallar = true` hace que la próxima llamada a `registrarCambioAuditado` tire. El resto delega en la implementación real.
 */
const interruptor = vi.hoisted(() => ({ fallar: false }));

vi.mock("../../src/server/auditoria/registrar-cambio-auditado", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/server/auditoria/registrar-cambio-auditado")>();
  return {
    ...real,
    registrarCambioAuditado: async (...args: Parameters<typeof real.registrarCambioAuditado>) => {
      if (interruptor.fallar) throw new Error("auditoría caída (simulada)");
      return real.registrarCambioAuditado(...args);
    },
  };
});

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { guardarMargenObjetivo } from "../../src/server/actions/reportes/margen-objetivo";

/**
 * `guardarMargenObjetivo` (Hito 4, bloque C, paso H4C-16): lo que ningún test fijaba. (1) Los rechazos de formato y su ORDEN: una categoría rota (`undefined`, un
 * texto vacío) gana sobre un porcentaje inválido con «Categoría inválida.» (`margen-objetivo-configurable` y la huella de dinero solo miran la categoría que no
 * existe y el porcentaje inválido por separado), y el porcentaje inválido gana sobre una categoría que no existe (se valida antes de leer). (2) La escritura y su
 * fila de auditoría son atómicas: si la auditoría falla no queda el cambio (crear, cambiar o borrar). Verde contra el código de antes de la mudanza y después.
 */
describe("guardarMargenObjetivo: orden de los rechazos y atomicidad", () => {
  let categoriaId: string;

  beforeEach(async () => {
    interruptor.fallar = false;
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    categoriaId = (await prisma.categoriaProducto.create({ data: { nombre: "Pastas" } })).id;
  });

  const objetivos = async () =>
    (await prismaAdmin.margenObjetivo.findMany({ orderBy: { categoriaId: "asc" } })).map((m) => ({ categoriaId: m.categoriaId, pct: Number(m.foodCostObjetivoPct) }));

  it("una categoría rota gana sobre el porcentaje; el porcentaje gana sobre la categoría que no existe", async () => {
    expect(await guardarMargenObjetivo(undefined as unknown as null, "abc")).toEqual({ ok: false, mensaje: "Categoría inválida." });
    expect(await guardarMargenObjetivo("", 150)).toEqual({ ok: false, mensaje: "Categoría inválida." });
    expect(await guardarMargenObjetivo("cnoexiste000000000000000", 0)).toEqual({ ok: false, mensaje: "El food cost objetivo tiene que ser mayor que 0 %." });
    expect(await guardarMargenObjetivo("cnoexiste000000000000000", 30)).toEqual({ ok: false, mensaje: "No se encontró la categoría." });
    expect(await guardarMargenObjetivo(categoriaId, 25)).toEqual({ ok: true, mensaje: "Food cost objetivo de la categoría «Pastas»: 25 %." });
    expect(await objetivos()).toEqual([{ categoriaId, pct: 25 }]);
  });

  it("si la auditoría falla, no queda el alta, ni el cambio, ni el borrado", async () => {
    interruptor.fallar = true;
    await expect(guardarMargenObjetivo(null, 30)).rejects.toThrow("auditoría caída");
    expect(await objetivos()).toEqual([]);

    interruptor.fallar = false;
    await guardarMargenObjetivo(null, 30);
    interruptor.fallar = true;
    await expect(guardarMargenObjetivo(null, 32)).rejects.toThrow("auditoría caída");
    expect(await objetivos()).toEqual([{ categoriaId: null, pct: 30 }]);
    await expect(guardarMargenObjetivo(null, null)).rejects.toThrow("auditoría caída");
    expect(await objetivos()).toEqual([{ categoriaId: null, pct: 30 }]);
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "MargenObjetivo" } })).toBe(1);
  });
});
