import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearMembresia } from "../setup/membresia";
import { sembrarEscenarioDeOpciones, type EscenarioDeOpciones } from "../setup/opciones";
import { crearGrupoEnElProducto } from "../../src/server/actions/catalogo/opciones-de-venta";
import { limitadorMutaciones } from "../../src/server/actions/limitador-de-mutaciones";

/**
 * Fase 6, paso 6.14c: «crear un grupo sin salir del producto» (`crearGrupoEnElProducto`) pide LAS DOS claves que hoy se piden en dos pantallas: `producto_opciones_admitidas` (el envoltorio, la de la pantalla del
 * producto) y `opciones_definir` (`exigirTambienPermisoDeEmpresa`, la de crear grupos y opciones). Ninguna clave nueva y nadie puede nada que antes no pudiera. Con la sesión simulada y el gate REAL, contra Postgres:
 *  - sin ninguna de las dos, solo la primera o solo la segunda: «no tenés permiso» y NO queda ninguna fila (ni grupo, ni opciones, ni versiones, ni admisión, ni auditoría);
 *  - la segunda clave se pide ANTES de formatear (un pedido mal formado de alguien sin ella recibe el rechazo de permiso, no el de formato);
 *  - con las dos, corre y deja todo.
 *
 * Mutaciones demostradas: borrar la llamada a `exigirTambienPermisoDeEmpresa` de la Server Action deja en rojo el caso «solo `producto_opciones_admitidas`» de acá Y la ficha del caso de uso
 * (`test/arquitectura/ficha-de-caso-de-uso.test.ts`: declara `permiso=opciones_definir+producto_opciones_admitidas` y el código ya no lo cumple).
 */
describe("crear un grupo sin salir del producto — las dos claves (6.14c)", () => {
  let e: EscenarioDeOpciones;
  let adminRolId: string;
  let operadorId: string;
  let milanesaId: string;
  const entrada = () => ({
    productoId: milanesaId,
    nombre: "Presentación",
    respuesta: "PRECIO_FINAL",
    prefijoEnCarta: null,
    opciones: [{ nombre: "Simple", importe: 8000 }, { nombre: "Doble", importe: 11000 }],
  });
  /** Todo lo que el comando puede escribir. */
  const filas = async () => ({
    grupos: await prisma.grupoDeOpciones.count(),
    opciones: await prisma.opcionDeGrupo.count(),
    versiones: await prisma.versionDeOpcion.count(),
    admisionesDeGrupo: await prisma.productoAdmiteGrupo.count(),
    admisionesDeOpcion: await prisma.productoAdmiteOpcion.count(),
    auditorias: await prisma.registroAuditoria.count(),
  });
  const sinLaClave = (accionClave: string) => prisma.permisoRol.updateMany({ where: { rolId: adminRolId, accionClave }, data: { puedeEditar: false, puedeVer: false } });
  const entrarComoAdmin = () => mockearUsuarioActual({ id: e.usuarioId, email: "administrativo@test.com", nombre: null });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeOpciones();
    const adminRol = await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } });
    const operadorRol = await prisma.rol.findFirstOrThrow({ where: { clave: "operador" } });
    adminRolId = adminRol.id;
    await crearMembresia({ usuarioId: e.usuarioId, sucursalId: e.sucursalA, rolId: adminRol.id });
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: e.sucursalA, rolId: operadorRol.id })).id;
    milanesaId = (await prisma.producto.create({ data: { codigo: "PV_MILA", nombre: "Milanesa", tipo: "PV", unidadStockId: e.unidadId, precioVenta: "0.00", modoDeVenta: "BASE_CONFIGURABLE" } })).id;
    await entrarComoAdmin();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sin ninguna de las dos claves (el operador): «no tenés permiso» y 0 filas", async () => {
    await mockearUsuarioActual({ id: operadorId, email: "operador@test.com", nombre: null });
    const antes = await filas();
    const r = await crearGrupoEnElProducto(entrada());
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/No tenés permiso/);
    expect(await filas()).toEqual(antes);
  });

  it("solo `opciones_definir` (falta `producto_opciones_admitidas`, la del envoltorio): «no tenés permiso» y 0 filas", async () => {
    await sinLaClave("producto_opciones_admitidas");
    const antes = await filas();
    const r = await crearGrupoEnElProducto(entrada());
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/No tenés permiso/);
    expect(r.mensaje).toMatch(/producto_opciones_admitidas/);
    expect(await filas()).toEqual(antes);
  });

  it("solo `producto_opciones_admitidas` (falta `opciones_definir`, la segunda): «no tenés permiso» y 0 filas", async () => {
    await sinLaClave("opciones_definir");
    const antes = await filas();
    const r = await crearGrupoEnElProducto(entrada());
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/No tenés permiso/);
    expect(r.mensaje).toMatch(/opciones_definir/);
    expect(await filas()).toEqual(antes);
  });

  it("la segunda clave se pide ANTES de formatear: sin ella, un pedido mal formado recibe el rechazo de permiso (no el de formato), y con las dos recibe el de formato", async () => {
    await sinLaClave("opciones_definir");
    const malFormado = { ...entrada(), opciones: [] };
    expect((await crearGrupoEnElProducto(malFormado)).mensaje).toMatch(/No tenés permiso/);
    await prisma.permisoRol.updateMany({ where: { rolId: adminRolId, accionClave: "opciones_definir" }, data: { puedeEditar: true, puedeVer: true } });
    expect(await crearGrupoEnElProducto(malFormado)).toEqual({ ok: false, mensaje: "Agregá al menos una opción al grupo." });
  });

  it("con las dos claves (el administrador): corre y deja el grupo, sus opciones, sus versiones, lo que admite el producto y su auditoría", async () => {
    const antes = await filas();
    const r = await crearGrupoEnElProducto(entrada());
    expect(r).toEqual({ ok: true, mensaje: "Listo: «Presentación» se agregó a «Milanesa» con 2 opciones." });
    expect(await filas()).toMatchObject({ grupos: antes.grupos + 1, opciones: antes.opciones + 2, versiones: antes.versiones + 2, admisionesDeGrupo: antes.admisionesDeGrupo + 1, admisionesDeOpcion: antes.admisionesDeOpcion + 2 });
    expect((await filas()).auditorias).toBeGreaterThan(antes.auditorias);
  });

  it("el limitador de mutaciones también la corta (es un envoltorio de mutación más)", async () => {
    vi.spyOn(limitadorMutaciones, "excedeLimite").mockReturnValue(true);
    const antes = await filas();
    expect(await crearGrupoEnElProducto(entrada())).toEqual({ ok: false, mensaje: "Demasiadas acciones seguidas — esperá un minuto e intentá de nuevo." });
    expect(await filas()).toEqual(antes);
  });
});
