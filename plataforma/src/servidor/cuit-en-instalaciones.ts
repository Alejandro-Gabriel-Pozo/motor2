import type { Instalacion } from "../entorno";
import { conTiempoLimite, TOPE_DE_LECTURA_DE_OTRA_BASE_MS } from "./tiempo-limite";

/**
 * Aviso informativo de CUIT repetido ENTRE instalaciones (ADR-025): el mismo CUIT confirmado, o declarado en una invitación aceptada, en otra base.
 * PURO —la lectura entra por parámetro, se prueba sin base— y con el mismo patrón tolerante del resumen del inicio: una instalación que falla o no
 * responde a tiempo queda en `sinLeer`, nunca hace lanzar el aviso ni tumba la pantalla que lo pide (ADR-025 §4).
 */
export interface EmpresaConEseCuit {
  empresaId: string;
  nombre: string;
  origen: "confirmado" | "declarado";
}

export interface CoincidenciaDeCuit {
  instalacion: Instalacion;
  empresas: readonly EmpresaConEseCuit[];
}

export interface CuitEnOtrasInstalaciones {
  coincidencias: readonly CoincidenciaDeCuit[];
  sinLeer: readonly Instalacion[];
}

export async function cuitEnOtrasInstalaciones(
  otras: readonly Instalacion[],
  cuit: string | null,
  buscar: (instalacion: Instalacion, cuit: string) => Promise<EmpresaConEseCuit[]>,
  tope = TOPE_DE_LECTURA_DE_OTRA_BASE_MS,
): Promise<CuitEnOtrasInstalaciones> {
  // La mayoría de las empresas en alta todavía no tienen CUIT en juego: sin CUIT, ni una lectura cruzada.
  if (cuit === null || otras.length === 0) return { coincidencias: [], sinLeer: [] };

  const resultados = await Promise.allSettled(otras.map((i) => conTiempoLimite(buscar(i, cuit), tope)));
  const coincidencias: CoincidenciaDeCuit[] = [];
  const sinLeer: Instalacion[] = [];
  otras.forEach((instalacion, n) => {
    const r = resultados[n];
    if (r.status !== "fulfilled") {
      sinLeer.push(instalacion);
    } else if (r.value.length > 0) {
      coincidencias.push({ instalacion, empresas: r.value });
    }
  });
  return { coincidencias, sinLeer };
}
