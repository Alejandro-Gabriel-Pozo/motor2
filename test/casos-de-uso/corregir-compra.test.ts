import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { corregirCompraCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/corregir-compra";
import { MENSAJE_FACTURA_DUPLICADA } from "../../src/core/movimientos/factura-unica";

/**
 * Caso de uso `corregirCompraCasoDeUso` (src/server/actions/movimientos/casos-de-uso/corregir-compra.ts; Task #41, Fase M). Postgres real,
 * sin mocks de base ni de sesión: recibe el actor ya resuelto (el permiso lo chequea `conPermiso` en la Server Action, cubierto por
 * test/movimientos/compras-corregir.test.ts, que no se tocó). Un caso por cada código de resultado, verificando también `datos`.
 */
describe("corregirCompraCasoDeUso", () => {
  let sucursalId: string;
  let seccionId: string;
  let adminId: string;
  let harinaId: string;
  let molinoId: string;
  let surId: string;

  const actor = () => ({ usuarioId: adminId, sucursalId, ...baseDeTest });
  const vista = (op: { proveedorId: string | null; nroFactura: string | null; detalleLibre: string | null }) => ({
    proveedorId: op.proveedorId,
    nroFactura: op.nroFactura,
    detalleLibre: op.detalleLibre,
  });

  async function compra(opciones: { proveedorId?: string | null; nroFactura?: string | null; proceso?: "COMPRA" | "MERMA"; anulada?: boolean } = {}) {
    const op = await prisma.operacion.create({
      data: {
        sucursalId,
        proceso: opciones.proceso ?? "COMPRA",
        fecha: new Date("2026-08-10T12:00:00Z"),
        usuarioId: adminId,
        proveedorId: opciones.proveedorId === undefined ? molinoId : opciones.proveedorId,
        nroFactura: opciones.nroFactura === undefined ? "A-0001" : opciones.nroFactura,
        detalleLibre: "semanal",
        anuladaEn: opciones.anulada ? new Date() : null,
      },
    });
    await prisma.movimientoStock.create({
      data: { operacionId: op.id, productoId: harinaId, seccionId, proceso: op.proceso, cantidad: 10, detalle: "Compra", precioTotal: 1000, precioPorUnidadStock: 100 },
    });
    return op;
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    harinaId = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } })).id;
    molinoId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
    surId = (await prisma.proveedor.create({ data: { codigo: "PRV_2", nombre: "Distribuidora Sur" } })).id;
  });

  it("éxito: datos con los campos corregidos (orden fijo), mensaje y auditoría por campo con los textos exactos de antes", async () => {
    const op = await compra();

    const r = await corregirCompraCasoDeUso(actor(), {
      operacionId: op.id,
      nueva: { proveedorId: surId, nroFactura: "  B-0002 ", detalleLibre: "" },
      esperado: vista(op),
    });

    expect(r).toEqual({
      ok: true,
      mensaje: "Compra corregida: proveedor, N.º de factura, detalle.",
      datos: { compraId: op.id, camposCorregidos: ["proveedorId", "nroFactura", "detalleLibre"] },
    });
    expect(await prisma.operacion.findUniqueOrThrow({ where: { id: op.id } })).toMatchObject({ proveedorId: surId, nroFactura: "B-0002", detalleLibre: null });
    const filas = await prisma.registroAuditoria.findMany({ where: { entidadId: op.id }, orderBy: { campo: "asc" } });
    expect(filas.map((f) => [f.campo, f.descripcion, f.valorAnterior, f.valorNuevo])).toEqual([
      ["detalleLibre", "Compra del 2026-08-10 (factura A-0001): detalle", "semanal", null],
      ["nroFactura", "Compra del 2026-08-10 (factura A-0001): N.º de factura", "A-0001", "B-0002"],
      ["proveedorId", "Compra del 2026-08-10 (factura A-0001): proveedor", "Molino SA", "Distribuidora Sur"],
    ]);
    expect(filas.every((f) => f.actorId === adminId && f.sucursalId === sucursalId)).toBe(true);
  });

  it("éxito sin cambios: «nada que corregir», camposCorregidos vacío y ninguna escritura", async () => {
    const op = await compra();
    const r = await corregirCompraCasoDeUso(actor(), { operacionId: op.id, nueva: { proveedorId: molinoId, nroFactura: "A-0001", detalleLibre: "semanal" }, esperado: vista(op) });
    expect(r).toEqual({ ok: true, mensaje: "La compra ya tiene esos datos: no hay nada que corregir.", datos: { compraId: op.id, camposCorregidos: [] } });
    expect(await prisma.registroAuditoria.count()).toBe(0);
  });

  it("NO_ENCONTRADA: id inexistente o de otra sucursal", async () => {
    const op = await compra();
    const otra = await prisma.sucursal.create({ data: { nombre: "Otra" } });
    const nueva = { proveedorId: null, nroFactura: "", detalleLibre: "" };
    expect(await corregirCompraCasoDeUso(actor(), { operacionId: "no-existe", nueva, esperado: vista(op) })).toEqual({
      ok: false,
      codigo: "NO_ENCONTRADA",
      mensaje: "No se encontró esa operación en esta sucursal.",
    });
    expect(await corregirCompraCasoDeUso({ usuarioId: adminId, sucursalId: otra.id, ...baseDeTest }, { operacionId: op.id, nueva, esperado: vista(op) })).toMatchObject({
      ok: false,
      codigo: "NO_ENCONTRADA",
    });
  });

  it("NO_ES_COMPRA", async () => {
    const op = await compra({ proceso: "MERMA" });
    const r = await corregirCompraCasoDeUso(actor(), { operacionId: op.id, nueva: { proveedorId: null, nroFactura: "", detalleLibre: "" }, esperado: vista(op) });
    expect(r).toEqual({ ok: false, codigo: "NO_ES_COMPRA", mensaje: 'Esa operación no es una Compra — es "MERMA".' });
  });

  it("YA_ANULADA", async () => {
    const op = await compra({ anulada: true });
    const r = await corregirCompraCasoDeUso(actor(), { operacionId: op.id, nueva: { proveedorId: null, nroFactura: "", detalleLibre: "" }, esperado: vista(op) });
    expect(r).toEqual({ ok: false, codigo: "YA_ANULADA", mensaje: "Una compra anulada no se puede corregir." });
  });

  it("CAMBIO_CONCURRENTE: lo que la persona vio ya no es lo guardado", async () => {
    const op = await compra();
    const r = await corregirCompraCasoDeUso(actor(), {
      operacionId: op.id,
      nueva: { proveedorId: molinoId, nroFactura: "A-0009", detalleLibre: "semanal" },
      esperado: { ...vista(op), nroFactura: "A-0005" },
    });
    expect(r).toEqual({
      ok: false,
      codigo: "CAMBIO_CONCURRENTE",
      mensaje: "Esta compra cambió mientras la editabas (otra persona la corrigió). Recargá la página y volvé a intentarlo.",
    });
  });

  it("ENTRADA_INVALIDA: un N.º de factura inválido (mensaje de validarCorreccion)", async () => {
    const op = await compra();
    const r = await corregirCompraCasoDeUso(actor(), { operacionId: op.id, nueva: { proveedorId: molinoId, nroFactura: "---", detalleLibre: "semanal" }, esperado: vista(op) });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.codigo).toBe("ENTRADA_INVALIDA");
  });

  it("PROVEEDOR_INEXISTENTE y PROVEEDOR_INACTIVO", async () => {
    const op = await compra();
    await prisma.proveedor.update({ where: { id: surId }, data: { activo: false } });
    const pedir = (proveedorId: string) => corregirCompraCasoDeUso(actor(), { operacionId: op.id, nueva: { proveedorId, nroFactura: "A-0001", detalleLibre: "semanal" }, esperado: vista(op) });

    expect(await pedir("no-existe")).toEqual({ ok: false, codigo: "PROVEEDOR_INEXISTENTE", mensaje: "El proveedor no existe." });
    expect(await pedir(surId)).toEqual({ ok: false, codigo: "PROVEEDOR_INACTIVO", mensaje: 'El proveedor "Distribuidora Sur" está inactivo.' });
  });

  it("FACTURA_DUPLICADA: otra compra vigente del mismo proveedor ya usa ese número", async () => {
    await compra({ nroFactura: "F-1" });
    const op = await compra({ nroFactura: "F-2" });
    const r = await corregirCompraCasoDeUso(actor(), { operacionId: op.id, nueva: { proveedorId: molinoId, nroFactura: "F-1", detalleLibre: "semanal" }, esperado: vista(op) });
    expect(r).toEqual({ ok: false, codigo: "FACTURA_DUPLICADA", mensaje: MENSAJE_FACTURA_DUPLICADA });
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: op.id } })).nroFactura).toBe("F-2");
  });
});
