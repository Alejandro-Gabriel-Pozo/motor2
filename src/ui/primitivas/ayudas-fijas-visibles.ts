/**
 * INTERRUPTOR de las AYUDAS FIJAS de todo el sistema (Frente «Visual», V5; mandato del dueño, 2026-11-17: «en Pedernal veo pocas palabras bien elegidas, en Motor 2 veo párrafos explicativos»; criterio
 * medible: palabras visibles por pantalla ≤ las de la maqueta de Pedernal + 10 %). Mismo patrón que `FICHA_AYUDAS_VISIBLES` (`src/core/catalogo/ficha-ayudas-visibles.ts`) y `OBSERVACIONES_VISIBLES`: una
 * constante. Con `false` (hoy) NO se dibujan; con `true` vuelven tal cual (no cambia el servidor, ni lo guardado, ni los permisos).
 *
 * QUÉ OCULTA (declarado; todo lo demás se queda):
 *  1. `AyudaCampo` (`src/components/ayuda-campo.tsx`): el texto fijo bajo un campo.
 *  2. La prop `ayuda=` de las primitivas `Campo`, `Selector`, `AreaDeTexto`, `Casilla` y de `CampoNumero` (que la pasa a `Campo`): el texto fijo bajo el control.
 * QUÉ NUNCA OCULTA (se queda siempre, por la regla «errores, avisos condicionales y permisos quedan»):
 *  - los errores (`error=`, `role="alert"`), la lectura en vivo (`lectura=`), las etiquetas y los botones;
 *  - los avisos condicionales y los motivos de permiso: viajan por la prop `aviso=` de esas mismas primitivas, que NO depende de este interruptor («No tenés el permiso para…», «Ya está en la lista.»,
 *    «Pendiente de completar», «el producto no tiene receta»). Un texto que cambia según el estado o el permiso NO va en `ayuda=`.
 *  - `AyudaIcono` (el «?» con tooltip: no ocupa lugar) y `AyudaDeFicha` (tiene su propio interruptor, `FICHA_AYUDAS_VISIBLES`).
 * Otros párrafos escritos a mano en las pantallas NO pasan por acá: los cuenta el cerco `test/arquitectura/cerco-ayudas-fijas.test.ts`, que solo puede bajar.
 *

 * Vive en `src/ui/primitivas/` y no en `src/core/` porque la capa `ui` no importa de `core` (`test/arquitectura/ui-sin-negocio.test.ts`): las primitivas lo leen sin salir de su capa.
 * Lo comprueba `test/ui/ayudas-fijas-interruptor.test.tsx` (los dos estados). Para volver a mostrarlas: poner `true`.
 */
export const AYUDAS_FIJAS_VISIBLES: boolean = false;
