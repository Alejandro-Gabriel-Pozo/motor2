import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, sembrarBase, sembrarCompraDeKardex, sembrarSeccion } from "../setup/test-db";
import { nroFacturaDePrueba } from "../setup/comprobante-de-prueba";
import { cargarProductosDeProveedorParaElCarrito } from "../../src/server/lecturas/catalogo/ofertas-de-proveedor";
import { registrarMovimientoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-movimiento";
import { mediodiaDelDia, ZONA_ARGENTINA, diaDeCalendario } from "../../src/core/tiempo/zona-horaria";
import type { DatosMovimientoInput } from "../../src/core/features/movimientos/movimiento.schema";
import type { Db } from "../../src/lib/db-tipos";

/**
 * Etapa 1 de Compras, paso 6: la precarga del carrito trae la unidad del vínculo (la de la última compra al proveedor) y las presentaciones activas de los productos, y decide con qué unidad arranca la fila.
 * Escenario: «Lata» se compra en «caja ×12» (presentación) con unidad de compra por defecto «unidad». Postgres real. Los casos de la pantalla (qué se muestra y qué se manda) son funciones puras con su propio test
 * (test/core/compras-carga-por-pasos.test.ts); acá se mide lo que la pantalla da por cierto del servidor: que el lector entrega la unidad y que registrar con ella suma lo que la pantalla muestra.
 */
const mediodiaDeHoy = () => mediodiaDelDia(diaDeCalendario(new Date(), ZONA_ARGENTINA), ZONA_ARGENTINA);

let sucursalId: string, norteId: string, seccionId: string, usuarioId: string;
let unidadId: string, cajaId: string, latasId: string, proveedorId: string;
/** El stock que ya dejó la compra sembrada para el kardex (el lector la necesita para ofrecer el producto): se descuenta para medir solo lo que registra el test. */
let stockSembrado = 0;

const actor = () => ({ usuarioId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId, sucursalNombre: "Central", ahora: new Date(), ...baseDeTest({ lectura: [sucursalId], escritura: [sucursalId] }) });
const lector = () => cargarProductosDeProveedorParaElCarrito(prisma as unknown as Db, proveedorId, sucursalId);
const stockDe = async (productoId: string) => Number((await prisma.movimientoStock.aggregate({ where: { productoId }, _sum: { cantidad: true } }))._sum.cantidad ?? 0) - stockSembrado;
const pedido = (unidadCompraId: string | undefined, claveIdempotencia = randomUUID()) =>
  ({
    proceso: "COMPRA",
    fecha: mediodiaDeHoy(),
    seccionId,
    proveedorId,
    nroFactura: nroFacturaDePrueba(),
    items: [{ productoId: latasId, cantidad: 2, precioTotal: 2400, ...(unidadCompraId === undefined ? {} : { unidadCompraId }) }],
    claveIdempotencia,
  }) as DatosMovimientoInput;
const comprar = (unidadCompraId: string | undefined, claveIdempotencia = randomUUID()) => registrarMovimientoCasoDeUso(actor(), pedido(unidadCompraId, claveIdempotencia));

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  sucursalId = base.sucursal.id;
  norteId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
  seccionId = (await sembrarSeccion(sucursalId)).id;
  usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
  unidadId = (await prisma.unidad.create({ data: { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 } })).id;
  cajaId = (await prisma.unidad.create({ data: { nombre: "caja", magnitud: "CANTIDAD", decimales: 0 } })).id;
  const insumo = await prisma.insumo.create({ data: { nombre: "Latas" } });
  latasId = (await prisma.producto.create({ data: { codigo: "MP_LATA", nombre: "Lata", tipo: "MP", unidadStockId: unidadId, unidadCompraId: unidadId, factorConversion: 1, insumoId: insumo.id } })).id;
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: latasId, disponible: true } });
  await prisma.presentacion.create({ data: { productoId: latasId, unidadCompraId: cajaId, factorConversion: 12 } });
  proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Distribuidora" } })).id;
  await sembrarCompraDeKardex({ sucursalId, seccionId, usuarioId, productoId: latasId, proveedorId, fecha: "2026-09-01", precioPorUnidadStock: 100 });
  stockSembrado = 0;
  stockSembrado = await stockDe(latasId);
});

const vincular = (unidadCompraId: string) => prisma.proveedorPorProducto.create({ data: { productoId: latasId, proveedorId, unidadCompraId, precioUnitario: 1200, precioPorUnidadStock: 100, referenciaProveedor: "LATA-12" } });

