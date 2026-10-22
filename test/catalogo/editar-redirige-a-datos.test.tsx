import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import EditarProductoPage from "../../src/app/(app)/catalogo/productos/[id]/editar/page";
import ProductosPage from "../../src/app/(app)/catalogo/productos/page";

/**
 * Fase 6, paso 6.13 (DEC-12, ADDENDUM 2026-10-21): `/catalogo/productos/[id]/editar` redirige SIEMPRE (307) al paso 1, `/catalogo/productos/[id]/datos`, para todos los tipos y sin leer el producto, pero
 * DESPUÉS de las guardas: quien no puede editar recibe en `/editar` el mismo «No tenés permiso» de siempre y no se le lleva ni se le revela nada. Se llama a las páginas de verdad, contra la base, con personas reales
 * (rol y permisos en la base); un redirect de Next es un error con el `digest` `NEXT_REDIRECT;<modo>;<url>;<estado>;`. La prueba HTTP real (307 con `Location`) es la del e2e `catalogo-ficha-producto`.
 */
async function resultadoDe(pagina: () => Promise<unknown>): Promise<{ redirigeA: string | null; estado: string | null; valor: unknown }> {
  try {
    return { redirigeA: null, estado: null, valor: await pagina() };
  } catch (e) {
    const digest = String((e as { digest?: string })?.digest ?? "");
    const m = /^NEXT_REDIRECT;[^;]*;([^;]*);(\d+);/.exec(digest);
    if (!m) throw e;
    return { redirigeA: m[1], estado: m[2], valor: null };
  }
}

describe("/editar redirige al paso 1 después de las guardas", () => {
  let sucursalId: string;
  let usuarios: { admin: string; soloVer: string; sinNada: string };
  let pvId: string;
  let mpId: string;

  const como = (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });
  const editar = (id: string) => resultadoDe(() => EditarProductoPage({ params: Promise.resolve({ id }) }));

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    pvId = (await sembrarProductoDisponible({ codigo: "PV_MILA", nombre: "Milanesas", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 20000 }, sucursalId)).id;
    mpId = (await sembrarProductoDisponible({ codigo: "MP_QUESO", nombre: "Queso", tipo: "MP", unidadStockId: catalogo.kg.id, unidadCompraId: catalogo.g.id, factorConversion: 25 }, sucursalId)).id;
    const rolSoloVer = await prisma.rol.create({ data: { nombre: "Mira" } });
    for (const accionClave of ["alta_producto", "producto_ver_catalogo"]) await prisma.permisoRol.create({ data: { rolId: rolSoloVer.id, accionClave, puedeVer: true, puedeEditar: false } });
    const rolSinNada = await prisma.rol.create({ data: { nombre: "Nada" } });
    usuarios = {
      admin: (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id,
      soloVer: (await crearUsuarioConMembresia({ email: "mira@test.com", sucursalId, rolId: rolSoloVer.id })).id,
      sinNada: (await crearUsuarioConMembresia({ email: "nada@test.com", sucursalId, rolId: rolSinNada.id })).id,
    };
  });

  it.each([
    ["un producto de venta", () => pvId],
    ["una materia prima", () => mpId],
  ] as const)("quien puede editar: %s va a /datos con un 307", async (_tipo, id) => {
    await como(usuarios.admin, "admin@test.com");
    const r = await editar(id());
    expect(r.redirigeA).toBe(`/catalogo/productos/${id()}/datos`);
    expect(r.estado).toBe("307");
  });

  it("un id que no existe también redirige (sin leer el producto): el 404 lo da /datos", async () => {
    await como(usuarios.admin, "admin@test.com");
    expect((await editar("no-existe-este-id")).redirigeA).toBe("/catalogo/productos/no-existe-este-id/datos");
  });

  it("el id viaja codificado: no se puede colar una ruta ni una consulta por el segmento", async () => {
    await como(usuarios.admin, "admin@test.com");
    const r = await editar("../../login?x=1#y");
    expect(r.redirigeA).toBe(`/catalogo/productos/${encodeURIComponent("../../login?x=1#y")}/datos`);
    expect(r.redirigeA).not.toContain("?");
  });

  it("quien solo VE productos NO es redirigido: recibe «No tenés permiso» (la guarda corre antes que el redirect)", async () => {
    await como(usuarios.soloVer, "mira@test.com");
    const r = await editar(pvId);
    expect(r.redirigeA).toBeNull();
    expect(JSON.stringify(r.valor)).toContain("No tenés permiso");
  });

  it("quien no tiene ni Ver tampoco es redirigido (y no se le dice que el producto existe)", async () => {
    await como(usuarios.sinNada, "nada@test.com");
    const r = await editar(pvId);
    expect(r.redirigeA).toBeNull();
    expect(JSON.stringify(r.valor)).toContain("No tenés permiso");
  });

  it("el enlace viejo `/catalogo/productos?id=` de la lista va directo a /datos (sin pasar por /editar)", async () => {
    await como(usuarios.admin, "admin@test.com");
    const r = await resultadoDe(() => ProductosPage({ searchParams: Promise.resolve({ id: pvId }) }));
    expect(r.redirigeA).toBe(`/catalogo/productos/${pvId}/datos`);
  });
});
