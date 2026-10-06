import { type RotuloLinea } from "./rendimiento-recetas-vistas";
import { type MetodoRendimiento } from "./rendimiento-conciliado";

export interface FilaRendimientoSimple {
  productoVentaId: string;
  productoVentaNombre: string;
  recetaIngredienteId: string;
  /** El id de la MP anclada en la receta — para el link "usar este valor" al editor (?editar=). */
  insumoProductoId: string;
  insumoONombre: string;
  unidadRecetaNombre: string;
  /** EFECTIVO de la sucursal (rendimientoEfectivo, D2) — el central, salvo que esta sucursal lo haya calibrado. */
  cantidadActual: number;
  /** El valor del Catálogo Central, SIN calibrar — para "(calibrado acá; central: X)" en la UI. */
  cantidadActualCentral: number;
  /** true si ESTA sucursal calibró cantidad y/o merma de esta línea. */
  calibradoLocal: boolean;
  /** Merma % EFECTIVA de esta sucursal — la que se CONGELA junto con `cantidadEstimada` al calibrar (D4, decisión del dueño). */
  mermaActual: number;
  /** NETO (misma base que `cantidadActual` — RecetaIngrediente.cantidad es neta) — ver docstring de `calcularCantidadEstimadaNeta`, es lo que se escribe si se usa este valor. */
  cantidadEstimada: number | null;
  desviacionPorcentaje: number | null;
  totalComprado: number;
  /** Solo insumos con `seProduce: true` pueden tener esto > 0 — un insumo producido nunca antes contaba como entrada, y por eso siempre daba -100% (defecto 1 de §3). */
  totalProducido: number;
  /** totalComprado + totalProducido — lo que de verdad entró al pool en la ventana. */
  totalEntradas: number;
  totalVendido: number;
  /** Saldo del pool ANTES de `desde` — contexto, nunca entra en ninguna fórmula (ver docstring de `stockCierre`). */
  stockApertura: number;
  /**
   * Saldo del pool DESPUÉS de `hasta` (`stockApertura + deltaStock`) — si
   * subió durante la ventana, parte de lo "comprado" en realidad se quedó
   * en el depósito, no se consumió. El caso real del Agua (+14,3 % con
   * Δstock=+9) es 0 % de desvío real SOLO SI un Conteo Físico confirma que
   * esos +9 están de verdad en el depósito (`metodo: "CONTEO"` — ver
   * rendimiento-conciliado.ts); sin ese conteo (`metodo: "COMPRAS"`) el
   * Δstock queda como advertencia de sesgo, no como una corrección: el
   * "restar Δstock" es tautológico (el propio saldo del sistema ya asume
   * la receta, vía el CONSUMO que cada venta escribe), así que no hay
   * ninguna forma de saber si esos +9 son acopio real o faltante sin medir
   * el depósito con un conteo físico real.
   */
  stockCierre: number;
  /**
   * "CONTEO" = medido (Task #26, Diseño B): hay dos `ConteoFisico`
   * `RESUELTO` que cubren el pool entero, uno al principio y otro al
   * final del tramo — `cantidadEstimada`/`desviacionPorcentaje` salen de
   * sumar el consumo real DIRECTO por proceso entre esas dos anclas
   * (`anclaDesde`/`anclaHasta`/`consumoReal`), nunca de las compras.
   * "COMPRAS" = estimado, el método de siempre (`totalEntradas /
   * totalVendido`) — D4: SIN las dos anclas, nunca se deja la fila sin
   * ningún número, se cae a este método, marcado como menos confiable.
   */
  metodo: MetodoRendimiento;
  /** Solo `metodo === "CONTEO"` — el día (calendario, D3) del Conteo Físico que abre el tramo medido. `null` en método COMPRAS. */
  anclaDesde: Date | null;
  /** Solo `metodo === "CONTEO"` — el día del Conteo Físico que cierra el tramo medido. `null` en método COMPRAS. */
  anclaHasta: Date | null;
  /** Solo `metodo === "CONTEO"` — −Σ CONSUMO(venta/producción) − Σ CONTROL − Σ AJUSTE(no-reversión) entre las dos anclas (ver `consumoRealDelTramo`). `null` en método COMPRAS. */
  consumoReal: number | null;
  /** Por qué `cantidadEstimada` es null, cuando lo es — nunca se oculta la fila, se explica (docs/plan-rendimiento-recetas-2026-09-22.md §B7). */
  motivoSinEstimacion: string | null;
  /** Cuánto puede moverse el % de desvío solo por comprar de a lotes — CONTEXTO en texto, nunca decide si la celda se pinta ámbar (eso es fijo, ver `desvioEsNotable`). Ver `bandaDeRuidoDeLote`. */
  bandaRuidoPct: number | null;
  /** (consumo observado − lo que la receta hubiera consumido) × costo de reposición — entradas reales en método COMPRAS, consumoReal en método CONTEO. Lo que ORDENA el ranking, no el %. Ver `impactoDelDesvio`. */
  impactoPesos: number | null;
  /** true cuando `impactoPesos` es null por falta de costo conocido (nunca se inventa un precio — mismo criterio que perdidas.ts). */
  sinCosto: boolean;
  semanasConDatos: number;
  confianza: "alta" | "media" | "baja" | "sin_datos";
  /**
   * Rótulo DECLARADO (nunca inferido) — reemplaza el viejo `esTrivial`
   * (`cantidad===1 && merma===0`, que rotulaba mal una sub-receta producida
   * o un packaging como "venta directa"). Ver `rotularLineaDeReceta`
   * (rendimiento-recetas-vistas.ts) para la prioridad exacta entre los tres
   * casos. Ninguno oculta la fila.
   */
  rotulo: RotuloLinea;
}

