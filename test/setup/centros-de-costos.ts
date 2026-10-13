import { randomUUID } from "node:crypto";
import { repartirImporte } from "../../src/core/moneda";
import { sembrarEscenarioDeGasto, type EscenarioDeGasto } from "./gasto";
import { prisma } from "./test-db";

/**
 * Ayudas de los tests de los CENTROS DE COSTOS (Paquete 5, M7): el escenario de siempre de los gastos más dos imputaciones, dos planes con sus centros y la aplicabilidad; las sentencias `pg` de una versión y de sus líneas
 * (para escribir como `motor2_app`, sujeto a la RLS, o como dueño); el reparto exacto en dos pasos (D3 de M4, ahora también para repartir entre centros); y las consultas de COHERENCIA que la base NO impone (no hay disparadores) y
 * que miran la Etapa C y el chequeo posterior al despliegue (`docs/deploy-con-migraciones.md`). Las usan `migracion-centros-de-costos`, `migracion-distribucion-de-costos`, `centros-de-costos-rls`, `distribucion-de-costos-concurrencia`,
 * `distribucion-de-costos-dinero` e `imputacion-de-gasto-dinero`.
 */

export interface EscenarioDeCentros extends EscenarioDeGasto {
  /** La imputación de la sucursal A: 120,00 con 20,00 de IVA computable. */
  imputacionAId: string;
  /** La imputación de la sucursal B: 80,00. */
  imputacionBId: string;
  /** El primer plan, aplicable en A y en B, con dos centros. */
  planId: string;
  /** El segundo plan, aplicable en A y en B, con un centro. */
  planOtroId: string;
  centroUnAId: string;
  centroUnBId: string;
  /** El centro del SEGUNDO plan. */
  centroOtroPlanId: string;
}

/** Las imputaciones de 120,00 (A, con 20,00 de IVA computable) y 80,00 (B) del renglón de 200,00, dos planes con sus centros (códigos neutros: `UN_A`, `UN_B`, `ZONA_N`) y la aplicabilidad de los dos planes en las dos sucursales. */
export async function sembrarEscenarioDeCentros(): Promise<EscenarioDeCentros> {
  const e = await sembrarEscenarioDeGasto();
  const imputacionA = await prisma.imputacionDeGasto.create({ data: { facturaProveedorRenglonId: e.renglonId, sucursalId: e.sucursalA, importe: "120.00", importeIvaComputable: "20.00" } as never });
  const imputacionB = await prisma.imputacionDeGasto.create({ data: { facturaProveedorRenglonId: e.renglonId, sucursalId: e.sucursalB, importe: "80.00" } as never });
  const plan = await prisma.planDeCostos.create({ data: { codigo: "PLAN_UN", nombre: "Unidades de negocio" } });
  const planOtro = await prisma.planDeCostos.create({ data: { codigo: "PLAN_ZONA", nombre: "Zonas" } });
  const centroUnA = await prisma.centroDeCostos.create({ data: { planDeCostosId: plan.id, codigo: "UN_A", nombre: "Unidad A" } });
  const centroUnB = await prisma.centroDeCostos.create({ data: { planDeCostosId: plan.id, codigo: "UN_B", nombre: "Unidad B" } });
  const centroOtroPlan = await prisma.centroDeCostos.create({ data: { planDeCostosId: planOtro.id, codigo: "ZONA_N", nombre: "Zona norte" } });
  for (const p of [plan, planOtro]) for (const sucursalId of [e.sucursalA, e.sucursalB]) await prisma.planDeCostosSucursal.create({ data: { planDeCostosId: p.id, sucursalId, aplica: true } });
  return {
    ...e,
    imputacionAId: imputacionA.id,
    imputacionBId: imputacionB.id,
    planId: plan.id,
    planOtroId: planOtro.id,
    centroUnAId: centroUnA.id,
    centroUnBId: centroUnB.id,
    centroOtroPlanId: centroOtroPlan.id,
  };
}

/**
 * Escribe (como dueño, sin RLS) una distribución completa: la cabecera de la versión y sus líneas. Por defecto es la versión 1 del primer plan, con el motivo que pide la versión 2 en adelante. Devuelve el id de la versión.
 * Las líneas llevan sus puntos básicos y sus importes ya repartidos: esta ayuda NO suma ni valida nada (igual que la base).
 */
