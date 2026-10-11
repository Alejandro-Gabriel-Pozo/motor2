import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { registrarMovimientoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-movimiento";
import { PROCESOS_UI } from "../../src/core/movimientos/ui-config";
import type { DatosMovimientoInput } from "../../src/core/features/movimientos/movimiento.schema";
import type { Transaccion } from "../../src/lib/db-tipos";

/**
 * U11 (auditoría de abstracciones 2026-10-11, N4-8): `registrarMovimientoCasoDeUso` tiene que exigir EN EL SERVIDOR lo que la pantalla exige, y comprobar que el motivo, el
 * destino y el proveedor sigan activos DENTRO de la transacción (antes solo lo hacía ANTES de abrirla: un maestro desactivado en el medio quedaba guardado igual).
 *
 * Sin base de datos: el caso de uso se llama con un cliente y una transacción falsos (solo lo que las validaciones leen). Lo que corre DESPUÉS de las validaciones (armado de
 * líneas, stock, escritura) lo cubren los tests con base de `registrar-movimiento.test.ts`.
 *
 * Qué exige hoy la pantalla (`panel-movimiento-form.tsx`): SOLO el motivo de la Merma es obligatorio (`<select required>`). El proveedor de Compra/Devolución a proveedor
 * («Sin proveedor») y el destino de Consumo («Sin destino específico») son opcionales en la UI, así que el servidor tampoco los exige.
 */
const SUCURSAL = "suc-1";
const SECCION = "sec-1";
const base = { fecha: new Date("2026-10-11T12:00:00Z"), seccionId: SECCION, items: [{ productoId: "p-1", cantidad: 1 }] };

type Maestros = { motivo?: boolean | null; destino?: boolean | null; proveedor?: boolean | null };

/** Cliente falso: la sección es de la sucursal y cada maestro responde `activo` (o no existe si es `null`). */
function dbFalso(m: Maestros): Prisma.TransactionClient {
  const fila = (activo: boolean | null | undefined) => async () => (activo === null || activo === undefined ? null : { activo });
  return {
    seccion: { findUnique: async () => ({ id: SECCION, sucursalId: SUCURSAL }) },
    motivoMerma: { findUnique: fila(m.motivo) },
    destinoConsumo: { findUnique: fila(m.destino) },
    proveedor: { findUnique: fila(m.proveedor) },
  } as unknown as Prisma.TransactionClient;
}

/** Transacción falsa: cuenta cuántas veces se abrió y, si `correr`, ejecuta el callback con el cliente que se le diga (el estado «dentro» de la transacción). */
function transaccionFalsa(dentro: Maestros | null) {
  const estado = { abierta: 0 };
  const transaccion = (async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    estado.abierta++;
    if (dentro === null) return { ok: true, mensaje: "Se guardaron 1 movimiento(s).", operacionId: "op-1", movimientos: 1, repetida: false };
    return fn(dbFalso(dentro));
  }) as unknown as Transaccion;
  return { transaccion, estado };
}

function llamar(datos: Partial<DatosMovimientoInput> & { proceso: DatosMovimientoInput["proceso"] }, fuera: Maestros, dentro: Maestros | null) {
  const { transaccion, estado } = transaccionFalsa(dentro);
  const actor = { usuarioId: "u-1", sucursalId: SUCURSAL, sucursalNombre: "Central", db: dbFalso(fuera), transaccion };
  return registrarMovimientoCasoDeUso(actor as unknown as Parameters<typeof registrarMovimientoCasoDeUso>[0],{ ...base, ...datos } as DatosMovimientoInput).then((r) => ({ r, estado }));
}

describe("U11: la Merma exige un motivo en el servidor", () => {
  it("sin motivo no se registra (ni se abre la transacción) y el mensaje dice qué falta y cómo resolverlo", async () => {
    const { r, estado } = await llamar({ proceso: "MERMA" }, {}, null);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toBe("La merma necesita un motivo: elegí uno de la lista (si no está el que buscás, pedí que lo carguen en Motivos de merma).");
    expect(estado.abierta).toBe(0);
  });

  it("un motivo vacío o en blanco tampoco cuenta", async () => {
    for (const motivoId of ["", "   "]) {
      const { r, estado } = await llamar({ proceso: "MERMA", motivoId }, {}, null);
      expect(r.ok).toBe(false);
      expect(estado.abierta).toBe(0);
    }
  });

  it("con un motivo activo pasa las validaciones (llega a abrir la transacción)", async () => {
    const { r, estado } = await llamar({ proceso: "MERMA", motivoId: "m-1" }, { motivo: true }, null);
    expect(r.ok).toBe(true);
    expect(estado.abierta).toBe(1);
  });

  it("un motivo que no existe o está desactivado se sigue rechazando con el mensaje de siempre", async () => {
    for (const motivo of [null, false]) {
      const { r, estado } = await llamar({ proceso: "MERMA", motivoId: "m-1" }, { motivo }, null);
      expect(r).toMatchObject({ ok: false, mensaje: "El motivo elegido ya no está disponible." });
      expect(estado.abierta).toBe(0);
    }
  });

  it("no endurece lo que la pantalla no exige: Compra, Consumo y Devolución a proveedor sin proveedor/destino siguen pasando", async () => {
    for (const proceso of ["COMPRA", "CONSUMO", "DEVOLUCION_PROVEEDOR", "AJUSTE", "PRODUCCION"] as const) {
      const { r, estado } = await llamar({ proceso }, {}, null);
      expect(r.ok, proceso).toBe(true);
      expect(estado.abierta, proceso).toBe(1);
    }
  });

  it("la regla del servidor y la de la pantalla no se desincronizan: el único proceso que pide motivo en ui-config es la Merma", () => {
    const piden = Object.values(PROCESOS_UI).filter((c) => c.pideMotivo).map((c) => c.proceso);
    expect(piden).toEqual(["MERMA"]);
  });
});

describe("U11: motivo, destino y proveedor se vuelven a comprobar DENTRO de la transacción", () => {
  it("un motivo desactivado entre la lectura previa y la escritura se rechaza", async () => {
    const { r, estado } = await llamar({ proceso: "MERMA", motivoId: "m-1" }, { motivo: true }, { motivo: false });
    expect(r).toMatchObject({ ok: false, mensaje: "El motivo elegido ya no está disponible." });
    expect(estado.abierta).toBe(1);
  });

  it("un destino desactivado en el medio se rechaza", async () => {
    const { r } = await llamar({ proceso: "CONSUMO", destinoId: "d-1" }, { destino: true }, { destino: false });
    expect(r).toMatchObject({ ok: false, mensaje: "El destino elegido ya no está disponible." });
  });

  it("un proveedor desactivado en el medio se rechaza", async () => {
    const { r } = await llamar({ proceso: "COMPRA", proveedorId: "pr-1" }, { proveedor: true }, { proveedor: false });
    expect(r).toMatchObject({ ok: false, mensaje: "El proveedor elegido ya no está disponible." });
  });
});
