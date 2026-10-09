import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
// `refrescarVistaSiHaceFalta` llama a `refresh` de Next: se cuenta (no se ejecuta), como en `caracterizacion/catalogo-sin-test-unitario.test.ts`.
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

import { refresh } from "next/cache";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearOActualizarGrupo } from "../../src/server/actions/catalogo/insumos";

/**
 * `crearOActualizarGrupo`: los mensajes exactos de sus tres caminos y CUÁNDO refresca la vista (Hito 4, bloque 4.3, paso H4C-9). Nació porque la mutación
 * «refrescar también cuando se rechaza el ciclo» de la mudanza no la veía ningún test (`grupos.test.ts` mira el ciclo, no el refresco, y la caracterización de las
 * acciones sin test unitario no incluye esta). Fija: el alta y el cambio de padre refrescan una vez cada uno (la «Cadena» de cada grupo se calcula en el
 * servidor); el ciclo se rechaza sin escribir y SIN refrescar; el cambio de padre responde con el nombre tal como se tipeó (recortado), no con el guardado.
 */
describe("crearOActualizarGrupo: mensajes y refresco de la vista", () => {
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

  it("alta: crea el grupo y refresca una vez; nombre vacío: rechaza sin refrescar", async () => {
    expect(await crearOActualizarGrupo("  ", null)).toEqual({ ok: false, mensaje: "El nombre del grupo no puede estar vacío." });
    expect(refrescos()).toBe(0);
    expect(await crearOActualizarGrupo("  Bebidas  ", null)).toEqual({ ok: true, mensaje: 'Grupo "Bebidas" creado.' });
    expect(refrescos()).toBe(1);
    expect(await prisma.grupo.findFirstOrThrow()).toMatchObject({ nombre: "Bebidas", grupoPadreId: null });
  });

  it("cambio de padre: responde con el nombre tipeado y refresca una vez", async () => {
    const raiz = await prisma.grupo.create({ data: { nombre: "Almacén" } });
    await prisma.grupo.create({ data: { nombre: "Bebidas" } });
    expect(await crearOActualizarGrupo("BEBIDAS", raiz.id)).toEqual({ ok: true, mensaje: 'Grupo "BEBIDAS" actualizado.' });
    expect(refrescos()).toBe(1);
    expect(await prisma.grupo.findFirstOrThrow({ where: { nombre: "Bebidas" } })).toMatchObject({ grupoPadreId: raiz.id });
  });

  it("ciclo: rechaza sin escribir y SIN refrescar", async () => {
    const a = await prisma.grupo.create({ data: { nombre: "A" } });
    const b = await prisma.grupo.create({ data: { nombre: "B", grupoPadreId: a.id } });
    expect(await crearOActualizarGrupo("A", b.id)).toEqual({ ok: false, mensaje: 'Ese padre ya desciende de "A", o es el mismo grupo — crearía un ciclo.' });
    expect(refrescos()).toBe(0);
    expect((await prisma.grupo.findUniqueOrThrow({ where: { id: a.id } })).grupoPadreId).toBeNull();
  });
});
