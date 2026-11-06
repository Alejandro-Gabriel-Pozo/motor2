import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { guardarContenidoCartaProducto } from "../../src/server/actions/carta/contenido-producto";
import { quitarProductoDeLaCarta } from "../../src/server/actions/carta/mantenimiento";
import { resolverMenuCarta } from "../../src/server/lecturas/carta/menu";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";

/**
 * «Nombre en la carta» (2026-11-04; `docs/diseno-nombre-en-carta-2026-11-04.md`), contra Postgres real y a través de las Server Actions. Lo escribe SOLO `guardarContenidoCartaProducto` (permiso
 * `carta_contenido_producto`, sucursal ACTIVA) y se audita POR COLUMNA en la misma transacción. Qué fija:
 *  - guardarlo, cambiarlo y borrarlo deja UNA fila de auditoría por cambio (con la sucursal y del valor anterior al nuevo); repetir lo mismo no deja otra (idempotencia);
 *  - un pedido SIN la clave (otro formulario) no lo toca ni audita; uno en blanco lo borra (vuelve al nombre del producto);
 *  - un valor inválido se rechaza sin escribir;
 *  - DOS guardados simultáneos: ninguno se pierde a medias, queda uno de los dos y la cadena de auditoría es coherente (el «anterior» del segundo es el «nuevo» del primero);
 *  - sin el permiso no escribe nada; escribe siempre en la sucursal activa;
 *  - la carta pública usa el nombre de la carta y la de otra sucursal sigue con el del producto; el nombre interno no cambia;
 *  - quitar el producto de la carta (con confirmación) audita lo que se perdía.
 */
