import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarConteoFisico, registrarConteosFisicos, resolverConteoPendiente } from "../../src/server/actions/movimientos/conteo-fisico";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";

/**
 * S-09 (plan de endurecimiento de seguridad, tanda T5; D3 del dueño, SIN RESPUESTA todavía: se ejecuta con el DEFECTO, revertible y pendiente de confirmar): aplicar una
 * diferencia de conteo al stock es un AJUSTE, y registrar un Ajuste exige `proceso_ajuste` (piso administrador). Hasta ahora bastaba `proceso_control` (piso operario, lo tiene el
 * rol de fábrica «operador»): un operario ponía `conteoReal: 0` con la acción AJUSTAR sobre hasta 60 productos por llamada y dejaba el stock de la sucursal en cero, y
 * `resolverConteoPendiente("ajustar")` (clave `conteo_resolver_pendiente`, también de operario) aplicaba la diferencia contra el saldo de hoy sin dejar rastro en la auditoría.
 * Ahora el operario REGISTRA el conteo (queda pendiente, con «Falta movimiento») y aplicar la diferencia exige además `proceso_ajuste`.
 */
describe("S-09 (D3, defecto): aplicar la diferencia de un conteo al stock exige proceso_ajuste", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;
  let admin: { id: string; email: string; nombre: null };
  let operario: { id: string; email: string; nombre: null };
  let productos: string[];

  const comoAdmin = () => mockearUsuarioActual(admin);
  const comoOperario = () => mockearUsuarioActual(operario);
  const saldo = (productoId: string) => calcularSaldoTotal(productoId, seccionId, prisma);
  const fila = (productoId: string, conteoReal: number, accion: "AJUSTAR" | "FALTA_MOVIMIENTO" | "DESCARTAR") => ({ productoId, seccionId, conteoReal, fechaConteo: new Date(), accion });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;

    const a = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    admin = { id: a.id, email: a.email, nombre: null };
    const rolOperador = await prisma.rol.findFirstOrThrow({ where: { clave: "operador" } });
    const o = await crearUsuarioConMembresia({ email: "operario@test.com", sucursalId, rolId: rolOperador.id });
    operario = { id: o.id, email: o.email, nombre: null };

    await comoAdmin();
    productos = [];
    for (const codigo of ["MP_A", "MP_B", "MP_C"]) {
      const mp = await sembrarProductoDisponible({ codigo, nombre: `Insumo ${codigo}`, tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });
      productos.push(mp.id);
    }
  });

  it("el operario tiene proceso_control y NO proceso_ajuste (el punto de partida del ataque)", async () => {
    const claves = await prisma.permisoRol.findMany({ where: { rol: { clave: "operador" }, accionClave: { in: ["proceso_control", "proceso_ajuste", "conteo_resolver_pendiente"] }, puedeEditar: true } });
    expect(claves.map((c) => c.accionClave).sort()).toEqual(["conteo_resolver_pendiente", "proceso_control"]);
  });

  describe("registrar el conteo", () => {
    it("ATAQUE: un operario registra AJUSTAR con conteoReal 0 sobre 3 productos en una llamada → no se aplica ninguna (hoy dejaba la sección en cero)", async () => {
      await comoOperario();

      const r = await registrarConteosFisicos(productos.map((p) => fila(p, 0, "AJUSTAR")));

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.resultados.map((x) => x.ok)).toEqual([false, false, false]);
      for (const x of r.resultados) expect(x.mensaje).toContain("permiso de Ajuste");
      for (const p of productos) expect(await saldo(p)).toBe(10);
      expect(await prisma.operacion.count({ where: { proceso: "CONTROL" } })).toBe(0);
      expect(await prisma.conteoFisico.count()).toBe(0);
    });

    it("ATAQUE: lo mismo con el conteo de un solo producto (registrarConteoFisico)", async () => {
      await comoOperario();

      const r = await registrarConteoFisico(fila(productos[0], 0, "AJUSTAR"));

      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("permiso de Ajuste");
      expect(await saldo(productos[0])).toBe(10);
      expect(await prisma.conteoFisico.count()).toBe(0);
    });

    it("el operario sí REGISTRA el conteo: «Falta movimiento» queda pendiente y «Descartar» queda descartado, sin tocar el stock", async () => {
      await comoOperario();

      expect((await registrarConteoFisico(fila(productos[0], 4, "FALTA_MOVIMIENTO"))).ok).toBe(true);
      expect((await registrarConteoFisico(fila(productos[1], 4, "DESCARTAR"))).ok).toBe(true);

      expect((await prisma.conteoFisico.findFirstOrThrow({ where: { productoId: productos[0] } })).estado).toBe("PENDIENTE");
      expect((await prisma.conteoFisico.findFirstOrThrow({ where: { productoId: productos[1] } })).estado).toBe("DESCARTADO");
      for (const p of productos) expect(await saldo(p)).toBe(10);
    });

    it("en una grilla mezclada se rechazan solo las filas AJUSTAR: las demás se registran", async () => {
      await comoOperario();

      const r = await registrarConteosFisicos([fila(productos[0], 0, "AJUSTAR"), fila(productos[1], 4, "FALTA_MOVIMIENTO"), fila(productos[2], 5, "DESCARTAR")]);

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.resultados.map((x) => x.ok)).toEqual([false, true, true]);
      expect(await prisma.conteoFisico.count()).toBe(2);
      for (const p of productos) expect(await saldo(p)).toBe(10);
    });

    it("control: quien tiene proceso_ajuste (el administrador) aplica el ajuste como siempre", async () => {
      await comoAdmin();

      const r = await registrarConteosFisicos([fila(productos[0], 7, "AJUSTAR"), fila(productos[1], 0, "AJUSTAR")]);

      expect(r.ok && r.resultados.every((x) => x.ok)).toBe(true);
      expect(await saldo(productos[0])).toBe(7);
      expect(await saldo(productos[1])).toBe(0);
    });
  });

  describe("resolver un conteo pendiente", () => {
    async function pendiente(contado: number) {
      await comoOperario();
      expect((await registrarConteoFisico(fila(productos[0], contado, "FALTA_MOVIMIENTO"))).ok).toBe(true);
      return prisma.conteoFisico.findFirstOrThrow({ where: { productoId: productos[0], estado: "PENDIENTE" } });
    }

    it("ATAQUE: el operario resuelve un pendiente con «ajustar» → se rechaza, sigue PENDIENTE y no se escribe ningún movimiento (hoy aplicaba la diferencia contra el saldo de hoy)", async () => {
      const conteo = await pendiente(0);
      const movimientosAntes = await prisma.movimientoStock.count();

      const r = await resolverConteoPendiente(conteo.id, "ajustar");

      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("permiso de Ajuste");
      expect(await saldo(productos[0])).toBe(10);
      expect(await prisma.movimientoStock.count()).toBe(movimientosAntes);
      expect((await prisma.conteoFisico.findUniqueOrThrow({ where: { id: conteo.id } })).estado).toBe("PENDIENTE");
    });

    it("el operario sí puede cerrarlo con «Ya se cargó» (no toca el stock)", async () => {
      const conteo = await pendiente(4);

      const r = await resolverConteoPendiente(conteo.id, "resuelto");

      expect(r.ok, r.mensaje).toBe(true);
      expect(await saldo(productos[0])).toBe(10);
      expect((await prisma.conteoFisico.findUniqueOrThrow({ where: { id: conteo.id } })).estado).toBe("RESUELTO");
    });

    it("con proceso_ajuste (el administrador) «ajustar» aplica la diferencia contra el saldo de hoy y deja una fila de auditoría con el saldo y lo contado", async () => {
      const conteo = await pendiente(4);
      await comoAdmin();
      const auditoriaAntes = await prisma.registroAuditoria.count({ where: { entidad: "ConteoFisico", entidadId: conteo.id } });

      const r = await resolverConteoPendiente(conteo.id, "ajustar");

      expect(r.ok, r.mensaje).toBe(true);
      expect(await saldo(productos[0])).toBe(4);
      const filas = await prisma.registroAuditoria.findMany({ where: { entidad: "ConteoFisico", entidadId: conteo.id }, orderBy: { creadoEn: "asc" } });
      expect(filas).toHaveLength(auditoriaAntes + 1); // el alta del conteo ya había dejado la suya
      expect(filas[filas.length - 1]).toMatchObject({ campo: "conteoReal", valorAnterior: "10", valorNuevo: "4", actorId: admin.id, sucursalId });
      expect(filas[filas.length - 1].descripcion).toContain("resuelto con ajuste de -6");
    });

    it("cerrar un pendiente cuyo stock ya coincide no deja fila de auditoría (no cambió nada)", async () => {
      const conteo = await pendiente(4);
      await comoAdmin();
      // Entre medio salieron 6 (una venta, una merma): el saldo de hoy ya coincide con lo contado.
      const salida = await prisma.operacion.create({ data: { sucursalId, proceso: "CONSUMO", fecha: new Date(), usuarioId: admin.id } });
      await prisma.movimientoStock.create({
        data: { operacionId: salida.id, productoId: productos[0], seccionId, proceso: "CONSUMO", cantidad: -6, detalle: "Salida de prueba", precioTotal: 0, precioPorUnidadStock: 0 },
      });
      expect(await saldo(productos[0])).toBe(4);
      const antes = await prisma.registroAuditoria.count();

      const r = await resolverConteoPendiente(conteo.id, "ajustar");

      expect(r.ok, r.mensaje).toBe(true);
      expect(await prisma.registroAuditoria.count()).toBe(antes);
    });
  });
});
