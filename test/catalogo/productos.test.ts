import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import {
  darDeAltaProducto,
  darDeAltaProductoRapido,
  actualizarProducto,
  obtenerInsumoDeProducto,
  asignarInsumoAProducto,
  buscarProductosSelector,
} from "../../src/server/actions/catalogo/productos";

describe("productos", () => {
  let unidadKgId: string;
  let unidadGId: string;
  let insumoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    unidadGId = catalogo.g.id;
    insumoId = catalogo.insumo.id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("da de alta un producto con código autogenerado con el prefijo del tipo", async () => {
    const resultado = await darDeAltaProducto({
      nombre: "Harina 0000",
      tipo: "MP",
      unidadStockId: unidadKgId,
      factorConversion: 1,
      insumoId,
    });
    expect(resultado.ok).toBe(true);

    const creado = await prisma.producto.findFirstOrThrow({ where: { nombre: "Harina 0000" } });
    expect(creado.codigo.startsWith("MP_")).toBe(true);
  });

  it("rechaza nombre duplicado, ignorando mayúsculas", async () => {
    await darDeAltaProducto({ nombre: "Azúcar", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1 });
    const resultado = await darDeAltaProducto({ nombre: "AZÚCAR", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1 });
    expect(resultado.ok).toBe(false);
  });

  it("alta rápida (wizard de Compra, §4): crea una MP con código autogenerado solo con nombre + unidad", async () => {
    const resultado = await darDeAltaProductoRapido("Levadura fresca", unidadKgId);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.id).toBeTruthy();

    const creado = await prisma.producto.findUniqueOrThrow({ where: { id: resultado.id } });
    expect(creado.codigo.startsWith("MP_")).toBe(true);
    expect(creado.tipo).toBe("MP");
    expect(creado.unidadStockId).toBe(unidadKgId);
    expect(Number(creado.factorConversion)).toBe(1);
  });

  it("alta rápida rechaza nombre duplicado y unidad faltante, igual que el alta completa", async () => {
    await darDeAltaProductoRapido("Manteca", unidadKgId);
    const duplicado = await darDeAltaProductoRapido("MANTECA", unidadKgId);
    expect(duplicado.ok).toBe(false);

    const sinUnidad = await darDeAltaProductoRapido("Otro producto", "");
    expect(sinUnidad.ok).toBe(false);
  });

  it("rechaza código manual duplicado", async () => {
    await darDeAltaProducto({ nombre: "Sal", tipo: "MP", codigo: "MP_SAL", unidadStockId: unidadKgId, factorConversion: 1 });
    const resultado = await darDeAltaProducto({
      nombre: "Sal fina",
      tipo: "MP",
      codigo: "MP_SAL",
      unidadStockId: unidadKgId,
      factorConversion: 1,
    });
    expect(resultado.ok).toBe(false);
  });

  it("rechaza combinación Tipo/Uso implícita inválida vía unidad mezclada dentro del mismo insumo", async () => {
    await darDeAltaProducto({ nombre: "Harina marca A", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1, insumoId });
    const resultado = await darDeAltaProducto({
      nombre: "Harina marca B",
      tipo: "MP",
      unidadStockId: unidadGId,
      factorConversion: 1,
      insumoId,
    });
    expect(resultado.ok).toBe(false);
  });

  it("actualizarProducto permite renombrar sin tocar el código (FK real, no hace falta reescribir historial)", async () => {
    await darDeAltaProducto({ nombre: "Fideos", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1 });
    const producto = await prisma.producto.findFirstOrThrow({ where: { nombre: "Fideos" } });

    const resultado = await actualizarProducto(producto.id, {
      nombre: "Fideos guiseros",
      tipo: "MP",
      unidadStockId: unidadKgId,
      factorConversion: 1,
    });
    expect(resultado.ok).toBe(true);

    const actualizado = await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } });
    expect(actualizado.codigo).toBe(producto.codigo);
    expect(actualizado.nombre).toBe("Fideos guiseros");
  });

  it("rechaza cambiar el tipo al editar, en vez de ignorarlo en silencio", async () => {
    await darDeAltaProducto({ nombre: "Harina 000", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1 });
    const producto = await prisma.producto.findFirstOrThrow({ where: { nombre: "Harina 000" } });

    const resultado = await actualizarProducto(producto.id, {
      nombre: "Harina 000",
      tipo: "PV", // intento real de cambiar MP -> PV
      unidadStockId: unidadKgId,
      factorConversion: 1,
    });
    expect(resultado.ok).toBe(false);

    const sigueIgual = await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } });
    expect(sigueIgual.tipo).toBe("MP");
  });

  it("rechaza consignación sin proveedor o sin precio", async () => {
    const resultado = await darDeAltaProducto({
      nombre: "Vino consignado",
      tipo: "MP",
      unidadStockId: unidadKgId,
      factorConversion: 1,
      esConsignacion: true,
    });
    expect(resultado.ok).toBe(false);
  });

  describe("asistente de hermanar (obtenerInsumoDeProducto / asignarInsumoAProducto)", () => {
    it("obtenerInsumoDeProducto devuelve null de insumo si el producto todavía no tiene uno", async () => {
      await darDeAltaProducto({ nombre: "Coca 500cc - Distribuidora Norte", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1 });
      const producto = await prisma.producto.findFirstOrThrow({ where: { nombre: "Coca 500cc - Distribuidora Norte" } });

      const info = await obtenerInsumoDeProducto(producto.id);
      expect(info?.insumoId).toBeNull();
      expect(info?.unidadStockId).toBe(unidadKgId);
    });

    it("obtenerInsumoDeProducto trae el nombre del insumo si ya está agrupado", async () => {
      await darDeAltaProducto({ nombre: "Harina marca A", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1, insumoId });
      const producto = await prisma.producto.findFirstOrThrow({ where: { nombre: "Harina marca A" } });

      const info = await obtenerInsumoDeProducto(producto.id);
      expect(info?.insumoId).toBe(insumoId);
      expect(info?.insumoNombre).toBe("Harina");
    });

    it("asignarInsumoAProducto agrupa retroactivamente una MP que no tenía insumo", async () => {
      await darDeAltaProducto({ nombre: "Coca 500cc - Distribuidora Sur", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1 });
      const producto = await prisma.producto.findFirstOrThrow({ where: { nombre: "Coca 500cc - Distribuidora Sur" } });

      const resultado = await asignarInsumoAProducto(producto.id, insumoId);
      expect(resultado.ok).toBe(true);

      const actualizado = await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } });
      expect(actualizado.insumoId).toBe(insumoId);
    });

    it("asignarInsumoAProducto rechaza si el Insumo ya tiene productos activos con otra unidad de stock", async () => {
      await darDeAltaProducto({ nombre: "Harina marca A", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1, insumoId });
      await darDeAltaProducto({ nombre: "Harina marca B (en gramos)", tipo: "MP", unidadStockId: unidadGId, factorConversion: 1 });
      const productoB = await prisma.producto.findFirstOrThrow({ where: { nombre: "Harina marca B (en gramos)" } });

      const resultado = await asignarInsumoAProducto(productoB.id, insumoId);
      expect(resultado.ok).toBe(false);

      const actualizado = await prisma.producto.findUniqueOrThrow({ where: { id: productoB.id } });
      expect(actualizado.insumoId).toBeNull();
    });

    it("asignarInsumoAProducto rechaza un PV (solo una MP puede tener insumo)", async () => {
      await darDeAltaProducto({ nombre: "Pizza muzza", tipo: "PV", unidadStockId: unidadKgId, factorConversion: 1 });
      const pv = await prisma.producto.findFirstOrThrow({ where: { nombre: "Pizza muzza" } });

      const resultado = await asignarInsumoAProducto(pv.id, insumoId);
      expect(resultado.ok).toBe(false);
    });
  });

  describe("buscarProductosSelector — filtro esConsignacion (hallazgo de la auditoría: panel de movimientos no filtraba por proceso)", () => {
    it("esConsignacion:true trae solo productos en consignación", async () => {
      const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Consignante" } });
      await darDeAltaProducto({ nombre: "Vino en consignación", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1, insumoId });
      const vino = await prisma.producto.findFirstOrThrow({ where: { nombre: "Vino en consignación" } });
      await prisma.producto.update({ where: { id: vino.id }, data: { esConsignacion: true, proveedorConsignacionId: proveedor.id } });
      await darDeAltaProducto({ nombre: "Harina normal", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1, insumoId });

      const resultado = await buscarProductosSelector("", { soloDisponibles: true, esConsignacion: true });
      expect(resultado.map((p) => p.nombre)).toEqual(["Vino en consignación"]);
    });

    it("esConsignacion:false excluye los productos en consignación", async () => {
      const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Consignante" } });
      await darDeAltaProducto({ nombre: "Vino en consignación", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1, insumoId });
      const vino = await prisma.producto.findFirstOrThrow({ where: { nombre: "Vino en consignación" } });
      await prisma.producto.update({ where: { id: vino.id }, data: { esConsignacion: true, proveedorConsignacionId: proveedor.id } });
      await darDeAltaProducto({ nombre: "Harina normal", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1, insumoId });

      const resultado = await buscarProductosSelector("", { soloDisponibles: true, esConsignacion: false });
      expect(resultado.map((p) => p.nombre)).toEqual(["Harina normal"]);
    });

    it("sin esConsignacion definido, trae los dos", async () => {
      const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Consignante" } });
      await darDeAltaProducto({ nombre: "Vino en consignación", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1, insumoId });
      const vino = await prisma.producto.findFirstOrThrow({ where: { nombre: "Vino en consignación" } });
      await prisma.producto.update({ where: { id: vino.id }, data: { esConsignacion: true, proveedorConsignacionId: proveedor.id } });
      await darDeAltaProducto({ nombre: "Harina normal", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1, insumoId });

      const resultado = await buscarProductosSelector("", { soloDisponibles: true });
      expect(resultado.map((p) => p.nombre).sort()).toEqual(["Harina normal", "Vino en consignación"]);
    });
  });

  describe("buscarProductosSelector — filtro soloSeProduce (Producción, hallazgo real 2026-09-23: dejaba \"producir\" cualquier MP)", () => {
    it("trae MP y PV marcados \"Se produce\", excluye los que no", async () => {
      await darDeAltaProducto({ nombre: "Harina comprada", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1, insumoId });
      await darDeAltaProducto({ nombre: "Prepizza masa", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1, insumoId, seProduce: true });
      await darDeAltaProducto({ nombre: "Gaseosa comprada", tipo: "PV", unidadStockId: unidadKgId, factorConversion: 1 });
      await darDeAltaProducto({ nombre: "Pizza al corte", tipo: "PV", unidadStockId: unidadKgId, factorConversion: 1, seProduce: true });

      const resultado = await buscarProductosSelector("", { soloDisponibles: true, soloSeProduce: true });
      expect(resultado.map((p) => p.nombre).sort()).toEqual(["Pizza al corte", "Prepizza masa"]);
    });
  });

  describe("el tilde de disponibilidad en el alta (§4, docs/plan-disponibilidad-por-sucursal-2026-09-23.md)", () => {
    async function disponibleEn(productoId: string, sucursalId: string) {
      return (await prisma.disponibilidadProducto.findUnique({ where: { sucursalId_productoId: { sucursalId, productoId } } }))?.disponible ?? false;
    }

    it("tildado (default, sin pasar el campo): queda disponible en TODAS las sucursales existentes", async () => {
      const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Norte" } });
      const r = await darDeAltaProducto({ nombre: "Harina universal", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1 });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      expect(await disponibleEn(r.id, (await prisma.sucursal.findUniqueOrThrow({ where: { nombre: "Central" } })).id)).toBe(true);
      expect(await disponibleEn(r.id, otraSucursal.id)).toBe(true);
    });

    it("sin tildar: queda disponible SOLO en la sucursal desde la que se da de alta", async () => {
      const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Norte" } });
      const central = await prisma.sucursal.findUniqueOrThrow({ where: { nombre: "Central" } });
      const r = await darDeAltaProducto({ nombre: "Insumo exclusivo de Central", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1, activoEnTodasLasSucursales: false });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      expect(await disponibleEn(r.id, central.id)).toBe(true);
      expect(await disponibleEn(r.id, otraSucursal.id)).toBe(false);
    });

    it("sin tildar: el producto no aparece en el selector de otra sucursal (paso P6 — buscarProductosSelector ya filtra por soloDisponibles)", async () => {
      const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Norte" } });
      const rolAdmin = await prisma.rol.findUniqueOrThrow({ where: { nombre: "admin" } });
      await crearUsuarioConMembresia({ email: "otro@test.com", sucursalId: otraSucursal.id, rolId: rolAdmin.id });

      const r = await darDeAltaProducto({ nombre: "Solo en Central", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1, activoEnTodasLasSucursales: false });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      // En "Central" (la sucursal del alta) sí aparece.
      const resultadoCentral = await buscarProductosSelector("Solo en Central", { soloDisponibles: true });
      expect(resultadoCentral.map((p) => p.nombre)).toEqual(["Solo en Central"]);

      // En "Norte" no.
      await mockearUsuarioActual({ id: (await prisma.user.findUniqueOrThrow({ where: { email: "otro@test.com" } })).id, email: "otro@test.com", nombre: null });
      const resultadoNorte = await buscarProductosSelector("Solo en Central", { soloDisponibles: true });
      expect(resultadoNorte).toEqual([]);
    });

    it("darDeAltaProductoRapido (sin formulario, sin tilde visible) sigue el mismo default: disponible en todas", async () => {
      const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Norte" } });
      const r = await darDeAltaProductoRapido("Producto del wizard", unidadKgId);
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      expect(await disponibleEn(r.id, (await prisma.sucursal.findUniqueOrThrow({ where: { nombre: "Central" } })).id)).toBe(true);
      expect(await disponibleEn(r.id, otraSucursal.id)).toBe(true);
    });
  });

  describe("pasoVenta (Task #25, venta fraccionada, docs/plan-venta-fraccionada-2026-09-26.md)", () => {
    it("solo aplica a PV: se rechaza en el alta de una MP", async () => {
      const r = await darDeAltaProducto({ nombre: "Harina fraccionada", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1, pasoVenta: 0.5 });
      expect(r).toEqual({ ok: false, mensaje: "El paso de venta solo aplica a productos de venta (PV)." });
    });

    it("0,3 se rechaza (1/paso no es entero); 0,5 se acepta, sin stock real, aunque la unidad tenga 0 decimales", async () => {
      const invalido = await darDeAltaProducto({ nombre: "Pizza mal fraccionada", tipo: "PV", unidadStockId: unidadGId, factorConversion: 1, precioVenta: 12000, pasoVenta: 0.3 });
      expect(invalido.ok).toBe(false);

      const valido = await darDeAltaProducto({ nombre: "Pizza fraccionada", tipo: "PV", unidadStockId: unidadGId, factorConversion: 1, precioVenta: 12000, pasoVenta: 0.5 });
      expect(valido.ok).toBe(true);
      if (!valido.ok) return;
      const creado = await prisma.producto.findUniqueOrThrow({ where: { id: valido.id } });
      expect(Number(creado.pasoVenta)).toBe(0.5);
    });

    it("R3: con 'Se produce', se rechaza si la unidad no tiene decimales suficientes — sugiere una unidad propia", async () => {
      const r = await darDeAltaProducto({
        nombre: "Pizza producida",
        tipo: "PV",
        unidadStockId: unidadGId, // 0 decimales
        factorConversion: 1,
        precioVenta: 12000,
        pasoVenta: 0.5,
        seProduce: true,
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.mensaje).toMatch(/unidad propia/);
    });

    it("R3: con 'Se produce' y una unidad con decimales suficientes, se acepta", async () => {
      const unidadDecimal = await prisma.unidad.create({ data: { nombre: "unidad (0,1)", magnitud: "CANTIDAD", decimales: 1 } });
      const r = await darDeAltaProducto({
        nombre: "Pizza producida OK",
        tipo: "PV",
        unidadStockId: unidadDecimal.id,
        factorConversion: 1,
        precioVenta: 12000,
        pasoVenta: 0.5,
        seProduce: true,
      });
      expect(r.ok).toBe(true);
    });

    it("transición peligrosa (a): marcar 'Se produce' en un producto con un pasoVenta ya inconsistente se bloquea", async () => {
      const alta = await darDeAltaProducto({ nombre: "Pizza al momento", tipo: "PV", unidadStockId: unidadGId, factorConversion: 1, precioVenta: 12000, pasoVenta: 0.5 });
      expect(alta.ok).toBe(true);
      if (!alta.ok) return;

      const r = await actualizarProducto(alta.id, {
        nombre: "Pizza al momento",
        tipo: "PV",
        unidadStockId: unidadGId,
        factorConversion: 1,
        precioVenta: 12000,
        pasoVenta: 0.5,
        seProduce: true, // ahora SÍ tiene stock real, y la unidad (0 decimales) no admite 0,5
      });
      expect(r.ok).toBe(false);

      const sigueIgual = await prisma.producto.findUniqueOrThrow({ where: { id: alta.id } });
      expect(sigueIgual.seProduce).toBe(false);
    });

    it("editar sin tocar pasoVenta lo conserva; vaciarlo vuelve al comportamiento sin paso", async () => {
      const alta = await darDeAltaProducto({ nombre: "Media pizza", tipo: "PV", unidadStockId: unidadGId, factorConversion: 1, precioVenta: 12000, pasoVenta: 0.5 });
      expect(alta.ok).toBe(true);
      if (!alta.ok) return;

      await actualizarProducto(alta.id, { nombre: "Media pizza especial", tipo: "PV", unidadStockId: unidadGId, factorConversion: 1, precioVenta: 12000, pasoVenta: 0.5 });
      expect(Number((await prisma.producto.findUniqueOrThrow({ where: { id: alta.id } })).pasoVenta)).toBe(0.5);

      await actualizarProducto(alta.id, { nombre: "Media pizza especial", tipo: "PV", unidadStockId: unidadGId, factorConversion: 1, precioVenta: 12000, pasoVenta: null });
      expect((await prisma.producto.findUniqueOrThrow({ where: { id: alta.id } })).pasoVenta).toBeNull();
    });

    it("se audita igual que el resto de los campos de producto", async () => {
      const alta = await darDeAltaProducto({ nombre: "Pizza auditada", tipo: "PV", unidadStockId: unidadGId, factorConversion: 1, precioVenta: 12000 });
      expect(alta.ok).toBe(true);
      if (!alta.ok) return;

      await actualizarProducto(alta.id, { nombre: "Pizza auditada", tipo: "PV", unidadStockId: unidadGId, factorConversion: 1, precioVenta: 12000, pasoVenta: 0.5 });

      const registro = await prisma.registroAuditoria.findFirst({ where: { entidadId: alta.id, campo: "pasoVenta" } });
      expect(registro).not.toBeNull();
      expect(registro!.valorAnterior).toBeNull();
      expect(registro!.valorNuevo).toBe("0.5");
    });
  });

  describe("validación de precios y factorConversion (Task #31 — validarImporte/validarCantidad, mismo criterio que Compra/Mesa/Mostrador)", () => {
    it("rechaza un precio de venta con más de 2 decimales", async () => {
      const r = await darDeAltaProducto({ nombre: "Pizza con precio raro", tipo: "PV", unidadStockId: unidadKgId, factorConversion: 1, precioVenta: 100.123 });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.mensaje).toMatch(/decimales/);
    });

    it("rechaza un precio de venta negativo", async () => {
      const r = await darDeAltaProducto({ nombre: "Pizza precio negativo", tipo: "PV", unidadStockId: unidadKgId, factorConversion: 1, precioVenta: -50 });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.mensaje).toMatch(/negativo/);
    });

    it("rechaza un precio de venta NaN (lo que manda el cliente cuando el campo tiene texto inválido)", async () => {
      const r = await darDeAltaProducto({ nombre: "Pizza precio NaN", tipo: "PV", unidadStockId: unidadKgId, factorConversion: 1, precioVenta: Number.NaN });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.mensaje).toMatch(/número válido/);
    });

    it("acepta un precio de venta válido con hasta 2 decimales", async () => {
      const r = await darDeAltaProducto({ nombre: "Pizza precio válido", tipo: "PV", unidadStockId: unidadKgId, factorConversion: 1, precioVenta: 1234.56 });
      expect(r.ok).toBe(true);
    });

    it("rechaza un precio de consignación con más de 2 decimales", async () => {
      const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_CONS", nombre: "Consignante" } });
      const r = await darDeAltaProducto({
        nombre: "Vino consignado con decimales", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1,
        esConsignacion: true, proveedorConsignacionId: proveedor.id, precioConsignacion: 30.999,
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.mensaje).toMatch(/decimales/);
    });

    it("rechaza un factorConversion con más decimales de los que admite la unidad de stock (kg admite 2)", async () => {
      const r = await darDeAltaProducto({ nombre: "Producto factor con 3 decimales", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1.234 });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.mensaje).toMatch(/decimales/);
    });

    it("rechaza un factorConversion gigantesco (por encima del tope de la columna Decimal)", async () => {
      const r = await darDeAltaProducto({ nombre: "Producto factor enorme", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1e15 });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.mensaje).toMatch(/grande/);
    });

    it("acepta un factorConversion válido con los decimales que admite la unidad de stock", async () => {
      const r = await darDeAltaProducto({ nombre: "Producto factor válido", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1.25 });
      expect(r.ok).toBe(true);
    });

    it("actualizarProducto aplica la misma validación de precioVenta al editar", async () => {
      const alta = await darDeAltaProducto({ nombre: "Pizza editable", tipo: "PV", unidadStockId: unidadKgId, factorConversion: 1, precioVenta: 1000 });
      expect(alta.ok).toBe(true);
      if (!alta.ok) return;

      const r = await actualizarProducto(alta.id, { nombre: "Pizza editable", tipo: "PV", unidadStockId: unidadKgId, factorConversion: 1, precioVenta: 1000.555 });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.mensaje).toMatch(/decimales/);

      // No se tocó nada: el precio sigue siendo el original (mismo criterio de Compra/Mesa/Mostrador — nunca reprocesa lo ya guardado).
      const sigueIgual = await prisma.producto.findUniqueOrThrow({ where: { id: alta.id } });
      expect(Number(sigueIgual.precioVenta)).toBe(1000);
    });
  });
});
