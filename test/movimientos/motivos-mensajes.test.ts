import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
// `refrescarVistaSiHaceFalta` llama a `refresh` de Next: se cuenta (no se ejecuta), como en `test/catalogo/grupos-refresco.test.ts`.
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

import { refresh } from "next/cache";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarActivoDestinoConsumo, actualizarActivoMotivoMerma, crearDestinoConsumo, crearMotivoMerma } from "../../src/server/actions/movimientos/motivos";

/**
 * Los textos EXACTOS de las cuatro mutaciones de los catálogos Motivo de Merma y Destino de Consumo, el ORDEN de los chequeos del alta y CUÁNDO refrescan la vista
 * (Hito 4, bloque C, paso H4C-17). `motivos.test.ts` mira `ok` y las listas, pero ningún texto ni el refresco. Verde contra el código de antes de la mudanza y
 * después.
 */
describe("motivos de merma y destinos de consumo: mensajes, orden y refresco", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    await prisma.motivoMerma.deleteMany({ where: { operaciones: { none: {} } } });
    await prisma.destinoConsumo.deleteMany({ where: { operaciones: { none: {} } } });
    vi.mocked(refresh).mockClear();
  });

  const refrescos = () => {
    const n = vi.mocked(refresh).mock.calls.length;
    vi.mocked(refresh).mockClear();
    return n;
  };

  it("alta de un motivo: el nombre gana sobre la descripción; repetido; éxito con la descripción recortada (vacía → null); refresca solo el éxito", async () => {
    expect(await crearMotivoMerma(" ", "x".repeat(301))).toEqual({ ok: false, mensaje: "El nombre del motivo no puede estar vacío." });
    expect(await crearMotivoMerma("Rotura", "x".repeat(301))).toEqual({ ok: false, mensaje: "La descripción no puede superar los 300 caracteres." });
    expect(refrescos()).toBe(0);
    expect(await crearMotivoMerma("  Rotura ", "  Se cayó: «frágil»  ")).toMatchObject({ ok: true, mensaje: 'Motivo "Rotura" creado.', nombre: "Rotura" });
    expect(refrescos()).toBe(1);
    expect(await crearMotivoMerma("Vencido", "   ")).toMatchObject({ ok: true, mensaje: 'Motivo "Vencido" creado.' });
    expect(refrescos()).toBe(1);
    expect(await crearMotivoMerma("ROTURA")).toEqual({ ok: false, mensaje: 'Ya existe un motivo "Rotura" (no distingue mayúsculas/espacios).' });
    expect(refrescos()).toBe(0);
    expect(await prisma.motivoMerma.findMany({ orderBy: { nombre: "asc" }, select: { nombre: true, descripcion: true } })).toEqual([
      { nombre: "Rotura", descripcion: "Se cayó: «frágil»" },
      { nombre: "Vencido", descripcion: null },
    ]);
  });

  it("alta de un destino: mismos caminos con sus textos", async () => {
    expect(await crearDestinoConsumo("")).toEqual({ ok: false, mensaje: "El nombre del destino no puede estar vacío." });
    expect(await crearDestinoConsumo("Personal")).toMatchObject({ ok: true, mensaje: 'Destino "Personal" creado.', nombre: "Personal" });
    expect(refrescos()).toBe(1);
    expect(await crearDestinoConsumo("personal")).toEqual({ ok: false, mensaje: 'Ya existe un destino "Personal" (no distingue mayúsculas/espacios).' });
    expect(refrescos()).toBe(0);
  });

  it("activar: no encontrado sin refrescar; éxito con UN refresco (motivo y destino)", async () => {
    const motivo = await prisma.motivoMerma.create({ data: { nombre: "Rotura" } });
    const destino = await prisma.destinoConsumo.create({ data: { nombre: "Personal" } });
    expect(await actualizarActivoMotivoMerma("cnoexiste000000000000000", false)).toEqual({ ok: false, mensaje: "No se encontró el motivo." });
    expect(await actualizarActivoDestinoConsumo("cnoexiste000000000000000", false)).toEqual({ ok: false, mensaje: "No se encontró el destino." });
    expect(refrescos()).toBe(0);
    expect(await actualizarActivoMotivoMerma(motivo.id, false)).toEqual({ ok: true, mensaje: 'Motivo "Rotura" desactivado.' });
    expect(refrescos()).toBe(1);
    expect(await actualizarActivoDestinoConsumo(destino.id, true)).toEqual({ ok: true, mensaje: 'Destino "Personal" activado.' });
    expect(refrescos()).toBe(1);
  });
});