export async function sembrarDistribucion(
  e: EscenarioDeCentros,
  imputacionId: string,
  lineas: ReadonlyArray<{ centroId: string; porcentajeBp: number; importe: string; importeIvaComputable?: string }>,
  opciones: { numero?: number; planId?: string } = {},
): Promise<string> {
  const numero = opciones.numero ?? 1;
  const planId = opciones.planId ?? e.planId;
  const version = await prisma.distribucionCostoVersion.create({
    data: {
      imputacionDeGastoId: imputacionId,
      planDeCostosId: planId,
      numero,
      motivo: numero > 1 ? "Corrección de la distribución" : null,
      claveIdempotencia: randomUUID(),
      payloadHash: "huella-de-prueba",
      resultadoMensaje: "Gasto distribuido.",
      creadoPorId: e.usuarioId,
    } as never,
  });
  for (const l of lineas) {
    await prisma.distribucionCostoLinea.create({
      data: { distribucionCostoVersionId: version.id, planDeCostosId: planId, centroDeCostosId: l.centroId, porcentajeBp: l.porcentajeBp, importe: l.importe, importeIvaComputable: l.importeIvaComputable ?? "0.00" } as never,
    });
  }
  return version.id;
}

interface SentenciaPg {
  texto: string;
  params: unknown[];
}

/** Un INSERT de una fila para un cliente `pg` (con `$1...`), con las columnas en el orden en que vienen en `datos`. */
export function sentenciaDeInsercion(tabla: string, datos: Record<string, unknown>): SentenciaPg {
  const columnas = Object.keys(datos);
  return {
    texto: `INSERT INTO "${tabla}" (${columnas.map((c) => `"${c}"`).join(",")}) VALUES (${columnas.map((_, i) => `$${i + 1}`).join(",")})`,
    params: columnas.map((c) => datos[c]),
  };
}

/** Una cabecera de versión válida (versión 1, sin motivo) para un cliente `pg`: lo que `extra` pisa o agrega (por ejemplo `empresaId`) entra como columna. `id` y `claveIdempotencia` salen nuevos si no se piden. */
export function sentenciaDeVersion(e: { imputacionId: string; planId: string; usuarioId: string }, extra: Record<string, unknown> = {}): SentenciaPg & { id: string } {
  const datos: Record<string, unknown> = {
    id: randomUUID(),
    imputacionDeGastoId: e.imputacionId,
    planDeCostosId: e.planId,
    numero: 1,
    motivo: null,
    claveIdempotencia: randomUUID(),
    payloadHash: "huella-de-prueba",
    resultadoMensaje: "Gasto distribuido.",
    creadoPorId: e.usuarioId,
    ...extra,
  };
  return { id: datos.id as string, ...sentenciaDeInsercion("DistribucionCostoVersion", datos) };
}

/** Una línea de una versión para un cliente `pg`: 100 % (10000 puntos básicos) con el importe de la imputación A por defecto. `extra` pisa o agrega columnas. */
export function sentenciaDeLinea(e: { versionId: string; planId: string; centroId: string }, extra: Record<string, unknown> = {}): SentenciaPg {
  return sentenciaDeInsercion("DistribucionCostoLinea", {
    id: randomUUID(),
    distribucionCostoVersionId: e.versionId,
    planDeCostosId: e.planId,
    centroDeCostosId: e.centroId,
    porcentajeBp: 10000,
    importe: "120.00",
    importeIvaComputable: "20.00",
    ...extra,
  });
}

export const aCentavos = (importe: number) => Math.round(importe * 100);

/**
 * El reparto en DOS pasos (D3 de M4, ahora también entre centros de costos): (1) el importe con los pesos del reparto; (2) el IVA computable con pesos = los importes de (1) en centavos. Así ningún computable pasa de su importe (el CHECK lo exige) y las
 * dos sumas dan EXACTO. Las partes se ordenan por id ANTES de repartir (los empates de mayor residuo se resuelven por índice). Lo usará el caso de uso de la Etapa C (que lo extraerá a `src/core/` cuando exista quien lo llame).
 */
export function repartirEnDosPasos(importe: number, computable: number, partes: ReadonlyArray<{ id: string; peso: number }>) {
  const ordenadas = [...partes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const importes = repartirImporte(importe, ordenadas.map((p) => p.peso));
  const computables = repartirImporte(computable, importes.map(aCentavos));
  return ordenadas.map((p, i) => ({ id: p.id, importe: importes[i]!, computable: computables[i]! }));
}
