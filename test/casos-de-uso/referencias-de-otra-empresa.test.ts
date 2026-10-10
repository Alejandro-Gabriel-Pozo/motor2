import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { darDeAltaProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/dar-de-alta-producto";
import { darDeAltaProductoRapidoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/dar-de-alta-producto-rapido";
import { actualizarProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/actualizar-producto";
import { crearOActualizarGrupoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/crear-o-actualizar-grupo";
import { registrarVentaCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-venta";
import { azarDelProceso } from "../../src/lib/azar";
import type { EntradaProducto } from "../../src/core/features/catalogo/productos.schema";
import { guardComandoDatosDeProducto } from "../../src/core/features/catalogo/productos.guard";

/**
 * Hallazgo O.175 (GT-3b, cerrado): cinco acciones rechazaban un id de OTRA empresa con una excepción CRUDA de Prisma (clave foránea compuesta por empresa, `P2003`) en lugar de `{ ok: false }`
 * con el rechazo de pertenencia. No cruzaba nada (la base lo impide y no se escribe una fila), pero el cliente recibía un error genérico y, en la venta, la excepción salía de dentro de la transacción.
 * Ahora cada caso de uso traduce la violación de clave foránea a «No se encontró …» en su borde (fuera de la transacción abortada). Postgres real; el ataque es el id de una segunda empresa.
 * Cada caso tiene su CONTROL positivo (el mismo pedido con ids propios termina bien): el rechazo no es de forma.
 */
describe("O.175: ids de otra empresa en categoría, insumo, unidades, proveedor y grupo padre → «No se encontró …», sin excepción cruda", () => {
  let sucursalId: string;
  let sucursalNombre: string;
  let seccionId: string;
  let adminId: string;
  let unidadId: string;
  let unidadCompraId: string;
  let categoriaId: string;
  let insumoId: string;
  let proveedorId: string;
  let grupoId: string;
  let ajeno: { unidadId: string; categoriaId: string; insumoId: string; proveedorId: string; grupoId: string };

  const actor = () => ({ usuarioId: adminId, sucursalId, sucursalNombre, ...baseDeTest });
  const datos = (extra: Partial<EntradaProducto> = {}): EntradaProducto => ({ nombre: "Producto de prueba", tipo: "MP", unidadStockId: unidadId, factorConversion: 1, ...extra });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    sucursalNombre = base.sucursal.nombre;
    const catalogo = await sembrarCatalogoBase();
    unidadId = catalogo.kg.id;
    unidadCompraId = catalogo.g.id;
    categoriaId = catalogo.categoria.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_PROPIO", nombre: "Proveedor propio" } })).id;
    grupoId = (await prisma.grupo.create({ data: { nombre: "Grupo propio" } })).id;

    // La OTRA empresa, con una fila de cada cosa que el cliente puede mandar por id.
    await prisma.empresa.create({ data: { id: "empresa_b", nombre: "Empresa B", slug: "empresa-b", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "PROVISIONING" } });
    const e = "empresa_b";
    ajeno = {
      unidadId: (await prismaAdmin.unidad.create({ data: { empresaId: e, nombre: "kg B", magnitud: "PESO", decimales: 2 } })).id,
      categoriaId: (await prismaAdmin.categoriaProducto.create({ data: { empresaId: e, nombre: "Categoría B" } })).id,
      insumoId: (await prismaAdmin.insumo.create({ data: { empresaId: e, nombre: "Insumo B" } })).id,
      proveedorId: (await prismaAdmin.proveedor.create({ data: { empresaId: e, codigo: "PRV_B", nombre: "Proveedor B" } })).id,
      grupoId: (await prismaAdmin.grupo.create({ data: { empresaId: e, nombre: "Grupo B" } })).id,
    };
  });

  const productos = () => prisma.producto.count();

  describe("darDeAltaProducto: categoría, insumo y unidad de compra", () => {
    it.each([
      ["categoriaId", () => ({ categoriaId: ajeno.categoriaId }), /No se encontró la categoría elegida\./],
      ["insumoId", () => ({ insumoId: ajeno.insumoId }), /No se encontró el insumo elegido\./],
      ["unidadCompraId", () => ({ unidadCompraId: ajeno.unidadId }), /No se encontró la unidad de compra elegida\./],
    ] as const)("%s de otra empresa: rechazo de pertenencia, sin producto creado", async (_campo, extra, mensaje) => {
      const r = await darDeAltaProductoCasoDeUso(actor(), datos(extra()), azarDelProceso, true, guardComandoDatosDeProducto({ datos: datos(extra()) }));
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.codigo).toBe("REFERENCIA_NO_ENCONTRADA");
      expect(r.mensaje).toMatch(mensaje);
      expect(await productos()).toBe(0);
    });

    it("control: con los ids propios el alta termina bien", async () => {
      const r = await darDeAltaProductoCasoDeUso(actor(), datos({ categoriaId, insumoId, unidadCompraId }), azarDelProceso, true, guardComandoDatosDeProducto({ datos: datos({ categoriaId, insumoId, unidadCompraId }) }));
      expect(r.ok).toBe(true);
      expect(await productos()).toBe(1);
    });
  });

  describe("darDeAltaProductoRapido: unidad de stock", () => {
    it("unidadStockId de otra empresa: rechazo de pertenencia, sin producto creado", async () => {
      const r = await darDeAltaProductoRapidoCasoDeUso(actor(), { nombre: "Rápido", unidadStockId: ajeno.unidadId }, azarDelProceso);
      expect(r).toMatchObject({ ok: false, codigo: "REFERENCIA_NO_ENCONTRADA" });
      expect(r.mensaje).toMatch(/No se encontró la unidad de stock elegida\./);
      expect(await productos()).toBe(0);
    });

    it("control: con la unidad propia termina bien", async () => {
      expect((await darDeAltaProductoRapidoCasoDeUso(actor(), { nombre: "Rápido", unidadStockId: unidadId }, azarDelProceso)).ok).toBe(true);
    });
  });

  describe("actualizarProducto: proveedor de consignación", () => {
    let productoId: string;
    beforeEach(async () => {
      productoId = (await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Producto de prueba", tipo: "MP", unidadStockId: unidadId, factorConversion: 1 }, sucursalId)).id;
    });
    const comando = (extra: Partial<EntradaProducto>) => {
      const d = datos({ esConsignacion: true, precioConsignacion: 10, ...extra });
      // M.2: lo que se prueba acá es la pertenencia del proveedor, no el permiso: el comando se arma con las dos claves finas (consignación y campos sensibles) concedidas.
      return { productoId, datos: d, puerta: guardComandoDatosDeProducto({ datos: d }), puedeGestionarConsignacion: true, puedeEditarCamposSensibles: true };
    };

    it("proveedorConsignacionId de otra empresa: rechazo de pertenencia fuera de la transacción abortada, sin cambios ni auditoría", async () => {
      const auditoriasAntes = await prismaAdmin.registroAuditoria.count();
      const r = await actualizarProductoCasoDeUso(actor(), comando({ proveedorConsignacionId: ajeno.proveedorId }));
      expect(r).toMatchObject({ ok: false, codigo: "REFERENCIA_NO_ENCONTRADA" });
      expect(r.mensaje).toMatch(/No se encontró el proveedor de consignación elegido\./);
      expect((await prisma.producto.findUniqueOrThrow({ where: { id: productoId } })).proveedorConsignacionId).toBeNull();
      expect(await prismaAdmin.registroAuditoria.count()).toBe(auditoriasAntes);
    });

    it("control: con el proveedor propio la edición termina bien", async () => {
      const r = await actualizarProductoCasoDeUso(actor(), comando({ proveedorConsignacionId: proveedorId }));
      expect(r.ok).toBe(true);
      expect((await prisma.producto.findUniqueOrThrow({ where: { id: productoId } })).proveedorConsignacionId).toBe(proveedorId);
    });
  });

  describe("crearOActualizarGrupo: grupo padre", () => {
    it("grupoPadreId de otra empresa al CREAR: rechazo de pertenencia, sin grupo creado", async () => {
      const r = await crearOActualizarGrupoCasoDeUso(actor(), { nombre: "Grupo nuevo", grupoPadreId: ajeno.grupoId });
      expect(r).toMatchObject({ ok: false, codigo: "PADRE_NO_ENCONTRADO" });
      expect(r.mensaje).toMatch(/No se encontró el grupo padre\./);
      expect(await prisma.grupo.count({ where: { nombre: "Grupo nuevo" } })).toBe(0);
    });

    it("grupoPadreId de otra empresa al ACTUALIZAR uno existente: ídem, el padre no cambia", async () => {
      const r = await crearOActualizarGrupoCasoDeUso(actor(), { nombre: "Grupo propio", grupoPadreId: ajeno.grupoId });
      expect(r).toMatchObject({ ok: false, codigo: "PADRE_NO_ENCONTRADO" });
      expect((await prisma.grupo.findUniqueOrThrow({ where: { id: grupoId } })).grupoPadreId).toBeNull();
    });

    it("control: con un padre propio termina bien", async () => {
      const padre = await prisma.grupo.create({ data: { nombre: "Padre propio" } });
      expect((await crearOActualizarGrupoCasoDeUso(actor(), { nombre: "Grupo nuevo", grupoPadreId: padre.id })).ok).toBe(true);
    });
  });

  describe("registrarVenta: a quién se vende (proveedor)", () => {
    let gaseosaId: string;
    beforeEach(async () => {
      gaseosaId = (await sembrarProductoDisponible({ codigo: "PV_GASEOSA", nombre: "Gaseosa", tipo: "PV", unidadStockId: unidadId, precioVenta: 500 }, sucursalId)).id;
    });
    const venta = (extra: { proveedorId?: string }) => ({ fecha: new Date("2026-08-06T12:00:00Z"), seccionId, nroFactura: "F-1", ventas: [{ productoId: gaseosaId, cantidadVendida: 1 }], ...extra });

    it("proveedorId de otra empresa: rechazo de pertenencia, sin ninguna Operacion escrita", async () => {
      const r = await registrarVentaCasoDeUso(actor(), venta({ proveedorId: ajeno.proveedorId }));
      expect(r).toMatchObject({ ok: false, codigo: "VENTA_RECHAZADA" });
      expect(r.mensaje).toMatch(/No se encontró el proveedor elegido\./);
      expect(await prisma.operacion.count()).toBe(0);
    });

    it("control: con el proveedor propio la venta termina bien", async () => {
      const r = await registrarVentaCasoDeUso(actor(), venta({ proveedorId }));
      expect(r.ok).toBe(true);
      expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(1);
    });
  });
});
