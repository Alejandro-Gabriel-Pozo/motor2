import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
// `refrescarVistaSiHaceFalta` llama a `refresh` de Next: se cuenta (no se ejecuta), como en `grupos-refresco.test.ts`.
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

import { refresh } from "next/cache";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarActivaProveedor, actualizarProveedor, altaProveedor } from "../../src/server/actions/catalogo/proveedores";

/**
 * Los textos EXACTOS de los caminos de las tres mutaciones de proveedores, el ORDEN de sus chequeos y CUÁNDO refrescan la vista (Hito 4, bloque C, paso H4C-14).
 * `proveedores.test.ts` mira `ok`, las filas y pedazos de algunos textos (el CUIT), pero no el nombre repetido, el orden entre el nombre y los datos de contacto,
 * el «no encontrado» que gana sobre un dato inválido de la edición ni el refresco de la activación. Verde contra el código de antes de la mudanza y después.
 * Fijaba además el hallazgo conocido de la activación (un id que no existe hacía lanzar a Prisma: se migró tal cual); desde O.44 (Hito 4, bloque D, aprobado
 * por el dueño) devuelve «No se encontró ese proveedor.» — cambió SOLO esa aserción.
 */
const CUIT_A = "30-70308853-4";
const CUIT_B = "20-12345678-6";

describe("proveedores: mensajes, orden de los chequeos y refresco", () => {
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

  it("alta: el nombre gana sobre los datos de contacto, y entre ellos gana el primero (contacto antes que email)", async () => {
    expect(await altaProveedor({ nombre: "  ", email: "no-es-un-email" })).toEqual({ ok: false, mensaje: "El nombre no puede estar vacío." });
    expect(await altaProveedor({ nombre: "Norte", contacto: "x".repeat(121), email: "no-es-un-email" })).toEqual({
      ok: false,
      mensaje: "El contacto no puede superar los 120 caracteres.",
    });
    expect(await altaProveedor({ nombre: "Norte", email: "no-es-un-email" })).toEqual({ ok: false, mensaje: "El email no tiene un formato válido." });
    expect(await prisma.proveedor.count()).toBe(0);
    expect(refrescos()).toBe(0);
  });

  it("alta: éxito con el id y el nombre, nombre repetido (con el nombre tipeado) y CUIT de otro; el nombre gana sobre el CUIT; sin refrescar", async () => {
    const creado = await altaProveedor({ nombre: "  Distribuidora Norte  ", cuit: CUIT_A });
    expect(creado).toMatchObject({ ok: true, mensaje: 'Proveedor "Distribuidora Norte" creado.', nombre: "Distribuidora Norte" });
    if (!creado.ok) return;
    expect((await prisma.proveedor.findUniqueOrThrow({ where: { id: creado.id } })).codigo).toMatch(/^PRV_/);

    expect(await altaProveedor({ nombre: "distribuidora NORTE", cuit: CUIT_A })).toEqual({ ok: false, mensaje: 'Ya existe un proveedor llamado "distribuidora NORTE".' });
    expect(await altaProveedor({ nombre: "Sur", cuit: "30703088534" })).toEqual({
      ok: false,
      mensaje: "Ya existe un proveedor con ese CUIT («Distribuidora Norte»). Dos proveedores de una misma empresa no pueden compartir CUIT: revisá que esté bien cargado.",
    });
    expect(await prisma.proveedor.count()).toBe(1);
    expect(refrescos()).toBe(0);
  });

  it("activar: mensaje y UN refresco por llamada; un id que no existe no se encuentra (O.44)", async () => {
    const p = await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Norte" } });
    expect(await actualizarActivaProveedor(p.id, false)).toEqual({ ok: true, mensaje: "Proveedor desactivado." });
    expect(refrescos()).toBe(1);
    expect(await actualizarActivaProveedor(p.id, true)).toEqual({ ok: true, mensaje: "Proveedor activado." });
    expect(refrescos()).toBe(1);
    expect(await actualizarActivaProveedor("cnoexiste000000000000000", false)).toEqual({ ok: false, mensaje: "No se encontró ese proveedor." });
  });

  it("editar: «no encontrado» gana sobre un dato inválido; dato inválido; CUIT de otro; éxito con el nombre guardado; sin refrescar", async () => {
    const norte = await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Norte", cuit: "30703088534" } });
    const sur = await prisma.proveedor.create({ data: { codigo: "PRV_2", nombre: "Sur" } });
    expect(await actualizarProveedor("cnoexiste000000000000000", { email: "no-es-un-email" })).toEqual({ ok: false, mensaje: "No se encontró ese proveedor." });
    expect(await actualizarProveedor(sur.id, { telefono: "1".repeat(200), email: "no-es-un-email" })).toEqual({
      ok: false,
      mensaje: "El teléfono no puede superar los 40 caracteres.",
    });
    expect(await actualizarProveedor(sur.id, { cuit: CUIT_A })).toEqual({
      ok: false,
      mensaje: "Ya existe un proveedor con ese CUIT («Norte»). Dos proveedores de una misma empresa no pueden compartir CUIT: revisá que esté bien cargado.",
    });
    expect(await actualizarProveedor(sur.id, { cuit: CUIT_B, contacto: "  Ana  " })).toEqual({ ok: true, mensaje: 'Proveedor "Sur" actualizado.' });
    expect(await prisma.proveedor.findUniqueOrThrow({ where: { id: sur.id } })).toMatchObject({ cuit: "20123456786", contacto: "Ana", email: null });
    expect(await actualizarProveedor(norte.id, { cuit: CUIT_A })).toEqual({ ok: true, mensaje: 'Proveedor "Norte" actualizado.' });
    expect(refrescos()).toBe(0);
  });
});
