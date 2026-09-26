# Plan: imprimir la comanda de cocina (KOT) y la boleta de cierre desde el POS de mesas — 2026-09-25

Sigue a «tomar pedido» (`docs/plan-tomar-pedido-2026-09-25.md`, que dejaba la impresión fuera de alcance) sobre la rama
`feat/pos-tomar-pedido`. Plan diseñado por un agente de planificación contra el código real, confirmado por el dueño del producto e
implementado un commit por paso. Sin migración ni campo nuevo: todo se deriva de lo existente.

## A. Premisa validada

Hay UNA sola PC en el local, que ve las dos impresoras (la térmica de cocina/caja y la común) por USB o red, con los drivers del
sistema operativo. `window.print()` sobre una vista formateada funciona en Chrome/Edge/Firefox modernos y el diálogo nativo deja
elegir la impresora. Por eso **no** hay agente local de impresión ni cola de «ya impresa»: imprimir es un acto sincrónico frente a
la persona; si falla (o se cancela el diálogo), existe «Reimprimir». El único problema real de la impresión física es de
configuración del sistema operativo (driver de la térmica como USB o TCP/IP puerto 9100), no de código: va en la aceptación manual.

## B. Decisiones

- **B1. Comanda de cocina (KOT), SIN precio.** Encabezado «COMANDA · COCINA» (primer envío), «REIMPRESIÓN» (copia) o «ANULACIÓN ·
  NO PREPARAR» (anulación); mesa en grande; «Envío N»; fecha y hora de impresión (dd/mm/aaaa hh:mm, hora de Argentina); «Tomó»: los
  autores distintos de los ítems del envío o, si no hay, el mozo de la cuenta; cantidad (la vigente) y nombre de cada ítem; bloque
  «Anulado» con cantidad, producto y motivo. Sin observaciones (no existen en el modelo). Garantía a nivel de tipos: `ComandaDeEnvio`
  (`src/core/pos/comanda.ts`) no tiene ningún campo de precio, se arma campo por campo (sin spread) y la página no le pasa precios.
- **B2. «Enviar a cocina» imprime solo.** Decisión del dueño al implementar (opción a): `enviarACocina` devuelve, además de
  `{ ok, mensaje }`, `numeroEnvio` y `envioNuevo` (tipo `ResultadoEnvioACocina` en `src/server/actions/tipos.ts`;
  `ResultadoAccion` no cambia). La pantalla pide imprimir `{ tipo: "envio", numero }` SOLO si `envioNuevo`: cada pestaña imprime el
  envío que el servidor confirmó como creado por SU llamada. Una pestaña vieja que aprieta «Enviar» sobre ítems que otro ya envió
  recibe «Esos ítems ya estaban enviados.» con el número de ese envío y `envioNuevo: false`, y no imprime nada. (El diseño original
  deducía el envío de lo que traía `router.refresh()` con un `despuesDe`, pero con esos datos una pestaña vieja no se distingue de la
  que envió: habría reimpreso la comanda del otro.)
- **B3. «Reimprimir» por envío.** Botón en el encabezado de cada «Envío k · en cocina» (`aria-label` «Reimprimir la comanda del
  envío k»). No llama al servidor ni toca `numeroEnvio`. Sin `pos_tomar_pedido` Editar, deshabilitado con `title`.
- **B4. Una anulación imprime el aviso a cocina, automático.** Se toman las anulaciones que el ítem ya tenía y se imprime la nueva:
  mesa, envío, hora, «Anuló», cantidad, producto, motivo y «Quedan: N». Se puede cancelar en el diálogo nativo. Quitar un ítem SIN
  enviar no imprime nada.
- **B5. Boleta de cierre (para el cliente, CON precio).** Sucursal, mesa, «Cerrada: dd/mm/aaaa hh:mm», «Atendió»; las líneas NETAS
  que registró `cerrarCuenta` (recalculadas con `lineasDeVenta` sobre los ítems de la cuenta cerrada, que ya no cambia), cada una en
  dos renglones para 58 mm («2 × Milanesa» y debajo, a la derecha, «$ 9.000 c/u» y el subtotal); las de neto 0 no aparecen;
  «TOTAL» en grande (mismo cálculo); «No válido como factura». Sin forma de pago, propina ni número de comprobante (no existen) y SIN
  el aviso de stock negativo (información interna: queda en el aviso ámbar de la pantalla y en la auditoría; lo verifica un E2E).
  > **Nota 2026-09-25 — numeración:** la boleta ya tiene número. «Boleta N.º 566-A» va en su propio renglón debajo de la mesa y
  > «Cuentas cerradas» antepone «N.º 566-A · »: número base secuencial por sucursal + ejemplar (A = original; B, C… = correcciones
  > tras anular parte de la venta, con encabezado «CORRECCIÓN» y «Reemplaza a N.º 566-A»). Sigue siendo control interno, no número
  > fiscal. Ver `docs/plan-numeracion-boleta-2026-09-25.md`.
- **B6. «Cerrar y registrar la venta» imprime la boleta sola**, solo con total > 0: después del refresco la mesa aparece libre y
  «Cuentas cerradas» ya trae la cuenta con los datos de la venta registrada. En el caso idempotente «ya estaba cerrada» se imprime
  igual (una copia de más no genera trabajo repetido, a diferencia del KOT). No se navega a otra pantalla (se perdería el aviso).
