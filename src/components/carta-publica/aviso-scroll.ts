export interface MetricasScroll {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

/** Píxeles de margen: un subpíxel de redondeo (o el último ítem casi a ras) no cuenta como "falta contenido". */
const TOLERANCIA_PX = 4;

/** ¿Queda contenido por debajo del borde visible de un contenedor con scroll vertical? Puro: el DOM se lee en `navegacion-carta.tsx`. */
export function hayMasParaVer({ scrollTop, clientHeight, scrollHeight }: MetricasScroll, tolerancia = TOLERANCIA_PX): boolean {
  return scrollHeight - (scrollTop + clientHeight) > tolerancia;
}
