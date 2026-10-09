import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { reclasificarStock } from "../../src/server/actions/stock/reclasificacion";
import { obtenerSaldoDisponibleParaReclasificar } from "../../src/server/actions/stock/lecturas-reclasificacion";
import { calcularSaldoPorLote, calcularSaldoTotal } from "../setup/saldo-de-seccion";

describe("reclasificarStock", () => {
  let sucursalId: string;
  let origenId: string;
  let destinoAId: string;
  let destinoBId: string;
  let unidadKgId: string;
  let insumoId: string;
  let mpId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    origenId = (await sembrarSeccion(sucursalId, "Origen")).id;
    destinoAId = (await sembrarSeccion(sucursalId, "Destino A")).id;
    destinoBId = (await sembrarSeccion(sucursalId, "Destino B")).id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Arroz", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    mpId = mp.id;
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: origenId, items: [{ productoId: mpId, cantidad: 10 }] });
  });

  it("reparte EXACTO el disponible entre 2 destinos, el origen queda en 0 y el total global no cambia", async () => {
    const resultado = await reclasificarStock({
      productoId: mpId,
      seccionOrigenId: origenId,
      destinos: [
        { seccionId: destinoAId, cantidad: 6 },
        { seccionId: destinoBId, cantidad: 4 },
      ],
      fecha: new Date(),
    });
    expect(resultado.ok).toBe(true);

    expect(await calcularSaldoTotal(mpId, origenId, prisma)).toBe(0);
    expect(await calcularSaldoTotal(mpId, destinoAId, prisma)).toBe(6);
    expect(await calcularSaldoTotal(mpId, destinoBId, prisma)).toBe(4);
  });

  // Task #32 (docs/pendientes-*.md): Reclasificación no tenía NINGÚN chequeo de decimales en los montos de destino — ni
  // siquiera redondeo — antes de sumarlos al Kardex. Ahora se RECHAZA un destino con más decimales de los que admite la unidad
  // de stock del producto, mismo criterio que Traspasos/Conteo Físico/Compra (src/core/datos/cantidad.ts).
  it("rechaza un destino con más decimales de los que admite la unidad de stock (antes no había NINGÚN chequeo)", async () => {
    const resultado = await reclasificarStock({
      productoId: mpId, seccionOrigenId: origenId, destinos: [{ seccionId: destinoAId, cantidad: 9.996 }], fecha: new Date(),
    });
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.mensaje).toContain("decimales");
    expect(await calcularSaldoTotal(mpId, origenId, prisma)).toBe(10); // nada se tocó
    expect(await calcularSaldoTotal(mpId, destinoAId, prisma)).toBe(0);
  });

  it("sigue aceptando destinos con los decimales exactos que admite la unidad", async () => {
    const resultado = await reclasificarStock({
      productoId: mpId, seccionOrigenId: origenId,
      destinos: [{ seccionId: destinoAId, cantidad: 6.25 }, { seccionId: destinoBId, cantidad: 3.75 }],
      fecha: new Date(),
    });
    expect(resultado.ok, resultado.ok ? "" : resultado.mensaje).toBe(true);
    expect(await calcularSaldoTotal(mpId, destinoAId, prisma)).toBe(6.25);
    expect(await calcularSaldoTotal(mpId, destinoBId, prisma)).toBe(3.75);
  });

  it("rechaza si la suma de los destinos no coincide exacto con el disponible (ni de más ni de menos)", async () => {
    const deMenos = await reclasificarStock({
      productoId: mpId, seccionOrigenId: origenId, destinos: [{ seccionId: destinoAId, cantidad: 5 }], fecha: new Date(),
    });
    expect(deMenos.ok).toBe(false);

    const deMas = await reclasificarStock({
      productoId: mpId, seccionOrigenId: origenId, destinos: [{ seccionId: destinoAId, cantidad: 15 }], fecha: new Date(),
    });
    expect(deMas.ok).toBe(false);

    // Nada se escribió: el saldo del origen sigue intacto.
    expect(await calcularSaldoTotal(mpId, origenId, prisma)).toBe(10);
  });

  it("rechaza si no hay saldo disponible en el origen", async () => {
    const resultado = await reclasificarStock({
      productoId: mpId, seccionOrigenId: destinoAId, destinos: [{ seccionId: destinoBId, cantidad: 1 }], fecha: new Date(),
    });
    expect(resultado.ok).toBe(false);
  });

  it("reclasifica por lote puntual sin tocar otros lotes del mismo producto+sección", async () => {
    const lote1 = new Date("2027-01-01");
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: origenId, items: [{ productoId: mpId, cantidad: 5, loteVencimiento: lote1 }] });

    const resultado = await reclasificarStock({
      productoId: mpId, seccionOrigenId: origenId, loteOrigen: lote1,
      destinos: [{ seccionId: destinoAId, cantidad: 5 }], fecha: new Date(),
    });
    expect(resultado.ok).toBe(true);

    expect(await calcularSaldoPorLote(mpId, origenId, lote1, prisma)).toBe(0);
    expect(await calcularSaldoPorLote(mpId, origenId, null, prisma)).toBe(10); // el lote "sin fecha" original, intacto
    expect(await calcularSaldoTotal(mpId, destinoAId, prisma)).toBe(5);
  });

  describe("obtenerSaldoDisponibleParaReclasificar (hallazgo de la auditoría: el form no mostraba el disponible antes de enviar)", () => {
    it("devuelve el saldo disponible en origen (sin lote)", async () => {
      expect(await obtenerSaldoDisponibleParaReclasificar(mpId, origenId, null)).toBe(10);
    });

    it("devuelve el saldo de un lote puntual, no el total del producto+sección", async () => {
      const lote1 = new Date("2027-01-01");
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: origenId, items: [{ productoId: mpId, cantidad: 5, loteVencimiento: lote1 }] });

      expect(await obtenerSaldoDisponibleParaReclasificar(mpId, origenId, lote1)).toBe(5);
      expect(await obtenerSaldoDisponibleParaReclasificar(mpId, origenId, null)).toBe(10);
    });

    it("devuelve null sin producto o sin sección origen todavía elegidos", async () => {
      expect(await obtenerSaldoDisponibleParaReclasificar("", origenId, null)).toBeNull();
      expect(await obtenerSaldoDisponibleParaReclasificar(mpId, "", null)).toBeNull();
    });
  });

  describe("destino idéntico al origen (hallazgo de la auditoría: generaba un par de movimientos sin efecto real)", () => {
    it("rechaza un único destino con la misma sección y el mismo lote (ambos sin lote) que el origen", async () => {
      const resultado = await reclasificarStock({
        productoId: mpId, seccionOrigenId: origenId, destinos: [{ seccionId: origenId, cantidad: 10 }], fecha: new Date(),
      });
      expect(resultado.ok).toBe(false);
      expect(await calcularSaldoTotal(mpId, origenId, prisma)).toBe(10); // nada se tocó
    });

    it("rechaza un único destino con la misma sección y el mismo lote puntual que el origen", async () => {
      const lote1 = new Date("2027-01-01");
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: origenId, items: [{ productoId: mpId, cantidad: 5, loteVencimiento: lote1 }] });

      const resultado = await reclasificarStock({
        productoId: mpId, seccionOrigenId: origenId, loteOrigen: lote1,
        destinos: [{ seccionId: origenId, loteVencimiento: lote1, cantidad: 5 }], fecha: new Date(),
      });
      expect(resultado.ok).toBe(false);
    });

    it("permite la misma sección si el lote destino es distinto (no es un no-op real)", async () => {
      const lote1 = new Date("2027-01-01");
      const resultado = await reclasificarStock({
        productoId: mpId, seccionOrigenId: origenId,
        destinos: [{ seccionId: origenId, loteVencimiento: lote1, cantidad: 10 }], fecha: new Date(),
      });
      expect(resultado.ok, resultado.mensaje).toBe(true);
      expect(await calcularSaldoPorLote(mpId, origenId, lote1, prisma)).toBe(10);
      expect(await calcularSaldoPorLote(mpId, origenId, null, prisma)).toBe(0);
    });

    it("permite repartir entre 2+ destinos aunque uno de ellos coincida con el origen", async () => {
      const resultado = await reclasificarStock({
        productoId: mpId, seccionOrigenId: origenId,
        destinos: [{ seccionId: origenId, cantidad: 4 }, { seccionId: destinoAId, cantidad: 6 }], fecha: new Date(),
      });
      expect(resultado.ok, resultado.mensaje).toBe(true);
    });
  });

  // Hallazgo post-cierre de Task #41 (2026-09-28, docs/pendientes-sesion-2026-09-27.md): reclasificarStock tiene I3
  // (claveIdempotencia en su comando desde M13d) pero nunca tuvo NINGÚN test de la clave — ni secuencial. Cerrado acá.
  describe("idempotencia (I3)", () => {
    it("un doble clic (misma claveIdempotencia) reclasifica UNA sola vez", async () => {
      const claveIdempotencia = crypto.randomUUID();
      const payload = { productoId: mpId, seccionOrigenId: origenId, destinos: [{ seccionId: destinoAId, cantidad: 10 }], fecha: new Date(), claveIdempotencia };

      const primero = await reclasificarStock(payload);
      expect(primero.ok, primero.mensaje).toBe(true);

      const segundo = await reclasificarStock(payload);
      expect(segundo.ok, segundo.mensaje).toBe(true);
      expect(segundo.mensaje).toBe(primero.mensaje);

      expect(await prisma.operacion.count({ where: { proceso: "RECLASIFICACION" } })).toBe(1);
      expect(await calcularSaldoTotal(mpId, destinoAId, prisma)).toBe(10); // no se duplicó el reparto
    });

    it("la misma clave con un payload distinto da conflicto, no una segunda reclasificación", async () => {
      const claveIdempotencia = crypto.randomUUID();
      const fecha = new Date();

      const primero = await reclasificarStock({
        productoId: mpId, seccionOrigenId: origenId,
        destinos: [{ seccionId: destinoAId, cantidad: 6 }, { seccionId: destinoBId, cantidad: 4 }], fecha, claveIdempotencia,
      });
      expect(primero.ok).toBe(true);

      const segundo = await reclasificarStock({
        productoId: mpId, seccionOrigenId: origenId, destinos: [{ seccionId: destinoAId, cantidad: 10 }], fecha, claveIdempotencia,
      });
      expect(segundo.ok).toBe(false);

      expect(await prisma.operacion.count({ where: { proceso: "RECLASIFICACION" } })).toBe(1);
    });

    // A diferencia de registrarPagoConsignante (M14, prisma.$transaction SIMPLE + catch de P2002), reclasificarStockCasoDeUso usa
    // conTransaccionSerializable (SERIALIZABLE + reintento genérico, mismo mecanismo que anularCompra): una carrera real sobre la
    // MISMA claveIdempotencia debería resolverse por reintento de la transacción entera, no por un catch puntual. Este test
    // demuestra que el resultado final es correcto de todos modos — exactamente una escritura, ninguna llamada rechaza.
    it("dos reclasificaciones SIMULTÁNEAS con la MISMA claveIdempotencia — exactamente una escribe, ninguna rechaza, las dos devuelven el mismo mensaje", async () => {
      for (let i = 0; i < 10; i++) {
        // Repone el saldo del origen para esta iteración: el `beforeEach` ya deja 10 antes de la primera vuelta, así que se lee
        // el disponible REAL en vez de asumir un número fijo (evita "la suma no coincide" por acumular de más).
        await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: origenId, items: [{ productoId: mpId, cantidad: 10 }] });
        const disponible = await calcularSaldoTotal(mpId, origenId, prisma);
        const claveIdempotencia = crypto.randomUUID();
        const payload = { productoId: mpId, seccionOrigenId: origenId, destinos: [{ seccionId: destinoAId, cantidad: disponible }], fecha: new Date(), claveIdempotencia };

        const settled = await Promise.allSettled([reclasificarStock(payload), reclasificarStock(payload)]);

        expect(settled.every((s) => s.status === "fulfilled"), `iteración ${i}: ninguna llamada debe rechazar: ${JSON.stringify(settled)}`).toBe(true);
        const resultados = settled.map((s) => (s.status === "fulfilled" ? s.value : { ok: false as const, mensaje: "rejected" }));
        expect(resultados.every((r) => r.ok), `iteración ${i}: las dos tienen que dar ok:true (una nueva, la otra idempotente): ${JSON.stringify(resultados)}`).toBe(true);
        expect(resultados[0].mensaje, `iteración ${i}: mismo mensaje en las dos`).toBe(resultados[1].mensaje);
      }

      expect(await prisma.operacion.count({ where: { proceso: "RECLASIFICACION" } })).toBe(10); // una por iteración, nunca el doble
      expect(await calcularSaldoTotal(mpId, origenId, prisma)).toBe(0); // sin sobras ni faltantes acumulados
    });
  });

  describe("Fase 6 (auditoría de seguridad/contratos): las secciones tienen que ser de la sucursal de quien llama", () => {
    it("rechaza un seccionOrigenId de OTRA sucursal", async () => {
      const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Otra sucursal" } });
      const seccionAjena = await sembrarSeccion(otraSucursal.id);

      const resultado = await reclasificarStock({
        productoId: mpId, seccionOrigenId: seccionAjena.id,
        destinos: [{ seccionId: destinoAId, cantidad: 10 }], fecha: new Date(),
      });

      expect(resultado.ok).toBe(false);
    });

    it("rechaza un destino de OTRA sucursal", async () => {
      const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Otra sucursal" } });
      const seccionAjena = await sembrarSeccion(otraSucursal.id);

      const resultado = await reclasificarStock({
        productoId: mpId, seccionOrigenId: origenId,
        destinos: [{ seccionId: seccionAjena.id, cantidad: 10 }], fecha: new Date(),
      });

      expect(resultado.ok).toBe(false);
      expect(await calcularSaldoTotal(mpId, origenId, prisma)).toBe(10); // nada se movió
    });

    it("obtenerSaldoDisponibleParaReclasificar devuelve null para una sección de OTRA sucursal", async () => {
      const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Otra sucursal" } });
      const seccionAjena = await sembrarSeccion(otraSucursal.id);

      const saldo = await obtenerSaldoDisponibleParaReclasificar(mpId, seccionAjena.id, null);
      expect(saldo).toBeNull();
    });
  });
});
