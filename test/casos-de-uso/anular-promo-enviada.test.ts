import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { anularPromoEnviadaCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/anular-promo-enviada";

/**
 * Caso de uso `anularPromoEnviadaCasoDeUso` (src/server/actions/pos/casos-de-uso/anular-promo-enviada.ts; Task #41, Fase M12d). Postgres
 * real, sin mocks de base ni de sesión: el caso de uso recibe el actor ya resuelto (el permiso lo chequea `conPermiso` en la Server
 * Action, cubierta por test/pos/promo-cuenta-action.test.ts, que no se tocó).
 *
 * Un caso por el éxito (con `datos`, una fila espejo y una fila de auditoría POR componente, todas con el mismo `promoCuentaId`) y uno
 * por cada código de fracaso, con los textos exactos de antes y verificando que un rechazo no escribe nada. También el ORDEN de las
 * validaciones (estado → motivo → «ya anulada»), que el guard dejó a propósito en el caso de uso. Un `promoCuentaId` que no es un
 * string lo rechaza el guard (test/core/features/cuentas/cuenta-anulacion-guard.test.ts).
 */
describe("anularPromoEnviadaCasoDeUso", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let cuenta: Awaited<ReturnType<typeof sembrarCuenta>>;
  let promoId: string;
  let mila: { id: string };
  let flan: { id: string };
  const actor = () => ({ usuarioId: s.admin.id, sucursalId: s.sucursalId, ...baseDeTest });
  const comando = (promoCuentaId: string, motivo: unknown) => ({ promoCuentaId, motivo });

  /** Una promo «Menú del día» con dos componentes (Milanesa ×1 y Flan ×2), con los envíos dados (`null` = borrador). */
  async function sembrarPromo(envios: [number | null, number | null]) {
    const seccionCarta = await prisma.seccionCarta.create({ data: { nombre: "Menús M12d" } });
    const promoCarta = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: s.sucursalId } }, seccionCartaId: seccionCarta.id, titulo: "Menú del día", precio: 12000 } });
    const promo = await prisma.promoCuenta.create({ data: { cuentaId: cuenta.id, promoCartaId: promoCarta.id, precio: 12000, titulo: "Menú del día", creadoPorId: s.admin.id } });
    promoId = promo.id;
    mila = await prisma.cuentaItem.create({
      data: { cuentaId: cuenta.id, productoId: s.milanesa.id, cantidad: 1, precioUnitario: 8000, precioCartaUnitario: 9000, numeroEnvio: envios[0], promoCuentaId: promo.id, creadoPorId: s.admin.id },
    });
    flan = await prisma.cuentaItem.create({
      data: { cuentaId: cuenta.id, productoId: s.flan.id, cantidad: 2, precioUnitario: 2000, numeroEnvio: envios[1], promoCuentaId: promo.id, creadoPorId: s.admin.id },
    });
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
  });

  const nadaEscrito = async () => {
    expect(await prisma.cuentaItem.count({ where: { anulaAItemId: { not: null } } })).toBe(0);
    expect(await prisma.registroAuditoria.count()).toBe(0);
  };

  it("éxito: una fila espejo por componente (resto íntegro, mismo promoCuentaId y precios), originales intactos, datos, mensaje y auditoría", async () => {
    await sembrarPromo([2, 3]);
    const r = await anularPromoEnviadaCasoDeUso(actor(), comando(promoId, "  Se cayó la mesa  "));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mensaje).toBe("Se anuló la promo «Menú del día» de la mesa 4 (2 componentes).");
    expect(r.datos.componentes).toHaveLength(2);
    expect([...r.datos.componentes].sort((a, b) => a.cantidadAnulada - b.cantidadAnulada)).toEqual([
      { cuentaItemId: mila.id, espejoId: expect.any(String), cantidadAnulada: 1 },
      { cuentaItemId: flan.id, espejoId: expect.any(String), cantidadAnulada: 2 },
    ]);

    const espejos = await prisma.cuentaItem.findMany({ where: { anulaAItemId: { not: null } } });
    expect(espejos.map((e) => e.id).sort()).toEqual(r.datos.componentes.map((c) => c.espejoId).sort());
    const espejoMila = espejos.find((e) => e.anulaAItemId === mila.id)!;
    const espejoFlan = espejos.find((e) => e.anulaAItemId === flan.id)!;
    const plano = (e: (typeof espejos)[number]) => ({
      ...e,
      cantidad: Number(e.cantidad),
      precioUnitario: Number(e.precioUnitario),
      precioCartaUnitario: e.precioCartaUnitario === null ? null : Number(e.precioCartaUnitario),
    });
    expect(plano(espejoMila)).toMatchObject({
      cuentaId: cuenta.id,
      productoId: s.milanesa.id,
      cantidad: -1,
      precioUnitario: 8000,
      precioCartaUnitario: 9000,
      numeroEnvio: 2,
      motivoAnulacion: "Se cayó la mesa",
      creadoPorId: s.admin.id,
      promoCuentaId: promoId,
    });
    expect(plano(espejoFlan)).toMatchObject({ productoId: s.flan.id, cantidad: -2, precioUnitario: 2000, precioCartaUnitario: null, numeroEnvio: 3, promoCuentaId: promoId });

    const originales = await prisma.cuentaItem.findMany({ where: { id: { in: [mila.id, flan.id] } }, orderBy: { cantidad: "asc" } });
    expect(originales.map((o) => [Number(o.cantidad), o.anulaAItemId, o.motivoAnulacion])).toEqual([
      [1, null, null],
      [2, null, null],
    ]);

    const filas = await prisma.registroAuditoria.findMany();
    expect(filas).toHaveLength(2);
    const filaDe = (id: string) => filas.find((f) => f.entidadId === id);
    expect(filaDe(mila.id)).toMatchObject({
      entidad: "CuentaItem",
      campo: "cantidadVigente",
      valorAnterior: "1",
      valorNuevo: "0",
      actorId: s.admin.id,
      sucursalId: s.sucursalId,
      descripcion: 'Mesa 4, envío 2: anulación de la promo «Menú del día» ya enviada a cocina — 1 × "Milanesa". Motivo: Se cayó la mesa',
    });
    expect(filaDe(flan.id)).toMatchObject({
      valorAnterior: "2",
      valorNuevo: "0",
      descripcion: 'Mesa 4, envío 3: anulación de la promo «Menú del día» ya enviada a cocina — 2 × "Flan". Motivo: Se cayó la mesa',
    });
  });

  it("solo anula el RESTO de cada componente, y saltea el que ya no tiene nada (singular en el mensaje)", async () => {
    await sembrarPromo([1, 1]);
    // Una anulación previa (p. ej. de una versión anterior): el Flan ya quedó en 0.
    await prisma.cuentaItem.create({
      data: { cuentaId: cuenta.id, productoId: s.flan.id, cantidad: -2, precioUnitario: 2000, numeroEnvio: 1, anulaAItemId: flan.id, motivoAnulacion: "x", promoCuentaId: promoId, creadoPorId: s.admin.id },
    });

    const r = await anularPromoEnviadaCasoDeUso(actor(), comando(promoId, "Motivo"));
    expect(r).toMatchObject({ ok: true, mensaje: "Se anuló la promo «Menú del día» de la mesa 4 (1 componente).", datos: { componentes: [{ cuentaItemId: mila.id, cantidadAnulada: 1 }] } });
    expect(await prisma.cuentaItem.count({ where: { anulaAItemId: flan.id } })).toBe(1);
    expect(await prisma.registroAuditoria.count()).toBe(1);
  });

  it("NO_ENCONTRADA: un id que no existe o una promo de OTRA sucursal", async () => {
    await sembrarPromo([1, 1]);
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const esperado = { ok: false, codigo: "NO_ENCONTRADA", mensaje: "No se encontró esa promo en esta sucursal." };
    expect(await anularPromoEnviadaCasoDeUso(actor(), comando("no-existe", "x"))).toEqual(esperado);
    expect(await anularPromoEnviadaCasoDeUso({ usuarioId: s.admin.id, sucursalId: norte.id, ...baseDeTest }, comando(promoId, "x"))).toEqual(esperado);
    await nadaEscrito();
  });

  it("CUENTA_CERRADA: una cuenta cerrada no se toca — y el estado se chequea ANTES que el motivo", async () => {
    await sembrarPromo([1, 1]);
    await prisma.cuenta.update({ where: { id: cuenta.id }, data: { cerradaEn: new Date() } });
    for (const motivo of ["Tarde", ""]) {
      expect(await anularPromoEnviadaCasoDeUso(actor(), comando(promoId, motivo))).toEqual({
        ok: false,
        codigo: "CUENTA_CERRADA",
        mensaje: "La cuenta de la mesa 4 ya se cerró: anulá la venta (Reportes › Trazabilidad).",
      });
    }
    await nadaEscrito();
  });

  it("SIN_COMPONENTES: una promo sin ningún componente original", async () => {
    await sembrarPromo([1, 1]);
    await prisma.cuentaItem.deleteMany({ where: { promoCuentaId: promoId } });
    expect(await anularPromoEnviadaCasoDeUso(actor(), comando(promoId, "Motivo"))).toEqual({
      ok: false,
      codigo: "SIN_COMPONENTES",
      mensaje: "Esa promo no tiene ningún componente.",
    });
    await nadaEscrito();
  });

  it.each([
    [null, null],
    [2, null],
  ] as [number | null, number | null][])("SIN_ENVIAR (envíos %j, %j): si algún componente es borrador, se quita la promo — y se chequea ANTES que el motivo", async (envioMila, envioFlan) => {
    await sembrarPromo([envioMila, envioFlan]);
    for (const motivo of ["Motivo", ""]) {
      expect(await anularPromoEnviadaCasoDeUso(actor(), comando(promoId, motivo))).toEqual({
        ok: false,
        codigo: "SIN_ENVIAR",
        mensaje: "Esa promo todavía no salió a cocina: usá «Quitar promo».",
      });
    }
    await nadaEscrito();
  });

  it("MOTIVO_INVALIDO: vacío, ausente o demasiado largo — y se chequea ANTES que «ya anulada»", async () => {
    await sembrarPromo([1, 1]);
    for (const motivo of ["   ", undefined, null]) {
      expect(await anularPromoEnviadaCasoDeUso(actor(), comando(promoId, motivo))).toEqual({ ok: false, codigo: "MOTIVO_INVALIDO", mensaje: "Escribí el motivo de la anulación." });
    }
    const largo = await anularPromoEnviadaCasoDeUso(actor(), comando(promoId, "x".repeat(201)));
    expect(largo).toMatchObject({ ok: false, codigo: "MOTIVO_INVALIDO" });
    expect(largo.mensaje).toMatch(/^El motivo no puede superar los \d+ caracteres\.$/);
    await nadaEscrito();

    expect((await anularPromoEnviadaCasoDeUso(actor(), comando(promoId, "Primera"))).ok).toBe(true);
    expect(await anularPromoEnviadaCasoDeUso(actor(), comando(promoId, ""))).toMatchObject({ ok: false, codigo: "MOTIVO_INVALIDO" });
  });

  it("YA_ANULADA: la segunda anulación (doble clic) no escribe nada", async () => {
    await sembrarPromo([1, 2]);
    expect((await anularPromoEnviadaCasoDeUso(actor(), comando(promoId, "Primera"))).ok).toBe(true);
    expect(await anularPromoEnviadaCasoDeUso(actor(), comando(promoId, "De nuevo"))).toEqual({
      ok: false,
      codigo: "YA_ANULADA",
      mensaje: "La promo «Menú del día» ya está anulada entera.",
    });
    expect(await prisma.cuentaItem.count({ where: { anulaAItemId: { not: null } } })).toBe(2);
    expect(await prisma.registroAuditoria.count()).toBe(2);
  });
});
