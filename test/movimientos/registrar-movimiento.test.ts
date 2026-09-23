import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { calcularSaldoTotal } from "../../src/core/movimientos/stock";

describe("registrarMovimiento", () => {
  let sucursalId: string;
  let seccionAId: string;
  let seccionBId: string;
  let unidadKgId: string;
  let unidadGId: string;
  let insumoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    unidadGId = catalogo.g.id;
    insumoId = catalogo.insumo.id;

    const seccionA = await sembrarSeccion(sucursalId, "Depósito A");
    const seccionB = await sembrarSeccion(sucursalId, "Depósito B");
    seccionAId = seccionA.id;
    seccionBId = seccionB.id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  async function crearMP(nombre: string, extra?: Partial<{ insumoId: string | null; esConsignacion: boolean; proveedorConsignacionId: string; precioConsignacion: number }>) {
    return prisma.producto.create({
      data: {
        codigo: `MP_${nombre.toUpperCase().replace(/\s/g, "_")}`,
        nombre,
        tipo: "MP",
        unidadStockId: unidadKgId,
        insumoId: extra?.insumoId ?? insumoId,
        esConsignacion: extra?.esConsignacion ?? false,
        proveedorConsignacionId: extra?.proveedorConsignacionId,
        precioConsignacion: extra?.precioConsignacion,
      },
    });
  }

  it("Compra suma stock (signoStock +1)", async () => {
    const mp = await crearMP("Harina");
    const resultado = await registrarMovimiento({
      proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId,
      items: [{ productoId: mp.id, cantidad: 10 }],
    });
    expect(resultado.ok).toBe(true);
    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(10);
  });

  it("Compra respeta la Presentación alternativa elegida, con su propio factor de conversión (no el default del producto)", async () => {
    const mp = await crearMP("Harina premium");
    // Presentación alternativa: "por caja" (unidadGId acá solo como id de
    // unidad distinto), 1 caja = 20kg — el default del producto es factor 1.
    const presentacion = await prisma.presentacion.create({
      data: { productoId: mp.id, unidadCompraId: unidadGId, factorConversion: 20 },
    });

    const resultado = await registrarMovimiento({
      proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId,
      items: [{ productoId: mp.id, cantidad: 2, unidadCompraId: presentacion.unidadCompraId }],
    });
    expect(resultado.ok, resultado.mensaje).toBe(true);
    // 2 cajas × 20kg/caja = 40kg de stock, no 2kg (que daría el factor default de 1).
    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(40);
  });

  it("Compra ignora un unidadCompraId que no es una Presentación real/activa de ese producto, y usa el factor default", async () => {
    const mp = await crearMP("Harina simple");
    const resultado = await registrarMovimiento({
      proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId,
      items: [{ productoId: mp.id, cantidad: 5, unidadCompraId: unidadGId }], // no existe ninguna Presentacion para este producto
    });
    expect(resultado.ok, resultado.mensaje).toBe(true);
    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(5);
  });

  it("Merma resta stock (signoStock -1) — el bug de v2.1.0 (Merma sin signo) no puede repetirse: el signo sale de un solo lugar (TRANSICIONES), no de una lista aparte", async () => {
    const mp = await crearMP("Tomate");
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mp.id, cantidad: 10 }] });

    const resultado = await registrarMovimiento({
      proceso: "MERMA", fecha: new Date(), seccionId: seccionAId, motivo: "VENCIDO",
      items: [{ productoId: mp.id, cantidad: 4 }],
    });
    expect(resultado.ok).toBe(true);
    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(6);
  });

  it("Ajuste: el usuario carga el delta ya con signo, no se multiplica por signoStock", async () => {
    const mp = await crearMP("Sal");
    // Ajuste, como Consumo/Merma, valida stock suficiente cuando el delta
    // es negativo (Movimientos.js:933-949: signo===0 && cantidad<0 también
    // acumula para validar) — hace falta stock previo para poder bajarlo.
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mp.id, cantidad: 8 }] });

    const bajaAjuste = await registrarMovimiento({ proceso: "AJUSTE", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mp.id, cantidad: -3 }] });
    expect(bajaAjuste.ok).toBe(true);
    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(5);

    const subeAjuste = await registrarMovimiento({ proceso: "AJUSTE", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mp.id, cantidad: 5 }] });
    expect(subeAjuste.ok).toBe(true);
    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(10);
  });

  it("sección obligatoria: rechaza Consumo/Merma/Ajuste sin sección elegida", async () => {
    const mp = await crearMP("Cebolla");
    const resultado = await registrarMovimiento({
      proceso: "CONSUMO", fecha: new Date(), seccionId: "", destino: "PERSONAL",
      items: [{ productoId: mp.id, cantidad: 1 }],
    });
    expect(resultado.ok).toBe(false);
  });

  it("no exige sección para Compra (da de alta stock nuevo)", async () => {
    const mp = await crearMP("Aceite");
    const resultado = await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mp.id, cantidad: 5 }] });
    expect(resultado.ok).toBe(true);
  });

  it("bugfix C-1: dos líneas del mismo payload pidiendo más del mismo producto+sección se validan JUNTAS, no una por una", async () => {
    const mp = await crearMP("Papa");
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mp.id, cantidad: 10 }] });

    // Dos líneas de 6 c/u contra un stock de 10: cada una por separado pasaría (6<=10), juntas piden 12 y no alcanza.
    const resultado = await registrarMovimiento({
      proceso: "MERMA", fecha: new Date(), seccionId: seccionAId, motivo: "ROTO_O_CAIDO",
      items: [{ productoId: mp.id, cantidad: 6 }, { productoId: mp.id, cantidad: 6 }],
    });
    expect(resultado.ok).toBe(false);

    // Ninguna fila parcial quedó escrita — el saldo sigue en 10, no en 4.
    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(10);
  });

  it("dos requests CONCURRENTES (no el mismo payload) nunca sobre-venden: aislamiento Serializable + reintento, equivalente real a conLock_", async () => {
    const mp = await crearMP("Limón");
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mp.id, cantidad: 10 }] });

    const [a, b] = await Promise.all([
      registrarMovimiento({ proceso: "MERMA", fecha: new Date(), seccionId: seccionAId, motivo: "ROTO_O_CAIDO", items: [{ productoId: mp.id, cantidad: 6 }] }),
      registrarMovimiento({ proceso: "MERMA", fecha: new Date(), seccionId: seccionAId, motivo: "ROTO_O_CAIDO", items: [{ productoId: mp.id, cantidad: 6 }] }),
    ]);

    // Juntas piden 12 sobre un stock de 10: como mucho una de las dos puede haber ganado la carrera.
    const exitos = [a, b].filter((r) => r.ok).length;
    expect(exitos).toBe(1);
    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(4);
  });

  it("Transferencia mueve stock entre 2 secciones sin cambiar el total global", async () => {
    const mp = await crearMP("Fideos");
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mp.id, cantidad: 10 }] });

    const resultado = await registrarMovimiento({
      proceso: "TRANSFERENCIA", fecha: new Date(), seccionId: seccionAId, seccionDestinoId: seccionBId,
      items: [{ productoId: mp.id, cantidad: 4 }],
    });
    expect(resultado.ok).toBe(true);
    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(6);
    expect(await calcularSaldoTotal(mp.id, seccionBId)).toBe(4);
  });

  it("Transferencia rechaza si la sección destino es la misma que el origen", async () => {
    const mp = await crearMP("Arroz");
    const resultado = await registrarMovimiento({
      proceso: "TRANSFERENCIA", fecha: new Date(), seccionId: seccionAId, seccionDestinoId: seccionAId,
      items: [{ productoId: mp.id, cantidad: 1 }],
    });
    expect(resultado.ok).toBe(false);
  });

  it("Compra rechaza la misma factura del mismo proveedor cargada dos veces", async () => {
    const mp = await crearMP("Queso");
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Lácteos SA" } });

    const primera = await registrarMovimiento({
      proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, proveedorId: proveedor.id, nroFactura: "A-001",
      items: [{ productoId: mp.id, cantidad: 5 }],
    });
    expect(primera.ok).toBe(true);

    const segunda = await registrarMovimiento({
      proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, proveedorId: proveedor.id, nroFactura: "A-001",
      items: [{ productoId: mp.id, cantidad: 5 }],
    });
    expect(segunda.ok).toBe(false);
  });

  it("Compra rechaza un número de factura de más de 60 caracteres, y no crea la Operacion", async () => {
    const mp = await crearMP("Harina");
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_LARGO", nombre: "Molino SA" } });

    const resultado = await registrarMovimiento({
      proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, proveedorId: proveedor.id, nroFactura: "A".repeat(61),
      items: [{ productoId: mp.id, cantidad: 5 }],
    });
    expect(resultado.ok).toBe(false);
    expect(await prisma.operacion.count({ where: { proveedorId: proveedor.id } })).toBe(0);
  });

  it("Compra con proveedor guarda referenciaProveedor en ProveedorPorProducto", async () => {
    // Necesita unidadCompraId propio: el hookup de ProveedorPorProducto solo
    // corre si armarLineaMovimiento resuelve una unidad de compra real
    // (aplicaFactorConversion), mismo requisito que ya tenía el hookup del
    // precio — sin esto la línea nunca llega a upsertProveedorPorProducto.
    const mp = await prisma.producto.create({
      data: { codigo: "MP_ACEITE", nombre: "Aceite", tipo: "MP", unidadStockId: unidadKgId, unidadCompraId: unidadKgId, insumoId },
    });
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_2", nombre: "Distribuidora del Sur" } });

    const resultado = await registrarMovimiento({
      proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, proveedorId: proveedor.id,
      items: [{ productoId: mp.id, cantidad: 10, precioTotal: 1000, referenciaProveedor: "ACE-5L" }],
    });
    expect(resultado.ok).toBe(true);

    const relacion = await prisma.proveedorPorProducto.findFirstOrThrow({ where: { productoId: mp.id, proveedorId: proveedor.id } });
    expect(relacion.referenciaProveedor).toBe("ACE-5L");
  });

  it("Compra aplica el factor de conversión de unidad de compra a unidad de stock", async () => {
    const g = await prisma.unidad.findFirst({ where: { nombre: "g" } });
    const mp = await prisma.producto.create({
      data: {
        codigo: "MP_MANTECA", nombre: "Manteca", tipo: "MP",
        unidadStockId: unidadKgId, unidadCompraId: g!.id, factorConversion: 0.001, insumoId,
      },
    });
    const resultado = await registrarMovimiento({
      proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId,
      items: [{ productoId: mp.id, cantidad: 500 }], // 500 g de unidad de compra
    });
    expect(resultado.ok).toBe(true);
    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBeCloseTo(0.5); // 500 * 0.001 kg
  });

  it("Producción reparte el consumo de receta entre \"hermanos\" del mismo Insumo cuando el puntual no alcanza", async () => {
    const insumoCompartido = await prisma.insumo.create({ data: { nombre: "Harina compartida" } });
    const mpA = await crearMP("Harina Proveedor A", { insumoId: insumoCompartido.id });
    const mpB = await crearMP("Harina Proveedor B", { insumoId: insumoCompartido.id });
    // resolverConsumoPorFamilia (P7, docs/plan-disponibilidad-por-sucursal-2026-09-23.md §5.3) exige que los "hermanos"
    // estén disponibles EN ESTA SUCURSAL para repartirles consumo — sin esto ninguno calificaría.
    await prisma.disponibilidadProducto.createMany({ data: [mpA.id, mpB.id].map((productoId) => ({ sucursalId, productoId, disponible: true })) });
    const pv = await prisma.producto.create({ data: { codigo: "PV_EMPANADA", nombre: "Empanada", tipo: "PV", unidadStockId: unidadKgId, seProduce: true } });

    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mpA.id, cantidad: 3 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mpB.id, cantidad: 10 }] });

    await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mpA.id, cantidad: 5, unidadId: unidadKgId, mermaPorcentaje: 0 }] } },
    });

    const resultado = await registrarMovimiento({
      proceso: "PRODUCCION", fecha: new Date(), seccionId: seccionAId,
      items: [{ productoId: pv.id, cantidad: 1 }],
    });
    expect(resultado.ok).toBe(true);

    const saldoA = await calcularSaldoTotal(mpA.id, seccionAId);
    const saldoB = await calcularSaldoTotal(mpB.id, seccionAId);
    expect(saldoA).toBeGreaterThanOrEqual(0);
    expect(saldoB).toBeGreaterThanOrEqual(0);
    expect(saldoA + saldoB).toBeCloseTo(3 + 10 - 5); // se consumieron 5kg en total entre ambos "hermanos"
    expect(await calcularSaldoTotal(pv.id, seccionAId)).toBe(1);
  });

  it("Producción de un insumo en consignación genera Consumo + Liquidación (cantidad 0, importe según precioConsignacion)", async () => {
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_CONS", nombre: "Consignante SA" } });
    const mpConsignacion = await crearMP("Café en consignación", { esConsignacion: true, proveedorConsignacionId: proveedor.id, precioConsignacion: 50 });
    const pv = await prisma.producto.create({ data: { codigo: "PV_CAFE", nombre: "Café con leche", tipo: "PV", unidadStockId: unidadKgId, seProduce: true } });

    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mpConsignacion.id, cantidad: 20 }] });
    await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mpConsignacion.id, cantidad: 2, unidadId: unidadKgId, mermaPorcentaje: 0 }] } },
    });

    const resultado = await registrarMovimiento({ proceso: "PRODUCCION", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: pv.id, cantidad: 1 }] });
    expect(resultado.ok).toBe(true);

    const liquidacion = await prisma.movimientoStock.findFirst({ where: { productoId: mpConsignacion.id, proceso: "LIQUIDACION_CONSIGNACION" } });
    expect(liquidacion).not.toBeNull();
    expect(Number(liquidacion!.cantidad)).toBe(0); // financiera pura, no vuelve a mover stock
    expect(Number(liquidacion!.precioTotal)).toBeCloseTo(2 * 50);
  });

  describe("Fase 6 (auditoría de seguridad/contratos): la sección tiene que ser de la sucursal de quien llama", () => {
    it("rechaza un seccionId de OTRA sucursal aunque el usuario tenga el permiso en la suya", async () => {
      const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Otra sucursal" } });
      const seccionAjena = await sembrarSeccion(otraSucursal.id, "Depósito ajeno");
      const mp = await crearMP("Harina ajena");

      const resultado = await registrarMovimiento({
        proceso: "COMPRA", fecha: new Date(), seccionId: seccionAjena.id,
        items: [{ productoId: mp.id, cantidad: 10 }],
      });

      expect(resultado.ok).toBe(false);
      expect(await calcularSaldoTotal(mp.id, seccionAjena.id)).toBe(0);
    });

    it("rechaza una sección destino de TRANSFERENCIA que sea de otra sucursal", async () => {
      const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Otra sucursal" } });
      const seccionAjena = await sembrarSeccion(otraSucursal.id, "Depósito ajeno");
      const mp = await crearMP("Harina para transferir");
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mp.id, cantidad: 10 }] });

      const resultado = await registrarMovimiento({
        proceso: "TRANSFERENCIA", fecha: new Date(), seccionId: seccionAId, seccionDestinoId: seccionAjena.id,
        items: [{ productoId: mp.id, cantidad: 5 }],
      });

      expect(resultado.ok).toBe(false);
      expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(10); // nada se movió
    });
  });
});
