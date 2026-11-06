# Maqueta: corregir comprobantes (mesa, mostrador, compra, nota de crédito)

Rama temporal `alegp/tmp-capturas-correcciones` (no se mergea). Todas las capturas son la **pantalla real del sistema** (servidor de producción `next start`) sobre una **base local descartable** con los datos reales de la empresa (sucursales, CORDECC, Mesa 1 SALÓN, puesto 0 MOSTRADOR y 23 productos de venta con su precio). Los casos se operaron por las pantallas (no con SQL). Celular = 375 px, escritorio = 1280 px, escala 2.

## Qué NO es real (declarado)
- **Costos de compra**: no existen en producción. Factura CORDECC con importes de EJEMPLO: Cerveza Patagonia ×24 = $144.000 ($6.000 c/u) y Agua 500 cc ×48 = $72.000 ($1.500 c/u). Devolución y nota de ejemplo: 6 × $6.000 = $36.000.
- **Sucursal**: se operó en «Varvarco» (no se sabe en cuál está la Mesa 1 real). Los 23 PV son los que se pasaron; faltan los otros 24 de los 47.
- **Recetas**: la Compra solo ofrece insumos, y el sistema exige receta para vender. Cerveza Patagonia y Agua 500 cc se compran como insumo «… (reventa)» (el sistema no admite dos productos con el mismo nombre). Brownie, Café, Capuccino y Flan casero llevan el mismo sustituto «… (reventa)» con stock, porque sus recetas reales no se pasaron. Por eso la factura muestra «MP_REV_PV_…».
- Las filas «2000-01-01 · Sin proveedor · $0» de Compras registradas son ese stock inicial de la maqueta.
- Cuenta/usuario: `gerente@maqueta.local` (rol admin).
- La **pantalla de nota de crédito la armé yo en esta rama** (no existía): `formulario-nota-credito.tsx`, `notas-de-credito-proveedor.ts` y `notas-de-credito.ts`, sin migración. Atajos: permiso `corregir_compra` (los propios de nota de crédito no están en el catálogo), sin auditoría aparte, tope por renglón (no suma notas anteriores).

## Capturas

### Caso 3 — cargar la compra (base de los casos 3 y 4)
| Archivo | Muestra |
|---|---|
| 10-compra-paso1-factura | Paso 1: proveedor CORDECC y número A-00003-00004576 (tecleado al revés a propósito) |
| 11-compra-paso2-renglones | Paso 2: Cerveza ×24 y Agua ×48 con importes |
| 12-compra-paso4-pago | Paso 4: «Pagada ahora» |
| 13-compra-paso5-revisar | Paso 5: resumen, total $216.000 |
| 14-compra-confirmada | Compra confirmada |
| 40-compra-contenedor-escritorio / -celular | EL CONTENEDOR: cabecera (fecha, proveedor, factura, total), renglones, «Cargada por», link «ver la operación», botones Corregir / Anular |
| 41-compra-trazabilidad-celular | «Ver la operación»: los 2 movimientos de stock (COMPRA) de esa factura |
| 42-compra-corregir-formulario-celular | Formulario «Corregir proveedor y factura»: dice «Se corrige solo la cabecera… Para cambiar precios o cantidades, anulá la compra» |
| 43-compra-corregida-celular | Número corregido a …4567; aviso «Compra corregida: N.º de factura» |
| 44-compra-anular-confirmar-celular | Confirmación de «Anular compra» |
| 45-compra-anular-rechazado-celular | Rechazo: «parte de lo que se compró ya se consumió… se compraron 24 y hoy quedan 22. Si le devolviste mercadería…, registrala como Devolución a proveedor» |

### Caso 1 — Mesa 1 (SALÓN): 2 Cerveza Patagonia + 1 Brownie + 2 Café = $46.000
| Archivo | Muestra |
|---|---|
| 20-mesa-0-pedido-enviado | Pedido cargado y enviado a cocina, total $46.000 |
| 20-mesa-1-cerrar-cuenta | Diálogo de cierre |
| 20-mesa-2-antes-cuenta-cerrada | ANTES: «Cuentas cerradas: N.º 1-A · $46.000»; «Emitir ticket corregido» deshabilitado (el ticket está al día) |
| 20-mesa-3-reporte-tickets-antes | Reporte «Tickets emitidos»: el ticket 1-A abierto, con link «Trazabilidad» por línea |
| 20-mesa-4-trazabilidad-anular-venta | Trazabilidad de la línea del Brownie con «Anular venta» |
| 20-mesa-5-ticket-desactualizado | Después de anular el Brownie: 1-A ahora $36.000, «Emitir ticket corregido» habilitado, «Reimprimir» deshabilitado |
| 20-mesa-6-emitir-dialogo | Diálogo: «Total corregido $36.000» y motivo obligatorio |
| 20-mesa-7-emitir-sin-motivo | Sin motivo: «Escribí el motivo de la anulación» |
| 20-mesa-8-despues-ticket-corregido | Justo después: aviso «Ticket N.º 1-B emitida: reemplaza a N.º 1-A» (la fila de abajo todavía no se actualizó) |
| 20-mesa-8b-despues-recargado | DESPUÉS (recargado): N.º 1-B · $36.000, «Emitir» deshabilitado, «Reimprimir» habilitado |
| 20-mesa-9-reporte-tickets | Reporte: 1-B «Corrección de 1-A» $36.000 y 1-A «Reemplazada por 1-B» $46.000 (el original sigue) |

