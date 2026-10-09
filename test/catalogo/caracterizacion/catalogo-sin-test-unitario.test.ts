import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
// `refrescarVistaSiHaceFalta` llama a `refresh` de Next: se cuenta (no se ejecuta). Cuántas veces refresca cada acción es parte de lo que se fija.
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

import { refresh } from "next/cache";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../../setup/test-db";
import { mockearUsuarioActual } from "../../setup/mock-sesion";
import { actualizarActivaCategoriaProducto, crearCategoriaProducto } from "../../../src/server/actions/catalogo/categorias-producto";
import { actualizarActivoGrupo, actualizarActivoInsumo, actualizarGrupoDeInsumo, crearInsumo } from "../../../src/server/actions/catalogo/insumos";
import { actualizarActivaUnidad } from "../../../src/server/actions/catalogo/unidades";

/**
 * Caracterización de las 7 Server Actions del catálogo que NO tenían ningún test unitario (Hito 4, paso H4C-0.4 de `docs/plan-hito-4-pureza.md` §3), contra el
 * código viejo y antes de mudarlas a casos de uso en el bloque B: las dos de categorías (`crearCategoriaProducto`, `actualizarActivaCategoriaProducto`), tres de
 * insumos (`crearInsumo`, `actualizarActivoInsumo`, `actualizarGrupoDeInsumo`), la de activar un grupo (`actualizarActivoGrupo`) y la de activar una unidad
 * (`actualizarActivaUnidad`). Fija los mensajes exactos, las filas que quedan, el camino «se reusa» de las dos altas (un nombre que ya existe, sin distinguir
 * mayúsculas ni espacios de los bordes, devuelve la fila existente sin crear otra), cuántas veces cada una refresca la vista (`refresh` de Next, contado) y lo
 * que pasa con un id que no existe (las de activar no lo chequeaban: el `update` de Prisma lanzaba; hallazgo conocido, se fijó tal cual).
 *
 * O.44 (Hito 4, bloque D; cambio de comportamiento aprobado por el dueño): las 4 de activar devuelven ahora su «no encontrado» con un id que no existe. Cambió
 * SOLO esa aserción de cada una (y el título que la describía); la de `actualizarGrupoDeInsumo` siguió lanzando (no es de activar) hasta O.44b (Hito 4, bloque
 * E1), que cambió SOLO su última aserción: ahora «No se encontró el insumo.». Red: `activar-id-inexistente`.
 */
