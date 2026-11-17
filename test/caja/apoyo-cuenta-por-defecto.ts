import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { azarDelProceso } from "../../src/lib/azar";
import { abrirSesionCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/abrir-sesion";
import { cobrarCuentaCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/cobrar-cuenta";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { baseDeEmpresa } from "../../src/server/sesion/base";
import { sembrarCuenta, type sembrarSalon } from "../pos/salon-fixture";
import { EMPRESA_POR_DEFECTO_ID as EMPRESA, prismaAdmin } from "../setup/test-db";

/**
 * Apoyo común de las pruebas de la etapa P-C3 (cuenta por defecto del cobro): escenario sobre Postgres real, con la sesión de caja abierta por el caso de uso y cuentas de cobro armadas DIRECTO en la base
 * (con `prismaAdmin`), porque con la regla C3b (una activa por sucursal) los casos «dos o más» no se pueden crear por el caso de uso. Cada archivo de prueba hace su propio `vi.mock` de la sesión.
 */
const AHORA = new Date("2026-01-15T15:00:00.000Z");
export const c = (n: number) => BigInt(n);

export type Salon = Awaited<ReturnType<typeof sembrarSalon>>;
export type Renglon = Parameters<typeof cobrarCuentaCasoDeUso>[1]["renglones"][number];

export function crearApoyo(s: Salon, lecturaAncha: readonly string[] | null = null) {
  const actor = () => ({ usuarioId: s.admin.id, empresaId: EMPRESA, sucursalId: s.sucursalId, ahora: AHORA, empresaZonaHoraria: "America/Argentina/Buenos_Aires", ...baseDeEmpresa(EMPRESA, { lectura: lecturaAncha ? [...lecturaAncha] : [s.sucursalId], escritura: [s.sucursalId] }) });
  let mesaN = 40;
  return {
    actor,
    /** Una cuenta de salón cerrada, con venta de 3000 (30,00 → `3000_00` centavos). */
    async cuentaCerrada() {
      mesaN += 1;
      const mesa = await prismaAdmin.mesa.create({ data: { sucursalId: s.sucursalId, numero: mesaN } });
      const cuenta = await sembrarCuenta(mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
      expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
      return cuenta;
    },
    abrirCaja: () => abrirSesionCasoDeUso(actor(), { claveIdempotencia: randomUUID(), fondoEnCentavos: c(0) }, azarDelProceso),
    cobrar: (cuentaId: string, renglones: Renglon[], total = 3000_00, clave: string = randomUUID()) =>
      cobrarCuentaCasoDeUso(actor(), { claveIdempotencia: clave, cuentaId, totalVistoEnCentavos: c(total), renglones }, azarDelProceso),
    /** Un medio de pago de ese tipo, creado directo (el efectivo es único por empresa: si ya existe, ese). */
    medio: async (tipo: string) => (tipo === "EFECTIVO" ? await prismaAdmin.medioDePago.findFirst({ where: { tipo } }) : null)?.id ?? (await prismaAdmin.medioDePago.create({ data: { id: randomUUID(), tipo } })).id,
    /** Una cuenta de cobro creada directo (sin pasar por el caso de uso: la regla C3b no deja crear dos activas por sucursal). */
    async cuentaDirecta(tipo: string, opciones: { activa?: boolean; sucursalId?: string } = {}) {
      return (await prismaAdmin.cuentaDeCobro.create({ data: { id: randomUUID(), sucursalId: opciones.sucursalId ?? s.sucursalId, tipo, nombre: `${tipo} ${randomUUID().slice(0, 8)}`, activa: opciones.activa ?? true } })).id;
    },
  };
}

/** Lo que quedó escrito de un cobro: las cuentas de los renglones en `Cobro` y en `MovimientoCaja` (tienen que coincidir). */
export async function cuentasEscritas(cuentaPosId: string): Promise<{ enCobro: (string | null)[]; enMovimiento: (string | null)[] }> {
  const cobranza = await prismaAdmin.cobranza.findFirst({ where: { cuentaId: cuentaPosId }, select: { id: true } });
  if (!cobranza) return { enCobro: [], enMovimiento: [] };
  const cobros = await prismaAdmin.cobro.findMany({ where: { cobranzaId: cobranza.id }, orderBy: { orden: "asc" } });
  const movimientos = await prismaAdmin.movimientoCaja.findMany({ where: { id: { in: cobros.map((x) => x.movimientoId) } } });
  const porId = new Map(movimientos.map((m) => [m.id, m.cuentaDeCobroId]));
  return { enCobro: cobros.map((x) => x.cuentaDeCobroId), enMovimiento: cobros.map((x) => porId.get(x.movimientoId) ?? null) };
}