### Caso 2 — Mostrador (puesto 0): 1 Capuccino + 1 Flan casero = $17.000
Misma serie con prefijo `30-mostrador-…` (se anuló el Flan: ticket 2-A $17.000 → 2-B $8.000). `30-mostrador-9-reporte-tickets` muestra además el detalle del ejemplar 2-B.

### Caso 4 — devolución parcial con nota de crédito
| Archivo | Muestra |
|---|---|
| 50-devolucion-formulario | Movimientos → Devolución a proveedor: 6 Cerveza, CORDECC, factura …4567 (se tipea de nuevo, no se elige la compra) |
| 51-devolucion-registrada | «Se guardaron 1 movimiento(s)» |
| 52-nota-credito-formulario | PANTALLA ARMADA EN ESTA RAMA: «Cargar nota de crédito del proveedor» dentro del contenedor; por renglón, unidades e importe; total; «No cambia el stock ni el costo»; «Aplicación al pago: pendiente de completar» |
| 53-nota-credito-registrada | Aviso «Nota de crédito A-00001-00000321 registrada por $36.000» |
| 54-nota-credito-en-lista / 55-…-escritorio | Sección «Notas de crédito de proveedores»: −$36.000, «Suelta (sin factura enganchada)», motivo con el número de factura, quién y cuándo. La factura sigue en $216.000 (no se netea) |
| 56-reporte-devoluciones-escritorio | Reporte de devoluciones: CORDECC $36.000 (el mismo monto, tecleado por separado) |

### Maqueta «Corregir una factura de compra» por pasos (mismo formato que el ticket; diseño en docs/diseno-correccion-de-compras-2026-11-06.md §4)
Pantallas reales (`/reportes/compras/corregir` y `/reportes/compras/corregir/<compra>`) sobre la compra real de CORDECC y el stock real. En «Compras registradas» ahora solo queda el enlace «Corregir esta factura →» (reemplaza al panel que se abría dentro de la lista). **Muestra y calcula, NO guarda** (falta el caso de uso y ampliar el CHECK de la base; el botón y un cartel lo dicen). Paso 1: filtros en una fila (desde, hasta, proveedor, letra, N.º de factura) y resultados abajo. Paso 2, otra página: original congelado a la izquierda y «Como debería quedar · versión 2» a la derecha (dos columnas en escritorio; apiladas en celular).
El stock de Cerveza Patagonia es 14: 24 comprados − 2 vendidos en la Mesa 1 (1-A) − 6 devueltos − 2 vendidos en el ticket 3-A.
| Archivo (escritorio y celular) | Muestra |
|---|---|
| 60-factura-paso1-buscar | Paso 1: filtros y las 5 compras de la base (la de CORDECC y 4 de stock inicial «pendiente de completar») |
| 61-factura-paso1-resultado | Buscar proveedor CORDECC, letra A, número 4567: un resultado |
| 62-factura-paso2-original-y-corregida | Paso 2: original congelado y la copia; «¿Qué querés corregir?» (importe, cantidad; el resto, próxima etapa) |
| 63-factura-paso2-importe-que-cambia | Cerveza $144.000 → $150.000: total $222.000, costo de reposición $6.000 → $6.250, «Stock: no cambia» |
| 64-factura-paso2-cantidad-limite-exacto | Bajar de 24 a 5: «Comprados 24 · hoy quedan 14 · se puede bajar hasta 10» |
| 65-factura-paso2-cantidad-que-cambia | Bajar de 24 a 20: stock 14 → 10; avisa que el costo por unidad pasa de $6.000 a $7.200 porque el importe sigue en $144.000 |
| 66-factura-paso2-completar-importe-faltante | Una compra real sin precio («pendiente de completar», $0): al completar $1.500 pasa a fijar el costo de reposición |
No se pudo mostrar «después de guardar» ni el historial de versiones (necesitan la escritura y la migración). Proveedor y N.º de factura, producto y agregar/quitar renglón figuran como próxima etapa.

