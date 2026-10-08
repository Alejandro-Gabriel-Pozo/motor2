import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

/**
 * Interruptor para romper la auditoría A MITAD DE CAMINO (mismo molde que `test/carta/dinero-de-carta-auditoria-atomica.test.ts`): `fallarEnLlamada = N` hace que la
 * N-ésima llamada a `registrarCambioAuditado` tire, DESPUÉS de que el caso de uso ya escribió. El resto delega en la implementación real. Los casos de uso importan
 * `registrarCambioAuditado` de `@/core/permisos/auditoria`, el mismo módulo que reemplaza este `vi.mock`.
 */
const interruptor = vi.hoisted(() => ({ fallarEnLlamada: null as number | null, llamadas: 0 }));

vi.mock("../../src/core/permisos/auditoria", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/core/permisos/auditoria")>();
  return {
    ...real,
    registrarCambioAuditado: async (...args: Parameters<typeof real.registrarCambioAuditado>) => {
      interruptor.llamadas++;
      if (interruptor.fallarEnLlamada !== null && interruptor.llamadas === interruptor.fallarEnLlamada) {
        throw new Error("auditoría caída (simulada)");
      }
      return real.registrarCambioAuditado(...args);
    },
  };
});

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarDecimalesUnidad } from "../../src/server/actions/catalogo/unidades";
import { agregarPresentacionAlternativa } from "../../src/server/actions/catalogo/productos";

/**
 * Configuración de catálogo que cambia el SIGNIFICADO de una cantidad o un costo, y su auditoría, atómicos (Hito 4, bloque 4.3): los decimales de una unidad
 * (fijan la precisión de toda cantidad que la usa) y el factor de conversión de una presentación de compra (mueve el costo por unidad de todo lo que se compre con
 * ella) van con su fila de auditoría en UNA transacción (Pureza 0.7). Si la auditoría falla, no queda NADA: ni el valor nuevo ni la fila.
 *
 * Nació en H4C-8 porque la mutación «auditoría en otra transacción» del caso de uso de los decimales no la veía ningún test (`unidades.test.ts` y la huella de dinero
 * solo miran el camino feliz: con la auditoría fuera de la transacción las filas finales son las mismas). Las presentaciones se suman acá desde el mismo commit para
 * que su mudanza (H4C-11) ya tenga la red.
 */
describe("catálogo: el cambio de significado y su auditoría son atómicos", () => {
  let kgId: string;
  let gId: string;
  let harinaId: string;

  beforeEach(async () => {
    interruptor.fallarEnLlamada = null;
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    kgId = (await prisma.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } })).id;
    gId = (await prisma.unidad.create({ data: { nombre: "g", magnitud: "PESO", decimales: 0 } })).id;
    harinaId = (await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kgId, unidadCompraId: kgId }, base.sucursal.id)).id;
    interruptor.llamadas = 0;
  });

  const decimalesDeKg = async () => (await prismaAdmin.unidad.findUniqueOrThrow({ where: { id: kgId } })).decimales;
  const factores = async () => (await prismaAdmin.presentacion.findMany()).map((p) => Number(p.factorConversion));

  it("decimales: si falla la auditoría, la unidad conserva los decimales anteriores y no queda la fila", async () => {
    interruptor.fallarEnLlamada = 1;
    await expect(actualizarDecimalesUnidad(kgId, 3)).rejects.toThrow("auditoría caída");
    expect(await decimalesDeKg()).toBe(2);
    expect(await prismaAdmin.registroAuditoria.count()).toBe(0);
  });

  it("presentación: si falla la auditoría del alta, no queda la presentación", async () => {
    interruptor.fallarEnLlamada = 1;
    await expect(agregarPresentacionAlternativa(harinaId, gId, 0.5)).rejects.toThrow("auditoría caída");
    expect(await factores()).toEqual([]);
    expect(await prismaAdmin.registroAuditoria.count()).toBe(0);
  });

  it("presentación: si falla la auditoría del cambio de factor, queda el factor anterior", async () => {
    expect((await agregarPresentacionAlternativa(harinaId, gId, 0.5)).ok).toBe(true);
    interruptor.llamadas = 0;
    interruptor.fallarEnLlamada = 1;
    await expect(agregarPresentacionAlternativa(harinaId, gId, 0.75)).rejects.toThrow("auditoría caída");
    expect(await factores()).toEqual([0.5]);
    expect(await prismaAdmin.registroAuditoria.count()).toBe(1);
  });

  it("control: sin falla, el cambio y su auditoría quedan", async () => {
    expect((await actualizarDecimalesUnidad(kgId, 3)).ok).toBe(true);
    expect(await decimalesDeKg()).toBe(3);
    expect((await agregarPresentacionAlternativa(harinaId, gId, 0.5)).ok).toBe(true);
    expect(await factores()).toEqual([0.5]);
    expect(await prismaAdmin.registroAuditoria.count()).toBe(2);
  });
});
