import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { crearMozo, entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { abrirCuenta, abrirCuentaDeMostrador, asignarClienteACuenta, liberarMesa } from "../../src/server/actions/pos/cuenta-apertura";
import { abrirCuentaDeMostradorCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/abrir-cuenta-de-mostrador";
import { agregarItems, enviarACocina } from "../../src/server/actions/pos/cuenta-pedido";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { habilitarMostrador } from "../../src/server/actions/pos/mesas";
import { obtenerDetalleDelMostrador } from "../../src/server/consultas/pos/detalle-de-mesa";
import { listarTicketsEmitidos } from "../../src/server/consultas/reportes/tickets-emitidos";

/**
 * M1.4c del mostrador (ADR-039): abrir la cuenta del mostrador, venderla y cerrarla como una mesa. Con la base real:
 *  - abrir: idempotente por estado, doble clic y dos cajeros dan UNA cuenta (el mismo id); sin puesto habilitado se rechaza; sin comensales; no cuenta para el límite;
 *  - el circuito completo (pedir, enviar, cliente con %, cerrar) con el «detalle» y los mensajes del mostrador, ticket numerado y reintento del cierre (`YA_CERRADA`);
 *  - la numeración de tickets bajo concurrencia entre una cuenta de mostrador y una de mesa (consecutivos, sin huecos ni duplicados);
 *  - cerrar contra agregar en la misma cuenta del mostrador; descartar una cuenta vacía.
 */
describe("la cuenta del mostrador", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let puestoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
    expect((await habilitarMostrador()).ok).toBe(true);
    puestoId = (await prisma.mesa.findFirstOrThrow({ where: { sucursalId: s.sucursalId, tipo: "MOSTRADOR" } })).id;
  });

  const abiertas = () => prisma.cuenta.findMany({ where: { mesa: { tipo: "MOSTRADOR" }, cerradaEn: null } });
  const idDe = (r: Awaited<ReturnType<typeof abrirCuentaDeMostrador>>) => (r.ok ? r.cuentaId : null);

  describe("abrir", () => {
    it("crea la cuenta del puesto: tipo MOSTRADOR, sin comensales, a nombre de quien la abre, y devuelve su id", async () => {
      const r = await abrirCuentaDeMostrador();
      expect(r).toMatchObject({ ok: true, mensaje: "Cuenta del mostrador abierta." });
      const [cuenta] = await abiertas();
      expect(cuenta).toMatchObject({ mesaId: puestoId, tipoMesa: "MOSTRADOR", comensales: null, abiertaPorId: s.admin.id });
      expect(idDe(r)).toBe(cuenta.id);
    });

    it("idempotente por estado: la segunda vez devuelve la MISMA cuenta sin crear otra", async () => {
      const primera = await abrirCuentaDeMostrador();
      const segunda = await abrirCuentaDeMostrador();
      expect(segunda).toMatchObject({ ok: true, mensaje: "El mostrador ya tenía una cuenta abierta." });
      expect(idDe(segunda)).toBe(idDe(primera));
      expect(await abiertas()).toHaveLength(1);
    });

    for (const cuantas of [2, 5]) {
      it(`doble clic (${cuantas} aperturas a la vez): UNA sola cuenta y todas devuelven el mismo id`, async () => {
        const resultados = await Promise.all(Array.from({ length: cuantas }, () => abrirCuentaDeMostrador()));
        expect(resultados.every((r) => r.ok), resultados.map((r) => r.mensaje).join(" / ")).toBe(true);
        expect(new Set(resultados.map(idDe)).size, "todos el mismo id").toBe(1);
        expect(resultados.filter((r) => r.mensaje === "Cuenta del mostrador abierta.")).toHaveLength(1);
        expect(await abiertas()).toHaveLength(1);
      });
    }

    it("dos cajeros a la vez comparten la cuenta (en M1 hay una por vez)", async () => {
      const cajero = await crearMozo(s.sucursalId, "cajero");
      const como = (usuarioId: string) => abrirCuentaDeMostradorCasoDeUso({ usuarioId, sucursalId: s.sucursalId, transaccion: baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }).transaccion });
      const [a, b] = await Promise.all([como(s.admin.id), como(cajero.id)]);
      expect(a.ok && b.ok).toBe(true);
      expect(a.ok && b.ok && a.datos.cuentaId === b.datos.cuentaId).toBe(true);
      expect(await abiertas()).toHaveLength(1);
    });

    it("la carrera se repite sin duplicar (varias rondas: se cierra la cuenta y se vuelve a abrir a la vez)", async () => {
      for (let ronda = 0; ronda < 3; ronda++) {
        const resultados = await Promise.all([abrirCuentaDeMostrador(), abrirCuentaDeMostrador(), abrirCuentaDeMostrador()]);
        expect(new Set(resultados.map(idDe)).size, `ronda ${ronda}`).toBe(1);
        expect(await liberarMesa(idDe(resultados[0])!), `ronda ${ronda}`).toEqual({ ok: true, mensaje: "Cuenta del mostrador descartada." });
        expect(await abiertas(), `ronda ${ronda}`).toHaveLength(0);
      }
    });

    it("sin el puesto habilitado se rechaza con MOSTRADOR_NO_HABILITADO y no escribe", async () => {
      await prismaAdmin.cuenta.deleteMany();
      await prismaAdmin.mesa.deleteMany({ where: { tipo: "MOSTRADOR" } });
      const r = await abrirCuentaDeMostradorCasoDeUso({ usuarioId: s.admin.id, sucursalId: s.sucursalId, transaccion: baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }).transaccion });
      expect(r).toMatchObject({ ok: false, codigo: "MOSTRADOR_NO_HABILITADO" });
      expect(await prisma.cuenta.count()).toBe(0);
    });

    it("una sucursal desactivada no abre cuentas (SUCURSAL_INACTIVA), pero si ya había una abierta, la devuelve", async () => {
      const actor = { usuarioId: s.admin.id, sucursalId: s.sucursalId, transaccion: baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }).transaccion };
      const abierta = await abrirCuentaDeMostradorCasoDeUso(actor);
      await prisma.sucursal.update({ where: { id: s.sucursalId }, data: { activo: false } });
      expect(await abrirCuentaDeMostradorCasoDeUso(actor)).toMatchObject({ ok: true, datos: { cuentaId: abierta.ok ? abierta.datos.cuentaId : "?" } });
      await prisma.cuenta.updateMany({ data: { cerradaEn: new Date(), cerradaPorId: s.admin.id } });
      expect(await abrirCuentaDeMostradorCasoDeUso(actor)).toMatchObject({ ok: false, codigo: "SUCURSAL_INACTIVA" });
    });

    it("no cuenta para el límite de mesas abiertas, y las mesas siguen con una sola cuenta abierta cada una", async () => {
      await prisma.sucursal.update({ where: { id: s.sucursalId }, data: { maxMesasAbiertas: 1 } });
      expect((await abrirCuentaDeMostrador()).ok).toBe(true);
      expect((await abrirCuenta(s.mesa.id, 2)).ok).toBe(true);
      const otra = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 9 } });
      expect((await abrirCuenta(otra.id, 2)).ok).toBe(false);
      expect(await abrirCuenta(s.mesa.id, 2)).toEqual({ ok: true, mensaje: "La mesa 4 ya tenía una cuenta abierta." });
    });

    it("la lectura del mostrador trae la cuenta abierta con rótulo «Mostrador» (número 0); sin cuenta, cuenta null", async () => {
      expect(await obtenerDetalleDelMostrador(s.sucursalId, prisma, new Date())).toMatchObject({ mesa: { id: puestoId, numero: 0 }, cuenta: null });
      const r = await abrirCuentaDeMostrador();
      expect(await obtenerDetalleDelMostrador(s.sucursalId, prisma, new Date())).toMatchObject({ mesa: { id: puestoId, numero: 0 }, cuenta: { id: idDe(r), comensales: null } });
    });
  });

  describe("vender y cerrar como una mesa", () => {
    it("pedir, enviar y cerrar: venta con detalle «Mostrador», ticket 1 y mensajes del mostrador; el reintento da YA_CERRADA sin escribir", async () => {
      const cuentaId = idDe(await abrirCuentaDeMostrador())!;
      const agregado = await agregarItems(cuentaId, [{ productoId: s.flan.id, cantidad: 2 }]);
      expect(agregado).toEqual({ ok: true, mensaje: "Se agregó 1 ítem al mostrador." });
      const item = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId } });
      expect((await enviarACocina(cuentaId, [item.id])).mensaje).toBe("Envío 1 a cocina: 1 ítem del mostrador.");
      const cierre = await cerrarCuenta(cuentaId);
      expect(cierre.ok, cierre.mensaje).toBe(true);
      expect(cierre.mensaje).toMatch(/^Cuenta del mostrador cerrada: se registró la venta por /);

      const ventas = await prisma.operacion.findMany({ where: { proceso: "VENTA" } });
      expect(ventas).toHaveLength(1);
      expect(ventas[0].detalleLibre).toBe("Mostrador");
      expect(await prisma.ejemplarTicket.findMany({ select: { cuentaId: true, numero: true, ejemplar: true } })).toEqual([{ cuentaId, numero: 1, ejemplar: 1 }]);
      expect((await prisma.cuenta.findUniqueOrThrow({ where: { id: cuentaId } })).cerradaEn).not.toBeNull();

      const operacionesAntes = await prisma.operacion.count();
      expect(await cerrarCuenta(cuentaId)).toEqual({ ok: true, mensaje: "La cuenta del mostrador ya estaba cerrada." });
      expect(await prisma.operacion.count(), "el reintento no escribe").toBe(operacionesAntes);
      expect(await prisma.ejemplarTicket.count(), "ni emite otro ticket").toBe(1);
      expect(await abiertas(), "el puesto queda sin cuenta abierta y se puede abrir otra").toHaveLength(0);
      expect((await abrirCuentaDeMostrador()).ok).toBe(true);
    });

    it("con cliente con %: el mensaje dice «al mostrador», la venta lleva el cliente y el descuento, y la auditoría nombra «Mostrador»", async () => {
      const cuentaId = idDe(await abrirCuentaDeMostrador())!;
      const cliente = await prisma.cliente.create({ data: { nombre: "Fulano", descuentoPorcentaje: 10 } });
      expect(await asignarClienteACuenta(cuentaId, cliente.id)).toEqual({ ok: true, mensaje: "«Fulano» asignado al mostrador, con 10% de descuento." });
      expect(await asignarClienteACuenta(cuentaId, null)).toEqual({ ok: true, mensaje: "Se quitó el cliente del mostrador." });
      await asignarClienteACuenta(cuentaId, cliente.id);
      await agregarItems(cuentaId, [{ productoId: s.flan.id, cantidad: 1 }]);
      const item = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId } });
      await enviarACocina(cuentaId, [item.id]);
      const cierre = await cerrarCuenta(cuentaId);
      expect(cierre.mensaje).toMatch(/^Cuenta del mostrador cerrada: se registró la venta por .* \(con 10% de descuento a «Fulano»\)\.$/);
      const venta = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA" } });
      expect(venta).toMatchObject({ clienteId: cliente.id, detalleLibre: "Mostrador" });
      const mov = await prisma.movimientoStock.findFirstOrThrow({ where: { proceso: "VENTA" } });
      expect(Number(mov.precioPorUnidadStock)).toBe(2700); // 3000 con 10 % de descuento: el cálculo del dinero es el de la mesa
      const auditoria = await prismaAdmin.registroAuditoria.findMany({ where: { entidad: "Cuenta", entidadId: cuentaId } });
      expect(auditoria.length).toBeGreaterThan(0);
      for (const fila of auditoria) expect(fila.descripcion.startsWith("Mostrador: ")).toBe(true);
    });

    it("hereda las reglas de la mesa: con algo sin enviar no se cierra; el stock insuficiente NO frena el cierre y deja su auditoría «Mostrador: …»", async () => {
      const cuentaId = idDe(await abrirCuentaDeMostrador())!;
      await agregarItems(cuentaId, [{ productoId: s.pizza.id, cantidad: 1 }]);
      expect(await cerrarCuenta(cuentaId)).toEqual({ ok: false, mensaje: "Hay 1 ítem sin enviar: envialo o quitalo." });
      const item = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId } });
      await enviarACocina(cuentaId, [item.id]);
      const cierre = await cerrarCuenta(cuentaId);
      expect(cierre.ok, cierre.mensaje).toBe(true);
      expect(cierre.mensaje).toContain("⚠ Quedó stock negativo");
      const filas = await prismaAdmin.registroAuditoria.findMany({ where: { campo: "saldoStock" } });
      expect(filas.length).toBeGreaterThan(0);
      for (const fila of filas) expect(fila.descripcion.startsWith("Mostrador: al cerrar la cuenta")).toBe(true);
    });

    it("descartar una cuenta vacía la cierra sin venta ni ticket", async () => {
      const cuentaId = idDe(await abrirCuentaDeMostrador())!;
      expect(await liberarMesa(cuentaId)).toEqual({ ok: true, mensaje: "Cuenta del mostrador descartada." });
      expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(0);
      expect(await prisma.ejemplarTicket.count()).toBe(0);
    });

    it("la cuenta cerrada del mostrador aparece en Tickets emitidos con su número", async () => {
      const cuentaId = await cuentaConFlanEnviada();
      expect((await cerrarCuenta(cuentaId)).ok).toBe(true);
      const { items } = await listarTicketsEmitidos(s.sucursalId, { mesaId: puestoId }, prisma);
      expect(items.map((t) => [t.numero.numero, t.mesaNumero])).toEqual([[1, 0]]);
    });

    async function cuentaConFlanEnviada() {
      const cuentaId = idDe(await abrirCuentaDeMostrador())!;
      await agregarItems(cuentaId, [{ productoId: s.flan.id, cantidad: 1 }]);
      const item = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId } });
      await enviarACocina(cuentaId, [item.id]);
      return cuentaId;
    }

    it("cierre de una cuenta de mostrador y una de mesa a la vez: tickets 1 y 2, sin huecos ni duplicados (varias rondas)", async () => {
      for (let ronda = 0; ronda < 3; ronda++) {
        const inicio = await prisma.ejemplarTicket.count();
        const mostrador = await cuentaConFlanEnviada();
        const mesa = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
        const resultados = await Promise.all([cerrarCuenta(mostrador), cerrarCuenta(mesa.id)]);
        expect(resultados.every((r) => r.ok), resultados.map((r) => r.mensaje).join(" / ")).toBe(true);
        const ejemplares = await prisma.ejemplarTicket.findMany({ orderBy: { numero: "asc" } });
        expect(ejemplares.map((e) => e.numero), `ronda ${ronda}`).toEqual(Array.from({ length: inicio + 2 }, (_, i) => i + 1));
        expect(new Set(ejemplares.slice(inicio).map((e) => e.cuentaId))).toEqual(new Set([mostrador, mesa.id]));
      }
    });

    it("cerrar la misma cuenta dos veces a la vez: una cierra, la otra ve YA_CERRADA; un solo ticket y una sola venta", async () => {
      const cuentaId = await cuentaConFlanEnviada();
      const resultados = await Promise.all([cerrarCuenta(cuentaId), cerrarCuenta(cuentaId)]);
      expect(resultados.every((r) => r.ok)).toBe(true);
      expect(resultados.filter((r) => r.mensaje === "La cuenta del mostrador ya estaba cerrada.")).toHaveLength(1);
      expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(1);
      expect(await prisma.ejemplarTicket.count()).toBe(1);
    });

    it("agregar contra cerrar en la cuenta del mostrador: nunca queda un ítem sin enviar en una cuenta cerrada", async () => {
      for (let vuelta = 0; vuelta < 3; vuelta++) {
        const cuentaId = await cuentaConFlanEnviada();
        const [agregado, cierre] = await Promise.all([agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }]), cerrarCuenta(cuentaId)]);
        const final = await prisma.cuenta.findUniqueOrThrow({ where: { id: cuentaId }, include: { items: true } });
        if (final.cerradaEn) expect(final.items.filter((i) => i.numeroEnvio === null), `vuelta ${vuelta}`).toEqual([]);
        expect([agregado.ok, cierre.ok], `vuelta ${vuelta}: ${agregado.mensaje} / ${cierre.mensaje}`).not.toEqual([true, true]);
        if (!final.cerradaEn) await prismaAdmin.cuenta.update({ where: { id: cuentaId }, data: { cerradaEn: new Date(), cerradaPorId: s.admin.id } });
      }
    });
  });
});
