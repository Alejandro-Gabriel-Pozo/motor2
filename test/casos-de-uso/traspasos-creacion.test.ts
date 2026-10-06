import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { crearSolicitudDeTraspasoCasoDeUso } from "../../src/server/actions/traspasos/casos-de-uso/crear-solicitud-de-traspaso";
import { crearEnvioDirectoDeTraspasoCasoDeUso } from "../../src/server/actions/traspasos/casos-de-uso/crear-envio-directo-de-traspaso";
import { calcularSaldoTotal } from "../../src/core/movimientos/stock";

/**
 * Casos de uso de la CREACIÓN de un traspaso (src/server/actions/traspasos/casos-de-uso/; Task #41, Fase M11c): pedir (PULL) y enviar
 * directo (PUSH). Postgres real, sin mocks de base ni de sesión: el caso de uso recibe el actor ya resuelto (el permiso lo chequea
 * `conPermiso` en la Server Action, cubierta de punta a punta por test/traspasos/traspasos.test.ts, que no se tocó en su comportamiento).
 *
 * Un caso por cada código de resultado, verificando `datos`, los textos exactos de antes y lo que queda escrito (o que no se escribió
 * nada). El formato del comando (sucursal vacía, sección o producto que no son string) lo cubre
 * test/core/features/traspasos/traspaso-comandos-guard.test.ts.
 */
