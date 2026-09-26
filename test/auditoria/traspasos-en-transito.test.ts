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
  crearSolicitudTransferencia,
  aprobarYEnviarTransferencia,
  rechazarSolicitudTransferencia,
  cancelarSolicitudTransferencia,
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
    const mp = await prisma.producto.create({
      data: { codigo: `MP_${nombre.toUpperCase()}`, nombre, tipo: "MP", unidadStockId: unidadKgId, insumoId },
    });
    // Disponible en AMBAS sucursales — este archivo prueba el ciclo de traspaso en sí, no el chequeo de disponibilidad.
    await prisma.disponibilidadProducto.createMany({
      data: [sucursalAId, sucursalBId].map((sucursalId) => ({ sucursalId, productoId: mp.id, disponible: true })),
    });
    return mp;
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

  it("Reingreso simultáneo (sin clave de idempotencia): dos confirmarReingresoTransferencia en paralelo sobre el mismo traspaso RECHAZADA_DESTINO — exactamente uno tiene efecto, el otro recibe el error de estado, nunca se duplica el reingreso", async () => {
    const mp = await crearMP("HarinaReingreso");
    await comoA();
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mp.id, cantidad: 10 }] });
    const envio = await crearEnvioDirectoTransferencia({ destinoSucursalId: sucursalBId, productoId: mp.id, cantidad: 4, seccionOrigenId: seccionAId });
    if (!envio.ok) throw new Error(envio.mensaje);

    await comoB();
    const rechazo = await rechazarTransferencia(envio.id, "no lo pedimos");
    expect(rechazo.ok, rechazo.mensaje).toBe(true);

    await comoA();
    // Mismo usuario (A = origen) en las dos llamadas: es el caso real (doble clic, o dos pestañas del mismo operador).
    // getUsuarioActual está mockeado a nivel de módulo (global al proceso), así que no tiene sentido simular A y B acá.
    const settled = await Promise.allSettled([confirmarReingresoTransferencia(envio.id), confirmarReingresoTransferencia(envio.id)]);

    expect(settled.every((s) => s.status === "fulfilled"), `ninguna llamada debe rechazar: ${JSON.stringify(settled)}`).toBe(true);
    const resultados = settled.map((s) => (s.status === "fulfilled" ? s.value : { ok: false as const, mensaje: "rejected" }));
    const exitosos = resultados.filter((r) => r.ok);
    const fallidos = resultados.filter((r) => !r.ok);

    expect(exitosos.length).toBe(1);
    expect(fallidos.length).toBe(1);
    expect(fallidos[0].mensaje).toMatch(/no hay ningún reingreso pendiente/);

    const movimientosDeReingreso = await prisma.movimientoStock.count({ where: { traspasoSucursalId: envio.id, proceso: "REINGRESO_TRANSFERENCIA_SUCURSAL" } });
    expect(movimientosDeReingreso).toBe(1); // nunca 2

    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(10); // exactamente el original, ni 14 ni 6

    const traspaso = await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: envio.id } });
    expect(traspaso.estado).toBe("CERRADA");
  });

  /**
   * Carrera de stock en tránsito (docs/plan-mutaciones-controladas-2026-09-25.md, Paso 4). `rechazarSolicitudTransferencia` y
   * `cancelarSolicitudTransferencia` leían el estado y escribían el nuevo SIN transacción: si `aprobarYEnviarTransferencia` (que sí es
   * serializable) hacía commit de la SALIDA + ENVIADA justo entre esa lectura y esa escritura, el traspaso quedaba RECHAZADA_ORIGEN con el
   * stock YA afuera del origen — y nadie lo podía reingresar (el reingreso exige RECHAZADA_DESTINO): stock perdido. Mismo arreglo que ya
   * tenía `rechazarTransferencia` (ver "rechazo simultáneo" más arriba).
   *
   * La carrera es intermitente por naturaleza (depende de en qué milisegundo cae cada consulta): por eso se corre varias veces, con el
   * rechazo arrancando con distintos desfasajes, y lo que se afirma es el INVARIANTE — el stock del origen más lo que sigue en tránsito es
   * siempre lo que se compró.
   */
  it("REGRESIÓN (stock en tránsito): aprobar y rechazar la MISMA solicitud simultáneos — exactamente uno gana, y nunca queda RECHAZADA_ORIGEN con la SALIDA ya hecha", async () => {
    const mp = await crearMP("HarinaCarrera");
    await comoA();
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mp.id, cantidad: 20 }] });

    const DESFASAJES_MS = [0, 0, 1, 2, 4, 8, 15];
    for (const desfasaje of DESFASAJES_MS) {
      await comoB();
      const sol = await crearSolicitudTransferencia({ origenSucursalId: sucursalAId, productoId: mp.id, cantidad: 1, seccionDestinoId: seccionBId });
      if (!sol.ok) throw new Error(sol.mensaje);

      await comoA(); // aprobar y rechazar una solicitud son los dos decisiones de Origen
      const settled = await Promise.allSettled([
        aprobarYEnviarTransferencia(sol.id, seccionAId),
        new Promise((r) => setTimeout(r, desfasaje)).then(() => rechazarSolicitudTransferencia(sol.id, "No tenemos")),
      ]);

      expect(settled.every((s) => s.status === "fulfilled"), `ninguna llamada debe rechazar: ${JSON.stringify(settled)}`).toBe(true);
      const resultados = settled.map((s) => (s.status === "fulfilled" ? s.value : { ok: false as const, mensaje: "rejected" }));
      const traspaso = await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: sol.id } });
      const salidas = await prisma.movimientoStock.count({ where: { traspasoSucursalId: sol.id, proceso: "TRANSFERENCIA_SALIDA_SUCURSAL" } });
      const contexto = `desfasaje ${desfasaje} ms → ${JSON.stringify(resultados)}; estado final ${traspaso.estado}, salidas ${salidas}`;

      expect(resultados.filter((r) => r.ok).length, contexto).toBe(1);
      expect(resultados.filter((r) => !r.ok)[0]?.mensaje, contexto).toMatch(/ya está en estado/);
      if (traspaso.estado === "ENVIADA") expect(salidas, contexto).toBe(1); // ganó aprobar: una sola salida
      else {
        expect(traspaso.estado, contexto).toBe("RECHAZADA_ORIGEN"); // ganó rechazar: nunca salió nada
        expect(salidas, contexto).toBe(0);
      }
    }

    // Invariante: lo que queda en el origen + lo que sigue en tránsito (ENVIADA) = lo que se compró. Nada se perdió en el medio.
    const enTransito = await prisma.traspasoSucursal.aggregate({ where: { productoId: mp.id, estado: "ENVIADA" }, _sum: { cantidad: true } });
    expect((await calcularSaldoTotal(mp.id, seccionAId)) + Number(enTransito._sum.cantidad ?? 0)).toBe(20);
  });

  it("REGRESIÓN (stock en tránsito): doble cancelación simultánea de la misma solicitud — exactamente una tiene efecto, la otra recibe el error de estado", async () => {
    const mp = await crearMP("HarinaDobleCancela");
    await comoA();
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mp.id, cantidad: 10 }] });

    await comoB();
    const sol = await crearSolicitudTransferencia({ origenSucursalId: sucursalAId, productoId: mp.id, cantidad: 2, seccionDestinoId: seccionBId });
    if (!sol.ok) throw new Error(sol.mensaje);

    // Mismo usuario (B = quien la pidió) en las dos llamadas: el caso real es un doble clic o dos pestañas.
    const settled = await Promise.allSettled([cancelarSolicitudTransferencia(sol.id), cancelarSolicitudTransferencia(sol.id)]);

    expect(settled.every((s) => s.status === "fulfilled"), `ninguna llamada debe rechazar: ${JSON.stringify(settled)}`).toBe(true);
    const resultados = settled.map((s) => (s.status === "fulfilled" ? s.value : { ok: false as const, mensaje: "rejected" }));
    expect(resultados.filter((r) => r.ok).length, JSON.stringify(resultados)).toBe(1);
    expect(resultados.filter((r) => !r.ok)[0]?.mensaje).toMatch(/no se puede cancelar desde acá/);

    const traspaso = await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: sol.id } });
    expect(traspaso.estado).toBe("CANCELADA");
    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(10); // una solicitud nunca tocó stock
  });

  it("REGRESIÓN (stock en tránsito): doble rechazo simultáneo de la misma solicitud — exactamente uno gana, el otro recibe el error de estado, nunca se pisa el motivo en silencio", async () => {
    const mp = await crearMP("HarinaDobleRechazoSol");
    await comoA();
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mp.id, cantidad: 10 }] });

    await comoB();
    const sol = await crearSolicitudTransferencia({ origenSucursalId: sucursalAId, productoId: mp.id, cantidad: 2, seccionDestinoId: seccionBId });
    if (!sol.ok) throw new Error(sol.mensaje);

    await comoA();
    const settled = await Promise.allSettled([
      rechazarSolicitudTransferencia(sol.id, "Motivo A: no tenemos"),
      rechazarSolicitudTransferencia(sol.id, "Motivo B: pedilo a otra"),
    ]);

    expect(settled.every((s) => s.status === "fulfilled"), `ninguna llamada debe rechazar: ${JSON.stringify(settled)}`).toBe(true);
    const resultados = settled.map((s) => (s.status === "fulfilled" ? s.value : { ok: false as const, mensaje: "rejected" }));
    expect(resultados.filter((r) => r.ok).length, JSON.stringify(resultados)).toBe(1);
    expect(resultados.filter((r) => !r.ok)[0]?.mensaje).toMatch(/no se puede rechazar desde acá/);

    const traspaso = await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: sol.id } });
    expect(traspaso.estado).toBe("RECHAZADA_ORIGEN");
    expect(["Motivo A: no tenemos", "Motivo B: pedilo a otra"]).toContain(traspaso.motivoRechazoOrigen);
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
