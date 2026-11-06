import type { ContextoDeAccion } from "../../src/server/actions/tipos";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { cargarCompraDeUnaParte } from "../setup/compra-de-prueba";
import { datosDeNota } from "../setup/nota-credito";
import { corregirFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/corregir-factura-proveedor";
import { hayComprobanteVigenteEnLaEmpresa } from "../../src/server/persistencia/compras/comprobante-en-la-empresa";
import { MENSAJE_FACTURA_DUPLICADA } from "../../src/core/movimientos/factura-unica";

/**
 * Caso de uso `corregirFacturaProveedorCasoDeUso` (U1 de «una sola compra», docs/diseno-una-sola-compra-2026-11-06.md §8.3). Postgres real, sin mocks de base: recibe el actor ya resuelto (el permiso de la sucursal activa lo pide `conPermiso` en
 * la Server Action; el de las demás sucursales de la factura lo pide el propio caso de uso). Un caso por cada código de resultado, con `datos` y con lo que quedó escrito en la factura Y en la compra de su parte (invariante I-NUM).
 */
describe("corregirFacturaProveedorCasoDeUso", () => {
  let sucursalId: string;
  let seccionId: string;
  let adminId: string;
  let harinaId: string;
  let molinoId: string;
  let surId: string;

  // El caso de uso pide un contexto completo; el test arma solo lo que usa (para una sola sucursal no hace falta más).
  const actor = (usuarioId: string = adminId, sucursal: string = sucursalId) => ({ usuarioId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: sucursal, sucursalNombre: "Central", ahora: new Date(), ...baseDeTest({ lectura: [sucursal], escritura: [sucursal] }) }) as unknown as ContextoDeAccion;
  const compra = (extra: { proveedorId?: string; nroFactura?: string; detalleLibre?: string; fecha?: Date } = {}) =>
    cargarCompraDeUnaParte(actor(), { seccionId, proveedorId: molinoId, productoId: harinaId, nroFactura: "A-00001-00000001", detalleLibre: "semanal", fecha: new Date("2026-08-10T12:00:00Z"), ...extra });
  const vistaDe = async (facturaId: string) => {
    const f = await prisma.facturaProveedor.findUniqueOrThrow({ where: { id: facturaId } });
    return { proveedorId: f.proveedorId, nroFactura: f.nroFactura, detalleLibre: f.detalleLibre };
  };
  const pedir = async (facturaId: string, nueva: Partial<{ proveedorId: string | null; nroFactura: string; detalleLibre: string }>, esperado?: { proveedorId: string | null; nroFactura: string | null; detalleLibre: string | null }) => {
    const vista = esperado ?? (await vistaDe(facturaId));
    return corregirFacturaProveedorCasoDeUso(actor(), { facturaId, nueva: { proveedorId: vista.proveedorId, nroFactura: vista.nroFactura ?? "", detalleLibre: vista.detalleLibre ?? "", ...nueva }, esperado: vista });
  };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    harinaId = (await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id }, sucursalId)).id;
    molinoId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
    surId = (await prisma.proveedor.create({ data: { codigo: "PRV_2", nombre: "Distribuidora Sur" } })).id;
  });

  it("éxito: datos con los campos corregidos (orden fijo), mensaje, auditoría por campo y el cambio COPIADO a la compra de la parte (I-NUM)", async () => {
    const { facturaId, operacionId } = await compra();

    const r = await pedir(facturaId, { proveedorId: surId, nroFactura: "  A-00002-00000002 ", detalleLibre: "" });

    expect(r).toEqual({ ok: true, mensaje: "Compra corregida: proveedor, N.º de factura, detalle.", datos: { facturaId, camposCorregidos: ["proveedorId", "nroFactura", "detalleLibre"] } });
    expect(await prisma.facturaProveedor.findUniqueOrThrow({ where: { id: facturaId } })).toMatchObject({ proveedorId: surId, nroFactura: "A-00002-00000002", nroFacturaNormalizado: "A:2-2", detalleLibre: null });
    expect(await prisma.operacion.findUniqueOrThrow({ where: { id: operacionId } }), "la compra de la parte lleva el proveedor, el número y el detalle de su factura").toMatchObject({ proveedorId: surId, nroFactura: "A-00002-00000002", detalleLibre: null });
    const filas = await prisma.registroAuditoria.findMany({ where: { entidadId: facturaId, entidad: "FacturaProveedor", campo: { in: ["proveedorId", "nroFactura", "detalleLibre"] } }, orderBy: { campo: "asc" } });
    expect(filas.map((f) => [f.campo, f.descripcion, f.valorAnterior, f.valorNuevo])).toEqual([
      ["detalleLibre", "Factura de proveedor del 2026-08-10 (factura A-00001-00000001): detalle", "semanal", null],
      ["nroFactura", "Factura de proveedor del 2026-08-10 (factura A-00001-00000001): N.º de factura", "A-00001-00000001", "A-00002-00000002"],
      ["proveedorId", "Factura de proveedor del 2026-08-10 (factura A-00001-00000001): proveedor", "Molino SA", "Distribuidora Sur"],
    ]);
    expect(filas.every((f) => f.actorId === adminId && f.sucursalId === sucursalId)).toBe(true);
    // Lo que no se pide corregir no se toca: el Kardex, el renglón y la parte quedan exactamente como estaban.
    expect(await prisma.movimientoStock.count({ where: { operacionId, proceso: "COMPRA" } })).toBe(1);
    expect(await prisma.facturaProveedorSucursal.count({ where: { facturaProveedorId: facturaId, operacionId } })).toBe(1);
  });

  it("éxito sin cambios: «nada que corregir», camposCorregidos vacío y ninguna escritura", async () => {
    const { facturaId } = await compra();
    const antes = await prisma.registroAuditoria.count();
    expect(await pedir(facturaId, {})).toEqual({ ok: true, mensaje: "La compra ya tiene esos datos: no hay nada que corregir.", datos: { facturaId, camposCorregidos: [] } });
    expect(await prisma.registroAuditoria.count()).toBe(antes);
  });

  it("idempotente por estado: reenviar la misma corrección (se perdió la respuesta) responde «nada que corregir» y no duplica la auditoría", async () => {
    const { facturaId } = await compra();
    const vista = await vistaDe(facturaId);
    const nueva = { proveedorId: surId, nroFactura: vista.nroFactura ?? "", detalleLibre: "semanal" };
    expect((await corregirFacturaProveedorCasoDeUso(actor(), { facturaId, nueva, esperado: vista })).ok).toBe(true);
    const filas = await prisma.registroAuditoria.count({ where: { entidadId: facturaId, campo: "proveedorId" } });
    const segunda = await corregirFacturaProveedorCasoDeUso(actor(), { facturaId, nueva, esperado: vista });
    expect(segunda).toMatchObject({ ok: true, datos: { camposCorregidos: [] } });
    expect(await prisma.registroAuditoria.count({ where: { entidadId: facturaId, campo: "proveedorId" } })).toBe(filas);
  });

  it("NO_ENCONTRADA: una factura inexistente", async () => {
    const r = await corregirFacturaProveedorCasoDeUso(actor(), { facturaId: "no-existe", nueva: { proveedorId: molinoId, nroFactura: "A-00001-00000001", detalleLibre: "" }, esperado: { proveedorId: molinoId, nroFactura: "A-00001-00000001", detalleLibre: "" } });
    expect(r).toMatchObject({ ok: false, codigo: "NO_ENCONTRADA" });
  });

  it("YA_ANULADA: una compra anulada no se corrige", async () => {
    const { facturaId } = await compra();
    await prisma.facturaProveedor.update({ where: { id: facturaId }, data: { anuladaEn: new Date(), anuladaPorId: adminId } });
    expect(await pedir(facturaId, { detalleLibre: "otro" })).toEqual({ ok: false, codigo: "YA_ANULADA", mensaje: "Una compra anulada no se puede corregir." });
  });

  it("CAMBIO_CONCURRENTE: lo que la persona vio ya no es lo guardado", async () => {
    const { facturaId } = await compra();
    const vista = await vistaDe(facturaId);
    const r = await pedir(facturaId, { nroFactura: "A-00001-00000009" }, { ...vista, nroFactura: "A-00001-00000005" });
    expect(r).toEqual({ ok: false, codigo: "CAMBIO_CONCURRENTE", mensaje: "Esta compra cambió mientras la editabas (otra persona la corrigió). Recargá la página y volvé a intentarlo." });
  });

  it("ENTRADA_INVALIDA: un N.º de factura inválido o quitar el proveedor (mensaje de validarCorreccion)", async () => {
    const { facturaId } = await compra();
    expect(await pedir(facturaId, { nroFactura: "---" })).toMatchObject({ ok: false, codigo: "ENTRADA_INVALIDA" });
    expect(await pedir(facturaId, { proveedorId: null })).toEqual({ ok: false, codigo: "ENTRADA_INVALIDA", mensaje: "La compra tiene que tener proveedor." });
  });

  it("PROVEEDOR_INEXISTENTE y PROVEEDOR_INACTIVO", async () => {
    const { facturaId } = await compra();
    await prisma.proveedor.update({ where: { id: surId }, data: { activo: false } });
    expect(await pedir(facturaId, { proveedorId: "no-existe" })).toEqual({ ok: false, codigo: "PROVEEDOR_INEXISTENTE", mensaje: "El proveedor no existe." });
    expect(await pedir(facturaId, { proveedorId: surId })).toEqual({ ok: false, codigo: "PROVEEDOR_INACTIVO", mensaje: 'El proveedor "Distribuidora Sur" está inactivo.' });
  });

  it("FACTURA_DUPLICADA: otra factura vigente del mismo proveedor ya usa ese número, y no cambia nada", async () => {
    await compra({ nroFactura: "A-00006-00000001" });
    const { facturaId, operacionId } = await compra({ nroFactura: "A-00006-00000002" });
    const r = await pedir(facturaId, { nroFactura: "A-00006-00000001" });
    expect(r).toEqual({ ok: false, codigo: "FACTURA_DUPLICADA", mensaje: MENSAJE_FACTURA_DUPLICADA });
    expect((await prisma.facturaProveedor.findUniqueOrThrow({ where: { id: facturaId } })).nroFactura).toBe("A-00006-00000002");
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: operacionId } })).nroFactura).toBe("A-00006-00000002");
    // El mismo número con OTRO proveedor no es un choque.
    expect((await pedir(facturaId, { proveedorId: surId, nroFactura: "A-00006-00000001" })).ok).toBe(true);
  });

  it("hayComprobanteVigenteEnLaEmpresa con «excluir esta factura»: la propia factura (su cabecera y la compra de su parte) no cuenta contra sí misma; la de otra, sí", async () => {
    const propia = await compra({ nroFactura: "A-00007-00000001" });
    const ajena = await compra({ nroFactura: "A-00007-00000002" });
    const preguntar = (nroFactura: string, excluirFacturaId?: string) =>
      prisma.$transaction((tx) => hayComprobanteVigenteEnLaEmpresa(tx, { empresaId: EMPRESA_POR_DEFECTO_ID, proveedorId: molinoId, nroFactura, excluirFacturaId }));
    expect(await preguntar("A-00007-00000001")).toBe(true);
    expect(await preguntar("A-00007-00000001", propia.facturaId), "sin contar la propia").toBe(false);
    expect(await preguntar("A-00007-00000002", propia.facturaId), "la de otra factura cuenta igual").toBe(true);
    expect(await preguntar("A-00007-00000002", ajena.facturaId)).toBe(false);
  });

  describe("notas de crédito: atan el proveedor, no el número ni el detalle", () => {
    for (const estado of ["vigente", "anulada"] as const) {
      it(`con una nota ${estado}: cambiar el PROVEEDOR se rechaza (CON_NOTAS_DE_CREDITO); el número y el detalle se corrigen igual`, async () => {
        const { facturaId } = await compra();
        await prisma.notaCreditoProveedor.create({ data: { ...datosDeNota({ facturaId, proveedorId: molinoId, usuarioId: adminId }), ...(estado === "anulada" ? { anuladaEn: new Date(), anuladaPorId: adminId, motivoAnulacion: "Anulada en la prueba" } : {}) } as never });

        const proveedor = await pedir(facturaId, { proveedorId: surId });
        expect(proveedor).toMatchObject({ ok: false, codigo: "CON_NOTAS_DE_CREDITO" });
        expect((await prisma.facturaProveedor.findUniqueOrThrow({ where: { id: facturaId } })).proveedorId).toBe(molinoId);

        expect((await pedir(facturaId, { nroFactura: "A-00001-00000099", detalleLibre: "corregido" })).ok).toBe(true);
      });
    }
  });

  it("SIN_PERMISO_EN_SUCURSAL: si una parte ya entró en otra sucursal donde quien corrige no tiene `corregir_compra`, se rechaza nombrándola y no se escribe nada", async () => {
    const { facturaId } = await compra();
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const seccionNorte = await sembrarSeccion(norte.id);
    const operacionNorte = await prisma.operacion.create({ data: { sucursalId: norte.id, proceso: "COMPRA", fecha: new Date(), usuarioId: adminId, proveedorId: molinoId, nroFactura: "A-00001-00000001" } });
    await prisma.movimientoStock.create({ data: { operacionId: operacionNorte.id, productoId: harinaId, seccionId: seccionNorte.id, proceso: "COMPRA", cantidad: 1, detalle: "Compra", precioTotal: 100, precioPorUnidadStock: 100 } });
    await prisma.facturaProveedorSucursal.create({ data: { facturaProveedorId: facturaId, sucursalId: norte.id, porcentajeDeclaradoBp: 1000, operacionId: operacionNorte.id, estadoRecepcion: "RECIBIDA", recibidaEn: new Date(), recibidaPorId: adminId } as never });

    const r = await pedir(facturaId, { detalleLibre: "otro" });
    expect(r).toMatchObject({ ok: false, codigo: "SIN_PERMISO_EN_SUCURSAL" });
    expect(!r.ok && r.mensaje).toContain("No podés corregir esta factura");
    expect((await prisma.facturaProveedor.findUniqueOrThrow({ where: { id: facturaId } })).detalleLibre).toBe("semanal");
  });
});
