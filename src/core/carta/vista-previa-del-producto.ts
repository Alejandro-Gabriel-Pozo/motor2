import type { PresentacionCartaV1 } from "./presentacion-en-carta";

/**
 * La VISTA PREVIA de UN producto en la carta de una sucursal (Fase 6, bloque 3, 6.18): lo que el servidor ya calculó con la regla de la venta (`cargarVistaPreviaDeLaCarta`) y la pantalla solo dibuja.
 * Es un TIPO (sin lógica): vive en `core/carta` para que el componente que dibuja no tenga que importar nada del servidor ni de `core/pos`.
 */
export type VistaPreviaDeLaCarta =
  /** El producto no tiene grupos de opciones en uso: sale con su nombre y su precio. */
  | { tipo: "sin-opciones" }
  /** Tiene grupos, pero hoy no se puede pedir (un grupo obligatorio sin ninguna opción disponible o con precio): no sale en la carta hasta que lo tenga. */
  | { tipo: "no-se-puede-pedir" }
  /** La forma exacta que le da la carta (la proyección de la Fase 5). */
  | { tipo: "forma"; presentacion: PresentacionCartaV1 }
  /** La carta no puede leerlo exacto (más de dos grupos cambian el precio): las listas de siempre, como una línea de texto. */
  | { tipo: "texto"; texto: string };
