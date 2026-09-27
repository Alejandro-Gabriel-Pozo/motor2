import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { anularItemEnviadoCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/anular-item-enviado";

/**
 * Caso de uso `anularItemEnviadoCasoDeUso` (src/server/actions/pos/casos-de-uso/anular-item-enviado.ts; Task #41, Fase M12c). Postgres
 * real, sin mocks de base ni de sesión: el caso de uso recibe el actor ya resuelto (el permiso lo chequea `conPermiso` en la Server
 * Action, cubierta por test/pos/anular-item-action.test.ts, que no se tocó).
 *
 * Un caso por el éxito (con `datos`, la fila espejo y la auditoría) y uno por cada código de fracaso, con los textos exactos de antes y
 * verificando que un rechazo no escribe nada. También el ORDEN de las validaciones (estado → motivo → guarda optimista → cantidad), que
 * el guard dejó a propósito en el caso de uso. Un `cuentaItemId` que no es un string lo rechaza el guard
 * (test/core/features/cuentas/cuenta-anulacion-guard.test.ts).
 */
describe("anularItemEnviadoCasoDeUso", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let cuenta: Awaited<ReturnType<typeof sembrarCuenta>>;
  let mila: (typeof cuenta.items)[number];
  const actor = () => ({ usuarioId: s.admin.id, sucursalId: s.sucursalId });
  const comando = (cuentaItemId: string, cantidad: unknown, motivo: unknown, restanteVisto: unknown) => ({ cuentaItemId, cantidad, motivo, restanteVisto });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
      { productoId: s.milanesa.id, cantidad: 3, precioUnitario: 9000, numeroEnvio: 2 },
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000 },
    ]);
    mila = cuenta.items[0];
  });

  const nadaEscrito = async () => {
    expect(await prisma.cuentaItem.count({ where: { anulaAItemId: { not: null } } })).toBe(0);
    expect(await prisma.registroAuditoria.count()).toBe(0);
  };

  it("éxito: fila espejo negativa (mismo producto/precio/envío), original intacto, datos, mensaje y auditoría como antes", async () => {
    const r = await anularItemEnviadoCasoDeUso(actor(), comando(mila.id, 2, "  Salió frío  ", 3));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mensaje).toBe("Se anuló 2 × «Milanesa» de la mesa 4.");
    expect(r.datos).toEqual({ espejoId: expect.any(String), cantidadAnulada: 2, restanteAntes: 3, restanteDespues: 1 });
    const espejo = await prisma.cuentaItem.findUniqueOrThrow({ where: { id: r.datos.espejoId } });
    expect({ ...espejo, cantidad: Number(espejo.cantidad), precioUnitario: Number(espejo.precioUnitario) }).toMatchObject({
      cuentaId: cuenta.id,
      productoId: s.milanesa.id,
      cantidad: -2,
      precioUnitario: 9000,
      numeroEnvio: 2,
      anulaAItemId: mila.id,
      motivoAnulacion: "Salió frío",
      creadoPorId: s.admin.id,
      promoCuentaId: null,
    });
    const original = await prisma.cuentaItem.findUniqueOrThrow({ where: { id: mila.id } });
    expect([Number(original.cantidad), original.numeroEnvio, original.anulaAItemId]).toEqual([3, 2, null]);
    const filas = await prisma.registroAuditoria.findMany();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      entidad: "CuentaItem",
      entidadId: mila.id,
      campo: "cantidadVigente",
      valorAnterior: "3",
      valorNuevo: "1",
      actorId: s.admin.id,
      sucursalId: s.sucursalId,
      descripcion: 'Mesa 4, envío 2: anulación de 2 × "Milanesa" ya enviado a cocina. Motivo: Salió frío',
    });
  });

  it("NO_ENCONTRADO: un id que no existe o un ítem de OTRA sucursal", async () => {
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const esperado = { ok: false, codigo: "NO_ENCONTRADO", mensaje: "No se encontró ese ítem en esta sucursal." };
    expect(await anularItemEnviadoCasoDeUso(actor(), comando("no-existe", 1, "x", 3))).toEqual(esperado);
    expect(await anularItemEnviadoCasoDeUso({ usuarioId: s.admin.id, sucursalId: norte.id }, comando(mila.id, 1, "x", 3))).toEqual(esperado);
    await nadaEscrito();
  });

  it("ES_ANULACION: una fila espejo no se anula", async () => {
    const r = await anularItemEnviadoCasoDeUso(actor(), comando(mila.id, 1, "Uno menos", 3));
    if (!r.ok) throw new Error(r.mensaje);
    expect(await anularItemEnviadoCasoDeUso(actor(), comando(r.datos.espejoId, 1, "Otra", -1))).toEqual({
      ok: false,
      codigo: "ES_ANULACION",
      mensaje: "Eso ya es una anulación: no se puede anular.",
    });
    expect(await prisma.cuentaItem.count({ where: { anulaAItemId: r.datos.espejoId } })).toBe(0);
  });

  it("CUENTA_CERRADA: una cuenta cerrada no se toca — y el estado se chequea ANTES que el motivo", async () => {
    await prisma.cuenta.update({ where: { id: cuenta.id }, data: { cerradaEn: new Date() } });
    for (const motivo of ["Tarde", ""]) {
      expect(await anularItemEnviadoCasoDeUso(actor(), comando(mila.id, 1, motivo, 3))).toEqual({
        ok: false,
        codigo: "CUENTA_CERRADA",
        mensaje: "La cuenta de la mesa 4 ya se cerró: anulá la venta (Reportes › Trazabilidad).",
      });
    }
    await nadaEscrito();
  });

  it("SIN_ENVIAR: un borrador se quita, no se anula", async () => {
    expect(await anularItemEnviadoCasoDeUso(actor(), comando(cuenta.items[1].id, 1, "Motivo", 1))).toEqual({
      ok: false,
      codigo: "SIN_ENVIAR",
      mensaje: "Ese ítem todavía no salió a cocina: usá «Quitar».",
    });
    await nadaEscrito();
  });

  it("COMPONENTE_DE_PROMO: un componente no se anula suelto (Task #16, D4)", async () => {
    const seccionCarta = await prisma.seccionCarta.create({ data: { nombre: "Menús M12c" } });
    const promoCarta = await prisma.promoCarta.create({ data: { sucursalId: s.sucursalId, seccionCartaId: seccionCarta.id, titulo: "Menú del día", precio: 10000 } });
    const promo = await prisma.promoCuenta.create({ data: { cuentaId: cuenta.id, promoCartaId: promoCarta.id, precio: 10000, titulo: "Menú del día", creadoPorId: s.admin.id } });
    const componente = await prisma.cuentaItem.create({
      data: { cuentaId: cuenta.id, productoId: s.flan.id, cantidad: 1, precioUnitario: 2500, numeroEnvio: 1, promoCuentaId: promo.id, creadoPorId: s.admin.id },
    });
    expect(await anularItemEnviadoCasoDeUso(actor(), comando(componente.id, 1, "Motivo", 1))).toEqual({
      ok: false,
      codigo: "COMPONENTE_DE_PROMO",
      mensaje: "«Flan» es parte de la promo «Menú del día»: anulá la promo entera.",
    });
    await nadaEscrito();
  });

  it("MOTIVO_INVALIDO: vacío, ausente o demasiado largo — y se chequea ANTES que la guarda optimista y la cantidad", async () => {
    for (const motivo of ["   ", undefined, null]) {
      expect(await anularItemEnviadoCasoDeUso(actor(), comando(mila.id, -5, motivo, 99))).toEqual({ ok: false, codigo: "MOTIVO_INVALIDO", mensaje: "Escribí el motivo de la anulación." });
    }
    const largo = await anularItemEnviadoCasoDeUso(actor(), comando(mila.id, 1, "x".repeat(201), 3));
    expect(largo).toMatchObject({ ok: false, codigo: "MOTIVO_INVALIDO" });
    expect(largo.mensaje).toMatch(/^El motivo no puede superar los \d+ caracteres\.$/);
    await nadaEscrito();
  });

  it("RESTANTE_CAMBIO: la guarda optimista rechaza un número distinto (o que no es un número) — y se chequea ANTES que la cantidad", async () => {
    for (const restanteVisto of [2, "3", undefined]) {
      expect(await anularItemEnviadoCasoDeUso(actor(), comando(mila.id, -5, "Motivo", restanteVisto))).toEqual({
        ok: false,
        codigo: "RESTANTE_CAMBIO",
        mensaje: "«Milanesa» cambió mientras lo mirabas (ahora quedan 3): revisá y volvé a intentar.",
      });
    }
    await nadaEscrito();
  });

  it("RESTANTE_CAMBIO después de otra anulación: el segundo que vio 3 se rechaza (el doble clic no anula dos veces)", async () => {
    expect((await anularItemEnviadoCasoDeUso(actor(), comando(mila.id, 1, "Uno menos", 3))).ok).toBe(true);
    expect(await anularItemEnviadoCasoDeUso(actor(), comando(mila.id, 1, "Uno menos", 3))).toEqual({
      ok: false,
      codigo: "RESTANTE_CAMBIO",
      mensaje: "«Milanesa» cambió mientras lo mirabas (ahora quedan 2): revisá y volvé a intentar.",
    });
    expect(await prisma.cuentaItem.count({ where: { anulaAItemId: mila.id } })).toBe(1);
  });

  it("CANTIDAD_INVALIDA: cero, negativa, NaN, no numérica o > 999 (validarCantidadPedido)", async () => {
    for (const cantidad of [0, -1, Number.NaN, "1", undefined]) {
      expect(await anularItemEnviadoCasoDeUso(actor(), comando(mila.id, cantidad, "Motivo", 3))).toEqual({
        ok: false,
        codigo: "CANTIDAD_INVALIDA",
        mensaje: "La cantidad tiene que ser un número mayor que cero.",
      });
    }
    expect(await anularItemEnviadoCasoDeUso(actor(), comando(mila.id, 1000, "Motivo", 3))).toEqual({ ok: false, codigo: "CANTIDAD_INVALIDA", mensaje: "La cantidad no puede superar 999." });
    await nadaEscrito();
  });

  it("EXCEDE_RESTANTE: no se anula más de lo que queda", async () => {
    expect(await anularItemEnviadoCasoDeUso(actor(), comando(mila.id, 4, "Motivo", 3))).toEqual({
      ok: false,
      codigo: "EXCEDE_RESTANTE",
      mensaje: "No se puede anular más de lo que queda de «Milanesa» (3).",
    });
    await nadaEscrito();
  });
});
