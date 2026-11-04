import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearMembresia } from "../setup/membresia";
import { actualizarVisibleEnCarta, guardarContenidoCartaProducto } from "../../src/server/actions/carta/contenido-producto";
import { agregarProductoALaCarta } from "../../src/server/actions/carta/mantenimiento";
import { copiarCartaDeSucursal } from "../../src/server/actions/carta/copiar-carta";
import { COLISION, TAMANO_DE_COLISION, VARIANTE_DEL_NOMBRE, debeRechazarse } from "./nombre-en-carta.oraculo";

/**
 * Regla del dueño (2026-11-04): en la carta de una sucursal NO puede haber dos cosas con el mismo nombre visible (`docs/diseno-nombre-en-carta-2026-11-04.md`). Contra Postgres real y a través de las acciones:
 * el oráculo de la dimensión «colisión» (escrito aparte, a mano) recorrido entero, el mismo guardado repetido, dos usuarios guardando el mismo nombre a la vez, mostrar un plato cuyo nombre ya usa otro, y la copia.
 */
describe("«Nombre en la carta»: sin nombres repetidos en una carta", () => {
  let sucursalId: string;
  let otraSucursalId: string;
  let seccionCartaId: string;
  let unidadId: string;
  let adminRolId: string;
  let objetivoId: string;

  const producto = async (codigo: string, nombre: string) => {
    const p = await sembrarProductoDisponible({ codigo, nombre, tipo: "PV", precioVenta: 1000, unidadStockId: unidadId }, sucursalId);
    await prisma.disponibilidadProducto.create({ data: { sucursalId: otraSucursalId, productoId: p.id, disponible: true } });
    return p.id;
  };
  const contenido = (suc: string, productoId: string, extra: { visibleEnCarta: boolean; nombreEnCarta?: string | null }) =>
    prisma.contenidoCartaProducto.create({ data: { sucursalId: suc, productoId, seccionCartaId, orden: 0, visibleEnCarta: extra.visibleEnCarta, nombreEnCarta: extra.nombreEnCarta ?? null } });
  const guardar = (productoId: string, nombreEnCarta: unknown, visibleEnCarta = true) => guardarContenidoCartaProducto(productoId, { visibleEnCarta, seccionCartaId, descripcion: null, nombreEnCarta } as never);
  const nombreGuardado = async (productoId: string, suc = sucursalId) => (await prisma.contenidoCartaProducto.findFirst({ where: { sucursalId: suc, productoId } }))?.nombreEnCarta ?? null;
  const auditorias = () => prisma.registroAuditoria.count({ where: { entidad: "ContenidoCartaProducto", campo: "nombreEnCarta" } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    adminRolId = base.admin.id;
    otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: adminRolId });
    await crearUsuarioConMembresia({ email: "admin-otra@test.com", sucursalId: otraSucursalId, rolId: adminRolId });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    seccionCartaId = (await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } })).id;
    objetivoId = await producto("PV_OBJ", "Milanesa");
  });

  /** Arma la escena de cada colisión y devuelve el nombre que se va a querer guardar, en la variante pedida. */
  async function escena(colision: (typeof COLISION)[number], variante: (typeof VARIANTE_DEL_NOMBRE)[number]): Promise<string> {
    const otro = await producto("PV_OTRO", "Pizza especial");
    switch (colision) {
      case "sin-choque":
        break;
      case "nombre-en-carta-de-otro":
        await contenido(sucursalId, otro, { visibleEnCarta: true, nombreEnCarta: "La Napólitana" });
        break;
      case "interno-de-otro-visible":
        await prisma.producto.update({ where: { id: otro }, data: { nombre: "La Napólitana" } });
        await contenido(sucursalId, otro, { visibleEnCarta: true });
        break;
      case "interno-de-otro-oculto":
        await prisma.producto.update({ where: { id: otro }, data: { nombre: "La Napólitana" } });
        await contenido(sucursalId, otro, { visibleEnCarta: false });
        break;
      case "agrupado":
        await prisma.itemAgrupadoCarta.create({ data: { sucursalId, nombre: "La Napólitana", seccionCartaId, orden: 1 } });
        break;
      case "promo":
        await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId } }, seccionCartaId, titulo: "La Napólitana", precio: 1000 } });
        break;
      case "promo-de-otra-sucursal":
        await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: otraSucursalId } }, seccionCartaId, titulo: "La Napólitana", precio: 1000 } });
        break;
      case "nombre-en-carta-de-otra-sucursal":
        await contenido(otraSucursalId, otro, { visibleEnCarta: true, nombreEnCarta: "La Napólitana" });
        break;
    }
    return variante === "igual" ? "La Napólitana" : variante === "otras-mayusculas" ? "la napólitana" : "LA NAPOLITANA";
  }

  it("el oráculo de colisión recorre todas las combinaciones (colisión × variante) y el guardado se rechaza exactamente donde la tabla lo dice", async () => {
    let recorridas = 0;
    for (const colision of COLISION) {
      for (const variante of VARIANTE_DEL_NOMBRE) {
        await limpiarBaseDeTest();
        const base = await sembrarBase();
        sucursalId = base.sucursal.id;
        adminRolId = base.admin.id;
        otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
        const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: adminRolId });
        await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
        unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
        seccionCartaId = (await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } })).id;
        objetivoId = await producto("PV_OBJ", "Milanesa");
        const nombre = await escena(colision, variante);

        const r = await guardar(objetivoId, nombre);
        const etiqueta = `${colision} / ${variante}`;
        expect(!r.ok, etiqueta).toBe(debeRechazarse(colision));
        if (debeRechazarse(colision)) {
          expect(r.mensaje, etiqueta).toContain("elegí otro");
          expect(await nombreGuardado(objetivoId), `no escribió (${etiqueta})`).toBeNull();
          expect(await auditorias(), `no auditó (${etiqueta})`).toBe(0);
        } else {
          expect(await nombreGuardado(objetivoId), etiqueta).toBe(nombre);
        }
        recorridas++;
      }
    }
    expect(recorridas).toBe(TAMANO_DE_COLISION);
  }, 240_000);

  it("el mensaje dice con quién choca: el plato que ya lleva ese nombre en la carta", async () => {
    const otro = await producto("PV_OTRO", "Pizza especial");
    await contenido(sucursalId, otro, { visibleEnCarta: true, nombreEnCarta: "La Napo" });
    const r = await guardar(objetivoId, "la napo");
    expect(r).toMatchObject({ ok: false });
    expect(r.mensaje).toContain("«la napo»");
    expect(r.mensaje).toContain("«Pizza especial»");
  });

  it("repetir el mismo guardado (doble clic) no choca consigo mismo y no deja otra auditoría", async () => {
    expect((await guardar(objetivoId, "La Napo")).ok).toBe(true);
    expect((await guardar(objetivoId, "La Napo")).ok).toBe(true);
    expect(await auditorias()).toBe(1);
  });

  it("un plato visible no choca con su PROPIO nombre de producto: se puede guardar el nombre en la carta igual al interno, o volver a guardar sin nombre", async () => {
    expect((await guardar(objetivoId, null)).ok).toBe(true);
    expect((await guardar(objetivoId, "Milanesa")).ok).toBe(true);
    expect((await guardar(objetivoId, null)).ok).toBe(true);
  });

  it("dos usuarios guardan el MISMO nombre a la vez en dos platos: gana uno, el otro recibe el mensaje y queda un solo plato con ese nombre", async () => {
    const otro = await producto("PV_OTRO", "Pizza especial");
    const resultados = await Promise.all([guardar(objetivoId, "La Napo"), guardar(otro, "la napo")]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.filter((r) => !r.ok)[0]!.mensaje).toContain("elegí otro");
    expect(await prisma.contenidoCartaProducto.count({ where: { sucursalId, nombreEnCarta: { not: null } } })).toBe(1);
    expect(await auditorias()).toBe(1);
  });

  it("mostrar un plato cuyo nombre interno ya usa otro como nombre en la carta se rechaza (atajo «Mostrar» y «Agregar a la carta»), sin escribir; con otro nombre en la carta, sí", async () => {
    const otro = await producto("PV_OTRO", "Pizza especial");
    await contenido(sucursalId, otro, { visibleEnCarta: true, nombreEnCarta: "Milanesa" });
    // Un contenido oculto del objetivo (con sección) y el atajo de mostrar.
    await contenido(sucursalId, objetivoId, { visibleEnCarta: false });
    expect(await actualizarVisibleEnCarta(objetivoId, true)).toMatchObject({ ok: false });
    expect((await prisma.contenidoCartaProducto.findFirstOrThrow({ where: { sucursalId, productoId: objetivoId } })).visibleEnCarta).toBe(false);
    // Un producto sin contenido que se agrega desde «Agregar a la carta»: su nombre choca (sin mayúsculas) con un ítem agrupado.
    await prisma.itemAgrupadoCarta.create({ data: { sucursalId, nombre: "Postre del día", seccionCartaId, orden: 2 } });
    const postre = await producto("PV_POSTRE", "postre del día");
    const r = await agregarProductoALaCarta({ sucursalId, productoId: postre, seccionCartaId });
    expect(r).toMatchObject({ ok: false });
    expect(await prisma.contenidoCartaProducto.count({ where: { sucursalId, productoId: postre } })).toBe(0);
    // Con un nombre en la carta propio, mostrar sí puede.
    expect((await guardar(objetivoId, "Milanesa de la casa", false)).ok).toBe(true);
    expect((await actualizarVisibleEnCarta(objetivoId, true)).ok).toBe(true);
  });

  it("«copiar carta»: si la sucursal destino tiene una promo con el mismo nombre, ese nombre en la carta no se copia (el plato sale con el de su producto), se informa y el resto de la copia sigue", async () => {
    await contenido(sucursalId, objetivoId, { visibleEnCarta: true, nombreEnCarta: "La Napo" });
    const otro = await producto("PV_OTRO", "Pizza especial");
    await contenido(sucursalId, otro, { visibleEnCarta: true, nombreEnCarta: "Fugazza de la casa" });
    await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: otraSucursalId } }, seccionCartaId, titulo: "LA NAPO", precio: 1000 } });
    const adminOtra = await prisma.user.findFirstOrThrow({ where: { email: "admin-otra@test.com" } });
    await crearMembresia({ usuarioId: adminOtra.id, sucursalId, rolId: adminRolId });
    await mockearUsuarioActual({ id: adminOtra.id, email: adminOtra.email, nombre: null });
    const r = await copiarCartaDeSucursal(sucursalId, true);
    expect(r.ok, r.mensaje).toBe(true);
    expect(r.mensaje).toContain("No se copió el nombre en la carta de 1 plato(s)");
    expect(await nombreGuardado(objetivoId, otraSucursalId)).toBeNull();
    expect(await nombreGuardado(otro, otraSucursalId)).toBe("Fugazza de la casa");
  });
});
