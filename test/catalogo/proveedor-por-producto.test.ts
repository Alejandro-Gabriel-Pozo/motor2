import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, sembrarSeccion, sembrarCompraDeKardex, sembrarMotivosYDestinos, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { obtenerComparativaPreciosPorInsumo, listarProductosDeProveedor } from "../../src/server/actions/catalogo/proveedor-por-producto";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { anularCompra, corregirCompra } from "../../src/server/actions/movimientos/compras";
import { upsertProveedorPorProducto } from "../../src/server/persistencia/catalogo/upsert-proveedor-por-producto";
import { cargarOfertasDeProveedores } from "../../src/server/lecturas/catalogo/ofertas-de-proveedor";

describe("ProveedorPorProducto (sin gate propio)", () => {
  let sucursalId: string;
  let productoId: string;
  let proveedorAId: string;
  let proveedorBId: string;
  let unidadCompraId: string;
  let adminId: string;
  let seccionId: string;

  /** Una compra en el Kardex (escrita directo), de la sucursal de la sesión salvo que se diga otra. */
  const compra = (productoDeLaCompra: string, proveedorId: string | null, fecha: string, precioPorUnidadStock: number, extra: { sucursalId?: string; seccionId?: string; proceso?: "COMPRA" | "DEVOLUCION_PROVEEDOR" } = {}) =>
    sembrarCompraDeKardex({ sucursalId, seccionId, usuarioId: adminId, productoId: productoDeLaCompra, proveedorId, fecha, precioPorUnidadStock, ...extra });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    // Las lecturas (obtenerComparativaPreciosPorInsumo, listarProductosDeProveedor) exigen una sesión; el upsert es un ayudante interno.
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    adminId = admin.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    const catalogo = await sembrarCatalogoBase();
    unidadCompraId = catalogo.kg.id;

    const producto = await sembrarProductoDisponible(
      { codigo: "MP_TEST", nombre: "Aceite", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id },
      sucursalId
    );
    productoId = producto.id;

    const [a, b] = await Promise.all([
      prisma.proveedor.create({ data: { codigo: "PRV_A", nombre: "Proveedor A" } }),
      prisma.proveedor.create({ data: { codigo: "PRV_B", nombre: "Proveedor B" } }),
    ]);
    proveedorAId = a.id;
    proveedorBId = b.id;
  });

  it("dos upserts concurrentes sobre la misma clave nunca crean dos filas", async () => {
    await Promise.all([
      upsertProveedorPorProducto(prisma, { productoId, proveedorId: proveedorAId, unidadCompraId, precioUnitario: 100, precioPorUnidadStock: 100 }),
      upsertProveedorPorProducto(prisma, { productoId, proveedorId: proveedorAId, unidadCompraId, precioUnitario: 110, precioPorUnidadStock: 110 }),
    ]);

    const cantidad = await prisma.proveedorPorProducto.count({ where: { productoId, proveedorId: proveedorAId, unidadCompraId } });
    expect(cantidad).toBe(1);
  });

  it("un precio 0 nunca pisa un precio bueno ya cargado", async () => {
    await upsertProveedorPorProducto(prisma, { productoId, proveedorId: proveedorAId, unidadCompraId, precioUnitario: 500, precioPorUnidadStock: 500 });
    await upsertProveedorPorProducto(prisma, { productoId, proveedorId: proveedorAId, unidadCompraId, precioUnitario: 0, precioPorUnidadStock: 0 });

    const fila = await prisma.proveedorPorProducto.findUniqueOrThrow({
      where: { productoId_proveedorId_unidadCompraId: { productoId, proveedorId: proveedorAId, unidadCompraId } },
    });
    expect(Number(fila.precioPorUnidadStock)).toBe(500);
  });

  describe("una compra con fecha atrasada no pisa el último precio (decisión del dueño, 2026-10-06; ERPNext hace lo mismo)", () => {
    const fila = () =>
      prisma.proveedorPorProducto.findUniqueOrThrow({ where: { productoId_proveedorId_unidadCompraId: { productoId, proveedorId: proveedorAId, unidadCompraId } } });
    const comprar = (fechaCompra: string, precio: number) =>
      upsertProveedorPorProducto(prisma, { productoId, proveedorId: proveedorAId, unidadCompraId, precioUnitario: precio, precioPorUnidadStock: precio, fechaCompra: new Date(fechaCompra) });

    it("una compra MÁS VIEJA no cambia el precio ni retrocede `ultimaCompra`", async () => {
      await comprar("2026-09-10", 500);
      await comprar("2026-08-01", 300); // la factura de hace más de un mes, cargada hoy
      const f = await fila();
      expect(Number(f.precioPorUnidadStock)).toBe(500);
      expect(f.ultimaCompra.toISOString().slice(0, 10)).toBe("2026-09-10");
    });

    it("una compra MÁS NUEVA sí actualiza el precio y la fecha", async () => {
      await comprar("2026-09-10", 500);
      await comprar("2026-09-20", 650);
      const f = await fila();
      expect(Number(f.precioPorUnidadStock)).toBe(650);
      expect(f.ultimaCompra.toISOString().slice(0, 10)).toBe("2026-09-20");
    });

    it("con la MISMA fecha gana la carga posterior", async () => {
      await comprar("2026-09-10", 500);
      await comprar("2026-09-10", 520);
      expect(Number((await fila()).precioPorUnidadStock)).toBe(520);
    });

    it("la referencia del proveedor tipeada en una compra vieja sí se guarda si no había una (un valor vacío nunca pisa)", async () => {
      await comprar("2026-09-10", 500);
      await upsertProveedorPorProducto(prisma, { productoId, proveedorId: proveedorAId, unidadCompraId, precioUnitario: 300, precioPorUnidadStock: 300, fechaCompra: new Date("2026-08-01"), referenciaProveedor: "COD-77" });
      const f = await fila();
      expect(f.referenciaProveedor).toBe("COD-77");
      expect(Number(f.precioPorUnidadStock)).toBe(500);
    });
  });

  it("la comparativa nunca elige como 'más barato' una oferta en 0", async () => {
    await compra(productoId, proveedorAId, "2026-09-10", 0);
    await compra(productoId, proveedorBId, "2026-09-10", 500);
    // La unidad de compra sale de la tabla; el precio, del Kardex.
    for (const p of [proveedorAId, proveedorBId]) await upsertProveedorPorProducto(prisma, { productoId, proveedorId: p, unidadCompraId, precioUnitario: 0, precioPorUnidadStock: 0 });

    const comparativa = await obtenerComparativaPreciosPorInsumo();
    const fila = comparativa.find((f) => f.insumo === "Harina"); // insumo sembrado en sembrarCatalogoBase
    expect(fila?.masBarato?.proveedorNombre).toBe("Proveedor B");
  });

  it("un referenciaProveedor vacío nunca pisa uno ya cargado (mismo criterio que el precio)", async () => {
    await upsertProveedorPorProducto(prisma, {
      productoId, proveedorId: proveedorAId, unidadCompraId, precioUnitario: 100, precioPorUnidadStock: 100, referenciaProveedor: "ACE-5L",
    });
    await upsertProveedorPorProducto(prisma, { productoId, proveedorId: proveedorAId, unidadCompraId, precioUnitario: 110, precioPorUnidadStock: 110 });

    const fila = await prisma.proveedorPorProducto.findUniqueOrThrow({
      where: { productoId_proveedorId_unidadCompraId: { productoId, proveedorId: proveedorAId, unidadCompraId } },
    });
    expect(fila.referenciaProveedor).toBe("ACE-5L");
  });

  it("referenciaProveedor se puede actualizar mandando un valor nuevo no vacío", async () => {
    await upsertProveedorPorProducto(prisma, {
      productoId, proveedorId: proveedorAId, unidadCompraId, precioUnitario: 100, precioPorUnidadStock: 100, referenciaProveedor: "ACE-5L",
    });
    await upsertProveedorPorProducto(prisma, {
      productoId, proveedorId: proveedorAId, unidadCompraId, precioUnitario: 110, precioPorUnidadStock: 110, referenciaProveedor: "ACEITE-BIDON-5",
    });

    const fila = await prisma.proveedorPorProducto.findUniqueOrThrow({
      where: { productoId_proveedorId_unidadCompraId: { productoId, proveedorId: proveedorAId, unidadCompraId } },
    });
    expect(fila.referenciaProveedor).toBe("ACEITE-BIDON-5");
  });

  describe("listarProductosDeProveedor", () => {
    it("trae los productos ya comprados a ese proveedor, más recientes primero", async () => {
      const producto2 = await sembrarProductoDisponible({ codigo: "MP_TEST_2", nombre: "Vinagre", tipo: "MP", unidadStockId: unidadCompraId }, sucursalId);

      await compra(productoId, proveedorAId, "2026-01-01", 100);
      await compra(producto2.id, proveedorAId, "2026-02-01", 50);
      // A otro proveedor no debería aparecer en la lista de A.
      await compra(productoId, proveedorBId, "2026-03-01", 999);
      await upsertProveedorPorProducto(prisma, { productoId, proveedorId: proveedorAId, unidadCompraId, precioUnitario: 100, precioPorUnidadStock: 100, referenciaProveedor: "ACE-5L" });

      const lista = await listarProductosDeProveedor(proveedorAId);
      expect(lista).toHaveLength(2);
      expect(lista[0].productoId).toBe(producto2.id); // más reciente primero
      expect(lista[1]).toMatchObject({ productoId, referenciaProveedor: "ACE-5L", ultimoPrecioPorUnidadStock: 100, origenDelPrecio: "SUCURSAL" });
      // O.10: la fila del carrito no lleva la unidad de compra (la precarga usa la unidad por defecto del producto, a propósito).
      expect(Object.keys(lista[1]).sort()).toEqual(
        ["origenDelPrecio", "productoCodigo", "productoId", "productoNombre", "referenciaProveedor", "ultimaCompra", "ultimoPrecioPorUnidadStock", "unidadStockNombre"],
      );
    });

    it("sin ninguna compra a ese proveedor, da vacío", async () => {
      expect(await listarProductosDeProveedor(proveedorAId)).toEqual([]);
    });

    it("no trae productos no disponibles en esta sucursal", async () => {
      await compra(productoId, proveedorAId, "2026-09-10", 100);
      await prisma.disponibilidadProducto.update({ where: { sucursalId_productoId: { sucursalId, productoId } }, data: { disponible: false } });

      expect(await listarProductosDeProveedor(proveedorAId)).toEqual([]);
    });
  });

  /**
   * Vínculo proveedor↔producto, parte 2 (decisión del dueño, 2026-10-06/07): la comparativa, la ficha y el carrito se LEEN del Kardex vigente, con la misma regla que el costo de reposición
   * (`obtenerCostoActualPorMP`). Antes leían la tabla `ProveedorPorProducto`, que no se entera de una compra anulada ni de un proveedor corregido.
   */
  describe("derivado del Kardex vigente", () => {
    const precioDe = async (proveedor: string) => {
      const fila = (await obtenerComparativaPreciosPorInsumo()).find((f) => f.insumo === "Harina");
      return fila?.todas.find((o) => o.proveedorNombre === proveedor);
    };
    const anular = (operacionId: string) => prisma.operacion.update({ where: { id: operacionId }, data: { anuladaEn: new Date(), anuladaPorId: adminId } });

    it("una compra ANULADA no da precio ni aparece (comparativa y carrito); el precio vuelve al de la compra anterior vigente", async () => {
      await compra(productoId, proveedorAId, "2026-09-01", 500);
      const nueva = await compra(productoId, proveedorAId, "2026-09-20", 900);
      expect((await precioDe("Proveedor A"))?.precioPorUnidadStock).toBe(900);

      await anular(nueva.id);
      const oferta = await precioDe("Proveedor A");
      expect(oferta?.precioPorUnidadStock).toBe(500);
      expect(oferta?.ultimaCompra.toISOString().slice(0, 10)).toBe("2026-09-01");
      expect((await listarProductosDeProveedor(proveedorAId))[0]).toMatchObject({ ultimoPrecioPorUnidadStock: 500 });
    });

    it("si la ÚNICA compra se anula, el proveedor desaparece de la comparativa y del carrito", async () => {
      const unica = await compra(productoId, proveedorAId, "2026-09-10", 500);
      await anular(unica.id);
      expect(await precioDe("Proveedor A")).toBeUndefined();
      expect(await listarProductosDeProveedor(proveedorAId)).toEqual([]);
    });

    it("una compra real anulada con la ACCIÓN `anularCompra` deja de aparecer", async () => {
      await sembrarMotivosYDestinos();
      expect((await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-09-20"), seccionId, proveedorId: proveedorAId, items: [{ productoId, cantidad: 10, precioTotal: 1000 }] })).ok).toBe(true);
      expect((await precioDe("Proveedor A"))?.precioPorUnidadStock).toBe(100);

      const op = await prisma.operacion.findFirstOrThrow({ where: { proceso: "COMPRA" } });
      expect((await anularCompra(op.id)).ok).toBe(true);
      expect(await precioDe("Proveedor A")).toBeUndefined();
    });

    it("corregir el proveedor de una compra MUEVE el precio al proveedor correcto", async () => {
      await sembrarMotivosYDestinos();
      expect((await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-09-20"), seccionId, proveedorId: proveedorAId, items: [{ productoId, cantidad: 10, precioTotal: 1000 }] })).ok).toBe(true);
      const op = await prisma.operacion.findFirstOrThrow({ where: { proceso: "COMPRA" } });
      const r = await corregirCompra(op.id, { proveedorId: proveedorBId, nroFactura: "", detalleLibre: "" }, { proveedorId: op.proveedorId, nroFactura: op.nroFactura, detalleLibre: op.detalleLibre });
      expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);

      expect(await precioDe("Proveedor A")).toBeUndefined();
      expect((await precioDe("Proveedor B"))?.precioPorUnidadStock).toBe(100);
    });

    it("una DEVOLUCIÓN al proveedor nunca es «la última compra»", async () => {
      await compra(productoId, proveedorAId, "2026-09-10", 500);
      await compra(productoId, proveedorAId, "2026-09-25", 900, { proceso: "DEVOLUCION_PROVEEDOR" });
      const oferta = await precioDe("Proveedor A");
      expect(oferta?.precioPorUnidadStock).toBe(500);
      expect(oferta?.ultimaCompra.toISOString().slice(0, 10)).toBe("2026-09-10");
    });

    it("una compra de fecha ATRASADA cargada después no pisa a la más nueva", async () => {
      await compra(productoId, proveedorAId, "2026-09-20", 650);
      await compra(productoId, proveedorAId, "2026-08-01", 300); // la factura vieja, cargada hoy
      const oferta = await precioDe("Proveedor A");
      expect(oferta?.precioPorUnidadStock).toBe(650);
      expect(oferta?.ultimaCompra.toISOString().slice(0, 10)).toBe("2026-09-20");
    });

    it("con la MISMA fecha gana la cargada después", async () => {
      await compra(productoId, proveedorAId, "2026-09-10", 500);
      await compra(productoId, proveedorAId, "2026-09-10", 520);
      expect((await precioDe("Proveedor A"))?.precioPorUnidadStock).toBe(520);
    });

    it("una compra sin precio (0) MÁS NUEVA no pisa el precio bueno, pero sí adelanta la fecha de la última compra", async () => {
      await compra(productoId, proveedorAId, "2026-09-10", 500);
      await compra(productoId, proveedorAId, "2026-09-20", 0);
      const oferta = await precioDe("Proveedor A");
      expect(oferta?.precioPorUnidadStock).toBe(500);
      expect(oferta?.ultimaCompra.toISOString().slice(0, 10)).toBe("2026-09-20");
    });

    it("una compra sin proveedor no crea ninguna oferta", async () => {
      await compra(productoId, null, "2026-09-10", 500);
      expect((await obtenerComparativaPreciosPorInsumo()).find((f) => f.insumo === "Harina")).toBeUndefined();
    });

    it("la comparativa es de la EMPRESA: suma lo comprado en todas las sucursales", async () => {
      const norte = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
      const seccionNorte = (await sembrarSeccion(norte, "Depósito Norte")).id;
      await compra(productoId, proveedorAId, "2026-09-10", 500);
      await compra(productoId, proveedorBId, "2026-09-12", 400, { sucursalId: norte, seccionId: seccionNorte });
      const fila = (await obtenerComparativaPreciosPorInsumo()).find((f) => f.insumo === "Harina");
      expect(fila?.masBarato?.proveedorNombre).toBe("Proveedor B");
      expect(fila?.todas).toHaveLength(2);
    });

    it("el carrito usa el precio de ESTA sucursal; si nunca le compró ese producto al proveedor, el de la empresa y lo dice", async () => {
      const norte = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
      const seccionNorte = (await sembrarSeccion(norte, "Depósito Norte")).id;
      const producto2 = await sembrarProductoDisponible({ codigo: "MP_TEST_3", nombre: "Sal", tipo: "MP", unidadStockId: unidadCompraId }, sucursalId);
      await compra(productoId, proveedorAId, "2026-09-10", 100); // esta sucursal
      await compra(productoId, proveedorAId, "2026-09-25", 130, { sucursalId: norte, seccionId: seccionNorte }); // otra sucursal, MÁS nueva
      await compra(producto2.id, proveedorAId, "2026-09-15", 40, { sucursalId: norte, seccionId: seccionNorte }); // solo la otra sucursal

      const lista = await listarProductosDeProveedor(proveedorAId);
      const de = (id: string) => lista.find((p) => p.productoId === id);
      expect(de(productoId)).toMatchObject({ ultimoPrecioPorUnidadStock: 100, origenDelPrecio: "SUCURSAL" }); // el de acá, no el más nuevo de Norte
      expect(de(producto2.id)).toMatchObject({ ultimoPrecioPorUnidadStock: 40, origenDelPrecio: "EMPRESA" });
    });

    it("un par con VARIAS unidades de compra: la unidad es la de la fila más reciente y la referencia, la de la más reciente que tenga una (la ficha muestra una fila por producto)", async () => {
      const bolsa = await prisma.unidad.create({ data: { nombre: "bolsa", magnitud: "CANTIDAD", decimales: 0 } });
      await compra(productoId, proveedorAId, "2026-09-10", 500);
      // Fila VIEJA en kg, con referencia; fila NUEVA en bolsa, sin referencia.
      await prisma.proveedorPorProducto.create({ data: { productoId, proveedorId: proveedorAId, unidadCompraId, precioUnitario: 500, precioPorUnidadStock: 500, ultimaCompra: new Date("2026-08-01"), referenciaProveedor: "ACE-5L" } });
      await prisma.proveedorPorProducto.create({ data: { productoId, proveedorId: proveedorAId, unidadCompraId: bolsa.id, precioUnitario: 12500, precioPorUnidadStock: 500, ultimaCompra: new Date("2026-09-10") } });

      const lista = await listarProductosDeProveedor(proveedorAId);
      expect(lista).toHaveLength(1);
      expect(lista[0]).toMatchObject({ referenciaProveedor: "ACE-5L" });
      // O.10: el carrito ya no lleva la unidad de compra; el MISMO dato se lee del lector de ofertas (lo usan la ficha y la comparativa).
      expect((await cargarOfertasDeProveedores(prisma, { proveedorId: proveedorAId }))[0]).toMatchObject({ unidadCompraId: bolsa.id, unidadCompraNombre: "bolsa", referenciaProveedor: "ACE-5L" });
    });

    it("un producto SIN unidad de compra también escribe su fila (con la unidad de stock) y conserva la referencia que se tipeó", async () => {
      await sembrarMotivosYDestinos();
      expect((await prisma.producto.findUniqueOrThrow({ where: { id: productoId } })).unidadCompraId).toBeNull();
      const r = await registrarMovimiento({
        proceso: "COMPRA", fecha: new Date("2026-09-20"), seccionId, proveedorId: proveedorAId,
        items: [{ productoId, cantidad: 10, precioTotal: 1000, referenciaProveedor: "ACE-5L" }],
      });
      expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);

      const fila = await prisma.proveedorPorProducto.findFirstOrThrow({ where: { productoId, proveedorId: proveedorAId } });
      expect(fila).toMatchObject({ unidadCompraId, referenciaProveedor: "ACE-5L" });
      expect((await listarProductosDeProveedor(proveedorAId))[0]).toMatchObject({ referenciaProveedor: "ACE-5L", ultimoPrecioPorUnidadStock: 100 });
      expect((await cargarOfertasDeProveedores(prisma, { proveedorId: proveedorAId }))[0]).toMatchObject({ unidadCompraNombre: "kg", referenciaProveedor: "ACE-5L" }); // O.10
    });

    it("una oferta sin fila en la tabla usa la unidad de compra del producto (o la de stock si no tiene)", async () => {
      await compra(productoId, proveedorAId, "2026-09-10", 500);
      expect(await prisma.proveedorPorProducto.count()).toBe(0);
      // O.10: la unidad se lee del lector de ofertas (el carrito ya no la lleva); mismo dato que antes.
      const ofertasDeA = () => cargarOfertasDeProveedores(prisma, { proveedorId: proveedorAId });
      const conUnidadDeStock = await ofertasDeA();
      expect(conUnidadDeStock[0]).toMatchObject({ unidadCompraId, unidadCompraNombre: "kg" }); // el producto no tiene unidad de compra: la de stock

      const bolsa = await prisma.unidad.create({ data: { nombre: "bolsa", magnitud: "CANTIDAD", decimales: 0 } });
      await prisma.producto.update({ where: { id: productoId }, data: { unidadCompraId: bolsa.id } });
      expect((await ofertasDeA())[0]).toMatchObject({ unidadCompraId: bolsa.id, unidadCompraNombre: "bolsa" });
    });
  });
});
