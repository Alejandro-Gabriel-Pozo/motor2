import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { clienteConEmpresaDePrueba, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "../setup/test-db";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarProveedor, altaProveedor, listarProveedores } from "../../src/server/actions/catalogo/proveedores";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";
import { mediodiaDelDia, ZONA_ARGENTINA, diaDeCalendario } from "../../src/core/tiempo/zona-horaria";
import { randomUUID } from "node:crypto";

/**
 * Proveedores (2026-11-04): corregir el NOMBRE de un proveedor y marcar si ofrece productos, servicios o ambos, contra Postgres real y por la Server Action de verdad.
 *
 * Cubre: renombrar (el id, el código y las compras del proveedor no cambian); el nombre repetido (sin distinguir mayúsculas, nombrando al otro; cambiar solo las mayúsculas del propio
 * nombre no choca consigo mismo); la CONCURRENCIA (dos ediciones del nombre a la vez sobre el mismo proveedor: gana una; la otra recibe «cambió mientras lo editabas»; y dos renombres
 * al MISMO nombre desde dos proveedores: gana uno); la IDEMPOTENCIA (guardar dos veces lo mismo no audita de más); la auditoría (quién, antes y después); las dos casillas (ninguna se
 * rechaza; un proveedor existente conserva lo que tiene); y el aislamiento entre empresas.
 *
 * Mutaciones (anotadas en el commit): sin el `where nombre = actual` y sin la comparación con `nombreEsperado` → rojo «dos ediciones a la vez»; sin excluir al propio proveedor en la búsqueda
 * → rojo «cambiar solo las mayúsculas»; sin auditar el nombre → rojo «auditoría»; sin validar la oferta → rojo «ninguna casilla».
 */
let admin: string;
let sucursalId: string;

const nombreDe = async (id: string) => (await prisma.proveedor.findUniqueOrThrow({ where: { id } })).nombre;
const auditoriaDe = (id: string, campo?: string) => prisma.registroAuditoria.findMany({ where: { entidad: "Proveedor", entidadId: id, ...(campo ? { campo } : {}) }, orderBy: { creadoEn: "asc" } });
const crear = (codigo: string, nombre: string, extra: Record<string, unknown> = {}) => prisma.proveedor.create({ data: { codigo, nombre, ...extra } });

beforeEach(async () => {
  __setCookieDeTestParaSucursal(undefined);
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  sucursalId = base.sucursal.id;
  const usuario = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
  admin = usuario.id;
  await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });
});