export interface FilaRendimientoCompartido {
  poolClave: string;
  insumoONombre: string;
  productoVentaId: string;
  productoVentaNombre: string;
  recetaIngredienteId: string;
  insumoProductoId: string;
  unidadRecetaNombre: string;
  /** EFECTIVO de la sucursal (rendimientoEfectivo, D2) — el central, salvo que esta sucursal lo haya calibrado. */
  cantidadActual: number;
  /** El valor del Catálogo Central, SIN calibrar — para "(calibrado acá; central: X)" en la UI. */
  cantidadActualCentral: number;
  /** true si ESTA sucursal calibró cantidad y/o merma de esta línea. */
  calibradoLocal: boolean;
  /** Merma % EFECTIVA de esta sucursal — la que se CONGELA junto con `cantidadEstimada` al calibrar (D4, decisión del dueño). */
  mermaActual: number;
  /** El coeficiente resuelto por regresión para ESTE plato, ya en NETO — null si el pool no fue resoluble. */
  cantidadEstimada: number | null;
  desviacionPorcentaje: number | null;
  /** Vendido de ESTE plato (no del pool) — antes se calculaba para la regresión y se descartaba, sin exponerse en la fila. */
  totalVendido: number;
  /** Ver docstring en FilaRendimientoSimple — acá con el `totalVendido` de ESTE plato, no del pool. */
  impactoPesos: number | null;
  sinCosto: boolean;
  /** Cuántos platos comparten este pool — mismo valor repetido en todas las filas del pool. */
  cantidadPlatosEnPool: number;
  /** Comprado + producido del POOL entero en la ventana — mismo valor repetido en todas las filas del pool (a diferencia de Fase 1, acá no hay "totalComprado" por plato: el pool es lo que se ajusta). */
  totalEntradasPool: number;
  /** Ver docstring en FilaRendimientoSimple — acá es del POOL, mismo valor repetido en todas sus filas. */
  stockApertura: number;
  stockCierre: number;
  /** Ver docstring en FilaRendimientoSimple — el LOTE de compra es del pool (todo el insumo compartido), pero la banda en sí es por FILA: depende de cuánto vendió y qué recta pide CADA plato, así que varía entre las filas de un mismo pool. `null` siempre en método CONTEO (mismo criterio que Fase 1). */
  bandaRuidoPct: number | null;
  /**
   * Cuántas OBSERVACIONES alimentaron la regresión — semanas de compras
   * (método COMPRAS) o intervalos entre anclas consecutivas de Conteo
   * Físico (método CONTEO, Task #26 §6). El nombre se queda igual entre
   * los dos métodos (ambos son "cuántos puntos tuvo el ajuste"), pero la
   * UNIDAD cambia — ver `metodo` antes de interpretar este número.
   */
  semanasConDatos: number;
  /** Calidad del ajuste (0-1) — mismo valor en todas las filas del pool, null si no se pudo resolver. */
  r2: number | null;
  /** Ver el docstring del mismo campo en FilaRendimientoSimple — acá es del POOL: si CUALQUIER intervalo entre anclas resultó resoluble, TODAS las filas del pool salen por CONTEO (la regresión es del pool entero, no por plato). */
  metodo: MetodoRendimiento;
  resoluble: boolean;
  motivoNoResoluble: string | null;
  /** Solo cuando SÍ es resoluble pero el desvío no se puede calcular igual (ver docstring en FilaRendimientoSimple) — si `motivoNoResoluble` ya explica la falta de estimado, este queda null (es más básico). */
  motivoSinEstimacion: string | null;
  /** Ver el docstring del mismo campo en FilaRendimientoSimple — acá es por fila, no por pool: dos platos pueden compartir un insumo con cantidades/merma distintas, así que el rótulo también puede ser distinto por fila. */
  rotulo: RotuloLinea;
}

