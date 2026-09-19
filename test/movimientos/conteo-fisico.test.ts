import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarConteoFisico, registrarConteosFisicos, resolverConteoPendiente, cancelarConteoFisico, obtenerHistorialConteosFisicos } from "../../src/server/actions/movimientos/conteo-fisico";
import { getUsuarioActual } from "../../src/core/auth/session";
import { calcularSaldoTotal } from "../../src/core/movimientos/stock";

describe("Conteo Físico", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;
  let mpId: string;
  let adminOriginal: { id: string; email: string; nombre: null };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    adminOriginal = { id: admin.id, email: admin.email, nombre: null };
    await mockearUsuarioActual(adminOriginal);

    const mp = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Yerba", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    mpId = mp.id;
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 10 }] });
  });

  it("AJUSTAR escribe el movimiento de corrección y el saldo queda en lo contado", async () => {
    const resultado = await registrarConteoFisico({
      productoId: mpId, seccionId, conteoReal: 7, fechaConteo: new Date(), accion: "AJUSTAR",
    });
    expect(resultado.ok).toBe(true);
    expect(await calcularSaldoTotal(mpId, seccionId)).toBe(7);

    const conteo = await prisma.conteoFisico.findFirstOrThrow({ where: { productoId: mpId } });
    expect(conteo.estado).toBe("RESUELTO");
    expect(Number(conteo.diferencia)).toBe(-3);
  });

  it("FALTA_MOVIMIENTO no toca el stock y queda PENDIENTE", async () => {
    const resultado = await registrarConteoFisico({
      productoId: mpId, seccionId, conteoReal: 15, fechaConteo: new Date(), accion: "FALTA_MOVIMIENTO",
    });
    expect(resultado.ok).toBe(true);
    expect(await calcularSaldoTotal(mpId, seccionId)).toBe(10); // sin cambios

    const conteo = await prisma.conteoFisico.findFirstOrThrow({ where: { productoId: mpId } });
    expect(conteo.estado).toBe("PENDIENTE");
  });

  it("DESCARTAR no toca el stock y no cuenta como conteo válido", async () => {
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 2, fechaConteo: new Date(), accion: "DESCARTAR" });
    expect(await calcularSaldoTotal(mpId, seccionId)).toBe(10);

    const conteo = await prisma.conteoFisico.findFirstOrThrow({ where: { productoId: mpId } });
    expect(conteo.estado).toBe("DESCARTADO");
  });

  it("diferencia 0 queda RESUELTO aunque la acción elegida no ajuste", async () => {
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 10, fechaConteo: new Date(), accion: "FALTA_MOVIMIENTO" });
    const conteo = await prisma.conteoFisico.findFirstOrThrow({ where: { productoId: mpId } });
    expect(conteo.estado).toBe("RESUELTO");
  });

  it("resolverConteoPendiente('resuelto') cierra sin tocar stock", async () => {
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 15, fechaConteo: new Date(), accion: "FALTA_MOVIMIENTO" });
    const conteo = await prisma.conteoFisico.findFirstOrThrow({ where: { productoId: mpId } });

    const resultado = await resolverConteoPendiente(conteo.id, "resuelto");
    expect(resultado.ok).toBe(true);
    expect(await calcularSaldoTotal(mpId, seccionId)).toBe(10);
    expect((await prisma.conteoFisico.findUniqueOrThrow({ where: { id: conteo.id } })).estado).toBe("RESUELTO");
  });

  it("resolverConteoPendiente('ajustar') ajusta contra el saldo de HOY, no el del día del conteo", async () => {
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 15, fechaConteo: new Date(), accion: "FALTA_MOVIMIENTO" });
    const conteo = await prisma.conteoFisico.findFirstOrThrow({ where: { productoId: mpId } });

    // Entre medio se cargó otra Compra — el saldo de "hoy" ya no es el de cuando se contó.
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 3 }] });

    const resultado = await resolverConteoPendiente(conteo.id, "ajustar");
    expect(resultado.ok).toBe(true);
    expect(await calcularSaldoTotal(mpId, seccionId)).toBe(15); // 13 (10+3) + ajuste de 2 = 15
  });

  it("cancelarConteoFisico revierte exactamente el ajuste, y una segunda cancelación falla", async () => {
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 7, fechaConteo: new Date(), accion: "AJUSTAR" });
    const conteo = await prisma.conteoFisico.findFirstOrThrow({ where: { productoId: mpId } });
    expect(await calcularSaldoTotal(mpId, seccionId)).toBe(7);

    const cancelado = await cancelarConteoFisico(conteo.id);
    expect(cancelado.ok).toBe(true);
    expect(await calcularSaldoTotal(mpId, seccionId)).toBe(10); // vuelve al saldo de antes del ajuste

    const segundaCancelacion = await cancelarConteoFisico(conteo.id);
    expect(segundaCancelacion.ok).toBe(false);
  });

  it("cancelarConteoFisico rechaza un conteo que nunca ajustó nada (Pendiente/Descartado)", async () => {
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 2, fechaConteo: new Date(), accion: "DESCARTAR" });
    const conteo = await prisma.conteoFisico.findFirstOrThrow({ where: { productoId: mpId } });

    const resultado = await cancelarConteoFisico(conteo.id);
    expect(resultado.ok).toBe(false);
  });

  it("cancelarConteoFisico y resolverConteoPendiente rechazan un conteo de otra sucursal, aunque el usuario tenga el permiso en la suya", async () => {
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 7, fechaConteo: new Date(), accion: "AJUSTAR" });
    const conteoResuelto = await prisma.conteoFisico.findFirstOrThrow({ where: { productoId: mpId } });
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 20, fechaConteo: new Date(), accion: "FALTA_MOVIMIENTO" });
    const conteoPendiente = await prisma.conteoFisico.findFirstOrThrow({ where: { productoId: mpId, estado: "PENDIENTE" } });

    const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Otra sucursal" } });
    const otroAdmin = await crearUsuarioConMembresia({
      email: "admin2@test.com",
      sucursalId: otraSucursal.id,
      rolId: (await prisma.rol.findUniqueOrThrow({ where: { nombre: "admin" } })).id,
    });
    await mockearUsuarioActual({ id: otroAdmin.id, email: otroAdmin.email, nombre: null });

    const cancelado = await cancelarConteoFisico(conteoResuelto.id);
    expect(cancelado.ok).toBe(false);
    const resuelto = await resolverConteoPendiente(conteoPendiente.id, "resuelto");
    expect(resuelto.ok).toBe(false);

    // El estado original no se tocó — el rechazo fue antes de cualquier escritura.
    expect((await prisma.conteoFisico.findUniqueOrThrow({ where: { id: conteoResuelto.id } })).estado).toBe("RESUELTO");
    expect((await prisma.conteoFisico.findUniqueOrThrow({ where: { id: conteoPendiente.id } })).estado).toBe("PENDIENTE");
  });

  it("obtenerHistorialConteosFisicos nunca mezcla conteos de otra sucursal (bug encontrado escribiendo la UI)", async () => {
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 7, fechaConteo: new Date(), accion: "AJUSTAR" });

    const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Otra sucursal" } });
    const otraSeccion = await sembrarSeccion(otraSucursal.id, "Depósito otra sucursal");
    const otroMp = await prisma.producto.create({ data: { codigo: "MP_2", nombre: "Café", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    const otroAdmin = await crearUsuarioConMembresia({ email: "admin2@test.com", sucursalId: otraSucursal.id, rolId: (await prisma.rol.findUniqueOrThrow({ where: { nombre: "admin" } })).id });
    await mockearUsuarioActual({ id: otroAdmin.id, email: otroAdmin.email, nombre: null });
    await registrarConteoFisico({ productoId: otroMp.id, seccionId: otraSeccion.id, conteoReal: 3, fechaConteo: new Date(), accion: "AJUSTAR" });

    // El historial de una sucursal solo lo puede leer alguien de esa sucursal: cada lectura, con el admin que le corresponde.
    await mockearUsuarioActual(adminOriginal);
    const historialSucursalOriginal = await obtenerHistorialConteosFisicos(sucursalId);
    expect(historialSucursalOriginal.items).toHaveLength(1);
    expect(historialSucursalOriginal.items[0].productoId).toBe(mpId);

    await mockearUsuarioActual({ id: otroAdmin.id, email: otroAdmin.email, nombre: null });
    const historialOtraSucursal = await obtenerHistorialConteosFisicos(otraSucursal.id);
    expect(historialOtraSucursal.items).toHaveLength(1);
    expect(historialOtraSucursal.items[0].productoId).toBe(otroMp.id);
  });

  it("obtenerHistorialConteosFisicos pagina por cursor sin repetir ni saltar filas", async () => {
    for (let i = 0; i < 7; i++) {
      await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: i, fechaConteo: new Date(2026, 0, i + 1), accion: "AJUSTAR" });
    }

    const pagina1 = await obtenerHistorialConteosFisicos(sucursalId);
    expect(pagina1.items).toHaveLength(7); // menos que TAMANO_PAGINA_CONTEOS: entran todos, sin próxima página
    expect(pagina1.nextCursor).toBeNull();

    const cursor = pagina1.items[2].id;
    const pagina2 = await obtenerHistorialConteosFisicos(sucursalId, { cursor });
    expect(pagina2.items.map((c) => c.id)).not.toContain(cursor);
    expect(pagina2.items).toHaveLength(4); // las 4 filas que quedaban después del cursor
  });

  it("obtenerHistorialConteosFisicos filtra por producto y por rango de fechas (hallazgo de la auditoría: existían pero nunca se exponían)", async () => {
    const otroMp = await prisma.producto.create({ data: { codigo: "MP_2", nombre: "Café", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: otroMp.id, cantidad: 5 }] });

    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 3, fechaConteo: new Date(2026, 0, 5), accion: "AJUSTAR" });
    await registrarConteoFisico({ productoId: otroMp.id, seccionId, conteoReal: 2, fechaConteo: new Date(2026, 0, 15), accion: "AJUSTAR" });

    const porProducto = await obtenerHistorialConteosFisicos(sucursalId, { productoId: mpId });
    expect(porProducto.items).toHaveLength(1);
    expect(porProducto.items[0].productoId).toBe(mpId);

    const porFecha = await obtenerHistorialConteosFisicos(sucursalId, { desde: new Date(2026, 0, 10), hasta: new Date(2026, 0, 20) });
    expect(porFecha.items).toHaveLength(1);
    expect(porFecha.items[0].productoId).toBe(otroMp.id);
  });

  it("Fase 6 (auditoría de seguridad/contratos): rechaza un seccionId de OTRA sucursal aunque el usuario tenga permiso en la suya", async () => {
    const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Otra sucursal" } });
    const seccionAjena = await sembrarSeccion(otraSucursal.id);

    const resultado = await registrarConteoFisico({ productoId: mpId, seccionId: seccionAjena.id, conteoReal: 5, fechaConteo: new Date(), accion: "AJUSTAR" });

    expect(resultado.ok).toBe(false);
    expect(await prisma.conteoFisico.count({ where: { sucursalId: otraSucursal.id } })).toBe(0);
  });
  describe("registrarConteosFisicos (toda la grilla en una llamada)", () => {
    async function crearMpConStock(codigo: string, cantidad: number) {
      const mp = await prisma.producto.create({ data: { codigo, nombre: `Producto ${codigo}`, tipo: "MP", unidadStockId: unidadKgId, insumoId } });
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad }] });
      return mp;
    }
    const fila = (productoId: string, conteoReal: number, accion: "AJUSTAR" | "FALTA_MOVIMIENTO" | "DESCARTAR" = "AJUSTAR") => ({
      productoId,
      seccionId,
      conteoReal,
      fechaConteo: new Date(),
      accion,
    });

    it("registra todas las filas, con un resultado por fila en el mismo orden, y ajusta el stock de las que corresponde", async () => {
      const b = await crearMpConStock("MP_B", 8);
      const c = await crearMpConStock("MP_C", 4);

      const r = await registrarConteosFisicos([fila(mpId, 7), fila(b.id, 8), fila(c.id, 6, "FALTA_MOVIMIENTO")]);

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.resultados).toHaveLength(3);
      expect(r.resultados.every((x) => x.ok)).toBe(true);
      expect(r.resultados[0].mensaje).toContain("Diferencia: -3 (ajustada)"); // mpId tenía 10, se contaron 7
      expect(r.resultados[1].mensaje).toContain("El stock ya coincidía"); // b: 8 = 8
      expect(r.resultados[2].mensaje).toContain("Diferencia: +2"); // c: 4 → 6, queda pendiente, no se ajusta
      expect(r.mensaje).toBe("3 de 3 conteo(s) registrado(s).");

      expect(await prisma.conteoFisico.count()).toBe(3);
      expect(await calcularSaldoTotal(mpId, seccionId)).toBe(7); // ajustado
      expect(await calcularSaldoTotal(c.id, seccionId)).toBe(4); // FALTA_MOVIMIENTO no toca el stock
    });

    it("una fila con error no frena a las demás: cada una devuelve su propio resultado", async () => {
      const b = await crearMpConStock("MP_B", 8);

      const r = await registrarConteosFisicos([fila(mpId, 7), fila(b.id, -1), fila("no-existe", 1), fila(b.id, 5)]);

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.resultados.map((x) => x.ok)).toEqual([true, false, false, true]);
      expect(r.resultados[1].mensaje).toContain("mayor o igual a 0");
      expect(r.resultados[2].mensaje).toContain("no existe");
      expect(r.mensaje).toBe("2 de 4 conteo(s) registrado(s).");
      expect(await prisma.conteoFisico.count()).toBe(2);
    });

    it("la sesión se comprueba una vez, al principio: sin sesión no se escribe NINGUNA fila (lleva al login)", async () => {
      vi.mocked(getUsuarioActual).mockResolvedValue(null);

      await expect(registrarConteosFisicos([fila(mpId, 7), fila(mpId, 6)])).rejects.toMatchObject({
        digest: expect.stringMatching(/^NEXT_REDIRECT;[a-z]+;\/login;/),
      });
      expect(await prisma.conteoFisico.count()).toBe(0);
    });

    it("sin el permiso de Control no se escribe nada y se avisa (un mensaje, no un redirect)", async () => {
      const base = await prisma.rol.findUniqueOrThrow({ where: { nombre: "operador" } });
      await prisma.permisoRol.update({ where: { rolId_accionClave: { rolId: base.id, accionClave: "proceso_control" } }, data: { puedeEditar: false } });
      const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.id });
      await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });

      const r = await registrarConteosFisicos([fila(mpId, 7)]);
      expect(r.ok).toBe(false);
      expect(await prisma.conteoFisico.count()).toBe(0);
    });

    it("una lista vacía y una lista demasiado larga se rechazan sin escribir nada", async () => {
      expect((await registrarConteosFisicos([])).ok).toBe(false);

      const demasiadas = Array.from({ length: 61 }, () => fila(mpId, 7));
      const r = await registrarConteosFisicos(demasiadas);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("demasiados");
      expect(await prisma.conteoFisico.count()).toBe(0);
    });

    it("una excepción inesperada en una fila (no un rechazo de negocio) queda como el resultado de ESA fila y no tira la llamada: las demás se escriben", async () => {
      const espia = vi.spyOn(console, "error").mockImplementation(() => {});
      const b = await crearMpConStock("MP_B", 8);

      // Una fecha inválida hace lanzar a Prisma dentro de la transacción (no es un `return error(...)`).
      const r = await registrarConteosFisicos([fila(mpId, 7), { ...fila(b.id, 5), fechaConteo: new Date("no-es-una-fecha") }, fila(b.id, 6)]);
      espia.mockRestore();

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.resultados.map((x) => x.ok)).toEqual([true, false, true]);
      expect(r.resultados[1].mensaje).toContain("error inesperado");
      expect(await prisma.conteoFisico.count()).toBe(2);
    });

    it("un producto de otra sección o sucursal sigue rechazándose por fila (el chequeo de sección no se perdió al agrupar)", async () => {
      const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Otra sucursal" } });
      const seccionAjena = await sembrarSeccion(otraSucursal.id);

      const r = await registrarConteosFisicos([fila(mpId, 7), { ...fila(mpId, 5), seccionId: seccionAjena.id }]);

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.resultados.map((x) => x.ok)).toEqual([true, false]);
      expect(await prisma.conteoFisico.count({ where: { sucursalId: otraSucursal.id } })).toBe(0);
    });
  });
});
