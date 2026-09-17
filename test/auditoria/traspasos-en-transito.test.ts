import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pruebas de investigación de la auditoría 2026-09-16 (Fase 4, "traspasos
 * en tránsito"). Solo investigación — no modifica código de producción.
 */

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { calcularSaldoTotal } from "../../src/core/movimientos/stock";
import {
  crearEnvioDirectoTransferencia,
  aceptarTransferencia,
  rechazarTransferencia,
  confirmarReingresoTransferencia,
} from "../../src/server/actions/traspasos/traspasos";

describe("Auditoría — Fase 4: traspasos entre sucursales en estado 'en tránsito'", () => {
  let sucursalAId: string;
  let sucursalBId: string;
  let seccionAId: string;
  let seccionBId: string;
  let unidadKgId: string;
  let insumoId: string;
  let usuarioAId: string;
  let usuarioBId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalAId = base.sucursal.id;
    const sucursalB = await prisma.sucursal.create({ data: { nombre: "Sucursal B" } });
    sucursalBId = sucursalB.id;

    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;

    seccionAId = (await sembrarSeccion(sucursalAId, "Depósito A")).id;
    seccionBId = (await sembrarSeccion(sucursalBId, "Depósito B")).id;

    const usuarioA = await crearUsuarioConMembresia({ email: "a@test.com", sucursalId: sucursalAId, rolId: base.admin.id });
    const usuarioB = await crearUsuarioConMembresia({ email: "b@test.com", sucursalId: sucursalBId, rolId: base.admin.id });
    usuarioAId = usuarioA.id;
    usuarioBId = usuarioB.id;
  });

  async function comoA() {
    await mockearUsuarioActual({ id: usuarioAId, email: "a@test.com", nombre: null });
  }
  async function comoB() {
    await mockearUsuarioActual({ id: usuarioBId, email: "b@test.com", nombre: null });
  }

  async function crearMP(nombre: string) {
    return prisma.producto.create({
      data: { codigo: `MP_${nombre.toUpperCase()}`, nombre, tipo: "MP", unidadStockId: unidadKgId, insumoId },
    });
  }

  it("Estado 'en tránsito' (ENVIADA): el origen ya bajó su stock, el destino todavía no lo tiene — el stock total del sistema (A+B) es menor durante ese lapso, por diseño (no es un bug)", async () => {
    const mp = await crearMP("Harina");
    await comoA();
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mp.id, cantidad: 10 }] });

    const envio = await crearEnvioDirectoTransferencia({
      destinoSucursalId: sucursalBId, productoId: mp.id, cantidad: 4, seccionOrigenId: seccionAId,
    });
    expect(envio.ok, envio.mensaje).toBe(true);
    if (!envio.ok) throw new Error(envio.mensaje);

    const saldoA = await calcularSaldoTotal(mp.id, seccionAId);
    const saldoB = await calcularSaldoTotal(mp.id, seccionBId);
    expect(saldoA).toBe(6); // 10 - 4, ya descontado
    expect(saldoB).toBe(0); // todavía no llegó

    const traspaso = await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: envio.id } });
    expect(traspaso.estado).toBe("ENVIADA");

    // El total contable (A+B) es 6 mientras está "en tránsito" — las 4
    // unidades existen físicamente pero no están en ningún Kardex hasta
    // que Destino confirme. Documentado como comportamiento esperado del
    // workflow (T1 candidato), no una pérdida de datos: el registro
    // TraspasoSucursal.estado="ENVIADA" es la evidencia de que hay algo
    // pendiente, visible en la Bandeja de ambos lados.
    expect(saldoA + saldoB).toBe(6);
  });

  it("Rechazo + reingreso: el ciclo completo devuelve exactamente la cantidad original al origen, sin duplicar ni perder stock", async () => {
    const mp = await crearMP("Harina2");
    await comoA();
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mp.id, cantidad: 10 }] });
    const envio = await crearEnvioDirectoTransferencia({ destinoSucursalId: sucursalBId, productoId: mp.id, cantidad: 4, seccionOrigenId: seccionAId });
    if (!envio.ok) throw new Error(envio.mensaje);

    await comoB();
    const rechazo = await rechazarTransferencia(envio.id, "No lo necesitamos");
    expect(rechazo.ok, rechazo.mensaje).toBe(true);

    // Tras el rechazo, ANTES del reingreso: sigue "perdido" del Kardex de
    // ambos lados — estado intermedio válido (RECHAZADA_DESTINO).
    let traspaso = await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: envio.id } });
    expect(traspaso.estado).toBe("RECHAZADA_DESTINO");
    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(6);

    await comoA();
    const reingreso = await confirmarReingresoTransferencia(envio.id);
    expect(reingreso.ok, reingreso.mensaje).toBe(true);

    traspaso = await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: envio.id } });
    expect(traspaso.estado).toBe("CERRADA");
    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(10); // exactamente el original, ni más ni menos
    expect(await calcularSaldoTotal(mp.id, seccionBId)).toBe(0);

    const movimientosDelTraspaso = await prisma.movimientoStock.count({ where: { traspasoSucursalId: envio.id } });
    expect(movimientosDelTraspaso).toBe(2); // salida + reingreso, nunca se tocó/borró la salida original
  });

  it("Aceptación duplicada (secuencial): la segunda llamada a aceptarTransferencia sobre un traspaso ya ACEPTADA es rechazada por el guard de estado, no genera una segunda entrada de stock", async () => {
    const mp = await crearMP("Harina3");
    await comoA();
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mp.id, cantidad: 10 }] });
    const envio = await crearEnvioDirectoTransferencia({ destinoSucursalId: sucursalBId, productoId: mp.id, cantidad: 4, seccionOrigenId: seccionAId });
    if (!envio.ok) throw new Error(envio.mensaje);

    await comoB();
    const primeraAceptacion = await aceptarTransferencia(envio.id, seccionBId);
    expect(primeraAceptacion.ok, primeraAceptacion.mensaje).toBe(true);

    const segundaAceptacion = await aceptarTransferencia(envio.id, seccionBId);
    expect(segundaAceptacion.ok).toBe(false);
    expect(segundaAceptacion.mensaje).toMatch(/no se puede aceptar/i);

    expect(await calcularSaldoTotal(mp.id, seccionBId)).toBe(4); // no 8
  });

  it("HALLAZGO A VERIFICAR: aceptar y rechazar simultáneos sobre el MISMO traspaso ENVIADA — ¿el guard de estado dentro de la transacción evita que ambos tengan efecto?", async () => {
    const mp = await crearMP("Harina4");
    await comoA();
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mp.id, cantidad: 10 }] });
    const envio = await crearEnvioDirectoTransferencia({ destinoSucursalId: sucursalBId, productoId: mp.id, cantidad: 4, seccionOrigenId: seccionAId });
    if (!envio.ok) throw new Error(envio.mensaje);

    await comoB();
    // aceptarTransferencia usa conTransaccionSerializable (lee+valida
    // estado+escribe dentro de la tx); rechazarTransferencia NO — hace un
    // simple prisma.traspasoSucursal.update() fuera de cualquier
    // transacción, sin releer el estado dentro de un lock. Corriendo
    // ambos "simultáneos" (mismo usuario B, no tiene sentido de negocio
    // real pero prueba la robustez del guard de estado ante la carrera).
    const settled = await Promise.allSettled([aceptarTransferencia(envio.id, seccionBId), rechazarTransferencia(envio.id, "motivo")]);

    console.log(
      "[auditoria] Aceptar+Rechazar simultáneos:",
      settled.map((s) => (s.status === "fulfilled" ? { ok: s.value.ok, mensaje: s.value.mensaje } : { rejected: true, message: String((s.reason as Error)?.message).slice(0, 200) }))
    );

    const traspaso = await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: envio.id } });
    console.log("[auditoria] Estado final del traspaso:", traspaso.estado);

    // El resultado válido es UNO solo de los dos efectos, nunca ambos
    // aplicados (eso dejaría el traspaso en un estado imposible o
    // generaría un movimiento de entrada sobre un traspaso ya rechazado).
    expect(["ACEPTADA", "RECHAZADA_DESTINO"]).toContain(traspaso.estado);

    const entradas = await prisma.movimientoStock.count({ where: { traspasoSucursalId: envio.id, proceso: "TRANSFERENCIA_ENTRADA_SUCURSAL" } });
    if (traspaso.estado === "RECHAZADA_DESTINO") {
      expect(entradas).toBe(0); // si terminó rechazado, no debe haber quedado una entrada de stock huérfana
    }
    if (traspaso.estado === "ACEPTADA") {
      expect(entradas).toBe(1); // si terminó aceptado, exactamente una entrada, no dos
    }
  });

  it("REGRESIÓN (Plan I3, §11.7): rechazo simultáneo — exactamente UNO de los dos gana, el otro recibe un error de estado explícito, nunca ambos ok:true pisando el motivo", async () => {
    const mp = await crearMP("HarinaRechazo");
    await comoA();
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mp.id, cantidad: 10 }] });
    const envio = await crearEnvioDirectoTransferencia({ destinoSucursalId: sucursalBId, productoId: mp.id, cantidad: 4, seccionOrigenId: seccionAId });
    if (!envio.ok) throw new Error(envio.mensaje);

    await comoB();
    const settled = await Promise.allSettled([
      rechazarTransferencia(envio.id, "Motivo A: no lo pedimos"),
      rechazarTransferencia(envio.id, "Motivo B: llegó mal"),
    ]);

    const resultados = settled.map((s) => (s.status === "fulfilled" ? s.value : { ok: false as const, mensaje: "rejected" }));
    const exitosos = resultados.filter((r) => r.ok);
    const fallidos = resultados.filter((r) => !r.ok);

    // Exactamente uno gana (mismo criterio que aceptarTransferencia ante
    // un estado inválido) — nunca los dos, nunca ninguno.
    expect(exitosos.length).toBe(1);
    expect(fallidos.length).toBe(1);
    expect(fallidos[0].mensaje).toMatch(/no se puede rechazar desde acá/);

    const traspaso = await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: envio.id } });
    expect(traspaso.estado).toBe("RECHAZADA_DESTINO");
    // El motivo persistido es el del que ganó — nunca queda pisado en
    // silencio por el que llegó después de que el estado ya cambió.
    expect(["Motivo A: no lo pedimos", "Motivo B: llegó mal"]).toContain(traspaso.motivoRechazoDestino);
  });

  it("Caso 2 (Pivote 3): fallo a mitad de la escritura de un envío — atomicidad real, no queda un TraspasoSucursal ni un MovimientoStock huérfano", async () => {
    // crearEnvioDirectoTransferencia escribe TraspasoSucursal + Operacion +
    // MovimientoStock dentro de UNA sola conTransaccionSerializable — para
    // simular "la conexión se cae después de registrar la salida" hay que
    // forzar un fallo DENTRO de esa misma transacción, antes del commit.
    // Replicamos el mismo patrón de escritura (mismo orden de creates) y
    // forzamos un throw justo después de crear el TraspasoSucursal pero
    // antes de escribir el MovimientoStock — si Postgres/Prisma son
    // atómicos de verdad, ninguna de las dos filas debe sobrevivir.
    const mp = await crearMP("Harina5");
    await comoA();
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mp.id, cantidad: 10 }] });
    await prisma.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: usuarioAId } }); // precondición: la membresía existe antes de simular el fallo

    class FalloSimulado extends Error {}

    await expect(
      prisma.$transaction(
        async (tx) => {
          await tx.traspasoSucursal.create({
            data: {
              origenSucursalId: sucursalAId,
              destinoSucursalId: sucursalBId,
              productoId: mp.id,
              cantidad: 4,
              seccionOrigenId: seccionAId,
              iniciadoPor: "ORIGEN",
              estado: "ENVIADA",
              creadoPorId: usuarioAId,
              fechaDecisionOrigen: new Date(),
              decididoPorOrigenId: usuarioAId,
            },
          });
          // "la conexión se cae" justo acá, antes de escribir el
          // MovimientoStock de salida y antes del COMMIT.
          throw new FalloSimulado("Fallo simulado a mitad de transacción");
        },
        { isolationLevel: "Serializable" as never }
      )
    ).rejects.toThrow(FalloSimulado);

    // Ni el TraspasoSucursal ni ningún MovimientoStock deben haber
    // sobrevivido — la transacción completa se revierte, no queda un
    // traspaso "ENVIADA" fantasma sin su movimiento de salida.
    const traspasosHuerfanos = await prisma.traspasoSucursal.count({ where: { productoId: mp.id } });
    const movimientosDeTraspaso = await prisma.movimientoStock.count({ where: { traspasoSucursalId: { not: null } } });
    expect(traspasosHuerfanos).toBe(0);
    expect(movimientosDeTraspaso).toBe(0);
    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(10); // intacto, como si el intento nunca hubiera ocurrido
  });
});
