import { calcularStockConsolidado, type EstadoStockConsolidado } from "@/core/stock/consolidado";
import { calcularAlertasStock } from "@/core/stock/alertas";
import type { Db } from "./comun";
import { generarReporteDiferenciasAjustes } from "./diferencias-ajustes";
import { generarReporteInsumosSinRecetaVinculada } from "./insumos-sin-receta";

export interface FilaSaludProducto {
  productoId: string;
  producto: string;
  codigo: string;
  seccionNombre: string;
  estadoConsolidado: EstadoStockConsolidado;
  estadoAlerta: "OK" | "BAJO" | "CRITICO";
  estadoDiferencias: string;
  sinRecetaVinculada: boolean;
  resumen: "Atención" | "OK";
}

const ALERTA_MALA = new Set(["BAJO", "CRITICO"]);
const CONSOLIDADO_MALO = new Set<EstadoStockConsolidado>(["NEGATIVO", "CON_DESVIO"]);
const ORDEN_CONSOLIDADO: Record<EstadoStockConsolidado, number> = { NEGATIVO: 0, CON_DESVIO: 1, SIN_CONTEO: 2, SIN_MOVIMIENTOS: 3, CONCILIADO: 4 };

/**
 * Port de generarReporteSaludPorProducto_ (Reportes.js:918-979; hallazgo
 * M-3). NO reemplaza a Stock Consolidado, Alertas, Diferencias de Ajuste ni
 * Insumos sin receta — es un CRUCE: por cada producto+sección, toma el
 * estado que YA calcula cada uno de los 4 (ninguna lógica de negocio
 * nueva) y arma una sola columna "Atención"/"OK".
 *
 * Diferencias de Ajuste e Insumos sin receta son señales A NIVEL DE
 * PRODUCTO (no varían por sección): se repiten a propósito en cada fila de
 * sección del mismo producto, para no perder la señal si se mira solo una.
 */
export async function generarReporteSaludPorProducto(sucursalId: string, db: Db): Promise<FilaSaludProducto[]> {
  const [consolidado, alertas, diferencias, sinReceta] = await Promise.all([
    calcularStockConsolidado(sucursalId, db),
    calcularAlertasStock(sucursalId, db),
    generarReporteDiferenciasAjustes(sucursalId, db),
    generarReporteInsumosSinRecetaVinculada(sucursalId, db),
  ]);

  const alertaPorClave = new Map(alertas.map((a) => [`${a.productoId}||${a.seccionId}`, a.estado]));
  const diferenciasPorProducto = new Map(diferencias.map((d) => [d.productoId, d.estado]));
  const sinRecetaPorProducto = new Set(sinReceta.map((s) => s.productoId));

  // Colapsa los lotes de un producto+sección en una sola fila, quedándose
  // con el peor estado del grupo (mismo criterio de prioridad que ya usa
  // calcularStockConsolidado al ordenar).
  const porClave = new Map<string, { productoId: string; producto: string; codigo: string; seccionNombre: string; estadoConsolidado: EstadoStockConsolidado }>();
  for (const c of consolidado) {
    const key = `${c.productoId}||${c.seccionId ?? ""}`;
    const actual = porClave.get(key);
    if (!actual || ORDEN_CONSOLIDADO[c.estado] < ORDEN_CONSOLIDADO[actual.estadoConsolidado]) {
      porClave.set(key, { productoId: c.productoId, producto: c.productoNombre, codigo: c.productoCodigo, seccionNombre: c.seccionNombre, estadoConsolidado: c.estado });
    }
  }

  const filas: FilaSaludProducto[] = Array.from(porClave.entries()).map(([key, f]) => {
    const estadoAlerta = (alertaPorClave.get(key) ?? "OK") as "OK" | "BAJO" | "CRITICO";
    const estadoDiferencias = diferenciasPorProducto.get(f.productoId) ?? null;
    const sinRecetaVinculada = sinRecetaPorProducto.has(f.productoId);

    const atencion =
      CONSOLIDADO_MALO.has(f.estadoConsolidado) || ALERTA_MALA.has(estadoAlerta) || estadoDiferencias === "REVISAR" || sinRecetaVinculada;

    return {
      productoId: f.productoId,
      producto: f.producto,
      codigo: f.codigo,
      seccionNombre: f.seccionNombre,
      estadoConsolidado: f.estadoConsolidado,
      estadoAlerta,
      estadoDiferencias: estadoDiferencias ?? "(no aplica)",
      sinRecetaVinculada,
      resumen: atencion ? "Atención" : "OK",
    };
  });

  return filas.sort(
    (a, b) => (a.resumen === b.resumen ? 0 : a.resumen === "Atención" ? -1 : 1) || a.producto.localeCompare(b.producto) || a.seccionNombre.localeCompare(b.seccionNombre)
  );
}