describe("renombrar un proveedor", () => {
  it("el proveedor de luz cargado abreviado se corrige: cambia el nombre y NO el id ni el código", async () => {
    const luz = await crear("PRV_LUZ", "Edenor SA");
    const r = await actualizarProveedor(luz.id, { nombre: "Edenor S.A. (luz)", nombreEsperado: "Edenor SA" });
    expect(r.ok, r.mensaje).toBe(true);
    const despues = await prisma.proveedor.findUniqueOrThrow({ where: { id: luz.id } });
    expect([despues.id, despues.codigo, despues.nombre]).toEqual([luz.id, "PRV_LUZ", "Edenor S.A. (luz)"]);
  });

  it("las compras del proveedor siguen siendo suyas y los reportes leen el nombre nuevo", async () => {
    __setCookieDeTestParaSucursal(sucursalId);
    const { kg, insumo } = await sembrarCatalogoBase();
    const seccion = await sembrarSeccion(sucursalId);
    const producto = await prisma.producto.create({ data: { codigo: "MP_X", nombre: "Harina", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
    const molino = await crear("PRV_MOL", "Molino");
    const compra = await registrarMovimiento({
      proceso: "COMPRA",
      fecha: mediodiaDelDia(diaDeCalendario(new Date(), ZONA_ARGENTINA), ZONA_ARGENTINA),
      seccionId: seccion.id,
      proveedorId: molino.id,
      nroFactura: "A-00001-00000001",
      items: [{ productoId: producto.id, cantidad: 10, precioTotal: 1000, referenciaProveedor: REFERENCIA_DE_PRUEBA }],
      claveIdempotencia: randomUUID(),
    });
    expect(compra.ok, compra.mensaje).toBe(true);
    const antes = await prisma.operacion.findMany({ where: { proveedorId: molino.id }, select: { id: true } });
    expect(antes).toHaveLength(1);

    const r = await actualizarProveedor(molino.id, { nombre: "Molino Harinero SA", nombreEsperado: "Molino" });
    expect(r.ok, r.mensaje).toBe(true);
    expect(await prisma.operacion.findMany({ where: { proveedorId: molino.id }, select: { id: true } }), "la compra sigue colgada del mismo proveedor").toEqual(antes);
    const lista = await listarProveedores();
    expect(lista.map((p) => p.nombre)).toEqual(["Molino Harinero SA"]);
  });

  it("un nombre ya usado por OTRO proveedor se rechaza, sin distinguir mayúsculas, y el mensaje nombra al otro; no cambia nada", async () => {
    await crear("PRV_A", "Distribuidora Norte");
    const b = await crear("PRV_B", "Sur");
    const r = await actualizarProveedor(b.id, { nombre: "DISTRIBUIDORA NORTE", nombreEsperado: "Sur" });
    expect(r).toEqual({ ok: false, mensaje: "Ya existe un proveedor llamado «Distribuidora Norte». Elegí otro nombre." });
    expect(await nombreDe(b.id)).toBe("Sur");
    expect(await auditoriaDe(b.id)).toHaveLength(0);
  });

  it("las tildes sí distinguen (mismo criterio del alta): «Cafe» y «Café» son nombres distintos", async () => {
    await crear("PRV_A", "Café del Sur");
    const b = await crear("PRV_B", "Otro");
    expect((await actualizarProveedor(b.id, { nombre: "Cafe del Sur", nombreEsperado: "Otro" })).ok).toBe(true);
    // El alta aplica el mismo criterio: «cafe del sur» ya existe (sin mayúsculas).
    expect((await altaProveedor({ nombre: "CAFE DEL SUR" })).ok).toBe(false);
  });

  it("cambiar solo las mayúsculas del PROPIO nombre se permite (no choca consigo mismo)", async () => {
    const a = await crear("PRV_A", "EDENOR");
    const r = await actualizarProveedor(a.id, { nombre: "Edenor", nombreEsperado: "EDENOR" });
    expect(r.ok, r.mensaje).toBe(true);
    expect(await nombreDe(a.id)).toBe("Edenor");
  });

  it("el nombre se valida como en el alta: vacío o con caracteres de control se rechaza; un id que no existe se informa", async () => {
    const a = await crear("PRV_A", "Uno");
    expect((await actualizarProveedor(a.id, { nombre: "   ", nombreEsperado: "Uno" })).ok).toBe(false);
    expect((await actualizarProveedor(a.id, { nombre: "Con\u0000nulo", nombreEsperado: "Uno" })).ok).toBe(false);
    expect((await actualizarProveedor(a.id, { nombre: "Dos" })).mensaje).toMatch(/nombre que tenía/);
    expect(await nombreDe(a.id)).toBe("Uno");
    expect(await actualizarProveedor("no-existe", { nombre: "X", nombreEsperado: "Y" })).toEqual({ ok: false, mensaje: "No se encontró ese proveedor." });
  });

  it("sin mandar el nombre (los datos de contacto de siempre) el nombre no se toca", async () => {
    const a = await crear("PRV_A", "Intacto");
    const r = await actualizarProveedor(a.id, { contacto: "Ana" });
    expect(r.ok, r.mensaje).toBe(true);
    expect(await nombreDe(a.id)).toBe("Intacto");
    expect((await prisma.proveedor.findUniqueOrThrow({ where: { id: a.id } })).contacto).toBe("Ana");
  });
});

describe("concurrencia", () => {
  it("DOS ediciones del nombre a la vez sobre el mismo proveedor: gana una y la otra recibe «cambió mientras lo editabas»", async () => {
    const a = await crear("PRV_A", "Original");
    const [x, y] = await Promise.all([actualizarProveedor(a.id, { nombre: "Primero", nombreEsperado: "Original" }), actualizarProveedor(a.id, { nombre: "Segundo", nombreEsperado: "Original" })]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    const perdedora = x.ok ? y : x;
    expect(perdedora.mensaje).toMatch(/cambió mientras lo editabas/);
    const final = await nombreDe(a.id);
    expect(["Primero", "Segundo"]).toContain(final);
    expect(await auditoriaDe(a.id, "nombre"), "una sola fila de auditoría del nombre").toHaveLength(1);
  });

  it("DOS proveedores que se renombran al MISMO nombre a la vez: gana uno y el otro recibe «Ya existe»", async () => {
    const a = await crear("PRV_A", "A");
    const b = await crear("PRV_B", "B");
    const [x, y] = await Promise.all([actualizarProveedor(a.id, { nombre: "Igual", nombreEsperado: "A" }), actualizarProveedor(b.id, { nombre: "igual", nombreEsperado: "B" })]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    expect((x.ok ? y : x).mensaje).toMatch(/Ya existe un proveedor llamado «[Ii]gual»/);
    expect(await prisma.proveedor.count({ where: { nombre: { equals: "igual", mode: "insensitive" } } })).toBe(1);
  });
});

describe("idempotencia y auditoría", () => {
  it("guardar DOS VECES lo mismo no escribe ni audita de más", async () => {
    const a = await crear("PRV_A", "Edenor SA");
    const pedido = { nombre: "Edenor S.A.", nombreEsperado: "Edenor SA", ofreceProductos: false, ofreceServicios: true };
    expect((await actualizarProveedor(a.id, pedido)).ok).toBe(true);
    const filas = (await auditoriaDe(a.id)).length;
    expect(filas).toBe(3);
    expect((await actualizarProveedor(a.id, pedido)).ok, "el mismo pedido repetido responde bien").toBe(true);
    expect((await auditoriaDe(a.id)).length, "y no deja filas nuevas").toBe(filas);
    expect((await actualizarProveedor(a.id, { nombre: "Edenor S.A.", nombreEsperado: "Edenor S.A." })).ok).toBe(true);
    expect((await auditoriaDe(a.id)).length).toBe(filas);
  });

  it("el cambio de nombre deja registro: quién, el antes y el después", async () => {
    const a = await crear("PRV_A", "Edenor SA");
    await actualizarProveedor(a.id, { nombre: "Edenor S.A.", nombreEsperado: "Edenor SA" });
    const [fila] = await auditoriaDe(a.id, "nombre");
    expect(fila).toMatchObject({ entidad: "Proveedor", campo: "nombre", valorAnterior: "Edenor SA", valorNuevo: "Edenor S.A.", actorId: admin, sucursalId: null });
    expect(fila!.creadoEn).toBeInstanceOf(Date);
  });
});

describe("qué le compramos: productos, servicios o ambos", () => {
  it("el alta nueva nace «productos» como siempre; con las casillas puede nacer «servicios» o «ambos»", async () => {
    const a = await altaProveedor({ nombre: "Sin decir" });
    const b = await altaProveedor({ nombre: "Solo servicios", ofreceProductos: false, ofreceServicios: true });
    const c = await altaProveedor({ nombre: "Ambos", ofreceProductos: true, ofreceServicios: true });
    for (const r of [a, b, c]) expect(r.ok, r.mensaje).toBe(true);
    const lista = await listarProveedores();
    const de = (n: string) => lista.find((p) => p.nombre === n)!;
    expect([de("Sin decir").ofreceProductos, de("Sin decir").ofreceServicios]).toEqual([true, false]);
    expect([de("Solo servicios").ofreceProductos, de("Solo servicios").ofreceServicios]).toEqual([false, true]);
    expect([de("Ambos").ofreceProductos, de("Ambos").ofreceServicios]).toEqual([true, true]);
  });

  it("ninguna de las dos casillas se rechaza (alta y edición) y no escribe", async () => {
    const alta = await altaProveedor({ nombre: "Ninguna", ofreceProductos: false, ofreceServicios: false });
    expect(alta).toMatchObject({ ok: false });
    expect(alta.mensaje).toMatch(/al menos una/i);
    expect(await prisma.proveedor.count({ where: { nombre: "Ninguna" } })).toBe(0);
    const a = await crear("PRV_A", "Uno");
    const edicion = await actualizarProveedor(a.id, { nombre: "Uno", nombreEsperado: "Uno", ofreceProductos: false, ofreceServicios: false });
    expect(edicion.ok).toBe(false);
    const guardado = await prisma.proveedor.findUniqueOrThrow({ where: { id: a.id } });
    expect([guardado.ofreceProductos, guardado.ofreceServicios]).toEqual([true, false]);
  });

  it("marcar servicios en un proveedor existente: lo guarda, audita cada columna y un proveedor que no se toca conserva lo suyo", async () => {
    const luz = await crear("PRV_LUZ", "Luz");
    const otro = await crear("PRV_OTRO", "Otro", { ofreceProductos: false, ofreceServicios: true });
    const r = await actualizarProveedor(luz.id, { ofreceProductos: false, ofreceServicios: true });
    expect(r.ok, r.mensaje).toBe(true);
    const g = await prisma.proveedor.findUniqueOrThrow({ where: { id: luz.id } });
    expect([g.ofreceProductos, g.ofreceServicios]).toEqual([false, true]);
    expect((await auditoriaDe(luz.id)).map((f) => [f.campo, f.valorAnterior, f.valorNuevo])).toEqual([
      ["ofreceProductos", "true", "false"],
      ["ofreceServicios", "false", "true"],
    ]);
    const o = await prisma.proveedor.findUniqueOrThrow({ where: { id: otro.id } });
    expect([o.ofreceProductos, o.ofreceServicios]).toEqual([false, true]);
  });

  it("mandar solo una de las dos deja la otra como estaba", async () => {
    const a = await crear("PRV_A", "Uno");
    expect((await actualizarProveedor(a.id, { ofreceServicios: true })).ok).toBe(true);
    const g = await prisma.proveedor.findUniqueOrThrow({ where: { id: a.id } });
    expect([g.ofreceProductos, g.ofreceServicios]).toEqual([true, true]);
  });
});

describe("aislamiento entre empresas", () => {
  it("el nombre de un proveedor de OTRA empresa no cuenta como repetido, y no se puede editar un proveedor ajeno", async () => {
    const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
    const ajeno = await testigo.proveedor.create({ data: { codigo: "PRV_AJENO", nombre: "Compartido" } });
    const mio = await crear("PRV_MIO", "Mio");
    expect((await actualizarProveedor(mio.id, { nombre: "Compartido", nombreEsperado: "Mio" })).ok, "mismo nombre en otra empresa: sin conflicto").toBe(true);
    const r = await actualizarProveedor(ajeno.id, { nombre: "Hackeado", nombreEsperado: "Compartido" });
    expect(r).toEqual({ ok: false, mensaje: "No se encontró ese proveedor." });
    expect((await testigo.proveedor.findUniqueOrThrow({ where: { id: ajeno.id } })).nombre).toBe("Compartido");
  });
});
