import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { ACCIONES } from "../../src/core/permisos/acciones";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { sincronizarPrecioGrupoCarta } from "../../src/server/actions/catalogo/productos";

/**
 * S-41 / D4 (plan de endurecimiento de seguridad, tanda T2; decisión 22 del dueño: tres clases de claves). `producto_sincronizar_precio_carta` aplica el mismo precio de
 * venta GLOBAL a varios productos de un ítem agrupado de la carta: fija el precio de venta de todas las sucursales, igual que `producto_editar`. Se sembraba al rol de fábrica
 * «operador» (cualquiera con ese rol cambiaba el precio global a otro valor, con auditoría pero sin pedirle nada al administrador). Ahora es de clase O (operativa sensible):
 * piso «operario» en el catálogo —para que el gerente la pueda asignar a un rol propio («Precios», un encargado) por configuración, con cada asignación auditada— y semilla
 * SOLO `admin`: nadie más la tiene al nacer la empresa.
 */
describe("S-41: la semilla del precio global es solo del administrador (clase O)", () => {
  let sucursalId: string;
  let adminId: string;
  let operadorId: string;
  let rolPreciosId: string;
  let productoId: string;
  let hermanoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id })).id;
    // Un rol propio al que el gerente le asignó la clave por configuración (una fila de PermisoRol), sin ninguna otra.
    const rol = await prisma.rol.create({ data: { nombre: "Precios" } });
    rolPreciosId = rol.id;
    await prisma.permisoRol.create({ data: { rolId: rol.id, accionClave: "producto_sincronizar_precio_carta", puedeVer: true, puedeEditar: true } });
    const unidad = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    const categoriaId = (await prisma.categoriaProducto.create({ data: { nombre: "Gaseosa" } })).id;
    productoId = (await sembrarProductoDisponible({ codigo: "SP_1", nombre: "Coca", tipo: "PV", categoriaId, precioVenta: 1000, unidadStockId: unidad.id }, sucursalId)).id;
    hermanoId = (await sembrarProductoDisponible({ codigo: "SP_2", nombre: "Fanta", tipo: "PV", categoriaId, precioVenta: 1000, unidadStockId: unidad.id }, sucursalId)).id;
    const seccion = await prisma.seccionCarta.create({ data: { nombre: "Bebidas" } });
    const item = await prisma.itemAgrupadoCarta.create({ data: { sucursalId, nombre: "Gaseosa", seccionCartaId: seccion.id } });
    await prisma.opcionItemAgrupadoCarta.createMany({ data: [productoId, hermanoId].map((id, orden) => ({ sucursalId, itemAgrupadoCartaId: item.id, productoId: id, orden })) });
  });

  const precios = async () => (await prisma.producto.findMany({ where: { id: { in: [productoId, hermanoId] } }, orderBy: { codigo: "asc" } })).map((p) => Number(p.precioVenta));
  const como = (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });

  it("EL ATAQUE: el rol de fábrica «operador» ya no fija el precio global de un ítem agrupado (antes: ok y los dos precios cambiaban)", async () => {
    await como(operadorId, "operador@test.com");
    const r = await sincronizarPrecioGrupoCarta([productoId, hermanoId], 1);
    expect(r.ok).toBe(false);
    expect(await precios()).toEqual([1000, 1000]);
  });

  it("control: el administrador sí", async () => {
    await como(adminId, "admin@test.com");
    expect((await sincronizarPrecioGrupoCarta([productoId, hermanoId], 1200)).ok).toBe(true);
    expect(await precios()).toEqual([1200, 1200]);
  });

  it("es delegable por configuración: un rol propio con la fila de la clave la ejerce (el piso sigue siendo «operario»)", async () => {
    const usuario = await crearUsuarioConMembresia({ email: "precios@test.com", sucursalId, rolId: rolPreciosId });
    await como(usuario.id, "precios@test.com");
    expect((await sincronizarPrecioGrupoCarta([productoId, hermanoId], 1300)).ok).toBe(true);
    expect(await precios()).toEqual([1300, 1300]);
  });

  it("el catálogo la declara de clase O: piso operario y semilla solo admin", () => {
    const accion = ACCIONES.find((a) => a.clave === "producto_sincronizar_precio_carta")!;
    expect(accion.nivelMinimo).toBe("operario");
    expect([...accion.rolesEditarSemilla]).toEqual(["admin"]);
  });
});
