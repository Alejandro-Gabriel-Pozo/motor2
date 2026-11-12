/**
 * INTERRUPTOR de «Está bien así» y de la lista «Platos de la carta sin nombre de carta» (decisión del dueño, 2026-11-11): hoy NO SE VEN. Mismo patrón que `GENERO_E_ITEM_AGRUPADO_VISIBLE`
 * (`genero-e-item-agrupado.ts`) y `DESCUENTO_POR_PRODUCTO_VISIBLE` (`descuento-producto.ts`).
 *
 * NECESIDAD (quién y dónde está escrita): el dueño, 2026-11-11 — «Me refiero al "está bien así" que tenemos nosotros, si cada producto vendible es lo que se ve en la carta ese "está bien así" queda
 * obsoleto»; autorizó apagarlo con «Si» a «¿Ocultamos "Está bien así" y la lista de pendientes ahora, dejando reversible el campo?». Reabre la decisión F de `docs/diseno-nombre-en-carta-2026-11-04.md`.
 * Evidencia medida en producción (solo lectura, 2026-11-11): en las 5 sucursales los platos «sin decidir» son todos BASE_CONFIGURABLE (la lista los excluye a propósito) y los directos tienen nombre de
 * carta igual al del producto: la lista sale vacía. Diseño: `docs/diseno-apagar-esta-bien-asi-2026-11-11.md`.
 *
 * Con `false`:
 *  - Carta › Hoy no dibuja la lista de platos sin nombre de carta (ni la consulta);
 *  - la ficha «En la carta» del producto no muestra el aviso «pendiente de completar»;
 *  - la acción `confirmarNombreEnCarta` rechaza con `MENSAJE_ESTA_BIEN_ASI_APAGADO` DESPUÉS de verificar el permiso, sin escribir ni auditar.
 * NO cambia: la columna la columna del nombre de carta de `ContenidoCartaProducto`, la regla «nombre de carta, o el del producto si está vacío», la regla de no repetir nombres, la carta pública, el selector del mozo, el ticket ni la comanda; el campo
 * «Nombre en la carta» de la ficha sigue editable.
 * Para volver a encenderlo: poner `true` (nada más).
 */
export const ESTA_BIEN_ASI_VISIBLE: boolean = false;

/** Lo que responde el servidor a «Está bien así» con el interruptor apagado. */
export const MENSAJE_ESTA_BIEN_ASI_APAGADO = "«Está bien así» está apagado: un plato sin nombre de carta sale con el nombre del producto. Si querés otro nombre, escribilo en la ficha del producto.";
