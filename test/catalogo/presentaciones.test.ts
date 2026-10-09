import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { agregarPresentacionAlternativa, actualizarActivaPresentacion, listarPresentaciones } from "../../src/server/actions/catalogo/productos";

describe("Presentaciones de compra alternativas", () => {
  let unidadKgId: string;
  let unidadGId: string;
  let productoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    unidadGId = catalogo.g.id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const producto = await prisma.producto.create({
      data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, unidadCompraId: unidadKgId, factorConversion: 1 },
    });
    productoId = producto.id;
  });

  it("listarPresentaciones devuelve vacío cuando el producto no tiene ninguna alternativa cargada (el circuito nunca se abrió)", async () => {
    expect(await listarPresentaciones(productoId)).toEqual([]);
  });

  it("agregarPresentacionAlternativa la crea, y listarPresentaciones la refleja", async () => {
    const resultado = await agregarPresentacionAlternativa(productoId, unidadGId, 20);
    expect(resultado.ok, resultado.mensaje).toBe(true);

    const presentaciones = await listarPresentaciones(productoId);
    expect(presentaciones).toHaveLength(1);
    expect(presentaciones[0]).toMatchObject({ unidadCompraId: unidadGId, factorConversion: 20, activa: true });
  });

  it("audita el factor de conversión de la presentación: el alta (anterior null), el cambio y NO un reenvío sin cambio (Pureza 0.7)", async () => {
    expect((await agregarPresentacionAlternativa(productoId, unidadGId, 20)).ok).toBe(true);
    expect((await agregarPresentacionAlternativa(productoId, unidadGId, 20)).ok).toBe(true);
    expect((await agregarPresentacionAlternativa(productoId, unidadGId, 25)).ok).toBe(true);

    const presentacion = await prisma.presentacion.findFirstOrThrow({ where: { productoId, unidadCompraId: unidadGId } });
    const registros = await prisma.registroAuditoria.findMany({ where: { entidad: "Presentacion", entidadId: presentacion.id }, orderBy: { creadoEn: "asc" } });
    expect(registros.map((r) => [r.campo, r.valorAnterior, r.valorNuevo])).toEqual([
      ["factorConversion", null, "20"],
      ["factorConversion", "20", "25"],
    ]);
  });

  it("rechaza agregar la misma unidad que ya es la unidad de compra por defecto del producto", async () => {
    const resultado = await agregarPresentacionAlternativa(productoId, unidadKgId, 1);
    expect(resultado.ok).toBe(false);
    expect(await listarPresentaciones(productoId)).toEqual([]);
  });

  it("rechaza un factor de conversión que no sea mayor a 0", async () => {
    const resultado = await agregarPresentacionAlternativa(productoId, unidadGId, 0);
    expect(resultado.ok).toBe(false);
  });

  it("rechaza un factor de conversión con más decimales de los que admite la unidad de stock del producto (kg admite 2)", async () => {
    const resultado = await agregarPresentacionAlternativa(productoId, unidadGId, 1.234);
    expect(resultado.ok).toBe(false);
    expect(resultado.mensaje).toMatch(/decimales/);
    expect(await listarPresentaciones(productoId)).toEqual([]);
  });

  it("rechaza un factor de conversión gigantesco", async () => {
    const resultado = await agregarPresentacionAlternativa(productoId, unidadGId, 1e15);
    expect(resultado.ok).toBe(false);
    expect(resultado.mensaje).toMatch(/grande/);
  });

  /**
   * M-4 (auditoría final): el operario con `producto_presentaciones` cambiaba con este mismo alta el FACTOR de una presentación ya existente (un `upsert` lo pisaba) y la compra siguiente metía más o
   * menos stock del que había. Una presentación que ya se usó en compras (hay un vínculo proveedor↔producto con su unidad, que cada compra con proveedor escribe) no cambia de factor.
   */
  describe("M-4: el factor de una presentación que ya se usó no se cambia", () => {
    let seccionId: string;
    let proveedorId: string;

    beforeEach(async () => {
      const sucursalId = (await prisma.sucursal.findFirstOrThrow()).id;
      seccionId = (await sembrarSeccion(sucursalId)).id;
      proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
      await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId, disponible: true } });
      expect((await agregarPresentacionAlternativa(productoId, unidadGId, 20)).ok).toBe(true);
    });

    const comprarEnLaPresentacion = async () => {
      const r = await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, proveedorId, items: [{ productoId, cantidad: 2, unidadCompraId: unidadGId, precioTotal: 100 }] });
      expect(r.ok, r.mensaje).toBe(true);
    };
    const factorGuardado = async () => Number((await prisma.presentacion.findFirstOrThrow({ where: { productoId, unidadCompraId: unidadGId } })).factorConversion);
    const auditoriasDelFactor = () => prisma.registroAuditoria.count({ where: { entidad: "Presentacion", campo: "factorConversion" } });

    it("ataque: después de comprar con la presentación (2 × 20 = 40 kg), subirle el factor a 25 se rechaza: el factor sigue en 20 y no se audita nada nuevo", async () => {
      await comprarEnLaPresentacion();
      expect(await prisma.movimientoStock.count({ where: { productoId } })).toBe(1);
      const auditoriasAntes = await auditoriasDelFactor();

      const r = await agregarPresentacionAlternativa(productoId, unidadGId, 25);

      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("ya se usó en compras");
      expect(r.mensaje).toContain("su factor de conversión no se puede cambiar");
      expect(await factorGuardado()).toBe(20);
      expect(await auditoriasDelFactor()).toBe(auditoriasAntes);
    });

    it("ataque: bajarlo (para que la compra siguiente meta menos) se rechaza igual", async () => {
      await comprarEnLaPresentacion();
      expect((await agregarPresentacionAlternativa(productoId, unidadGId, 1)).ok).toBe(false);
      expect(await factorGuardado()).toBe(20);
    });

    it("control: reactivarla con el MISMO factor sigue permitido aunque se haya usado", async () => {
      await comprarEnLaPresentacion();
      const presentacion = (await listarPresentaciones(productoId))[0];
      expect((await actualizarActivaPresentacion(presentacion.id, false)).ok).toBe(true);

      const r = await agregarPresentacionAlternativa(productoId, unidadGId, 20);

      expect(r.ok, r.mensaje).toBe(true);
      expect((await listarPresentaciones(productoId))[0].activa).toBe(true);
    });

    it("control: antes de usarse, el factor se sigue corrigiendo (la presentación se cargó con un error)", async () => {
      expect((await agregarPresentacionAlternativa(productoId, unidadGId, 25)).ok).toBe(true);
      expect(await factorGuardado()).toBe(25);
    });

    it("control: crear una presentación NUEVA (otra unidad de compra) sigue permitido aunque el producto ya tenga compras", async () => {
      await comprarEnLaPresentacion();
      const unidadCaja = await prisma.unidad.create({ data: { nombre: "caja", magnitud: "CANTIDAD", decimales: 0 } });
      const r = await agregarPresentacionAlternativa(productoId, unidadCaja.id, 12);
      expect(r.ok, r.mensaje).toBe(true);
      expect(await listarPresentaciones(productoId)).toHaveLength(2);
    });
  });

  it("actualizarActivaPresentacion la desactiva sin borrarla — sigue listada, ya no activa", async () => {
    await agregarPresentacionAlternativa(productoId, unidadGId, 20);
    const presentacion = (await listarPresentaciones(productoId))[0];

    const resultado = await actualizarActivaPresentacion(presentacion.id, false);
    expect(resultado.ok, resultado.mensaje).toBe(true);

    const presentaciones = await listarPresentaciones(productoId);
    expect(presentaciones).toHaveLength(1);
    expect(presentaciones[0].activa).toBe(false);
  });
});