describe("«Nombre en la carta» del contenido de carta", () => {
  let sucursalId: string;
  let otraSucursalId: string;
  let seccionCartaId: string;
  let pizzasId: string;
  let adminRolId: string;
  let operadorRolId: string;

  const fila = (sucursal = sucursalId) => prisma.contenidoCartaProducto.findUnique({ where: { sucursalId_productoId: { sucursalId: sucursal, productoId: pizzasId } } });
  const auditoria = () => prisma.registroAuditoria.findMany({ where: { entidad: "ContenidoCartaProducto", campo: "nombreEnCarta" }, orderBy: { creadoEn: "asc" } });
  const guardar = (extra: Record<string, unknown>) => guardarContenidoCartaProducto(pizzasId, { visibleEnCarta: true, seccionCartaId, descripcion: "A la piedra", ...extra });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    adminRolId = base.admin.id;
    operadorRolId = base.operador.id;
    otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: adminRolId });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    const u = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    seccionCartaId = (await prisma.seccionCarta.create({ data: { nombre: "Pizzas", orden: 1 } })).id;
    pizzasId = (await sembrarProductoDisponible({ codigo: "PV_PIZZAS", nombre: "Pizzas", tipo: "PV", precioVenta: 18000, unidadStockId: u.id }, sucursalId)).id;
    await prisma.disponibilidadProducto.create({ data: { sucursalId: otraSucursalId, productoId: pizzasId, disponible: true } });
  });

  it("cargarlo, cambiarlo y borrarlo deja una fila de auditoría por cambio, con la sucursal; repetir el mismo valor no deja otra", async () => {
    expect((await guardar({ nombreEnCarta: "La Napo" })).ok).toBe(true);
    expect((await fila())?.nombreEnCarta).toBe("La Napo");
    expect((await guardar({ nombreEnCarta: "La Napo" })).ok, "repetir (doble clic)").toBe(true);
    expect((await guardar({ nombreEnCarta: "La Napo de la casa" })).ok).toBe(true);
    expect((await guardar({ nombreEnCarta: "   " })).ok, "en blanco = borrarlo").toBe(true);
    expect((await guardar({ nombreEnCarta: null })).ok, "borrarlo de nuevo").toBe(true);
    expect((await fila())?.nombreEnCarta).toBeNull();
    const registros = await auditoria();
    expect(registros.map((r) => [r.entidadId, r.valorAnterior, r.valorNuevo, r.sucursalId])).toEqual([
      [`${sucursalId}:${pizzasId}`, null, "La Napo", sucursalId],
      [`${sucursalId}:${pizzasId}`, "La Napo", "La Napo de la casa", sucursalId],
      [`${sucursalId}:${pizzasId}`, "La Napo de la casa", null, sucursalId],
    ]);
    expect(registros[0]!.descripcion).toContain("con nombre en la carta");
    expect(registros[2]!.descripcion).toContain("sin nombre en la carta");
  });

  it("un pedido sin la clave no lo toca ni audita; sin nombre y sin fila previa no deja auditoría", async () => {
    expect((await guardar({})).ok).toBe(true);
    expect(await auditoria()).toEqual([]);
    expect((await guardar({ nombreEnCarta: "La Napo" })).ok).toBe(true);
    expect((await guardar({ descripcion: "Otra descripción" })).ok, "un formulario sin la clave").toBe(true);
    expect(await fila()).toMatchObject({ nombreEnCarta: "La Napo", descripcion: "Otra descripción" });
    expect(await auditoria()).toHaveLength(1);
  });

  it("un valor inválido se rechaza sin escribir nada", async () => {
    for (const malo of [1, true, {}, "La\nNapo", " La Napo", "x".repeat(81)]) {
      expect((await guardar({ nombreEnCarta: malo })).ok, JSON.stringify(malo)).toBe(false);
    }
    expect(await fila()).toBeNull();
    expect(await auditoria()).toEqual([]);
  });

  it("dos guardados simultáneos con nombres distintos: queda uno de los dos y la cadena de auditoría es coherente", async () => {
    const resultados = await Promise.all([guardar({ nombreEnCarta: "Nombre A" }), guardar({ nombreEnCarta: "Nombre B" })]);
    expect(resultados.map((r) => r.ok)).toEqual([true, true]);
    const final = (await fila())?.nombreEnCarta;
    expect(["Nombre A", "Nombre B"]).toContain(final);
    const registros = await auditoria();
    expect(registros).toHaveLength(2);
    // El primero en entrar encontró NULL; el segundo encontró el del primero; el último «nuevo» es lo que quedó guardado.
    expect(registros[0]!.valorAnterior).toBeNull();
    expect(registros[1]!.valorAnterior).toBe(registros[0]!.valorNuevo);
    expect(registros[1]!.valorNuevo).toBe(final);
    expect(new Set(registros.map((r) => r.valorNuevo))).toEqual(new Set(["Nombre A", "Nombre B"]));
  });

  it("dos guardados simultáneos con el MISMO nombre: queda una sola fila y una sola auditoría", async () => {
    const resultados = await Promise.all([guardar({ nombreEnCarta: "La Napo" }), guardar({ nombreEnCarta: "La Napo" })]);
    expect(resultados.map((r) => r.ok)).toEqual([true, true]);
    expect(await prisma.contenidoCartaProducto.count({ where: { productoId: pizzasId } })).toBe(1);
    expect(await auditoria()).toHaveLength(1);
  });

  it("sin el permiso `carta_contenido_producto` no escribe ni audita; con él, escribe en la sucursal activa y nunca en otra", async () => {
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: operadorRolId });
    await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
    expect((await guardar({ nombreEnCarta: "La Napo" })).ok).toBe(false);
    expect(await fila()).toBeNull();
    expect(await auditoria()).toEqual([]);

    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@test.com" } });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    expect((await guardar({ nombreEnCarta: "La Napo" })).ok).toBe(true);
    expect((await fila())?.nombreEnCarta).toBe("La Napo");
    expect(await fila(otraSucursalId)).toBeNull();
  });

  it("la carta pública de la sucursal usa el nombre de la carta; la de otra sucursal y el producto siguen con el interno", async () => {
    expect((await guardar({ nombreEnCarta: "La Napo" })).ok).toBe(true);
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: otraSucursalId, productoId: pizzasId, visibleEnCarta: true, seccionCartaId, orden: 0 } });
    const nombres = async (suc: string) => (await resolverMenuCarta(suc, prisma, AHORA_DE_LA_CORRIDA))!.secciones.flatMap((s) => s.items.map((i) => i.nombre));
    expect(await nombres(sucursalId)).toEqual(["La Napo"]);
    expect(await nombres(otraSucursalId)).toEqual(["Pizzas"]);
    expect((await prisma.producto.findUniqueOrThrow({ where: { id: pizzasId } })).nombre).toBe("Pizzas");
  });

  it("quitar el producto de la carta (confirmado) deja auditado el nombre que tenía", async () => {
    expect((await guardar({ nombreEnCarta: "La Napo" })).ok).toBe(true);
    expect((await quitarProductoDeLaCarta({ sucursalId, productoId: pizzasId, confirmado: true })).ok).toBe(true);
    expect(await fila()).toBeNull();
    const registros = await auditoria();
    expect(registros.at(-1)).toMatchObject({ valorAnterior: "La Napo", valorNuevo: null, sucursalId });
  });
});
