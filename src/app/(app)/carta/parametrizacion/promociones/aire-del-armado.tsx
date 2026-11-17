import type { ReactNode } from "react";

/**
 * Aire del armado «como Pedernal» (`ARMADO_DE_PROMO_COMO_PEDERNAL`, pedido del dueño 2026-11-17: «en Pedernal veo algo limpio, en Motor 2 algo apretado»): con el interruptor encendido, los bloques de cada promo van uno debajo del otro
 * con más espacio entre sí (y sin el margen suelto que cada uno traía); apagado, no envuelve nada: la pantalla de siempre.
 */
export function ConAire({ activo, children }: { activo: boolean; children: ReactNode }) {
  if (!activo) return <>{children}</>;
  return <div className="mt-4 flex flex-col gap-5 [&>*]:mt-0">{children}</div>;
}

/** Un título con lo que le cuelga (un formulario, un dato): juntos entre sí, aunque el resto vaya con aire. Apagado, no envuelve nada. */
export function Junto({ activo, children }: { activo: boolean; children: ReactNode }) {
  if (!activo) return <>{children}</>;
  return <div className="flex flex-col gap-2 [&>*]:mt-0">{children}</div>;
}
