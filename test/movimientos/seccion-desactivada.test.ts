import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

// La lectura de la clave I3 se controla desde el test (en el resto de los casos «nueva»); el armado de líneas devuelve «sin línea»: un movimiento que PASA la regla de la sección
// llega hasta `SIN_LINEAS_VALIDAS` (sin tocar la base), uno que NO la pasa se corta antes con `SECCION_INACTIVA`.
const { chequearIdempotencia } = vi.hoisted(() => ({ chequearIdempotencia: vi.fn() }));
vi.mock("../../src/server/persistencia/movimientos/idempotencia", () => ({ chequearIdempotencia, registrarResultadoIdempotente: vi.fn() }));
vi.mock("../../src/server/actions/movimientos/casos-de-uso/armar-linea-de-movimiento", () => ({ armarLineaMovimiento: vi.fn(async () => ({ ok: true, linea: null })) }));

import { registrarMovimientoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-movimiento";
import type { DatosMovimientoInput, ProcesoGenerico } from "../../src/core/features/movimientos/movimiento.schema";
import type { Transaccion } from "../../src/lib/db-tipos";

/**
 * P17 (decisión del dueño, 2026-10-11): una sección de stock dada de baja SOLO admite sacar mercadería (consumir, mermar o transferir) hasta vaciarla; no recibe mercadería nueva.
 * Controlado por el SERVIDOR en `registrarMovimientoCasoDeUso`, con el texto único `mensajeSeccionDesactivada` y el código `SECCION_INACTIVA`.
 *
 * Sin base de datos (como `registrar-movimiento-maestros-obligatorios.test.ts`): cliente y transacción falsos. El vaciado real (saldo exacto) y la idempotencia contra la base están en
 * `seccion-desactivada-con-base.test.ts`.
 */
const SUCURSAL = "suc-1";
const OTRA_SUCURSAL = "suc-2";
const base = { fecha: new Date("2026-10-11T12:00:00Z"), items: [{ productoId: "p-1", cantidad: 1 }] };

const mensaje = (nombre: string) =>
  `La sección «${nombre}» está desactivada: solo se puede sacar mercadería de ella (transferir, mermar o consumir) hasta vaciarla. Elegí otra sección o activala.`;

/** `Record<ProcesoGenerico, …>`: si el motor gana un proceso, esta tabla deja de compilar y hay que decidir qué pasa con una sección dada de baja. */
const PROCESOS: Record<ProcesoGenerico, { extra: Partial<DatosMovimientoInput>; sacaSinMas: boolean }> = {
  COMPRA: { extra: {}, sacaSinMas: false },
  PRODUCCION: { extra: {}, sacaSinMas: false },
  CONSUMO: { extra: {}, sacaSinMas: true },
  AJUSTE: { extra: {}, sacaSinMas: false },
  TRANSFERENCIA: { extra: { seccionDestinoId: "activa" }, sacaSinMas: true },
  MERMA: { extra: { motivoId: "m-1" }, sacaSinMas: true },
  DEVOLUCION_CLIENTE: { extra: {}, sacaSinMas: false },
  DEVOLUCION_PROVEEDOR: { extra: {}, sacaSinMas: false },
  DEVOLUCION_CONSIGNACION: { extra: {}, sacaSinMas: false },
};

/** Secciones de la sucursal 1: «Barra» (activa), «Cocina» (dada de baja) y «Depósito viejo» (dada de baja); «Ajena» es de otra sucursal y está dada de baja. */
const SECCIONES: Record<string, { id: string; nombre: string; sucursalId: string; activa: boolean }> = {
  activa: { id: "activa", nombre: "Barra", sucursalId: SUCURSAL, activa: true },
  baja: { id: "baja", nombre: "Cocina", sucursalId: SUCURSAL, activa: false },
  baja2: { id: "baja2", nombre: "Depósito viejo", sucursalId: SUCURSAL, activa: false },
  ajena: { id: "ajena", nombre: "Ajena", sucursalId: OTRA_SUCURSAL, activa: false },
};

function dbFalso(): Prisma.TransactionClient {
  return {
    seccion: { findUnique: async ({ where }: { where: { id: string } }) => SECCIONES[where.id] ?? null },
    motivoMerma: { findUnique: async () => ({ activo: true }) },
    destinoConsumo: { findUnique: async () => ({ activo: true }) },
    proveedor: { findUnique: async () => ({ activo: true }) },
  } as unknown as Prisma.TransactionClient;
}

function llamar(proceso: ProcesoGenerico, seccionId: string, extra: Partial<DatosMovimientoInput> = {}) {
  const transaccion = (async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(dbFalso())) as unknown as Transaccion;
  const actor = { usuarioId: "u-1", sucursalId: SUCURSAL, sucursalNombre: "Central", db: dbFalso(), transaccion };
  return registrarMovimientoCasoDeUso(actor as unknown as Parameters<typeof registrarMovimientoCasoDeUso>[0], { ...base, proceso, seccionId, ...PROCESOS[proceso].extra, ...extra } as DatosMovimientoInput);
}

describe("P17: una sección dada de baja solo admite sacar mercadería", () => {
  beforeEach(() => {
    chequearIdempotencia.mockReset();
    chequearIdempotencia.mockResolvedValue({ estado: "nueva" });
  });

  for (const [proceso, { sacaSinMas }] of Object.entries(PROCESOS) as [ProcesoGenerico, (typeof PROCESOS)[ProcesoGenerico]][]) {
    if (sacaSinMas) {
      it(`${proceso}: se puede sacar de una sección dada de baja (pasa la regla de la sección)`, async () => {
        const r = await llamar(proceso, "baja");
        expect(r).toMatchObject({ ok: false, codigo: "SIN_LINEAS_VALIDAS" });
      });
    } else {
      it(`${proceso}: se rechaza sobre una sección dada de baja, con el texto y el código de siempre`, async () => {
        const r = await llamar(proceso, "baja");
        expect(r).toMatchObject({ ok: false, codigo: "SECCION_INACTIVA", mensaje: mensaje("Cocina") });
      });
    }
  }

  it("TRANSFERENCIA: la sección de DESTINO dada de baja se rechaza (la mercadería no entra), con el nombre del destino", async () => {
    const r = await llamar("TRANSFERENCIA", "activa", { seccionDestinoId: "baja" });
    expect(r).toMatchObject({ ok: false, codigo: "SECCION_INACTIVA", mensaje: mensaje("Cocina") });
  });

  it("TRANSFERENCIA: origen y destino dados de baja: sacar del origen se permite, pero el destino rechaza (sale el nombre del destino)", async () => {
    const r = await llamar("TRANSFERENCIA", "baja", { seccionDestinoId: "baja2" });
    expect(r).toMatchObject({ ok: false, codigo: "SECCION_INACTIVA", mensaje: mensaje("Depósito viejo") });
  });

  it("TRANSFERENCIA: de una sección dada de baja a una activa se permite", async () => {
    const r = await llamar("TRANSFERENCIA", "baja", { seccionDestinoId: "activa" });
    expect(r).toMatchObject({ ok: false, codigo: "SIN_LINEAS_VALIDAS" });
  });

  it("una sección activa sigue pasando en todos los procesos (la regla no cambia nada para quien no dio de baja)", async () => {
    for (const proceso of Object.keys(PROCESOS) as ProcesoGenerico[]) {
      const r = await llamar(proceso, "activa");
      expect(r).toMatchObject({ ok: false, codigo: "SIN_LINEAS_VALIDAS" });
    }
  });

  it("una sección de OTRA sucursal sigue dando «No se encontró la sección.» aunque esté dada de baja (no se filtra su estado)", async () => {
    expect(await llamar("COMPRA", "ajena")).toMatchObject({ ok: false, codigo: "SECCION_NO_ENCONTRADA", mensaje: "No se encontró la sección." });
    expect(await llamar("TRANSFERENCIA", "activa", { seccionDestinoId: "ajena" })).toMatchObject({ ok: false, codigo: "SECCION_DESTINO_NO_ENCONTRADA", mensaje: "No se encontró la sección destino." });
  });

  it("I3 antes que la sección: un reintento de una compra YA escrita cuya sección se dio de baja después devuelve «repetida», no un rechazo", async () => {
    chequearIdempotencia.mockResolvedValue({ estado: "duplicado", mensaje: "Se guardaron 1 movimiento(s)." });
    const r = await llamar("COMPRA", "baja", { claveIdempotencia: "7c0f6a38-6a41-4d0e-9b53-0f3f8f1c7a11" });
    expect(r).toMatchObject({ ok: true, mensaje: "Se guardaron 1 movimiento(s).", datos: { repetida: true, operacionId: null, movimientos: null } });
  });

  it("I3: la misma clave con otro contenido sigue siendo conflicto, también sobre una sección dada de baja", async () => {
    chequearIdempotencia.mockResolvedValue({ estado: "conflicto" });
    const r = await llamar("COMPRA", "baja", { claveIdempotencia: "7c0f6a38-6a41-4d0e-9b53-0f3f8f1c7a11" });
    expect(r).toMatchObject({ ok: false, codigo: "CONFLICTO_IDEMPOTENCIA" });
  });
});
