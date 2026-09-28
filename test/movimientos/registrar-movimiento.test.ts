import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, sembrarMotivosYDestinos, crearUsuarioConMembresia, prisma } from "../setup/test-db";
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
  let motivoVencidoId: string;
  let motivoRotoId: string;
  let destinoPersonalId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    unidadGId = catalogo.g.id;
    insumoId = catalogo.insumo.id;
    const { motivos, destinos } = await sembrarMotivosYDestinos();
    motivoVencidoId = motivos.get("Vencido")!;
    motivoRotoId = motivos.get("Roto o caído")!;
    destinoPersonalId = destinos.get("Personal")!;

    const seccionA = await sembrarSeccion(sucursalId, "Depósito A");
    const seccionB = await sembrarSeccion(sucursalId, "Depósito B");
    seccionAId = seccionA.id;
    seccionBId = seccionB.id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  async function crearMP(nombre: string, extra?: Partial<{ insumoId: string | null; esConsignacion: boolean; proveedorConsignacionId: string; precioConsignacion: number }>) {
    return sembrarProductoDisponible(
      {
        codigo: `MP_${nombre.toUpperCase().replace(/\s/g, "_")}`,
        nombre,
        tipo: "MP",
        unidadStockId: unidadKgId,
        insumoId: extra?.insumoId ?? insumoId,
        esConsignacion: extra?.esConsignacion ?? false,
        proveedorConsignacionId: extra?.proveedorConsignacionId,
        precioConsignacion: extra?.precioConsignacion,
      },
      sucursalId
    );
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

  it("rechaza un producto no disponible en esta sucursal (docs/plan-disponibilidad-por-sucursal-2026-09-23.md §5.4)", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_OTRA", nombre: "Solo en otra sucursal", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    // Sin fila DisponibilidadProducto en sucursalId: "fila ausente = no disponible".
    const resultado = await registrarMovimiento({
      proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId,
      items: [{ productoId: mp.id, cantidad: 10 }],
    });
    expect(resultado.ok).toBe(false);
    expect(resultado.mensaje).toContain("no está disponible en");
    expect(await prisma.movimientoStock.count({ where: { productoId: mp.id } })).toBe(0);
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
      proceso: "MERMA", fecha: new Date(), seccionId: seccionAId, motivoId: motivoVencidoId,
      items: [{ productoId: mp.id, cantidad: 4 }],
    });
    expect(resultado.ok).toBe(true);
    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(6);
  });

  it("Merma rechaza un motivoId que no existe, y uno que existe pero está desactivado — el mensaje no revienta como error 500 crudo", async () => {
    const mp = await crearMP("Zanahoria");
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mp.id, cantidad: 10 }] });

    const inexistente = await registrarMovimiento({
      proceso: "MERMA", fecha: new Date(), seccionId: seccionAId, motivoId: "no-existe",
      items: [{ productoId: mp.id, cantidad: 1 }],
    });
    expect(inexistente.ok).toBe(false);
    expect(inexistente.mensaje).toBe("El motivo elegido ya no está disponible.");

    await prisma.motivoMerma.update({ where: { id: motivoVencidoId }, data: { activo: false } });
    const desactivado = await registrarMovimiento({
      proceso: "MERMA", fecha: new Date(), seccionId: seccionAId, motivoId: motivoVencidoId,
      items: [{ productoId: mp.id, cantidad: 1 }],
    });
    expect(desactivado.ok).toBe(false);
    expect(desactivado.mensaje).toBe("El motivo elegido ya no está disponible.");

    // El saldo no se movió: ninguno de los dos rechazos escribió nada.
    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(10);
  });

  it("Consumo rechaza un destinoId que no existe o que está desactivado, igual que Merma con motivoId", async () => {
    const mp = await crearMP("Apio");
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mp.id, cantidad: 10 }] });

    const inexistente = await registrarMovimiento({
      proceso: "CONSUMO", fecha: new Date(), seccionId: seccionAId, destinoId: "no-existe",
      items: [{ productoId: mp.id, cantidad: 1 }],
    });
    expect(inexistente.ok).toBe(false);
    expect(inexistente.mensaje).toBe("El destino elegido ya no está disponible.");

    await prisma.destinoConsumo.update({ where: { id: destinoPersonalId }, data: { activo: false } });
    const desactivado = await registrarMovimiento({
      proceso: "CONSUMO", fecha: new Date(), seccionId: seccionAId, destinoId: destinoPersonalId,
      items: [{ productoId: mp.id, cantidad: 1 }],
    });
    expect(desactivado.ok).toBe(false);
    expect(desactivado.mensaje).toBe("El destino elegido ya no está disponible.");

    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(10);
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
      proceso: "CONSUMO", fecha: new Date(), seccionId: "", destinoId: destinoPersonalId,
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
      proceso: "MERMA", fecha: new Date(), seccionId: seccionAId, motivoId: motivoRotoId,
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
      registrarMovimiento({ proceso: "MERMA", fecha: new Date(), seccionId: seccionAId, motivoId: motivoRotoId, items: [{ productoId: mp.id, cantidad: 6 }] }),
      registrarMovimiento({ proceso: "MERMA", fecha: new Date(), seccionId: seccionAId, motivoId: motivoRotoId, items: [{ productoId: mp.id, cantidad: 6 }] }),
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
    const mp = await sembrarProductoDisponible(
      { codigo: "MP_ACEITE", nombre: "Aceite", tipo: "MP", unidadStockId: unidadKgId, unidadCompraId: unidadKgId, insumoId },
      sucursalId
    );
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
    const mp = await sembrarProductoDisponible(
      {
        codigo: "MP_MANTECA", nombre: "Manteca", tipo: "MP",
        unidadStockId: unidadKgId, unidadCompraId: g!.id, factorConversion: 0.001, insumoId,
      },
      sucursalId
    );
    const resultado = await registrarMovimiento({
      proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId,
      items: [{ productoId: mp.id, cantidad: 500 }], // 500 g de unidad de compra
    });
    expect(resultado.ok).toBe(true);
    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBeCloseTo(0.5); // 500 * 0.001 kg
  });

  it("Producción rechaza una MP que no está marcada \"Se produce\" (hallazgo real 2026-09-23: antes dejaba \"producir\" cualquier MP comprada, sin consumir ninguna receta)", async () => {
    const harinaComprada = await crearMP("Harina de bolsa"); // seProduce: false por default
    const resultado = await registrarMovimiento({
      proceso: "PRODUCCION", fecha: new Date(), seccionId: seccionAId,
      items: [{ productoId: harinaComprada.id, cantidad: 10 }],
    });
    expect(resultado.ok).toBe(false);
    expect(await calcularSaldoTotal(harinaComprada.id, seccionAId)).toBe(0); // no se escribió nada
  });

  it("Producción reparte el consumo de receta entre \"hermanos\" del mismo Insumo cuando el puntual no alcanza", async () => {
    const insumoCompartido = await prisma.insumo.create({ data: { nombre: "Harina compartida" } });
    const mpA = await crearMP("Harina Proveedor A", { insumoId: insumoCompartido.id });
    const mpB = await crearMP("Harina Proveedor B", { insumoId: insumoCompartido.id });
    // resolverConsumoPorFamilia (P7, docs/plan-disponibilidad-por-sucursal-2026-09-23.md §5.3) exige que los "hermanos"
    // estén disponibles EN ESTA SUCURSAL para repartirles consumo — crearMP ya lo hace (sembrarProductoDisponible).
    const pv = await sembrarProductoDisponible({ codigo: "PV_EMPANADA", nombre: "Empanada", tipo: "PV", unidadStockId: unidadKgId, seProduce: true }, sucursalId);

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
    const pv = await sembrarProductoDisponible({ codigo: "PV_CAFE", nombre: "Café con leche", tipo: "PV", unidadStockId: unidadKgId, seProduce: true }, sucursalId);

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

  describe("M13c: el guard de comando (guardComandoRegistrarMovimiento) frena un proceso que no es de este motor, aunque ACCION_POR_PROCESO ya haya elegido un permiso real para él", () => {
    it('un payload armado a mano con proceso: "VENTA" no cuela: antes de este guard, ACCION_POR_PROCESO.VENTA resuelve a "proceso_venta" (que el admin de este test SÍ tiene) y conPermiso lo dejaba pasar — nada, DENTRO de la acción, frenaba después un proceso ajeno (confirmado leyendo movimientos.ts antes de este cambio: las 4 validaciones en línea nunca miraban el proceso en sí)', async () => {
      const mp = await crearMP("Cerveza");
      const resultado = await registrarMovimiento({
        proceso: "VENTA", fecha: new Date(), seccionId: seccionAId,
        items: [{ productoId: mp.id, cantidad: 1 }],
      } as unknown as Parameters<typeof registrarMovimiento>[0]);

      expect(resultado).toEqual({ ok: false, mensaje: 'Proceso "VENTA" no se registra con esta acción.' });
      expect(await prisma.operacion.count()).toBe(0);
    });

    it('lo mismo con proceso: "CONTROL" (Conteo Físico, ACCION_POR_PROCESO.CONTROL -> "proceso_control")', async () => {
      const mp = await crearMP("Gaseosa");
      const resultado = await registrarMovimiento({
        proceso: "CONTROL", fecha: new Date(), seccionId: seccionAId,
        items: [{ productoId: mp.id, cantidad: 1 }],
      } as unknown as Parameters<typeof registrarMovimiento>[0]);

      expect(resultado).toEqual({ ok: false, mensaje: 'Proceso "CONTROL" no se registra con esta acción.' });
      expect(await prisma.operacion.count()).toBe(0);
    });
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

  // docs/plan-validacion-de-datos-2026-09-25.md, Paso C1: Compra y Devolución a proveedor (los dos procesos con aplicaFactorConversion)
  // validan cantidad, precio total, peso real y N.º de factura con src/core/datos. Antes: un precio NaN o negativo se guardaba como 0
  // sin aviso, una línea con cantidad basura (o 0) se descartaba en silencio y 2,5 en una unidad entera se redondeaba a 3.
  describe("Compra / Devolución a proveedor: validación de datos de entrada (src/core/datos)", () => {
    async function compra(items: Parameters<typeof registrarMovimiento>[0]["items"], extra?: { nroFactura?: string; proveedorId?: string }) {
      return registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items, ...extra });
    }

    it("precioTotal NaN → error, sin Operacion (antes se guardaba 0 sin aviso)", async () => {
      const mp = await crearMP("Harina");
      const resultado = await compra([{ productoId: mp.id, cantidad: 10, precioTotal: Number.NaN }]);
      expect(resultado).toEqual({ ok: false, mensaje: 'El precio de "Harina" no es un número válido.' });
      expect(await prisma.operacion.count()).toBe(0);
    });

    it("precioTotal negativo → error, sin Operacion (antes se guardaba 0 sin aviso)", async () => {
      const mp = await crearMP("Harina");
      const resultado = await compra([{ productoId: mp.id, cantidad: 10, precioTotal: -5 }]);
      expect(resultado).toEqual({ ok: false, mensaje: 'El precio de "Harina" no puede ser negativo.' });
      expect(await prisma.operacion.count()).toBe(0);
    });

    it("precioTotal con más de 2 decimales (10.555) → error, sin Operacion", async () => {
      const mp = await crearMP("Harina");
      const resultado = await compra([{ productoId: mp.id, cantidad: 10, precioTotal: 10.555 }]);
      expect(resultado).toEqual({ ok: false, mensaje: 'El precio de "Harina" admite como máximo 2 decimales.' });
      expect(await prisma.operacion.count()).toBe(0);
    });

    it("dos líneas, una con cantidad NaN → error con el nombre del producto (antes se descartaba esa línea y se guardaba la otra)", async () => {
      const harina = await crearMP("Harina");
      const azucar = await crearMP("Azúcar");
      const resultado = await compra([
        { productoId: harina.id, cantidad: 10, precioTotal: 100 },
        { productoId: azucar.id, cantidad: Number.NaN, precioTotal: 50 },
      ]);
      expect(resultado).toEqual({ ok: false, mensaje: 'La cantidad de "Azúcar" no es un número válido.' });
      expect(await prisma.operacion.count()).toBe(0);
      expect(await prisma.movimientoStock.count()).toBe(0);
    });

    it("2,5 en una unidad de 0 decimales → error (antes se redondeaba y se guardaba 3)", async () => {
      const mp = await sembrarProductoDisponible(
        { codigo: "MP_HUEVO", nombre: "Huevo", tipo: "MP", unidadStockId: unidadGId, insumoId },
        sucursalId
      );
      const resultado = await compra([{ productoId: mp.id, cantidad: 2.5 }]);
      expect(resultado).toEqual({ ok: false, mensaje: 'La cantidad de "Huevo" tiene que ser un número entero (la unidad "g" no admite decimales).' });
      expect(await prisma.movimientoStock.count()).toBe(0);
    });

    it("los decimales se miden en la unidad de COMPRA (la de la presentación elegida), no en la de stock", async () => {
      const mp = await crearMP("Harina en caja"); // stock en kg (2 decimales)
      const presentacion = await prisma.presentacion.create({ data: { productoId: mp.id, unidadCompraId: unidadGId, factorConversion: 20 } }); // "g" = 0 decimales
      const resultado = await compra([{ productoId: mp.id, cantidad: 1.5, unidadCompraId: presentacion.unidadCompraId }]);
      expect(resultado).toEqual({ ok: false, mensaje: 'La cantidad de "Harina en caja" tiene que ser un número entero (la unidad "g" no admite decimales).' });
      expect(await prisma.movimientoStock.count()).toBe(0);
    });

    it("cantidad 0 en una Compra → error (decisión del dueño: se rechaza, no se saltea en silencio)", async () => {
      const harina = await crearMP("Harina");
      const azucar = await crearMP("Azúcar");
      const resultado = await compra([
        { productoId: harina.id, cantidad: 10 },
        { productoId: azucar.id, cantidad: 0 },
      ]);
      expect(resultado).toEqual({ ok: false, mensaje: 'La cantidad de "Azúcar" tiene que ser mayor que cero.' });
      expect(await prisma.operacion.count()).toBe(0);
    });

    it("peso real negativo o NaN → error (antes se ignoraba sin aviso y se usaba el factor)", async () => {
      const mp = await crearMP("Carne");
      const negativo = await compra([{ productoId: mp.id, cantidad: 1, pesoReal: -1 }]);
      expect(negativo).toEqual({ ok: false, mensaje: 'El peso real de "Carne" tiene que ser mayor que cero.' });
      const nan = await compra([{ productoId: mp.id, cantidad: 1, pesoReal: Number.NaN }]);
      expect(nan).toEqual({ ok: false, mensaje: 'El peso real de "Carne" no es un número válido.' });
      const cero = await compra([{ productoId: mp.id, cantidad: 1, pesoReal: 0 }]);
      expect(cero).toEqual({ ok: false, mensaje: 'El peso real de "Carne" tiene que ser mayor que cero.' });
      expect(await prisma.operacion.count()).toBe(0);
    });

    it("peso real válido se usa como cantidad de stock; vacío (null) sigue sin peso real", async () => {
      const mp = await crearMP("Carne");
      expect((await compra([{ productoId: mp.id, cantidad: 1, pesoReal: 2.35 }])).ok).toBe(true);
      expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(2.35);
      expect((await compra([{ productoId: mp.id, cantidad: 1, pesoReal: null }])).ok).toBe(true);
      expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(3.35);
    });

    it("N.º de factura sin ninguna letra ni número ('---') → error, sin Operacion", async () => {
      const mp = await crearMP("Harina");
      const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_GUION", nombre: "Molino SA" } });
      const resultado = await compra([{ productoId: mp.id, cantidad: 5 }], { proveedorId: proveedor.id, nroFactura: "---" });
      expect(resultado).toEqual({ ok: false, mensaje: "El número de factura tiene que tener al menos una letra o un número." });
      expect(await prisma.operacion.count()).toBe(0);
    });

    it("N.º de factura: 60 caracteres pasa; 61 da el mismo mensaje de siempre; se guarda recortado", async () => {
      const mp = await crearMP("Harina");
      const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_60", nombre: "Molino SA" } });
      const largo = await compra([{ productoId: mp.id, cantidad: 5 }], { proveedorId: proveedor.id, nroFactura: "A".repeat(61) });
      expect(largo).toEqual({ ok: false, mensaje: "El número de factura no puede superar los 60 caracteres." });
      const justo = await compra([{ productoId: mp.id, cantidad: 5 }], { proveedorId: proveedor.id, nroFactura: `  ${"B".repeat(60)}  ` });
      expect(justo.ok, justo.mensaje).toBe(true);
      expect((await prisma.operacion.findFirstOrThrow()).nroFactura).toBe("B".repeat(60));
    });

    it("precioTotal vacío → se guarda 0 (una compra sin precio sigue permitida); precioTotal 0 → 0", async () => {
      const mp = await crearMP("Harina");
      expect((await compra([{ productoId: mp.id, cantidad: 5 }])).ok).toBe(true);
      expect((await compra([{ productoId: mp.id, cantidad: 5, precioTotal: 0 }])).ok).toBe(true);
      const filas = await prisma.movimientoStock.findMany({ where: { productoId: mp.id } });
      expect(filas.map((f) => Number(f.precioTotal))).toEqual([0, 0]);
    });

    it("precioTotal válido con 2 decimales se guarda tal cual", async () => {
      const mp = await crearMP("Harina");
      expect((await compra([{ productoId: mp.id, cantidad: 3, precioTotal: 1234.56 }])).ok).toBe(true);
      expect(Number((await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: mp.id } })).precioTotal)).toBe(1234.56);
    });

    it("Devolución a proveedor usa las mismas reglas (decisión del dueño): precio NaN → error, no 0", async () => {
      const mp = await crearMP("Harina");
      expect((await compra([{ productoId: mp.id, cantidad: 10 }])).ok).toBe(true);
      const resultado = await registrarMovimiento({
        proceso: "DEVOLUCION_PROVEEDOR", fecha: new Date(), seccionId: seccionAId,
        items: [{ productoId: mp.id, cantidad: 2, precioTotal: Number.NaN }],
      });
      expect(resultado).toEqual({ ok: false, mensaje: 'El precio de "Harina" no es un número válido.' });
      expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(10);
    });

    it("los procesos sin aplicaFactorConversion no cambian: una línea de Merma con cantidad 0 se sigue salteando", async () => {
      const harina = await crearMP("Harina");
      const azucar = await crearMP("Azúcar");
      await compra([{ productoId: harina.id, cantidad: 10 }, { productoId: azucar.id, cantidad: 10 }]);
      const resultado = await registrarMovimiento({
        proceso: "MERMA", fecha: new Date(), seccionId: seccionAId, motivoId: motivoVencidoId,
        items: [{ productoId: harina.id, cantidad: 2 }, { productoId: azucar.id, cantidad: 0 }],
      });
      expect(resultado.ok, resultado.mensaje).toBe(true);
      expect(await calcularSaldoTotal(harina.id, seccionAId)).toBe(8);
      expect(await calcularSaldoTotal(azucar.id, seccionAId)).toBe(10);
    });
  });
});