describe("catálogo: las 7 acciones sin test unitario (caracterización)", () => {
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

  it("crearCategoriaProducto: vacío, caracteres no permitidos, alta y «se reusa» (sin refrescar)", async () => {
    expect(await crearCategoriaProducto("   ")).toEqual({ ok: false, mensaje: "El nombre de la categoría no puede estar vacío." });
    expect(await crearCategoriaProducto("-Bebidas")).toEqual({ ok: false, mensaje: 'El nombre de la categoría no puede empezar con "-".' });
    expect(await crearCategoriaProducto("Bebidas<>")).toEqual({
      ok: false,
      mensaje: "El nombre de la categoría tiene caracteres no permitidos. Se admiten letras, números, espacios y - . , ( ) % & / '",
    });
    expect(await prisma.categoriaProducto.count()).toBe(0);

    const alta = await crearCategoriaProducto("  Bebidas  ");
    const fila = await prisma.categoriaProducto.findFirstOrThrow();
    expect(alta).toEqual({ ok: true, mensaje: 'Categoría "Bebidas" creada.', id: fila.id, nombre: "Bebidas" });
    expect(fila).toMatchObject({ nombre: "Bebidas", activo: true });

    expect(await crearCategoriaProducto("BEBIDAS")).toEqual({ ok: true, mensaje: 'Ya existía la categoría "Bebidas" — se reusa.', id: fila.id, nombre: "Bebidas" });
    expect(await prisma.categoriaProducto.count()).toBe(1);
    expect(refrescos()).toBe(0);
  });

  it("actualizarActivaCategoriaProducto: desactiva y activa, refresca una vez cada una; un id que no existe no se encuentra (O.44)", async () => {
    const c = await prisma.categoriaProducto.create({ data: { nombre: "Almacén" } });
    expect(await actualizarActivaCategoriaProducto(c.id, false)).toEqual({ ok: true, mensaje: "Categoría desactivada." });
    expect((await prisma.categoriaProducto.findUniqueOrThrow({ where: { id: c.id } })).activo).toBe(false);
    expect(refrescos()).toBe(1);
    expect(await actualizarActivaCategoriaProducto(c.id, true)).toEqual({ ok: true, mensaje: "Categoría activada." });
    expect((await prisma.categoriaProducto.findUniqueOrThrow({ where: { id: c.id } })).activo).toBe(true);
    expect(refrescos()).toBe(1);
    expect(await actualizarActivaCategoriaProducto("no-existe", false)).toEqual({ ok: false, mensaje: "No se encontró la categoría." });
    expect(refrescos()).toBe(0);
  });

  it("crearInsumo: vacío, alta y «se reusa» sin distinguir mayúsculas (sin refrescar)", async () => {
    expect(await crearInsumo("")).toEqual({ ok: false, mensaje: "El nombre del insumo no puede estar vacío." });
    expect(await crearInsumo("Harina#")).toEqual({
      ok: false,
      mensaje: "El nombre del insumo tiene caracteres no permitidos. Se admiten letras, números, espacios y - . , ( ) % & / '",
    });
    const alta = await crearInsumo(" Harina ");
    const fila = await prisma.insumo.findFirstOrThrow();
    expect(alta).toEqual({ ok: true, mensaje: 'Insumo "Harina" creado.', id: fila.id, nombre: "Harina" });
    expect(fila).toMatchObject({ nombre: "Harina", activo: true, grupoId: null });

    expect(await crearInsumo("hArInA")).toEqual({ ok: true, mensaje: 'Ya existía el insumo "Harina" — se reusa.', id: fila.id, nombre: "Harina" });
    expect(await prisma.insumo.count()).toBe(1);
    expect(refrescos()).toBe(0);
  });

  it("actualizarActivoInsumo: desactiva y activa, refresca una vez cada una; un id que no existe no se encuentra (O.44)", async () => {
    const i = await prisma.insumo.create({ data: { nombre: "Harina" } });
    expect(await actualizarActivoInsumo(i.id, false)).toEqual({ ok: true, mensaje: "Insumo desactivado." });
    expect((await prisma.insumo.findUniqueOrThrow({ where: { id: i.id } })).activo).toBe(false);
    expect(refrescos()).toBe(1);
    expect(await actualizarActivoInsumo(i.id, true)).toEqual({ ok: true, mensaje: "Insumo activado." });
    expect(refrescos()).toBe(1);
    expect(await actualizarActivoInsumo("no-existe", false)).toEqual({ ok: false, mensaje: "No se encontró el insumo." });
    expect(refrescos()).toBe(0);
  });

  it("actualizarGrupoDeInsumo: asigna y saca el grupo, refresca una vez cada una", async () => {
    const i = await prisma.insumo.create({ data: { nombre: "Harina" } });
    const g = await prisma.grupo.create({ data: { nombre: "Secos" } });
    expect(await actualizarGrupoDeInsumo(i.id, g.id)).toEqual({ ok: true, mensaje: "Grupo del insumo actualizado." });
    expect((await prisma.insumo.findUniqueOrThrow({ where: { id: i.id } })).grupoId).toBe(g.id);
    expect(refrescos()).toBe(1);
    expect(await actualizarGrupoDeInsumo(i.id, null)).toEqual({ ok: true, mensaje: "Grupo del insumo actualizado." });
    expect((await prisma.insumo.findUniqueOrThrow({ where: { id: i.id } })).grupoId).toBeNull();
    expect(refrescos()).toBe(1);
    expect(await actualizarGrupoDeInsumo("no-existe", null)).toEqual({ ok: false, mensaje: "No se encontró el insumo." }); // O.44b: antes lanzaba
  });

  it("actualizarActivoGrupo: desactiva y activa, refresca una vez cada una; un id que no existe no se encuentra (O.44)", async () => {
    const g = await prisma.grupo.create({ data: { nombre: "Secos" } });
    expect(await actualizarActivoGrupo(g.id, false)).toEqual({ ok: true, mensaje: "Grupo desactivado." });
    expect((await prisma.grupo.findUniqueOrThrow({ where: { id: g.id } })).activo).toBe(false);
    expect(refrescos()).toBe(1);
    expect(await actualizarActivoGrupo(g.id, true)).toEqual({ ok: true, mensaje: "Grupo activado." });
    expect(refrescos()).toBe(1);
    expect(await actualizarActivoGrupo("no-existe", false)).toEqual({ ok: false, mensaje: "No se encontró el grupo." });
  });

  it("actualizarActivaUnidad: desactiva y activa, refresca una vez cada una; un id que no existe no se encuentra (O.44)", async () => {
    const u = await prisma.unidad.create({ data: { nombre: "caja", magnitud: "CANTIDAD", decimales: 0 } });
    expect(await actualizarActivaUnidad(u.id, false)).toEqual({ ok: true, mensaje: "Unidad desactivada." });
    expect((await prisma.unidad.findUniqueOrThrow({ where: { id: u.id } })).activa).toBe(false);
    expect(refrescos()).toBe(1);
    expect(await actualizarActivaUnidad(u.id, true)).toEqual({ ok: true, mensaje: "Unidad activada." });
    expect(refrescos()).toBe(1);
    expect(await actualizarActivaUnidad("no-existe", false)).toEqual({ ok: false, mensaje: "No se encontró la unidad." });
  });

  it("ninguna de las 7 deja filas de auditoría (no son dinero)", async () => {
    const c = await prisma.categoriaProducto.create({ data: { nombre: "Almacén" } });
    const i = await prisma.insumo.create({ data: { nombre: "Harina" } });
    const g = await prisma.grupo.create({ data: { nombre: "Secos" } });
    const u = await prisma.unidad.create({ data: { nombre: "caja", magnitud: "CANTIDAD", decimales: 0 } });
    await crearCategoriaProducto("Bebidas");
    await actualizarActivaCategoriaProducto(c.id, false);
    await crearInsumo("Sal");
    await actualizarActivoInsumo(i.id, false);
    await actualizarGrupoDeInsumo(i.id, g.id);
    await actualizarActivoGrupo(g.id, false);
    await actualizarActivaUnidad(u.id, false);
    expect(await prismaAdmin.registroAuditoria.count()).toBe(0);
  });
});