### Maqueta «Corregir un ticket» por pasos (pedido del dueño, 2026-11-06)
Pantallas reales (`/reportes/tickets/corregir` y `/reportes/tickets/corregir/<ticket>`) sobre los tickets reales de la base local: 1-A/1-B y 2-A/2-B ya corregidos, y 3-A (Mesa 01, $46.000) y 4-A (Mostrador, $25.000) sin corregir. **Muestra y calcula, NO guarda.** Paso 1: filtros en una sola fila (desde, hasta, letra, N.º de ticket) y resultados abajo. Elegir uno abre OTRA página (paso 2): en escritorio, el ticket original congelado a la izquierda y el corregido a la derecha, en dos columnas para que no quede una columna larga; en celular se apilan.
| Archivo (escritorio y celular) | Muestra |
|---|---|
| 70-ticket-paso1-buscar | Paso 1: filtros arriba y los 6 tickets del día abajo, con estado («Al día», «Reemplazado por 1-B», «Corrección de 1-A») y «Corregir →» o «Ver →» |
| 71-ticket-paso1-resultado | Buscar letra A y número 3: un resultado |
| 72-ticket-paso2-original-y-corregido | Paso 2: «ORIGINAL N.º 3-A, no se modifica» y «COMO QUEDA N.º 3-B» con «Quitar» por línea |
| 73-ticket-paso2-quitando-una-linea | Se quita el Brownie: total corregido $36.000 y «el 3-A queda en el historial como Reemplazado por 3-B» |
Lo que reúne: hoy son tres pasos en tres pantallas (Reportes → Tickets, anular cada línea en Trazabilidad, volver a la mesa a emitir). La maqueta los junta en uno. **Pendiente de decidir:** hoy anular y emitir son dos operaciones separadas; hacerlo en un solo paso exige un caso de uso nuevo que sea atómico (todo o nada) y pida el motivo una vez. «Quitar» saca la línea entera (la venta se registra por línea); quitar una unidad de dos sería «anular y rehacer» (plan aprobado, no construido). Una promo no se quita por componente (botón deshabilitado).

## Respuestas por caso (VERIFICADO = visto en la pantalla real; PROPUESTA = mi sugerencia; NO VERIFICADO = no probado)

### Casos 1 y 2 — ticket corregido (mesa y mostrador, idénticos)
- **(a) Pasos.** VERIFICADO: para llegar de «cuenta cerrada» a «ticket corregido» el guion hizo 8 toques y 1 texto: abrir el ticket en Reportes → Tickets emitidos (1), «Trazabilidad» de la línea (1), «Anular venta» (1), «Sí, anular» (1), volver a la mesa (2), «Emitir ticket corregido» (1), escribir el motivo, «Emitir e imprimir» (1); más moverse por el menú hasta el reporte. Cargar el pedido y cerrar la cuenta aparte (≈15 toques para 3 productos).
- **(b) Contenedor.** VERIFICADO: en la mesa se ve solo «N.º 1-A · hora · mesero · total» y dos botones. Lo que queda oculto: las líneas del ticket, qué línea se anuló, el motivo del ejemplar B, el stock repuesto. Para saberlo hay que ir a Reportes (Tickets emitidos muestra ejemplares y líneas; el motivo NO se ve ahí).
- **(c) Registro.** VERIFICADO en base: ejemplar 1-B nuevo con motivo, quién y cuándo, apuntando al 1-A; el 1-A NO se borra (el reporte lo marca «Reemplazada por 1-B»); auditoría «ticket corregido 1-B (reemplaza a 1-A). Motivo: …». La venta de la línea queda anulada con quién y cuándo, **sin motivo**: «Anular venta» no lo pide y la auditoría solo dice «Venta del …: anulación» (no nombra producto ni importe). El motivo se pide recién al emitir el ticket corregido.
- **(d) Qué se puede romper o confundir.** VERIFICADO: (1) la corrección es de a una línea ENTERA: anular «Cerveza ×2» baja las dos; no hay «bajar una». (2) Justo después de emitir, la fila de «Cuentas cerradas» siguió mostrando 1-A con «Emitir» habilitado hasta recargar; el servidor rechaza una segunda emisión (código y reglas, no probado en pantalla) — puede confundir. (3) El primer paso (anular) está en otra pantalla y el motivo en otra: se puede anular y no emitir nunca el ticket corregido; el botón «Reimprimir» queda deshabilitado, pero el cliente ya se llevó el 1-A impreso. (4) El ticket impreso ya entregado no se puede recuperar: la corrección es un papel nuevo. (5) El buscador de Trazabilidad «por producto» NO lista la venta (lista consumos y compras del insumo): hay que llegar por Tickets. NO VERIFICADO: permiso del mozo (probado solo con admin).
- **(e) Veredicto.** El mecanismo es sólido (conserva el original, pide motivo, un solo ejemplar vigente), pero **para un usuario no técnico el recorrido es confuso** porque está partido en tres pantallas y el motivo llega al final. PROPUESTA más barata: en «Cuentas cerradas», agregar por fila un botón «Anular una línea» que lleve directo a esa venta, y pedir el motivo ahí (el mismo texto vale para el ticket corregido); cero tablas nuevas.

