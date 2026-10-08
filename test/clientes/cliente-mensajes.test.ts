import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
// `refrescarVistaSiHaceFalta` llama a `refresh` de Next: se cuenta (no se ejecuta), como en `test/catalogo/grupos-refresco.test.ts`.
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

import { refresh } from "next/cache";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarActivoCliente, actualizarCliente, altaCliente } from "../../src/server/actions/clientes/cliente";

/**
 * Los textos EXACTOS de los rechazos de las tres mutaciones de clientes, el ORDEN de sus chequeos y CUÁNDO refrescan la vista (Hito 4, bloque C, paso H4C-15).
 * `cliente.test.ts` mira solo `ok` en la mayoría de los rechazos, y la huella de dinero del tramo C solo el % inválido del alta: un texto cambiado del nombre vacío,
 * del cliente inexistente o del nombre repetido de la edición, el orden entre el nombre y el %, y el refresco de la activación (solo cuando sale bien) no los veía
 * nadie. Verde contra el código de antes de la mudanza y después.
 */
describe("clientes: mensajes, orden de los chequeos y refresco", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    vi.mocked(refresh).mockClear();
  });

  const refrescos = () => {
    const n = vi.mocked(refresh).mock.calls.length;
    vi.mocked(refresh).mockClear();
    return n;
  };

  it("alta: el nombre gana sobre el %; éxito con id y nombre; sin refrescar", async () => {
    expect(await altaCliente("  ", 150)).toEqual({ ok: false, mensaje: "El nombre del cliente no puede estar vacío." });
    expect(await altaCliente("Fulano", 150)).toEqual({ ok: false, mensaje: "El % de descuento tiene que ser menor que 100 %." });
    expect(await altaCliente("Fulano", "")).toEqual({ ok: false, mensaje: "Falta el % de descuento." });
    expect(await altaCliente("  Fulano  ", "7,5")).toMatchObject({ ok: true, mensaje: 'Cliente "Fulano" creado, con 7.5% de descuento.', nombre: "Fulano" });
    expect(refrescos()).toBe(0);
  });

  it("editar: «no encontrado» gana sobre un dato inválido; el nombre gana sobre el %; el nombre de OTRO; éxito; sin refrescar", async () => {
    const uno = await prisma.cliente.create({ data: { nombre: "Uno", descuentoPorcentaje: 10 } });
    await prisma.cliente.create({ data: { nombre: "Dos", descuentoPorcentaje: 20 } });
    expect(await actualizarCliente("cnoexiste000000000000000", "", 150)).toEqual({ ok: false, mensaje: "No se encontró ese cliente." });
    expect(await actualizarCliente(uno.id, " ", 150)).toEqual({ ok: false, mensaje: "El nombre del cliente no puede estar vacío." });
    expect(await actualizarCliente(uno.id, "Uno", -1)).toEqual({ ok: false, mensaje: "El % de descuento no puede ser negativo." });
    expect(await actualizarCliente(uno.id, "DOS", 10)).toEqual({ ok: false, mensaje: 'Ya existe un cliente llamado "Dos".' });
    expect(await actualizarCliente(uno.id, "  Uno Bis ", 12)).toEqual({ ok: true, mensaje: 'Cliente "Uno Bis" actualizado.' });
    expect(refrescos()).toBe(0);
  });

  it("activar: refresca UNA vez cuando sale bien y NINGUNA si el cliente no existe", async () => {
    const uno = await prisma.cliente.create({ data: { nombre: "Uno", descuentoPorcentaje: 10 } });
    expect(await actualizarActivoCliente("cnoexiste000000000000000", false)).toEqual({ ok: false, mensaje: "No se encontró ese cliente." });
    expect(refrescos()).toBe(0);
    expect(await actualizarActivoCliente(uno.id, false)).toEqual({ ok: true, mensaje: 'Cliente "Uno" desactivado.' });
    expect(refrescos()).toBe(1);
  });
});
