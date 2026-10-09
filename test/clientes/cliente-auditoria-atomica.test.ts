import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

/**
 * Interruptor para romper la auditoría A MITAD DE CAMINO (mismo molde que `test/catalogo/catalogo-auditoria-atomica.test.ts`): `fallarEnLlamada = N` hace que la
 * N-ésima llamada a `registrarCambioAuditado` tire, DESPUÉS de que el cambio ya se escribió. El resto delega en la implementación real.
 */
const interruptor = vi.hoisted(() => ({ fallarEnLlamada: null as number | null, llamadas: 0 }));

vi.mock("../../src/server/auditoria/registrar-cambio-auditado", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/server/auditoria/registrar-cambio-auditado")>();
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

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarActivoCliente, actualizarCliente, altaCliente } from "../../src/server/actions/clientes/cliente";

/**
 * El % de descuento de un cliente mueve plata (se congela en cada cuenta al asignarlo): su alta, su edición y su activación van con sus filas de auditoría en UNA
 * transacción. Si la auditoría falla a mitad de camino, no queda NADA: ni el cambio ni las filas que ya se habían escrito (Hito 4, bloque C, paso H4C-15). Nació
 * porque `cliente-auditoria.test.ts` y la huella de dinero solo miran el camino feliz: con la auditoría fuera de la transacción las filas finales son las mismas.
 * Verde contra el código de antes de la mudanza y después.
 */
describe("clientes: el cambio y su auditoría son atómicos", () => {
  beforeEach(async () => {
    interruptor.fallarEnLlamada = null;
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    interruptor.llamadas = 0;
  });

  const filasDeCliente = () => prismaAdmin.registroAuditoria.count({ where: { entidad: "Cliente" } });

  it("alta: si falla la SEGUNDA fila (el %), no queda el cliente ni la primera fila (el nombre)", async () => {
    interruptor.fallarEnLlamada = 2;
    await expect(altaCliente("Fulano", 10)).rejects.toThrow("auditoría caída");
    expect(await prisma.cliente.count()).toBe(0);
    expect(await filasDeCliente()).toBe(0);
  });

  it("edición: si falla la SEGUNDA fila (el %), el cliente conserva nombre y % y no queda la primera fila", async () => {
    const c = await prisma.cliente.create({ data: { nombre: "Fulano", descuentoPorcentaje: 10 } });
    interruptor.fallarEnLlamada = 2;
    await expect(actualizarCliente(c.id, "Fulano Pérez", 20)).rejects.toThrow("auditoría caída");
    const despues = await prisma.cliente.findUniqueOrThrow({ where: { id: c.id } });
    expect({ nombre: despues.nombre, pct: Number(despues.descuentoPorcentaje) }).toEqual({ nombre: "Fulano", pct: 10 });
    expect(await filasDeCliente()).toBe(0);
  });

  it("activación: si falla la fila, el cliente sigue activo", async () => {
    const c = await prisma.cliente.create({ data: { nombre: "Fulano", descuentoPorcentaje: 10 } });
    interruptor.fallarEnLlamada = 1;
    await expect(actualizarActivoCliente(c.id, false)).rejects.toThrow("auditoría caída");
    expect((await prisma.cliente.findUniqueOrThrow({ where: { id: c.id } })).activo).toBe(true);
    expect(await filasDeCliente()).toBe(0);
  });
});