### Caso 3 — compra corregida SOLA
- **(a) Pasos.** VERIFICADO: cargar la factura = 8 toques y 13 campos (5 pasos). Corregir cabecera (número mal tecleado): expandir (1) + «Corregir proveedor y factura» (1) + 3 campos + «Guardar» (1). **Corregir la cantidad o el precio de un renglón NO EXISTE**: la pantalla lo dice («Para cambiar precios o cantidades, anulá la compra y cargala de nuevo»).
- **(b) Contenedor.** VERIFICADO: se ve fecha, proveedor, factura, total, renglones (producto, cantidad, precio, sección), quién la cargó y «ver la operación» (movimientos de stock). Oculto: que la compra figuraba «Pagada ahora» (el pago solo se muestra en facturas repartidas entre sucursales) y qué se vendió o devolvió de lo comprado (solo aparece como error al anular).
- **(c) Registro.** VERIFICADO: la corrección de cabecera deja auditoría por campo (A-00003-00004576 → A-00003-00004567, quién y cuándo) y no toca el stock ni los renglones. NO VERIFICADO: la anulación exitosa (no se pudo probar porque ya se vendieron cervezas; el código dice que es un ajuste inverso y no borra la compra).
- **(d) Qué se puede romper.** VERIFICADO: al anular para rehacer, el sistema lo rechaza si parte de lo comprado ya se vendió o devolvió («se compraron 24 y hoy quedan 22»): una compra con un precio mal cargado y mercadería ya vendida **no se puede rehacer** por esta vía, y el mensaje manda a hacer una devolución a proveedor (que no corrige el precio). Anular toda la factura por un renglón mal es desproporcionado.
- **(e) Veredicto.** Para el error de cabecera, opera un no técnico. Para precio/cantidad **es un callejón sin salida** en cuanto hay consumo. PROPUESTA (más barata): permitir corregir el importe/cantidad de un renglón con un ejemplar de ajuste (la corrección por ejemplares ya prevista en el diseño) y mostrar «Pagada ahora» en el contenedor; es una decisión de modelo y dinero: espero tu OK antes de diseñarla.

### Caso 4 — compra con nota de crédito
- **(a) Pasos.** VERIFICADO: devolución física = 1 toque de elegir insumo + 7 campos + «Confirmar»; nota de crédito = expandir (1) + abrir (1) + 4 campos + «Registrar» (1). Total ≈ 5 toques y 10 campos en dos pantallas distintas.
- **(b) Contenedor.** VERIFICADO: la devolución y la nota NO están enlazadas entre sí ni con la factura: la nota es «suelta» (por decisión del diseño, la compra simple no es documento) y el número de factura va solo como texto en el motivo. La factura sigue en $216.000. En la nota se ve proveedor, número, líneas, motivo, quién y cuándo.
- **(c) Registro.** VERIFICADO: la nota guarda quién, cuándo, motivo, importe por línea y su imputación a la sucursal; no se edita ni se borra (en esta maqueta no hay botón de anular). NO VERIFICADO: auditoría administrativa (omitida en la maqueta).
- **(d) Qué se puede romper.** VERIFICADO: el importe de la nota y el de la devolución se tipean dos veces (pueden diferir); no hay tope contra notas anteriores; se puede cargar la misma nota con otro número; «Aplicación al pago» queda «pendiente de completar». La idempotencia (misma clave → mismo resultado) está en la acción pero NO la probé con un doble clic.
- **(e) Veredicto.** Es operable pero **repite datos** y deja dos registros sueltos. PROPUESTA más barata (ya prevista como NC1 en el diseño): al cargar la nota, elegir la devolución ya registrada (trae cantidad e importe) en vez de tipearlos. Mientras tanto, NC0 tal como está en esta maqueta alcanza para registrar el dinero.

## Cómo reproducir
`herramientas/correr-todo.sh` (necesita Postgres local con las bases `motor2_dev`/`motor2_e2e`, `npm run build:e2e` + `npm run start:e2e` en el puerto 3300 y un `.env.cap` con las variables `MOTOR2_E2E_*`; los datos se siembran con `sembrar-datos-reales.ts`).
