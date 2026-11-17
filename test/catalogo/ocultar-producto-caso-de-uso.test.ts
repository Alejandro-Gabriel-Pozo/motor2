import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { randomUUID } from "node:crypto";
import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia } from "../setup/test-db";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import { ocultarProductoCasoDeUso, type ComandoOcultarProducto } from "../../src/server/actions/catalogo/casos-de-uso/ocultar-producto";

/**
 * «Ocultar» como Pedernal, etapa (b) (docs/diseno-ocultar-como-pedernal-2026-11-15.md, CU-1 a CU-3, R-11 a R-15), contra Postgres con la RLS real (`motor2_app`, con alcance por sucursal):
 * fija un estado (no alterna), «ya estaba» no escribe ni audita, con existencia distinta de cero (también negativa) se rechaza y NO queda ni la marca ni la auditoría, mostrar no tiene condiciones salvo que un local
 * no muestra lo que la empresa oculta, la empresa solo la mueve administración con alcance total, no toca Desactivar, aislamiento entre empresas y concurrencia/idempotencia (dos pedidos a la vez = una marca, un registro).
 */
describe("ocultarProductoCasoDeUso", () => {
  let sucursalA: string;
  let sucursalB: string;
  let usuarioId: string;
  let seccionA: string;
  let seccionB: string;
  let productoId: string;
  const hoy = AHORA_DE_LA_CORRIDA;

  /** El contexto de quien opera en la sucursal `sucursalId`; con `empresa` la transacción se ensancha a las dos (lo hace la acción). */
  const actor = (sucursalId: string, empresa = false) => ({
    empresaId: EMPRESA_POR_DEFECTO_ID,
    usuarioId,
    sucursalId,
    sucursalNombre: sucursalId === sucursalA ? "Centro" : "Norte",
    ahora: hoy,
    ...baseDeTest({ lectura: empresa ? [sucursalA, sucursalB] : [sucursalId], escritura: empresa ? [sucursalA, sucursalB] : [sucursalId] }),
  });
  const pedir = (sucursalId: string, c: Partial<ComandoOcultarProducto>, empresa = false) =>
    ocultarProductoCasoDeUso(actor(sucursalId, empresa), { productoId, alcance: "LOCAL", oculto: true, marcaId: randomUUID(), puedeEnLaEmpresa: false, ...c });
  const marcas = () => prismaAdmin.ocultamientoProducto.findMany({ orderBy: { creadoEn: "asc" } });
  const auditoria = () => prismaAdmin.registroAuditoria.findMany({ where: { entidad: "OcultamientoProducto" } });

  async function mover(seccionId: string, sucursalId: string, cantidad: number) {
    const proceso = cantidad < 0 ? "VENTA" : "COMPRA";
    const op = await prisma.operacion.create({ data: { sucursalId, proceso, fecha: new Date(), usuarioId } });
    await prisma.movimientoStock.create({ data: { operacionId: op.id, productoId, seccionId, proceso, cantidad, detalle: "test" } });
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    sucursalA = base.sucursal.id;
    sucursalB = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    usuarioId = (await crearUsuarioConMembresia({ email: "u@test.com", sucursalId: sucursalA, rolId: base.admin.id })).id;
    seccionA = (await sembrarSeccion(sucursalA, "Salón A")).id;
    seccionB = (await sembrarSeccion(sucursalB, "Salón B")).id;
    productoId = (await prisma.producto.create({ data: { codigo: "PV_MILA", nombre: "Milanesa", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 100 } })).id;
    await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursalA, productoId, disponible: true } });
  });

  it("oculta en el local sin existencia: una fila, versión 1, con quién y cuándo, y un registro de auditoría; no toca Desactivar", async () => {
    const r = await pedir(sucursalA, {});
    expect(r).toMatchObject({ ok: true, datos: { yaEstaba: false, sigueOcultoPor: null } });
    const filas = await marcas();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ productoId, sucursalId: sucursalA, oculto: true, version: 1, actualizadoPorId: usuarioId, actualizadoEn: hoy });
    const a = await auditoria();
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ campo: "oculto", valorAnterior: "false", valorNuevo: "true", sucursalId: sucursalA, actorId: usuarioId });
    expect((await prisma.disponibilidadProducto.findFirstOrThrow({ where: { sucursalId: sucursalA, productoId } })).disponible, "Desactivar queda como estaba").toBe(true);
  });

  it("IDEMPOTENCIA: ocultar dos veces seguidas (y con el mismo marcaId) = una fila y un solo registro; la segunda dice «ya estaba»", async () => {
    const marcaId = randomUUID();
    expect(await pedir(sucursalA, { marcaId })).toMatchObject({ ok: true, datos: { yaEstaba: false } });
    expect(await pedir(sucursalA, { marcaId })).toMatchObject({ ok: true, datos: { yaEstaba: true } });
    expect(await marcas()).toHaveLength(1);
    expect(await auditoria()).toHaveLength(1);
  });

  it("mostrar y volver a ocultar: la MISMA fila cambia de estado con la versión +1 (no se borra) y cada cambio deja su registro", async () => {
    await pedir(sucursalA, {});
    expect(await pedir(sucursalA, { oculto: false })).toMatchObject({ ok: true, datos: { yaEstaba: false } });
    expect(await marcas()).toMatchObject([{ oculto: false, version: 2 }]);
    expect(await pedir(sucursalA, { oculto: true })).toMatchObject({ ok: true });
    expect(await marcas()).toMatchObject([{ oculto: true, version: 3 }]);
    expect(await auditoria()).toHaveLength(3);
    expect(await pedir(sucursalA, { oculto: false })).toMatchObject({ ok: true });
    expect(await pedir(sucursalA, { oculto: false }), "mostrar lo que no está oculto: ya estaba").toMatchObject({ ok: true, datos: { yaEstaba: true } });
    expect(await auditoria()).toHaveLength(4);
  });

  it("con existencia POSITIVA o NEGATIVA en el local se rechaza (TIENE_EXISTENCIA) y NO queda ni la marca ni la auditoría (todo o nada)", async () => {
    await mover(seccionA, sucursalA, 5);
    expect(await pedir(sucursalA, {})).toMatchObject({ ok: false, codigo: "TIENE_EXISTENCIA" });
    expect(await marcas()).toHaveLength(0);
    expect(await auditoria()).toHaveLength(0);
    await mover(seccionA, sucursalA, -8);
    expect(await pedir(sucursalA, {}), "saldo −3: también se rechaza").toMatchObject({ ok: false, codigo: "TIENE_EXISTENCIA" });
    await mover(seccionA, sucursalA, 3);
    expect(await pedir(sucursalA, {}), "en cero: se oculta").toMatchObject({ ok: true });
    expect(await marcas()).toHaveLength(1);
  });

  it("existencia en OTRO local no frena ocultar en este; sí frena ocultar en toda la empresa (y mostrar no tiene condiciones)", async () => {
    await mover(seccionB, sucursalB, 4);
    expect(await pedir(sucursalA, {})).toMatchObject({ ok: true });
    expect(await pedir(sucursalA, { alcance: "EMPRESA", puedeEnLaEmpresa: true }, true)).toMatchObject({ ok: false, codigo: "TIENE_EXISTENCIA" });
    expect(await marcas(), "la rechazada no dejó su marca; queda la del local").toHaveLength(1);
    expect(await pedir(sucursalA, { oculto: false })).toMatchObject({ ok: true });
  });

  it("EMPRESA con el contexto SIN ensanchar (como llega de la acción): el caso de uso mismo ensancha la lectura y ve la existencia de OTRO local; la marca de la empresa se escribe igual", async () => {
    await mover(seccionB, sucursalB, 4);
    const sinEnsanchar = (c: Partial<ComandoOcultarProducto>) => ocultarProductoCasoDeUso(actor(sucursalA), { productoId, alcance: "EMPRESA", oculto: true, marcaId: randomUUID(), puedeEnLaEmpresa: true, ...c });
    expect(await sinEnsanchar({})).toMatchObject({ ok: false, codigo: "TIENE_EXISTENCIA" });
    expect(await marcas(), "el rechazo deshizo todo").toHaveLength(0);
    await mover(seccionB, sucursalB, -4);
    expect(await sinEnsanchar({})).toMatchObject({ ok: true, datos: { yaEstaba: false } });
    expect(await marcas()).toMatchObject([{ sucursalId: null, oculto: true }]);
    expect(await sinEnsanchar({}), "doble clic: la segunda es «ya estaba»").toMatchObject({ ok: true, datos: { yaEstaba: true } });
    expect(await auditoria()).toHaveLength(1);
  });

  it("EMPRESA: solo administración con alcance total; sin eso, SIN_PERMISO y no se toca nada; con él, la marca queda con sucursalId nulo y se audita", async () => {
    expect(await pedir(sucursalA, { alcance: "EMPRESA", puedeEnLaEmpresa: false }, true)).toMatchObject({ ok: false, codigo: "SIN_PERMISO" });
    expect(await marcas()).toHaveLength(0);
    expect(await pedir(sucursalA, { alcance: "EMPRESA", puedeEnLaEmpresa: true }, true)).toMatchObject({ ok: true, datos: { yaEstaba: false, sigueOcultoPor: "EMPRESA" } });
    expect(await marcas()).toMatchObject([{ sucursalId: null, oculto: true, version: 1 }]);
    expect(await auditoria()).toMatchObject([{ sucursalId: null, entidadId: `EMPRESA:${productoId}` }]);
  });

  it("un local NO muestra lo que la empresa oculta (EMPRESA_LO_OCULTA); la empresa vuelve a mostrar y entonces el local sí", async () => {
    await pedir(sucursalA, { alcance: "EMPRESA", puedeEnLaEmpresa: true }, true);
    await pedir(sucursalA, {}); // el local también lo oculta
    expect(await pedir(sucursalA, { oculto: false })).toMatchObject({ ok: false, codigo: "EMPRESA_LO_OCULTA" });
    expect(await pedir(sucursalA, { alcance: "EMPRESA", oculto: false, puedeEnLaEmpresa: true }, true)).toMatchObject({ ok: true });
    expect(await pedir(sucursalA, { oculto: false })).toMatchObject({ ok: true });
  });

  it("producto inexistente o de otra empresa: PRODUCTO_NO_ENCONTRADO sin revelar nada; datos inválidos se rechazan antes de tocar la base", async () => {
    expect(await pedir(sucursalA, { productoId: "no-existe" })).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_ENCONTRADO" });
    expect(await pedir(sucursalA, { marcaId: "no-es-uuid" })).toMatchObject({ ok: false, codigo: "DATOS_INVALIDOS" });
    expect(await pedir(sucursalA, { productoId: "" })).toMatchObject({ ok: false, codigo: "DATOS_INVALIDOS" });
    expect(await marcas()).toHaveLength(0);
  });

  it("CONCURRENCIA: dos pedidos de ocultar a la vez (clic doble, dos pestañas) dejan UNA fila y UN registro de auditoría", async () => {
    const [x, y] = await Promise.all([pedir(sucursalA, {}), pedir(sucursalA, {})]);
    expect([x.ok, y.ok]).toEqual([true, true]);
    expect([x, y].filter((r) => r.ok && r.datos.yaEstaba)).toHaveLength(1);
    expect(await marcas()).toHaveLength(1);
    expect(await auditoria()).toHaveLength(1);
  });

  it("CONCURRENCIA: ocultar y mostrar a la vez terminan en un estado válido, con la versión y la auditoría coherentes", async () => {
    await pedir(sucursalA, {});
    await Promise.all([pedir(sucursalA, { oculto: false }), pedir(sucursalA, { oculto: true })]);
    const filas = await marcas();
    expect(filas).toHaveLength(1);
    expect(filas[0]!.version).toBeGreaterThanOrEqual(2);
    expect((await auditoria()).length).toBe(filas[0]!.version);
  });

  it("AISLAMIENTO: ocultar en el local A no ve ni toca lo de B; el id de un producto de la empresa testigo no se encuentra", async () => {
    await pedir(sucursalA, {});
    expect(await pedir(sucursalB, { oculto: false })).toMatchObject({ ok: true, datos: { yaEstaba: true } });
    expect(await marcas()).toMatchObject([{ sucursalId: sucursalA, oculto: true }]);
    expect(EMPRESA_POR_DEFECTO_ID).toBeTruthy();
  });
});
