import { DESTINOS_CONSUMO_SEMILLA, MOTIVOS_MERMA_SEMILLA } from "@/core/movimientos/public";
import { ACCIONES } from "@/core/permisos/acciones";

/**
 * El PLAN de la siembra de una empresa nueva, puro: qué filas necesita para existir sin personas (acciones, unidades base, motivos de merma, destinos de consumo y su
 * primera sucursal). Los roles y su matriz de permisos salen de `core/permisos/roles-de-fabrica.ts`. Quien lo escribe es `plataforma/src/servidor/sembrar-empresa.ts`
 * (Pureza Fase 4, tramo B): lo comparten el alta de la consola (E5, ADR-020) y el fixture de pruebas `crearEmpresa`.
 */

/** Mismas 5 unidades base que `prisma/seed.ts` (decimales por magnitud, como DECIMALES_DEFAULT_POR_CATEGORIA_ de Apps Script). */
const UNIDADES_BASE: ReadonlyArray<{
  nombre: string;
  magnitud: "PESO" | "VOLUMEN" | "CANTIDAD";
  decimales: number;
}> = [
  { nombre: "kg", magnitud: "PESO", decimales: 2 },
  { nombre: "g", magnitud: "PESO", decimales: 0 },
  { nombre: "l", magnitud: "VOLUMEN", decimales: 2 },
  { nombre: "ml", magnitud: "VOLUMEN", decimales: 0 },
  { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 },
];

export function planDeSiembra(empresaId: string, nombreSucursal: string) {
  return {
    // `Accion` es global (una fila por clave para todo el sistema): las de la primera empresa ya están, no se pisan (el escritor usa `skipDuplicates`).
    acciones: ACCIONES.map((a) => ({ clave: a.clave, descripcion: a.descripcion })),
    unidades: UNIDADES_BASE.map((u) => ({ empresaId, ...u })),
    motivosDeMerma: MOTIVOS_MERMA_SEMILLA.map((m) => ({ empresaId, nombre: m.nombre, descripcion: m.descripcion ?? null })),
    destinosDeConsumo: DESTINOS_CONSUMO_SEMILLA.map((d) => ({ empresaId, nombre: d.nombre, descripcion: d.descripcion ?? null })),
    sucursal: { empresaId, nombre: nombreSucursal },
  };
}