export interface UsoDeInsumo {
  pvProductoId: string;
  pvNombre: string;
  recetaIngredienteId: string;
  insumoProductoId: string;
  /** EFECTIVO (rendimientoEfectivo, D2) — el central, salvo que esta sucursal lo haya calibrado. */
  cantidad: number;
  unidadNombre: string;
  /** EFECTIVO — ver `cantidad`. */
  mermaPorcentaje: number;
  /** Los valores del Catálogo Central, SIN calibrar — para "(calibrado acá; central: X)" en la UI. */
  cantidadCentral: number;
  mermaPorcentajeCentral: number;
  calibradoLocal: boolean;
  /** Los tres datos DECLARADOS que alimentan `rotularLineaDeReceta` — ver su docstring en rendimiento-recetas-vistas.ts.
   * SIEMPRE con los valores CENTRALES (cantidadCentral/mermaPorcentajeCentral): el rótulo clasifica la ESTRUCTURA
   * declarada de la receta, no si esta sucursal la calibró — una calibración local no puede cambiar de qué "tipo" de
   * línea se trata. */
  insumoSeProduce: boolean;
  insumoEsNoComestible: boolean;
  pvSeProduce: boolean;
}

export interface Pool {
  clave: string;
  nombre: string;
  /** Todas las MP cuyas compras cuentan para este pool — los hermanos activos del Insumo, o el producto puntual solo. */
  productoIds: string[];
  usos: UsoDeInsumo[];
}

/**
 * Un pool resuelto por mínimos cuadrados — comparte forma entre el método
 * CONTEO (§6, intervalos entre anclas) y el método COMPRAS (semanas) de
 * `calcularRendimientoRecetasCompartidas`, para que el resto de la función
 * no necesite dos caminos distintos de ahí en adelante.
 */
export interface ResultadoPoolCompartido {
  metodo: MetodoRendimiento;
  resoluble: boolean;
  motivoNoResoluble: string | null;
  r2: number | null;
  /** Un coeficiente BRUTO por uso, en el mismo orden que `pool.usos` — solo con `resoluble`. */
  coeficientes: number[] | null;
  /** Semanas (COMPRAS) o intervalos entre anclas (CONTEO) que alimentaron la regresión. */
  observaciones: number;
}