describe("precarga del carrito: la unidad del vínculo", () => {
  it("(a) vínculo en «caja ×12» con la unidad por defecto «unidad»: el lector devuelve la caja, elegida y vigente, con las unidades del producto", async () => {
    await vincular(cajaId);
    const [fila] = await lector();
    expect(fila).toMatchObject({ productoId: latasId, unidadCompraId: cajaId, unidadCompraNombre: "caja", unidadElegidaId: cajaId, unidadDelVinculoVigente: true, unidadStockNombre: "unidad" });
    expect(fila.unidades.porDefecto).toEqual({ unidadCompraId: unidadId, nombre: "unidad", factor: 1 });
    expect(fila.unidades.presentaciones).toEqual([{ unidadCompraId: cajaId, nombre: "caja", factor: 12 }]);
  });

  it("(b) registrar 2 con la unidad que trajo el lector: entran 24 al stock", async () => {
    await vincular(cajaId);
    const [fila] = await lector();
    const r = await comprar(fila.unidadElegidaId);
    expect(r.ok).toBe(true);
    expect(await stockDe(latasId)).toBe(24);
  });

  it("(c) la presentación desactivada: no es válida, la fila cae a la por defecto (vacía), pide confirmar y registrar 2 deja 2", async () => {
    await vincular(cajaId);
    await prisma.presentacion.updateMany({ where: { productoId: latasId, unidadCompraId: cajaId }, data: { activa: false } });
    const [fila] = await lector();
    expect(fila).toMatchObject({ unidadCompraId: cajaId, unidadElegidaId: "", unidadDelVinculoVigente: false });
    expect(fila.unidades.presentaciones).toEqual([]);
    expect((await comprar(fila.unidadElegidaId)).ok).toBe(true);
    expect(await stockDe(latasId)).toBe(2);
  });

  it("(d) vínculo en la unidad por defecto: la fila arranca con vacío (vigente) y el servidor trata igual vacío que el id de la por defecto sin fila de presentación", async () => {
    await vincular(unidadId);
    const [fila] = await lector();
    expect(fila).toMatchObject({ unidadCompraId: unidadId, unidadElegidaId: "", unidadDelVinculoVigente: true });
    expect((await comprar(fila.unidadElegidaId)).ok).toBe(true);
    expect((await comprar(unidadId)).ok).toBe(true);
    expect(await stockDe(latasId)).toBe(2 + 2);
  });

  it("(e) sin fila en la tabla (compra vieja): la unidad es la por defecto del producto y está vigente", async () => {
    const [fila] = await lector();
    expect(fila).toMatchObject({ unidadCompraId: unidadId, unidadElegidaId: "", unidadDelVinculoVigente: true });
  });

  it("(f) idempotencia: la compra precargada reenviada con la misma clave devuelve «repetida» y el stock entra una sola vez", async () => {
    await vincular(cajaId);
    const [fila] = await lector();
    const mismoPedido = pedido(fila.unidadElegidaId);
    const primera = await registrarMovimientoCasoDeUso(actor(), mismoPedido);
    expect(primera.ok).toBe(true);
    const reenvio = await registrarMovimientoCasoDeUso(actor(), mismoPedido);
    expect(reenvio.ok).toBe(true);
    if (reenvio.ok) expect(reenvio.datos.repetida).toBe(true);
    expect(await stockDe(latasId)).toBe(24);
  });
});

describe("precarga del carrito: alcance", () => {
  it("(g) un producto que no está disponible en la sucursal no se precarga, aunque otra sucursal se lo haya comprado al proveedor", async () => {
    await vincular(cajaId);
    const aparte = await prisma.producto.create({ data: { codigo: "MP_SOLO_NORTE", nombre: "Solo Norte", tipo: "MP", unidadStockId: unidadId } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId: norteId, productoId: aparte.id, disponible: true } });
    const seccionNorte = (await sembrarSeccion(norteId, "Depósito Norte")).id;
    await sembrarCompraDeKardex({ sucursalId: norteId, seccionId: seccionNorte, usuarioId, productoId: aparte.id, proveedorId, fecha: "2026-09-02", precioPorUnidadStock: 50 });
    const filas = await lector();
    expect(filas.map((f) => f.productoId)).toEqual([latasId]);
  });

  it("(h) las presentaciones de la fila son solo las del producto precargado (no mezcla las de otro)", async () => {
    await vincular(cajaId);
    const otro = await prisma.producto.create({ data: { codigo: "MP_OTRO", nombre: "Otro", tipo: "MP", unidadStockId: unidadId } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: otro.id, disponible: true } });
    await prisma.presentacion.create({ data: { productoId: otro.id, unidadCompraId: cajaId, factorConversion: 6 } });
    await sembrarCompraDeKardex({ sucursalId, seccionId, usuarioId, productoId: otro.id, proveedorId, fecha: "2026-09-03", precioPorUnidadStock: 10 });
    const filas = await lector();
    const factorDe = (id: string) => filas.find((f) => f.productoId === id)?.unidades.presentaciones.map((p) => p.factor);
    expect(factorDe(latasId)).toEqual([12]);
    expect(factorDe(otro.id)).toEqual([6]);
  });
});
