import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { calcularSaldoTotal } from "../../src/core/movimientos/stock";
import {
  crearSolicitudTransferencia,
  crearEnvioDirectoTransferencia,
  aprobarYEnviarTransferencia,
  rechazarSolicitudTransferencia,
  aceptarTransferencia,
  rechazarTransferencia,
  confirmarReingresoTransferencia,
  cancelarSolicitudTransferencia,
  obtenerBandejaTransferencias,
} from "../../src/server/actions/traspasos/traspasos";

describe("Traspasos entre sucursales", () => {
  let sucursalAId: string;
  let sucursalBId: string;
  let seccionAId: string;
  let seccionBId: string;
  let unidadKgId: string;
  let insumoId: string;
  let adminAId: string;
  let adminBId: string;
  let rolAdminId: string;
  let rolOperadorId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase(); // "Central" = sucursal A
    sucursalAId = base.sucursal.id;
    rolAdminId = base.admin.id;
    rolOperadorId = base.operador.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionAId = (await sembrarSeccion(sucursalAId, "Depósito A")).id;

    const sucursalB = await prisma.sucursal.create({ data: { nombre: "Sucursal B" } });
    sucursalBId = sucursalB.id;
    seccionBId = (await sembrarSeccion(sucursalBId, "Depósito B")).id;

    const adminA = await crearUsuarioConMembresia({ email: "admin-a@test.com", sucursalId: sucursalAId, rolId: rolAdminId });
    const adminB = await crearUsuarioConMembresia({ email: "admin-b@test.com", sucursalId: sucursalBId, rolId: rolAdminId });
    adminAId = adminA.id;
    adminBId = adminB.id;
  });

  const comoA = () => mockearUsuarioActual({ id: adminAId, email: "admin-a@test.com", nombre: null });
  const comoB = () => mockearUsuarioActual({ id: adminBId, email: "admin-b@test.com", nombre: null });

  async function crearProductoConStock(codigo: string, cantidad: number) {
    const mp = await prisma.producto.create({ data: { codigo, nombre: codigo, tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    await comoA();
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mp.id, cantidad }] });
    return mp;
  }

  it("crearSolicitudTransferencia redondea la cantidad a los decimales de la unidad, igual que crearEnvioDirectoTransferencia (PUSH)", async () => {
    const mp = await crearProductoConStock("MP_PULL_DEC", 20); // unidadStock = kg, 2 decimales

    await comoB();
    const sol = await crearSolicitudTransferencia({ origenSucursalId: sucursalAId, productoId: mp.id, cantidad: 5.126, seccionDestinoId: seccionBId });
    expect(sol.ok).toBe(true);
    if (!sol.ok) return;

    const traspaso = await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: sol.id } });
    expect(Number(traspaso.cantidad)).toBe(5.13); // redondeado a 2 decimales, no 5.126 crudo

    await comoA();
    await aprobarYEnviarTransferencia(sol.id, seccionAId);
    const movimiento = await prisma.movimientoStock.findFirstOrThrow({ where: { traspasoSucursalId: sol.id, proceso: "TRANSFERENCIA_SALIDA_SUCURSAL" } });
    expect(Number(movimiento.cantidad)).toBe(-5.13); // el Kardex nunca recibe el valor sin redondear
  });

  it("flujo pull completo: B solicita a A, A aprueba (sale de su Sección Origen), B acepta (entra a su Sección Destino)", async () => {
    const mp = await crearProductoConStock("MP_PULL", 20);

    await comoB();
    const sol = await crearSolicitudTransferencia({ origenSucursalId: sucursalAId, productoId: mp.id, cantidad: 5, seccionDestinoId: seccionBId });
    expect(sol.ok).toBe(true);
    if (!sol.ok) return;

    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(20); // al solicitar, origen todavía no se toca

    await comoA();
    const aprobar = await aprobarYEnviarTransferencia(sol.id, seccionAId);
    expect(aprobar.ok).toBe(true);
    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(15);
    expect(await calcularSaldoTotal(mp.id, seccionBId)).toBe(0); // todavía no entró nada a destino

    await comoB();
    const aceptar = await aceptarTransferencia(sol.id, seccionBId);
    expect(aceptar.ok).toBe(true);
    expect(await calcularSaldoTotal(mp.id, seccionBId)).toBe(5);
  });

  it("flujo push completo: A envía directo a B (sale YA al crear el envío), B acepta", async () => {
    const mp = await crearProductoConStock("MP_PUSH", 10);

    await comoA();
    const envio = await crearEnvioDirectoTransferencia({ destinoSucursalId: sucursalBId, productoId: mp.id, cantidad: 4, seccionOrigenId: seccionAId });
    expect(envio.ok).toBe(true);
    if (!envio.ok) return;

    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(6); // ya salió al crear el envío

    await comoB();
    const aceptar = await aceptarTransferencia(envio.id, seccionBId);
    expect(aceptar.ok).toBe(true);
    expect(await calcularSaldoTotal(mp.id, seccionBId)).toBe(4);
  });

  it("si destino rechaza lo que le enviaron, el stock queda 'perdido' hasta que origen confirma el reingreso — y ahí vuelve exacto", async () => {
    const mp = await crearProductoConStock("MP_RECHAZO", 10);

    await comoA();
    const envio = await crearEnvioDirectoTransferencia({ destinoSucursalId: sucursalBId, productoId: mp.id, cantidad: 3, seccionOrigenId: seccionAId });
    if (!envio.ok) throw new Error("esperaba ok");
    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(7);

    await comoB();
    const rechazo = await rechazarTransferencia(envio.id, "No lo necesitamos más");
    expect(rechazo.ok).toBe(true);
    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(7); // rechazar SOLO no devuelve el stock todavía

    await comoA();
    const reingreso = await confirmarReingresoTransferencia(envio.id);
    expect(reingreso.ok).toBe(true);
    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(10); // vuelve exacto
  });

  it("origen puede rechazar una Solicitud sin que se toque nada de stock (nunca salió)", async () => {
    const mp = await crearProductoConStock("MP_RECHAZO_SOL", 8);

    await comoB();
    const sol = await crearSolicitudTransferencia({ origenSucursalId: sucursalAId, productoId: mp.id, cantidad: 2, seccionDestinoId: seccionBId });
    if (!sol.ok) throw new Error("esperaba ok");

    await comoA();
    const rechazo = await rechazarSolicitudTransferencia(sol.id, "No tenemos stock");
    expect(rechazo.ok).toBe(true);
    expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(8);
  });

  it("el lado equivocado no puede accionar: destino no puede aprobar una Solicitada; origen no puede aceptar una Solicitada", async () => {
    const mp = await crearProductoConStock("MP_GUARD", 8);

    await comoB();
    const sol = await crearSolicitudTransferencia({ origenSucursalId: sucursalAId, productoId: mp.id, cantidad: 2, seccionDestinoId: seccionBId });
    if (!sol.ok) throw new Error("esperaba ok");

    // B es Destino de esta fila — no puede aprobarla (ese rol es de Origen, o sea A).
    const aprobarComoDestino = await aprobarYEnviarTransferencia(sol.id, seccionBId);
    expect(aprobarComoDestino.ok).toBe(false);

    await comoA();
    // A es Origen, todavía SOLICITADA — no puede aceptarla como si fuera Destino.
    const aceptarComoOrigen = await aceptarTransferencia(sol.id, seccionAId);
    expect(aceptarComoOrigen.ok).toBe(false);
  });

  it("mismo criterio abierto que proceso_transferencia: un operador puede solicitar una transferencia por defecto", async () => {
    const mp = await crearProductoConStock("MP_PERMISO", 5);

    const operadorB = await crearUsuarioConMembresia({ email: "operador-b@test.com", sucursalId: sucursalBId, rolId: rolOperadorId });
    await mockearUsuarioActual({ id: operadorB.id, email: "operador-b@test.com", nombre: null });

    const sol = await crearSolicitudTransferencia({ origenSucursalId: sucursalAId, productoId: mp.id, cantidad: 1, seccionDestinoId: seccionBId });
    expect(sol.ok).toBe(true);
  });

  it("obtenerBandejaTransferencias separa lo que hay que accionar del historial, para cada lado", async () => {
    const mp = await crearProductoConStock("MP_BANDEJA", 10);

    await comoB();
    const sol = await crearSolicitudTransferencia({ origenSucursalId: sucursalAId, productoId: mp.id, cantidad: 2, seccionDestinoId: seccionBId });
    if (!sol.ok) throw new Error("esperaba ok");

    await comoA(); // la bandeja de una sucursal solo la puede leer alguien de esa sucursal
    const bandejaA = await obtenerBandejaTransferencias(sucursalAId);
    expect(bandejaA.paraAprobar.map((t) => t.id)).toContain(sol.id);
    expect(bandejaA.historial.map((t) => t.id)).not.toContain(sol.id);

    await comoB(); // la bandeja de una sucursal solo la puede leer alguien de esa sucursal
    const bandejaB = await obtenerBandejaTransferencias(sucursalBId);
    expect(bandejaB.paraAprobar.map((t) => t.id)).not.toContain(sol.id); // B no es Origen acá
    expect(bandejaB.paraAceptar.map((t) => t.id)).not.toContain(sol.id); // todavía SOLICITADA, no ENVIADA
    // La propia solicitud de B (destino), todavía sin decisión de A: en curso para B, nunca historial (hallazgo de la auditoría).
    expect(bandejaB.esperando.map((t) => t.id)).toContain(sol.id);
    expect(bandejaB.historial.map((t) => t.id)).not.toContain(sol.id);

    await comoA();
    await aprobarYEnviarTransferencia(sol.id, seccionAId);

    await comoB(); // la bandeja de una sucursal solo la puede leer alguien de esa sucursal
    const bandejaBTrasAprobar = await obtenerBandejaTransferencias(sucursalBId);
    expect(bandejaBTrasAprobar.paraAceptar.map((t) => t.id)).toContain(sol.id);
    expect(bandejaBTrasAprobar.esperando.map((t) => t.id)).not.toContain(sol.id); // ya no es "esperando": ahora B tiene algo para accionar (paraAceptar)
    await comoA(); // la bandeja de una sucursal solo la puede leer alguien de esa sucursal
    const bandejaATrasAprobar = await obtenerBandejaTransferencias(sucursalAId);
    expect(bandejaATrasAprobar.paraAprobar.map((t) => t.id)).not.toContain(sol.id);
    expect(bandejaATrasAprobar.historial.map((t) => t.id)).toContain(sol.id);
    // A ya aprobó y ya no tiene nada más que hacer — un PULL que A aprobó
    // NO es un envío propio de A (lo inició B), así que sigue siendo
    // historial para A, no "esperando" (a diferencia de un PUSH directo).
    expect(bandejaATrasAprobar.esperando.map((t) => t.id)).not.toContain(sol.id);
  });

  it("un PUSH directo propio queda 'esperando' (no historial) para quien lo envió, hasta que la otra sucursal decida", async () => {
    const mp = await crearProductoConStock("MP_PUSH_ESPERA", 10);

    await comoA();
    const envio = await crearEnvioDirectoTransferencia({ destinoSucursalId: sucursalBId, productoId: mp.id, cantidad: 3, seccionOrigenId: seccionAId });
    if (!envio.ok) throw new Error("esperaba ok");

    await comoA(); // la bandeja de una sucursal solo la puede leer alguien de esa sucursal
    const bandejaA = await obtenerBandejaTransferencias(sucursalAId);
    expect(bandejaA.esperando.map((t) => t.id)).toContain(envio.id);
    expect(bandejaA.historial.map((t) => t.id)).not.toContain(envio.id);

    await comoB();
    await aceptarTransferencia(envio.id, seccionBId);

    await comoA(); // la bandeja de una sucursal solo la puede leer alguien de esa sucursal
    const bandejaATrasAceptar = await obtenerBandejaTransferencias(sucursalAId);
    expect(bandejaATrasAceptar.esperando.map((t) => t.id)).not.toContain(envio.id);
    expect(bandejaATrasAceptar.historial.map((t) => t.id)).toContain(envio.id);
  });

  describe("cancelarSolicitudTransferencia", () => {
    it("quien creó la solicitud PULL (destino) la cancela ella misma, sin tocar stock — antes solo podía esperar a que Origen la rechace", async () => {
      const mp = await crearProductoConStock("MP_CANCELA", 10);

      await comoB();
      const sol = await crearSolicitudTransferencia({ origenSucursalId: sucursalAId, productoId: mp.id, cantidad: 2, seccionDestinoId: seccionBId });
      if (!sol.ok) throw new Error("esperaba ok");

      const resultado = await cancelarSolicitudTransferencia(sol.id);
      expect(resultado.ok, resultado.mensaje).toBe(true);

      const traspaso = await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: sol.id } });
      expect(traspaso.estado).toBe("CANCELADA");
      expect(await calcularSaldoTotal(mp.id, seccionAId)).toBe(10); // nunca se tocó

      await comoA(); // la bandeja de una sucursal solo la puede leer alguien de esa sucursal
      const bandejaA = await obtenerBandejaTransferencias(sucursalAId);
      expect(bandejaA.paraAprobar.map((t) => t.id)).not.toContain(sol.id);
      expect(bandejaA.historial.map((t) => t.id)).toContain(sol.id);
    });

    it("Origen no puede cancelar una solicitud que no le pidieron a él cancelar (no es quien la creó)", async () => {
      const mp = await crearProductoConStock("MP_CANCELA_2", 10);

      await comoB();
      const sol = await crearSolicitudTransferencia({ origenSucursalId: sucursalAId, productoId: mp.id, cantidad: 2, seccionDestinoId: seccionBId });
      if (!sol.ok) throw new Error("esperaba ok");

      await comoA();
      const resultado = await cancelarSolicitudTransferencia(sol.id);
      expect(resultado.ok).toBe(false);

      const traspaso = await prisma.traspasoSucursal.findUniqueOrThrow({ where: { id: sol.id } });
      expect(traspaso.estado).toBe("SOLICITADA");
    });

    it("no se puede cancelar una solicitud que Origen ya aprobó (ya no es SOLICITADA)", async () => {
      const mp = await crearProductoConStock("MP_CANCELA_3", 10);

      await comoB();
      const sol = await crearSolicitudTransferencia({ origenSucursalId: sucursalAId, productoId: mp.id, cantidad: 2, seccionDestinoId: seccionBId });
      if (!sol.ok) throw new Error("esperaba ok");

      await comoA();
      await aprobarYEnviarTransferencia(sol.id, seccionAId);

      await comoB();
      const resultado = await cancelarSolicitudTransferencia(sol.id);
      expect(resultado.ok).toBe(false);
    });
  });

  it("obtenerBandejaTransferencias pagina el historial por cursor sin perder ni duplicar filas, y no pagina lo en curso", async () => {
    const mp = await crearProductoConStock("MP_PAGINA", 100);

    // 5 traspasos PUSH cerrados (historial) — uno por uno para que `creadoEn` quede en orden distinto.
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      await comoA();
      const envio = await crearEnvioDirectoTransferencia({ destinoSucursalId: sucursalBId, productoId: mp.id, cantidad: 1, seccionOrigenId: seccionAId });
      if (!envio.ok) throw new Error("esperaba ok");
      await comoB();
      const aceptar = await aceptarTransferencia(envio.id, seccionBId);
      if (!aceptar.ok) throw new Error("esperaba ok");
      ids.push(envio.id);
    }

    // Uno en curso (Solicitada, sin cerrar) — nunca debería contarse en la paginación del historial.
    await comoB();
    const enCurso = await crearSolicitudTransferencia({ origenSucursalId: sucursalAId, productoId: mp.id, cantidad: 1, seccionDestinoId: seccionBId });
    if (!enCurso.ok) throw new Error("esperaba ok");

    await comoA(); // la bandeja de una sucursal solo la puede leer alguien de esa sucursal
    const pagina1 = await obtenerBandejaTransferencias(sucursalAId, undefined);
    expect(pagina1.paraAprobar.map((t) => t.id)).toEqual([enCurso.id]);
    expect(pagina1.historial.map((t) => t.id)).not.toContain(enCurso.id);
    // 5 cerrados < tamaño de página: entran todos de una, sin próxima página.
    expect(new Set(pagina1.historial.map((t) => t.id))).toEqual(new Set(ids));
    expect(pagina1.nextCursorHistorial).toBeNull();

    // El cursor de una fila puntual arranca la página siguiente justo después de esa fila, sin repetirla.
    const cursor = pagina1.historial[2].id;
    await comoA(); // la bandeja de una sucursal solo la puede leer alguien de esa sucursal
    const pagina2 = await obtenerBandejaTransferencias(sucursalAId, cursor);
    expect(pagina2.historial.map((t) => t.id)).not.toContain(cursor);
    expect(pagina2.historial.length).toBe(2); // las 2 filas que quedaban después del cursor
  });
});
