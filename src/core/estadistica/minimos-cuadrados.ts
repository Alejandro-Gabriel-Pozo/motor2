export interface ResultadoMinimosCuadrados {
  coeficientes: number[];
  r2: number;
}

/**
 * Mínimos cuadrados ordinarios vía ecuaciones normales — (X^T X) β = X^T y,
 * resuelto por eliminación gaussiana con pivoteo parcial. Pensado para
 * pocas incógnitas (un puñado de platos compartiendo un mismo insumo, ver
 * docs/diseno-rendimiento-recetas-por-sucursal.md §3.3 Fase 2) — no trae
 * una librería de álgebra lineal para esto, el tamaño real del problema no
 * lo justifica.
 *
 * Devuelve `null` si el sistema no tiene solución confiable: menos
 * observaciones que incógnitas, o columnas de X linealmente dependientes
 * (ej. dos platos que siempre se vendieron en la misma proporción semana a
 * semana — matemáticamente no hay forma de separar cuánto aportó cada uno,
 * inventar un número ahí sería peor que no dar ninguno).
 */
export function resolverMinimosCuadrados(X: number[][], y: number[]): ResultadoMinimosCuadrados | null {
  const filas = X.length;
  const columnas = X[0]?.length ?? 0;
  if (filas === 0 || columnas === 0 || y.length !== filas || filas <= columnas) return null;

  const A: number[][] = Array.from({ length: columnas }, () => new Array(columnas).fill(0));
  const b: number[] = new Array(columnas).fill(0);
  for (let i = 0; i < filas; i++) {
    for (let p = 0; p < columnas; p++) {
      b[p] += X[i][p] * y[i];
      for (let q = 0; q < columnas; q++) A[p][q] += X[i][p] * X[i][q];
    }
  }

  const coeficientes = resolverSistemaLineal(A, b);
  if (!coeficientes) return null;

  const promedio = y.reduce((acc, v) => acc + v, 0) / filas;
  let sumaResiduosCuadrados = 0;
  let sumaTotalCuadrados = 0;
  for (let i = 0; i < filas; i++) {
    const predicho = X[i].reduce((acc, x, j) => acc + x * coeficientes[j], 0);
    sumaResiduosCuadrados += (y[i] - predicho) ** 2;
    sumaTotalCuadrados += (y[i] - promedio) ** 2;
  }
  const r2 = sumaTotalCuadrados > 0 ? 1 - sumaResiduosCuadrados / sumaTotalCuadrados : sumaResiduosCuadrados < 1e-9 ? 1 : 0;

  return { coeficientes, r2 };
}

/** Gauss-Jordan con pivoteo parcial. `null` = sistema singular/mal condicionado. */
function resolverSistemaLineal(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const M = A.map((fila, i) => [...fila, b[i]]);

  for (let col = 0; col < n; col++) {
    let filaPivote = col;
    for (let f = col + 1; f < n; f++) {
      if (Math.abs(M[f][col]) > Math.abs(M[filaPivote][col])) filaPivote = f;
    }
    [M[col], M[filaPivote]] = [M[filaPivote], M[col]];

    const pivote = M[col][col];
    if (Math.abs(pivote) < 1e-9) return null;

    for (let f = 0; f < n; f++) {
      if (f === col) continue;
      const factor = M[f][col] / pivote;
      for (let c = col; c <= n; c++) M[f][c] -= factor * M[col][c];
    }
  }

  return M.map((fila, i) => fila[n] / fila[i]);
}
