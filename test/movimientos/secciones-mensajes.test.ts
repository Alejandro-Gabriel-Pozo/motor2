import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
// `refrescarVistaSiHaceFalta` llama a `refresh` de Next: se cuenta (no se ejecuta), como en `test/catalogo/grupos-refresco.test.ts`.
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

import { refresh } from "next/cache";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarActivaSeccion, actualizarRespaldoSeccion, crearSeccion, renombrarSeccion } from "../../src/server/actions/movimientos/secciones";

/**
 * Los textos EXACTOS de las cuatro mutaciones de secciones, el ORDEN de sus chequeos (el nombre del renombre se valida ANTES de leer la sección; el booleano del
 * respaldo, antes que el id) y CUÁNDO refrescan la vista (Hito 4, bloque C, paso H4C-18). `secciones.test.ts` fija algunos textos del respaldo, pero no los del
 * alta y el renombre, ni el orden, ni el refresco. Verde contra el código de antes de la mudanza y después.
 */
describe("secciones: mensajes, orden de los chequeos y refresco", () => {
  let sucursalId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    vi.mocked(refresh).mockClear();
  });

  const refrescos = () => {
    const n = vi.mocked(refresh).mock.calls.length;
    vi.mocked(refresh).mockClear();
    return n;
  };

  it("alta: vacío; repetido (con el nombre tipeado); éxito con id y nombre; refresca solo el éxito", async () => {
    expect(await crearSeccion("  ")).toEqual({ ok: false, mensaje: "El nombre de la sección no puede estar vacío." });
    expect(await crearSeccion(" Barra ")).toMatchObject({ ok: true, mensaje: 'Sección "Barra" creada.', nombre: "Barra" });
    expect(refrescos()).toBe(1);
    expect(await crearSeccion("BARRA")).toEqual({ ok: false, mensaje: 'Ya existe una sección "BARRA" en esta sucursal (las secciones no distinguen mayúsculas/espacios).' });
    expect(refrescos()).toBe(0);
  });

  it("renombre: el nombre vacío gana sobre una sección que no existe; ajena; nombre de OTRA (con el guardado); éxito; refresca solo el éxito", async () => {
    const barra = await prisma.seccion.create({ data: { sucursalId, nombre: "Barra" } });
    await prisma.seccion.create({ data: { sucursalId, nombre: "Cocina" } });
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const ajena = await prisma.seccion.create({ data: { sucursalId: norte.id, nombre: "Barra Norte" } });
    expect(await renombrarSeccion("cnoexiste000000000000000", " ")).toEqual({ ok: false, mensaje: "El nombre no puede estar vacío." });
    expect(await renombrarSeccion("cnoexiste000000000000000", "Depósito")).toEqual({ ok: false, mensaje: "No se encontró la sección." });
    expect(await renombrarSeccion(ajena.id, "Depósito")).toEqual({ ok: false, mensaje: "No se encontró la sección." });
    expect(await renombrarSeccion(barra.id, "cocina")).toEqual({ ok: false, mensaje: 'Ya existe una sección "Cocina" en esta sucursal.' });
    expect(refrescos()).toBe(0);
    expect(await renombrarSeccion(barra.id, "  Barra principal ")).toEqual({ ok: true, mensaje: 'Sección renombrada a "Barra principal".' });
    expect(refrescos()).toBe(1);
  });

  it("activar: ajena sin refrescar; éxito con UN refresco", async () => {
    const barra = await prisma.seccion.create({ data: { sucursalId, nombre: "Barra" } });
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const ajena = await prisma.seccion.create({ data: { sucursalId: norte.id, nombre: "Barra Norte" } });
    expect(await actualizarActivaSeccion(ajena.id, false)).toEqual({ ok: false, mensaje: "No se encontró la sección." });
    expect(refrescos()).toBe(0);
    expect(await actualizarActivaSeccion(barra.id, false)).toEqual({ ok: true, mensaje: 'Sección "Barra" desactivada.' });
    expect(refrescos()).toBe(1);
  });

  it("respaldo: el valor que no es booleano gana sobre el id roto; un id que no es texto es «no encontrada»; refresca solo el éxito", async () => {
    const barra = await prisma.seccion.create({ data: { sucursalId, nombre: "Barra" } });
    expect(await actualizarRespaldoSeccion(42 as unknown as string, "no" as unknown as boolean)).toEqual({ ok: false, mensaje: "Valor inválido." });
    expect(await actualizarRespaldoSeccion(42 as unknown as string, false)).toEqual({ ok: false, mensaje: "No se encontró la sección." });
    expect(refrescos()).toBe(0);
    expect(await actualizarRespaldoSeccion(barra.id, false)).toEqual({ ok: true, mensaje: 'Sección "Barra" ya no sirve de respaldo automático en ventas.' });
    expect(refrescos()).toBe(1);
  });
});