- **B7. Una infraestructura, dos documentos.** `imprimir.tsx` (en `src/app/(pos)/mesas/[mesaId]/`): `ImpresionProvider` en la CIMA
  de la página (envuelve mesa libre y cuenta abierta, así sobrevive al cierre), un único pedido pendiente, `resolverImpresion` puro
  (`src/core/pos/impresion.ts`: imprimir / esperar / descartar), portal a `document.body` con `data-imprimible`/`data-tipo`.
  Separados: los armadores (`comanda.ts` sin precios, `boleta.ts` con precios) y la presentación (`ticket-cocina.tsx`,
  `boleta-cuenta.tsx`). Nunca un «ticket genérico» con banderas.
- **B8. «Cuentas cerradas».** Al pie de la pantalla de la mesa (libre o con cuenta abierta): las últimas
  `BOLETAS_RECIENTES_POR_MESA = 3` cuentas cerradas CON VENTA (al menos un ítem con `operacionId`), de la más nueva a la más vieja,
  con «Reimprimir boleta» (copia marcada «REIMPRESIÓN»). Sin `pos_cerrar_cuenta` Editar, deshabilitado. Si alguna Operacion de la
  cuenta tiene `anuladaEn`, dice «Venta anulada» y el botón queda deshabilitado; el resolver también descarta ese caso.
- **B9. CSS en `src/app/globals.css`.** En pantalla nunca se ve (`@media screen`); al imprimir oculta todo lo demás solo si hay un
  documento montado (`body:has(> [data-imprimible])`); página con nombre `@page ticket { margin: 2mm 3mm }` sin `size` (lo decide
  el driver); ancho `100%` hasta `76mm` (en 58/80 mm ocupa el útil; en A4/carta sale una columna arriba a la izquierda); tamaños en
  pt, negro sobre blanco con `color-scheme: light`, separadores punteados, `overflow-wrap: anywhere`, montos con `tabular-nums`.
  Ciclo: un efecto sobre el `id` del documento anota una vez `afterprint` (lo desmonta) y llama a `window.print()`; una ref con el
  último id impreso evita la doble impresión del modo estricto en desarrollo.
- **B10. Accesibilidad.** Los documentos no llevan casos axe (siempre `display:none` en pantalla). Los «Reimprimir» de cada envío
  quedan cubiertos por el caso axe existente de `/mesas/[mesaId]`; «Cuentas cerradas» tiene caso propio (fila normal y con venta
  anulada, claro y oscuro).
- **B11. Sin migración.** La hora del KOT es la de impresión: la del envío no se guarda. Guardarla (`CuentaItem.enviadoEn`) queda
  como mejora que **requiere autorización expresa**; no forma parte de este plan.
  > **Nota 2026-09-25:** la numeración de la boleta SÍ trajo una migración, autorizada aparte: la tabla `EjemplarBoleta`
  > (`20260925200000_pos_numeracion_boleta`, `docs/plan-numeracion-boleta-2026-09-25.md`). Lo de este plan sigue sin migración propia
  > y la hora del envío sigue sin guardarse.

## C. Pasos (un commit por paso, suite completa en verde en cada uno)

1. Núcleo de la comanda y del resolver (`comanda.ts`, `impresion.ts`, tests puros).
2. Infraestructura compartida, comanda imprimible y «Reimprimir» por envío (sin impresión automática todavía).
3. «Enviar a cocina» imprime solo (con `numeroEnvio`/`envioNuevo`, ver B2).
4. La anulación imprime el aviso a cocina.
5. Núcleo de la boleta (`boleta.ts`, rama `boleta` del resolver; test contra Postgres real).
6. Boleta imprimible y «Cuentas cerradas» con «Reimprimir boleta».
7. «Cerrar cuenta» imprime la boleta sola (total > 0).
8. Este documento y las notas en `plan-tomar-pedido` §E y en el grounding.

Pruebas: los E2E reemplazan `window.print` con `addInitScript` (`test/e2e/fixtures/impresion.ts`: guarda tipo y texto del
documento montado en el momento de la llamada; `page.on("dialog")` no ve el diálogo de impresión), y lo complementan con
`emulateMedia({ media: "print" })` y viewports angostos (220 px ≈ 58 mm, 302 px ≈ 80 mm). Cada guarda nueva se probó rojo→verde
(detalle en los mensajes de commit).

## D. Aceptación manual en la PC del local (no automatizable)

- Instalar la térmica con su driver (USB, o TCP/IP puerto 9100) y verificar que aparezca en el diálogo de impresión.
- La comanda (enviar, reimprimir, anular) y la boleta (cerrar, reimprimir) salen bien en el rollo real: ancho completo, sin cortes,
  texto legible, separadores visibles.
- La impresora común da una columna legible arriba a la izquierda.
- Chrome recuerda la última impresora elegida.
- El diálogo se abre solo después de enviar, anular y cerrar (y no al cerrar una cuenta sin venta).
- Un navegador sin `:has()` imprimiría la página entera: usar Chrome/Edge/Firefox actualizados.

### Opción kiosk (documentada, sin código)

Para que salga directo a la impresora predeterminada sin mostrar el diálogo, Chrome/Edge se pueden abrir con
`--kiosk-printing` (por ejemplo, un acceso directo a `chrome.exe --kiosk-printing https://…/mesas`). Contras: no se elige
impresora (siempre la predeterminada del sistema, así que la comanda y la boleta saldrían por la misma) y no se puede cancelar. No
requiere ningún cambio en motor2.

## E. Riesgos asumidos

- Si el refresco falla (red caída), no se imprime nada: se recupera con «Reimprimir» (envío o boleta).
- La hora del KOT es la de impresión, no la del envío (B11).
- «No válido como factura» es el comportamiento seguro por defecto para un ticket no fiscal.