describe("casos de uso de la creación de un traspaso", () => {
  let sucursalAId: string; // quien actúa
  let sucursalBId: string; // la otra punta
  let seccionAId: string;
  let seccionBId: string;
  let adminAId: string;
  let kgId: string;
  let insumoId: string;

  const comoA = () => ({ usuarioId: adminAId, sucursalId: sucursalAId, sucursalNombre: "Central", ahora: new Date(), ...baseDeTest });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalAId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    kgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionAId = (await sembrarSeccion(sucursalAId, "Depósito A")).id;
    sucursalBId = (await prisma.sucursal.create({ data: { nombre: "Sucursal B" } })).id;
    seccionBId = (await sembrarSeccion(sucursalBId, "Depósito B")).id;
    adminAId = (await crearUsuarioConMembresia({ email: "admin-a@test.com", sucursalId: sucursalAId, rolId: base.admin.id })).id;
  });

  /** Producto (kg, 2 decimales) con `stock` kg en la sección A, disponible en las sucursales dadas. */
  async function producto(stock: number, disponibleEn: string[] = [sucursalAId, sucursalBId], nombre = "Harina") {
    const mp = await prisma.producto.create({ data: { codigo: `MP_${Math.random().toString(36).slice(2, 8)}`, nombre, tipo: "MP", unidadStockId: kgId, insumoId } });
    if (disponibleEn.length) {
      await prisma.disponibilidadProducto.createMany({ data: disponibleEn.map((sucursalId) => ({ sucursalId, productoId: mp.id, disponible: true })) });
    }
    if (stock) {
      const op = await prisma.operacion.create({ data: { sucursalId: sucursalAId, proceso: "COMPRA", fecha: new Date(), usuarioId: adminAId } });
      await prisma.movimientoStock.create({
        data: { operacionId: op.id, productoId: mp.id, seccionId: seccionAId, proceso: "COMPRA", cantidad: stock, detalle: "Compra", precioTotal: 0, precioPorUnidadStock: 0 },
      });
    }
    return mp;
  }

  async function nadaEscrito() {
    expect(await prisma.traspasoSucursal.count()).toBe(0);
    expect(await prisma.operacion.count({ where: { proceso: "TRANSFERENCIA_SALIDA_SUCURSAL" } })).toBe(0);
  }

  describe("crearSolicitudDeTraspasoCasoDeUso (PULL: A le pide a B)", () => {
    const comando = (productoId: string, extra: Partial<{ cantidad: unknown; seccionDestinoId: string; origenSucursalId: string }> = {}) => ({
      origenSucursalId: sucursalBId,
      productoId,
      cantidad: 3,
      seccionDestinoId: seccionAId,
      detalle: "Para el fin de semana",
      ...extra,
    });

    it("éxito: datos, mensaje y traspaso SOLICITADO sin tocar stock (como antes)", async () => {
      const mp = await producto(0);

      const r = await crearSolicitudDeTraspasoCasoDeUso(comoA(), comando(mp.id));

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.mensaje).toBe('Solicitud enviada a "Sucursal B".');
      const t = await prisma.traspasoSucursal.findFirstOrThrow();
      expect(r.datos).toEqual({ traspasoId: t.id, productoNombre: "Harina" });
      expect(t).toMatchObject({
        origenSucursalId: sucursalBId,
        destinoSucursalId: sucursalAId,
        productoId: mp.id,
        seccionDestinoId: seccionAId,
        seccionOrigenId: null,
        iniciadoPor: "DESTINO",
        estado: "SOLICITADA",
        creadoPorId: adminAId,
        detalle: "Para el fin de semana",
        fechaDecisionOrigen: null,
      });
      expect(Number(t.cantidad)).toBe(3);
      expect(await prisma.movimientoStock.count({ where: { traspasoSucursalId: t.id } })).toBe(0);
    });

    it("MISMA_SUCURSAL: no se puede pedir a sí misma", async () => {
      const mp = await producto(0);
      const r = await crearSolicitudDeTraspasoCasoDeUso(comoA(), comando(mp.id, { origenSucursalId: sucursalAId }));
      expect(r).toMatchObject({ ok: false, codigo: "MISMA_SUCURSAL", mensaje: "No podés pedirte una transferencia a vos mismo." });
      await nadaEscrito();
    });

    it("SUCURSAL_NO_DISPONIBLE: inexistente o inactiva", async () => {
      const mp = await producto(0);
      const r1 = await crearSolicitudDeTraspasoCasoDeUso(comoA(), comando(mp.id, { origenSucursalId: "no-existe" }));
      expect(r1).toMatchObject({ ok: false, codigo: "SUCURSAL_NO_DISPONIBLE", mensaje: "Esa sucursal no existe o no está activa." });
      await prisma.sucursal.update({ where: { id: sucursalBId }, data: { activo: false } });
      const r2 = await crearSolicitudDeTraspasoCasoDeUso(comoA(), comando(mp.id));
      expect(r2).toMatchObject({ ok: false, codigo: "SUCURSAL_NO_DISPONIBLE", mensaje: "Esa sucursal no existe o no está activa." });
      await nadaEscrito();
    });

    it("SECCION_NO_PROPIA: la sección de destino es de la otra sucursal", async () => {
      const mp = await producto(0);
      const r = await crearSolicitudDeTraspasoCasoDeUso(comoA(), comando(mp.id, { seccionDestinoId: seccionBId }));
      expect(r).toMatchObject({ ok: false, codigo: "SECCION_NO_PROPIA", mensaje: "Elegí a qué sección propia tiene que entrar." });
      await nadaEscrito();
    });

    it("PRODUCTO_NO_TRANSFERIBLE: inexistente, o no disponible en la sucursal a la que se le pide", async () => {
      const r1 = await crearSolicitudDeTraspasoCasoDeUso(comoA(), comando("no-existe"));
      expect(r1).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_TRANSFERIBLE", mensaje: "El producto no existe." });
      const mp = await producto(0, [sucursalAId]);
      const r2 = await crearSolicitudDeTraspasoCasoDeUso(comoA(), comando(mp.id));
      expect(r2).toMatchObject({
        ok: false,
        codigo: "PRODUCTO_NO_TRANSFERIBLE",
        mensaje: "«Harina» no está disponible en «Sucursal B»: activalo allá antes de enviar.",
      });
      await nadaEscrito();
    });

    it("CANTIDAD_INVALIDA: más decimales de los que admite la unidad se rechaza, no se redondea", async () => {
      const mp = await producto(0);
      const r = await crearSolicitudDeTraspasoCasoDeUso(comoA(), comando(mp.id, { cantidad: 2.555 }));
      expect(r).toMatchObject({ ok: false, codigo: "CANTIDAD_INVALIDA", mensaje: 'La cantidad de "Harina" admite como máximo 2 decimales (unidad "kg").' });
      await nadaEscrito();
    });
  });

  describe("crearEnvioDirectoDeTraspasoCasoDeUso (PUSH: A le manda a B)", () => {
    const comando = (productoId: string, extra: Partial<{ cantidad: unknown; seccionOrigenId: string; destinoSucursalId: string }> = {}) => ({
      destinoSucursalId: sucursalBId,
      productoId,
      cantidad: 4,
      seccionOrigenId: seccionAId,
      detalle: null,
      ...extra,
    });

    it("éxito: datos, mensaje, traspaso ENVIADO y SALIDA en el Kardex de origen (como antes)", async () => {
      const mp = await producto(10);

      const r = await crearEnvioDirectoDeTraspasoCasoDeUso(comoA(), comando(mp.id));

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.mensaje).toBe('Enviado a "Sucursal B". Se descontó 4 kg de "Harina" en "Depósito A".');
      const t = await prisma.traspasoSucursal.findFirstOrThrow();
      const operacion = await prisma.operacion.findFirstOrThrow({ where: { proceso: "TRANSFERENCIA_SALIDA_SUCURSAL" }, include: { movimientos: true } });
      expect(r.datos).toEqual({ traspasoId: t.id, productoNombre: "Harina", operacionId: operacion.id, seccionOrigenId: seccionAId, cantidad: 4 });
      expect(t).toMatchObject({
        origenSucursalId: sucursalAId,
        destinoSucursalId: sucursalBId,
        seccionOrigenId: seccionAId,
        seccionDestinoId: null,
        iniciadoPor: "ORIGEN",
        estado: "ENVIADA",
        creadoPorId: adminAId,
        decididoPorOrigenId: adminAId,
        detalle: null,
      });
      expect(t.fechaDecisionOrigen).not.toBeNull();
      expect(operacion).toMatchObject({ sucursalId: sucursalAId, usuarioId: adminAId, claveIdempotencia: null, payloadHash: null });
      expect(operacion.movimientos).toHaveLength(1);
      expect(operacion.movimientos[0]).toMatchObject({ seccionId: seccionAId, productoId: mp.id, traspasoSucursalId: t.id, detalle: 'Transferencia a sucursal "Sucursal B".' });
      expect(Number(operacion.movimientos[0].cantidad)).toBe(-4);
      expect(await calcularSaldoTotal(mp.id, seccionAId, prisma)).toBe(6);
    });

    it("STOCK_INSUFICIENTE: el mismo texto de antes y nada escrito", async () => {
      const mp = await producto(3);
      const r = await crearEnvioDirectoDeTraspasoCasoDeUso(comoA(), comando(mp.id));
      expect(r).toMatchObject({ ok: false, codigo: "STOCK_INSUFICIENTE", mensaje: 'Stock insuficiente de "Harina" en "Depósito A". Actual: 3, requerido: 4.' });
      await nadaEscrito();
      expect(await calcularSaldoTotal(mp.id, seccionAId, prisma)).toBe(3);
    });

    it("CANTIDAD_INVALIDA se chequea ANTES que el stock (el error nombra la cantidad tecleada)", async () => {
      const mp = await producto(0);
      const r = await crearEnvioDirectoDeTraspasoCasoDeUso(comoA(), comando(mp.id, { cantidad: 2.555 }));
      expect(r).toMatchObject({ ok: false, codigo: "CANTIDAD_INVALIDA", mensaje: 'La cantidad de "Harina" admite como máximo 2 decimales (unidad "kg").' });
      await nadaEscrito();
    });

    it("MISMA_SUCURSAL, SUCURSAL_NO_DISPONIBLE, SECCION_NO_PROPIA y PRODUCTO_NO_TRANSFERIBLE, con los textos de antes", async () => {
      const mp = await producto(10);
      expect(await crearEnvioDirectoDeTraspasoCasoDeUso(comoA(), comando(mp.id, { destinoSucursalId: sucursalAId }))).toMatchObject({
        ok: false,
        codigo: "MISMA_SUCURSAL",
        mensaje: "No podés mandarte una transferencia a vos mismo.",
      });
      expect(await crearEnvioDirectoDeTraspasoCasoDeUso(comoA(), comando(mp.id, { destinoSucursalId: "no-existe" }))).toMatchObject({
        ok: false,
        codigo: "SUCURSAL_NO_DISPONIBLE",
        mensaje: "Esa sucursal no existe o no está activa.",
      });
      expect(await crearEnvioDirectoDeTraspasoCasoDeUso(comoA(), comando(mp.id, { seccionOrigenId: seccionBId }))).toMatchObject({
        ok: false,
        codigo: "SECCION_NO_PROPIA",
        mensaje: "Elegí de qué sección propia sale.",
      });
      const soloEnA = await producto(10, [sucursalAId], "Azúcar");
      expect(await crearEnvioDirectoDeTraspasoCasoDeUso(comoA(), comando(soloEnA.id))).toMatchObject({
        ok: false,
        codigo: "PRODUCTO_NO_TRANSFERIBLE",
        mensaje: "«Azúcar» no está disponible en «Sucursal B»: activalo allá antes de enviar.",
      });
      await nadaEscrito();
    });

    it("dos envíos simultáneos que juntos superan el stock: la transacción serializable deja pasar uno solo", async () => {
      const mp = await producto(5);

      const resultados = await Promise.all([crearEnvioDirectoDeTraspasoCasoDeUso(comoA(), comando(mp.id)), crearEnvioDirectoDeTraspasoCasoDeUso(comoA(), comando(mp.id))]);

      expect(resultados.filter((r) => r.ok)).toHaveLength(1);
      expect(resultados.find((r) => !r.ok)).toMatchObject({ codigo: "STOCK_INSUFICIENTE", mensaje: 'Stock insuficiente de "Harina" en "Depósito A". Actual: 1, requerido: 4.' });
      expect(await prisma.traspasoSucursal.count()).toBe(1);
      expect(await calcularSaldoTotal(mp.id, seccionAId, prisma)).toBe(1);
    });
  });
});
