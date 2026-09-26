import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { crearMozo, crearUsuarioConRol, entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { cerrarCuenta, emitirBoletaCorregida } from "../../src/server/actions/pos/cuenta";
import { anularVenta } from "../../src/server/actions/movimientos/venta";
import { obtenerBoletasRecientes } from "../../src/core/pos/boleta";

/**
 * Ejemplar de corrección de la boleta (src/server/actions/pos/cuenta.ts, docs/plan-numeracion-boleta-2026-09-25.md, paso 7): después de
 * anular UNA línea de la venta de una mesa desde Trazabilidad (`anularVenta`), la boleta impresa quedó desactualizada; se emite el
 * ejemplar siguiente con el MISMO número (566-B), `corrigeAId` al A, el motivo y una fila de auditoría. Nunca se edita ni se borra nada.
 */
describe("emitirBoletaCorregida (server action)", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
  });

  /** Mesa cerrada con una Operacion VENTA por línea: 2 milanesas a 9.000, 1 flan a 3.000 y 1 milanesa a 9.500 (boleta 1-A). */
  async function cerrarTresLineas() {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
      { productoId: s.milanesa.id, cantidad: 2, precioUnitario: 9000, numeroEnvio: 1 },
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 },
      { productoId: s.milanesa.id, cantidad: 1, precioUnitario: 9500, numeroEnvio: 2 },
    ]);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
    const ventaDe = async (productoId: string, precioUnitario: number) =>
      (await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId: cuenta.id, productoId, precioUnitario } })).operacionId!;
    return { cuenta, ventaMila: await ventaDe(s.milanesa.id, 9000), ventaFlan: await ventaDe(s.flan.id, 3000), ventaMila2: await ventaDe(s.milanesa.id, 9500) };
  }
  const ejemplaresDe = (cuentaId: string) => prisma.ejemplarBoleta.findMany({ where: { cuentaId }, orderBy: { ejemplar: "asc" } });
  const auditoriaDeCuentas = () => prisma.registroAuditoria.findMany({ where: { entidad: "Cuenta" }, orderBy: { creadoEn: "asc" } });

  it("después de anular una línea: emite el 1-B (mismo número, corrige al A, con motivo), lo audita y la boleta queda vigente con lo que sigue vendido", async () => {
    const { cuenta, ventaFlan } = await cerrarTresLineas();
    expect((await anularVenta(ventaFlan)).ok).toBe(true);

    const r = await emitirBoletaCorregida(cuenta.id, "  No quiso el flan  ");
    expect(r).toEqual({ ok: true, mensaje: "Boleta N.º 1-B emitida: reemplaza a N.º 1-A.", numero: 1, ejemplar: 2 });

    const [a, b] = await ejemplaresDe(cuenta.id);
    expect(b).toMatchObject({ sucursalId: s.sucursalId, numero: 1, ejemplar: 2, corrigeAId: a.id, motivo: "No quiso el flan", emitidoPorId: s.admin.id });
    expect(b.emitidoEn.getTime()).toBeGreaterThanOrEqual(a.emitidoEn.getTime());

    const [boleta] = await obtenerBoletasRecientes(s.sucursalId, s.mesa.id);
    expect(boleta).toMatchObject({ estado: "vigente", numero: { numero: 1, ejemplar: 2 }, corrigeA: { numero: 1, ejemplar: 1 }, total: 27500 });
    expect(boleta.lineas.map((l) => l.producto)).toEqual(["Milanesa", "Milanesa"]);

    const auditoria = await auditoriaDeCuentas();
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({ entidad: "Cuenta", entidadId: cuenta.id, campo: "ejemplarBoleta", valorAnterior: "1-A", valorNuevo: "1-B", actorId: s.admin.id, sucursalId: s.sucursalId });
    expect(auditoria[0].descripcion).toBe("Mesa 4: boleta corregida N.º 1-B (reemplaza a N.º 1-A). Motivo: No quiso el flan");
  });

  it("una segunda emisión sin nuevas anulaciones se rechaza: el B ya las refleja, y no se escribe nada", async () => {
    const { cuenta, ventaFlan } = await cerrarTresLineas();
    await anularVenta(ventaFlan);
    expect((await emitirBoletaCorregida(cuenta.id, "No quiso el flan")).ok).toBe(true);

    expect(await emitirBoletaCorregida(cuenta.id, "Otra vez")).toEqual({ ok: false, mensaje: "La boleta N.º 1-B ya refleja las anulaciones." });
    expect(await ejemplaresDe(cuenta.id)).toHaveLength(2);
    expect(await auditoriaDeCuentas()).toHaveLength(1);
  });

  it("otra anulación después del B: el 1-C corrige también al A (nunca al B), y se audita B → C", async () => {
    const { cuenta, ventaFlan, ventaMila2 } = await cerrarTresLineas();
    await anularVenta(ventaFlan);
    await emitirBoletaCorregida(cuenta.id, "No quiso el flan");
    expect((await anularVenta(ventaMila2)).ok).toBe(true);

    expect(await emitirBoletaCorregida(cuenta.id, "La segunda milanesa no salió")).toEqual({ ok: true, mensaje: "Boleta N.º 1-C emitida: reemplaza a N.º 1-A.", numero: 1, ejemplar: 3 });
    const [a, , c] = await ejemplaresDe(cuenta.id);
    expect(c).toMatchObject({ numero: 1, ejemplar: 3, corrigeAId: a.id, motivo: "La segunda milanesa no salió" });
    expect((await auditoriaDeCuentas()).map((f) => [f.valorAnterior, f.valorNuevo])).toEqual([["1-A", "1-B"], ["1-B", "1-C"]]);
    expect((await obtenerBoletasRecientes(s.sucursalId, s.mesa.id))[0]).toMatchObject({ estado: "vigente", numero: { numero: 1, ejemplar: 3 }, corrigeA: { numero: 1, ejemplar: 1 }, total: 18000 });
  });

  it("sin anulaciones (boleta vigente) se rechaza", async () => {
    const { cuenta } = await cerrarTresLineas();
    expect(await emitirBoletaCorregida(cuenta.id, "Por las dudas")).toEqual({ ok: false, mensaje: "La boleta N.º 1-A ya refleja las anulaciones." });
    expect(await ejemplaresDe(cuenta.id)).toHaveLength(1);
  });

  it("con la venta anulada entera se rechaza: no hay boleta que corregir", async () => {
    const { cuenta, ventaMila, ventaFlan, ventaMila2 } = await cerrarTresLineas();
    for (const id of [ventaMila, ventaFlan, ventaMila2]) await anularVenta(id);
    expect(await emitirBoletaCorregida(cuenta.id, "Se anuló todo")).toEqual({ ok: false, mensaje: "La venta se anuló entera: no hay boleta que corregir." });
    expect(await ejemplaresDe(cuenta.id)).toHaveLength(1);
  });

  it("el motivo es obligatorio (mismo criterio que anular un ítem) y sin él no se escribe nada", async () => {
    const { cuenta, ventaFlan } = await cerrarTresLineas();
    await anularVenta(ventaFlan);
    for (const motivo of ["", "   "]) expect(await emitirBoletaCorregida(cuenta.id, motivo)).toEqual({ ok: false, mensaje: "Escribí el motivo de la anulación." });
    expect(await emitirBoletaCorregida(cuenta.id, "x".repeat(201))).toEqual({ ok: false, mensaje: "El motivo no puede superar los 200 caracteres." });
    expect(await ejemplaresDe(cuenta.id)).toHaveLength(1);
    expect(await auditoriaDeCuentas()).toEqual([]);
  });

  it("una cuenta abierta, o cerrada antes de la numeración (sin ejemplar), no tiene boleta que corregir", async () => {
    const abierta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    expect(await emitirBoletaCorregida(abierta.id, "Motivo")).toEqual({ ok: false, mensaje: "La cuenta de la mesa 4 todavía está abierta: no tiene boleta que corregir." });
    await prisma.cuentaItem.deleteMany({ where: { cuentaId: abierta.id } });
    await prisma.cuenta.delete({ where: { id: abierta.id } });

    const [ventaMila, ventaFlan] = await Promise.all(
      [1, 2].map(() => prisma.operacion.create({ data: { sucursalId: s.sucursalId, proceso: "VENTA", fecha: new Date(), usuarioId: s.admin.id, detalleLibre: "Mesa 4" } }))
    );
    const vieja = await prisma.cuenta.create({
      data: {
        mesaId: s.mesa.id,
        abiertaPorId: s.admin.id,
        cerradaEn: new Date(Date.now() - 60_000),
        cerradaPorId: s.admin.id,
        items: {
          create: [
            { productoId: s.milanesa.id, cantidad: 1, precioUnitario: 9000, numeroEnvio: 1, operacionId: ventaMila.id },
            { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1, operacionId: ventaFlan.id },
          ],
        },
      },
    });
    await prisma.operacion.update({ where: { id: ventaFlan.id }, data: { anuladaEn: new Date() } });
    expect(await emitirBoletaCorregida(vieja.id, "Motivo")).toEqual({
      ok: false,
      mensaje: "La cuenta de la mesa 4 se cerró antes de la numeración de boletas: no tiene boleta que corregir.",
    });
    expect(await prisma.ejemplarBoleta.count()).toBe(0);
  });

  it("aislada por sucursal: una cuenta de otra sucursal no se encuentra, aunque tenga su boleta desactualizada", async () => {
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const mesaNorte = await prisma.mesa.create({ data: { sucursalId: norte.id, numero: 1 } });
    const venta = await prisma.operacion.create({ data: { sucursalId: norte.id, proceso: "VENTA", fecha: new Date(), usuarioId: s.admin.id, anuladaEn: new Date(Date.now() + 1_000) } });
    const otra = await prisma.operacion.create({ data: { sucursalId: norte.id, proceso: "VENTA", fecha: new Date(), usuarioId: s.admin.id } });
    const ajena = await prisma.cuenta.create({
      data: {
        mesaId: mesaNorte.id,
        abiertaPorId: s.admin.id,
        cerradaEn: new Date(),
        cerradaPorId: s.admin.id,
        items: {
          create: [
            { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1, operacionId: venta.id },
            { productoId: s.milanesa.id, cantidad: 1, precioUnitario: 9000, numeroEnvio: 1, operacionId: otra.id },
          ],
        },
      },
    });
    await prisma.ejemplarBoleta.create({ data: { sucursalId: norte.id, cuentaId: ajena.id, numero: 1, emitidoPorId: s.admin.id } });

    expect(await emitirBoletaCorregida(ajena.id, "Motivo")).toEqual({ ok: false, mensaje: "No se encontró esa cuenta en esta sucursal." });
    expect(await emitirBoletaCorregida("no-existe", "Motivo")).toEqual({ ok: false, mensaje: "No se encontró esa cuenta en esta sucursal." });
    expect(await prisma.ejemplarBoleta.count()).toBe(1);
  });

  it("sin pos_cerrar_cuenta Editar no se puede: ni el mozo ni uno que solo lo VE; un cajero con solo ese permiso sí", async () => {
    const { cuenta, ventaFlan } = await cerrarTresLineas();
    await anularVenta(ventaFlan);
    const mozo = await crearMozo(s.sucursalId);
    const soloVe = await crearUsuarioConRol(s.sucursalId, "cajero-solo-ve", [{ clave: "pos_cerrar_cuenta", ver: true, editar: false }]);
    for (const usuario of [mozo, soloVe]) {
      await entrarComo(usuario);
      const r = await emitirBoletaCorregida(cuenta.id, "Motivo");
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/No tenés permiso/);
      expect(r.mensaje).toContain('"pos_cerrar_cuenta"');
    }
    expect(await ejemplaresDe(cuenta.id)).toHaveLength(1);

    const cajero = await crearUsuarioConRol(s.sucursalId, "cajero", [{ clave: "pos_cerrar_cuenta", ver: true, editar: true }]);
    await entrarComo(cajero);
    expect((await emitirBoletaCorregida(cuenta.id, "No quiso el flan")).ok).toBe(true);
    expect((await ejemplaresDe(cuenta.id))[1].emitidoPorId).toBe(cajero.id);
  });
});
