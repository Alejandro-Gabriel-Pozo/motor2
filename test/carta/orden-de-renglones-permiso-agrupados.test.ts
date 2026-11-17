import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { fijarModoDeOrdenDeSeccionCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/fijar-modo-de-orden-de-seccion";
import { reordenarRenglonesDeSeccionCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/reordenar-renglones-de-seccion";
import { consultarOrdenDeSeccion } from "../../src/server/lecturas/carta/orden-de-renglones";

/**
 * Etapa O1, el permiso ADICIONAL: quien reordena una sección o cambia su modo necesita `carta_contenido_producto`; si la sección tiene ítems agrupados
 * necesita además `carta_items_agrupados`. Sin la segunda, se rechaza y no se escribe nada (ni orden, ni modo, ni auditoría). Esta prueba está para que
 * quitar ese control (`void gate;`) ponga la suite en rojo.
 */
describe("orden de renglones: el permiso adicional de ítems agrupados (etapa O1)", () => {
  let sucursalId: string;
  let usuarioId: string;
  let seccionId: string;
  const actor = () => actorDePrueba(usuarioId, sucursalId);
  const lista = async () => {
    const vistos = (await consultarOrdenDeSeccion(actor().db, { sucursalId, seccionCartaId: seccionId }))!.renglones;
    return vistos.slice().reverse().map((r) => ({ tipo: r.tipo, id: r.id, ordenVisto: r.orden }));
  };
  const reordenar = async () => reordenarRenglonesDeSeccionCasoDeUso(actor(), { seccionCartaId: seccionId, renglones: await lista() });
  const fijarModo = () => fijarModoDeOrdenDeSeccionCasoDeUso(actor(), { seccionCartaId: seccionId, modo: "ALFABETICO", versionVista: 0, modoId: crypto.randomUUID() });
  const sinNingunaEscritura = async () => {
    expect(await prisma.modoDeOrdenDeSeccionCarta.count()).toBe(0);
    expect(await prisma.registroAuditoria.count({ where: { entidad: { in: ["ModoDeOrdenDeSeccionCarta", "ContenidoCartaProducto", "ItemAgrupadoCarta"] } } })).toBe(0);
  };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    const unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    seccionId = (await prisma.seccionCarta.create({ data: { nombre: "Bebidas", orden: 1 } })).id;
    const agua = await sembrarProductoDisponible({ codigo: "PV_AGUA", nombre: "Agua", tipo: "PV", unidadStockId: unidadId, precioVenta: 1000 }, sucursalId);
    await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: agua.id, visibleEnCarta: true, seccionCartaId: seccionId, orden: 0 } });
    const agrupado = await prisma.itemAgrupadoCarta.create({ data: { sucursalId, nombre: "Gaseosas", seccionCartaId: seccionId, orden: 1 } });
    const opcion = await sembrarProductoDisponible({ codigo: "OP_GASEOSA", nombre: "Gaseosa opción", tipo: "PV", unidadStockId: unidadId, precioVenta: 1000 }, sucursalId);
    await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId, itemAgrupadoCartaId: agrupado.id, productoId: opcion.id } });
    // El rol admin tiene las dos claves; a este usuario se le quita SOLO la de ítems agrupados.
    const quitadas = await prisma.permisoRol.updateMany({ where: { rolId: base.admin.id, accionClave: "carta_items_agrupados" }, data: { puedeEditar: false, puedeVer: false } });
    expect(quitadas.count).toBe(1);
  });

  it("con `carta_contenido_producto` pero SIN `carta_items_agrupados`, reordenar una sección con un ítem agrupado se rechaza y no escribe nada", async () => {
    const r = await reordenar();
    expect(r.ok).toBe(false);
    await sinNingunaEscritura();
  });

  it("con `carta_contenido_producto` pero SIN `carta_items_agrupados`, cambiar el modo de una sección con un ítem agrupado se rechaza y no escribe nada", async () => {
    const r = await fijarModo();
    expect(r.ok).toBe(false);
    await sinNingunaEscritura();
  });

  it("con las DOS claves las dos acciones corren", async () => {
    await prisma.permisoRol.updateMany({ where: { accionClave: "carta_items_agrupados" }, data: { puedeEditar: true, puedeVer: true } });
    expect((await reordenar()).ok).toBe(true);
    expect((await fijarModo()).ok).toBe(true);
    expect(await prisma.modoDeOrdenDeSeccionCarta.count()).toBe(1);
  });
});
