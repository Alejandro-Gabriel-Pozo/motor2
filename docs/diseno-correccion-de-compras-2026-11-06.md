# Diseño: corregir una compra ya cargada, por ejemplar (2026-11-06)

Estado del documento: **PROPUESTA para el dueño**. Sin código y sin migración. Lo contado del código se verificó leyendo `prisma/schema.prisma`, `src/core/compras/{anulacion,correccion}.ts`, los casos de uso `anular-compra`, `corregir-compra` y `registrar-movimiento`, `src/server/lecturas/reportes/comun.ts` (costo de reposición), las pantallas de `reportes/compras` y las capturas de la maqueta `docs/_capturas/correcciones/` (casos 3 y 4). Del repo `motor2-docs` se leyó `_planes/plan-documento-comercial-compras-y-ventas.md` (decisiones y semántica «anular y rehacer»). No se corrió ningún test.

Estados de cada decisión: **CONFIRMADA** (la dijo el dueño), **PROPUESTA**, **PENDIENTE**, **NO VERIFICADA**.

## 0. Resumen para el dueño

- **CONFIRMADA (2026-11-06, dueño): «el original debería quedar congelado».** La factura cargada no se edita nunca; se corrige con un **ejemplar nuevo** que la reemplaza, con motivo, quién y cuándo. Es lo que ya hace el ticket (1-A queda, 1-B lo reemplaza).
- **No hace falta ninguna tabla nueva (PROPUESTA).** `Operacion` ya tiene `reemplazaAOperacionId` (la operación que reemplaza a otra, única) y `motivoAnulacion`, aplicadas por la migración M2. La base hoy permite `reemplazaAOperacionId` **solo en ventas**: la única migración es **ampliar ese CHECK a compras** (aditiva y reversible; requiere tu autorización por base, con respaldo y ensayo).
- **El hallazgo que destraba el caso de la maqueta (PROPUESTA):** la corrección se controla por el **saldo final**, no revirtiendo la compra entera. Corregir un **precio** no mueve stock, así que **nunca** choca con «ya se vendió». Corregir una **cantidad** solo se limita a lo que todavía queda (por ejemplo, «comprados 24, quedan 22: podés bajar hasta 2»).
- **Pantalla (PROPUESTA):** se parte del documento, no del botón. «Corregir esta factura» muestra el original (congelado) arriba y una copia editable abajo, con lo que cambia resaltado y un resumen «qué cambia» (stock, costo y total) antes de guardar. Se pregunta primero **qué querés corregir**, y solo se abren esos campos.
- **Primera etapa más barata (PROPUESTA):** corregir o completar el **importe** de un renglón (sin mover stock). Incluye el caso «$0 = sin dato» que hoy muestra «hay productos sin precio».
- **Una pregunta para vos** (cambia dinero): §11.

## 1. El documento que se corrige: qué datos trae

Es la primera parte de la corrección: antes de decidir cómo corregir, qué es lo que hay que poder corregir. Verificado contra el código de `main` del 2026-11-06.

### 1.1 Qué es una compra hoy

- **Compra simple de una sucursal:** una `Operacion` (`proceso = COMPRA`) con una línea `MovimientoStock` por renglón. **No es un documento** `FacturaProveedor`; no existe una columna «total»: el total de la factura es la suma de los importes de sus renglones.
- **Factura repartida entre sucursales:** un documento `FacturaProveedor` con sus renglones, partes por sucursal y pago. Su `importeTotal` «nunca se modifica» (comentario del esquema). Se trata aparte (etapa C3).
- En esta propuesta, la corrección de una **compra simple** es el caso central. La factura documento queda como etapa posterior con nombre.

### 1.2 Cabecera

| Dato | Dónde vive | Qué mueve | ¿Se corrige hoy? | Propuesta |
|---|---|---|---|---|
| Proveedor | `Operacion.proveedorId` | vínculo proveedor↔producto, comparativa, aviso de duplicado | Sí (K1b, in situ) | Se mantiene; entra en el mismo flujo «Corregir esta factura» |
| N.º de factura (letra, punto de venta, número) | `Operacion.nroFactura`; único entre las vigentes de la empresa+proveedor | unicidad, aviso de duplicado | Sí (K1b) | Igual. En un ejemplar nuevo el número es **el mismo** (§6) |
| Fecha de la factura | `Operacion.fecha` | stock, **orden del costo vigente**, período del gasto | No | **No se corrige** (si fue otro día es otro comprobante: anular y recargar) |
| Depósito (por renglón) | `MovimientoStock.seccionId` | stock por sección | No | Etapa C1 (mueve stock entre secciones) |
| Detalle libre | `Operacion.detalleLibre` | nada | Sí | Se mantiene |
| Condición de pago («Pagada ahora») | se elige en el paso 4 de la carga | en la factura documento: estado de pago | En compra simple **no se muestra** en el contenedor | **NO VERIFICADA** dónde queda guardada en la compra simple; se verifica antes del nivel 6 |
| Quién la cargó y cuándo, clave de idempotencia | `usuarioId`, `creadoEn`, `claveIdempotencia` | trazabilidad | n/a | El ejemplar nuevo lleva los suyos |

### 1.3 Renglón (una línea `MovimientoStock` de la compra)

| Dato | Detalle | Qué mueve |
|---|---|---|
| Producto (insumo) | el insumo comprado | stock, costo, vínculo |
| Cantidad | en **unidad de stock**, positiva | stock |
| Importe del renglón | `precioTotal`, **con IVA incluido** (`$0` = sin dato, **CONFIRMADA** por el dueño) | gasto, costo |
| Precio por unidad de stock | derivado: importe ÷ cantidad | costo de reposición |
| Lote (vencimiento) | `loteVencimiento`, opcional | saldo por lote |
| Sección | dónde entra | stock por sección |
| Texto de conversión | `detalle` (por ejemplo «24 unidad») | solo lectura |
| «Cómo lo llama el proveedor» | se guarda en el vínculo proveedor↔producto, no en el renglón | precarga de próximas compras |
| Unidad de compra y unidades compradas | **no se guardan** hoy (llegan con la migración 2a de compras, pendiente de autorización) | n/a |

### 1.4 Lo que se desprende de cada dato (qué hay que cuidar al corregirlo)

| Consumidor | Cómo lee la compra | Consecuencia de corregir |
|---|---|---|
| Stock (Kardex, solo agrega) | suma de líneas con signo | un cambio de cantidad, lote, sección o producto mueve stock; uno de precio, no |
| **Costo de reposición** | el precio por unidad de la entrada valorizada **más reciente**, ordenada por `fecha` desc y luego por id, solo operaciones no anuladas y con precio > 0 (`obtenerCostoActualPorMP`) | si el ejemplar nuevo conserva la **fecha** original, el costo vigente lo sigue solo: no hay nada que recalcular |
| Compras del período, ratio compras/ventas, gasto por insumo | suman `COMPRA` vigentes | cuenta el ejemplar nuevo; el original (anulado) sale |
| Costo histórico de las ventas pasadas («reconstruido») | historial de compras vigentes por día | cambia **hacia atrás** el margen reconstruido de ventas ya hechas (§11) |
| Vínculo proveedor↔producto y su precio | se escribe en la carga (`registrarVinculoDeCompraEnTx`) | hay que re-apuntarlo al ejemplar nuevo: **NO VERIFICADA** la regla exacta de «precio vigente» del vínculo |
| Aviso de duplicado y unicidad de número | entre vigentes | el original se anula antes de insertar el ejemplar (§7) |
| Nota de crédito suelta | el número de la factura va como texto en el motivo | **no se puede detectar** que existe una nota: se avisa en pantalla (§5) |

### 1.5 Inventario de lo que ya existe con otro nombre (regla del proyecto)

| Ya existe | Qué es | Qué se reutiliza |
|---|---|---|
| `Operacion.reemplazaAOperacionId` (único, FK, relación inversa `reemplazadaPor`) | «la operación que reemplaza a otra»; hoy CHECK solo `VENTA` | La cadena de ejemplares (original → corrección → corrección). Solo se amplía el CHECK a `COMPRA` |
| `Operacion.motivoAnulacion` | motivo con que se anuló | El motivo de la corrección |
| `Operacion.revierteAOperacionId` + AJUSTE inverso | contra-asiento de una anulación (`anularCompra`) | El original se anula con su contra-asiento, como hoy |
| `evaluarAnulacion` (saldo por lote y total por sección, S-02) | decide si se puede revertir | La misma regla, aplicada al **saldo final** de la corrección |
| Conteo posterior (M-3): se rechaza anular si hubo conteo físico posterior | guarda de coherencia | Se aplica a los renglones cuya cantidad, lote, sección o producto cambian |
| `EjemplarTicket` (1-A reemplazado por 1-B) | patrón visual y de datos del ticket | Misma idea y mismos textos («Reemplazada por…») |
| Plan aprobado **B-REHACER** (anular y rehacer, `plan-documento-comercial-compras-y-ventas.md` §B, DC3.8) | para ventas: se anula la operación y en la misma transacción se escribe la que queda, enlazada | Se extiende a compras con el mismo patrón |
| `docs/diseno-compras-factura-unica-y-rechazo-2026-11-03.md` §12 (corrección con ejemplares, PROPUESTA) | propone revertir el ejemplar vigente y cargar el siguiente con el mismo número | Este documento lo **precisa**: control por saldo final (el §12 como está caería en el mismo callejón de la maqueta) y lo baja a la compra simple |
| `corregirCompra` (K1b) y `anularCompra` (K1c) | corrección de cabecera y anulación | K1b se absorbe en la pantalla nueva; K1c queda como «era otra factura» |
| Comprobante único en la empresa (`hayComprobanteVigenteEnLaEmpresa`) | chequeo de número repetido | Igual, excluyendo el ejemplar que se reemplaza |

## 2. Catálogo de errores corregibles

Lo que puede estar mal en una factura cargada, y qué pasa con cada uno. Esta tabla es la base de la pantalla (§4).

| # | Qué estaba mal | Mueve stock | Mueve costo y gasto | Hoy | Etapa |
|---|---|---|---|---|---|
| E1 | Proveedor | No | No (cambia el vínculo) | K1b | C0 |
| E2 | N.º de factura | No | No | K1b | C0 |
| E3 | **Importe de un renglón mal** | **No** | Sí | anular y recargar (bloqueado si hay consumo) | **C0** |
| E4 | **Importe faltante ($0 = sin dato)** | **No** | Sí (pasa a contar para el costo) | anular y recargar | **C0** |
| E5 | **Cantidad de un renglón** | Sí (la diferencia) | Sí | anular y recargar | C1 |
| E6 | Lote o vencimiento de un renglón | Sí (pasa de lote) | No | no | C1 |
| E7 | Depósito de un renglón | Sí (pasa de sección) | No | no | C1 |
| E8 | **Producto equivocado** en un renglón | Sí (sale de uno, entra al otro) | Sí | anular y recargar | C2 |
| E9 | Renglón de más | Sí (sale) | Sí | anular y recargar | C2 |
| E10 | Renglón que faltó | Sí (entra) | Sí | anular y recargar | C2 |
| E11 | Fecha de la factura | Sí (período y orden del costo) | Sí | no | **No se corrige**: es otro comprobante |
| E12 | «Es otra factura / no existió» | Sí (todo) | Sí | anular (K1c) | Se mantiene |
| E13 | El proveedor acreditó plata o mercadería | — | — | nota de crédito (maqueta, NC0) | **No es corrección**: es otro documento (§8) |

## 3. Escalera de diseño (niveles 1 a 10)

### Nivel 1. Propósito y alcance

- **Necesidad (CONFIRMADA):** el dueño, 2026-11-03 («corregir una factura mal cargada sin borrar lo cargado mal y sin que el sistema quede inconsistente», diseño de compras §12) y 2026-11-06 («el original debería quedar congelado»). Evidencia: la maqueta del 2026-11-06 mostró que con mercadería ya vendida no hay forma de corregir un precio.
- **Propósito:** corregir los datos de una compra simple ya cargada (importes, cantidades, lote, depósito, producto, renglones) dejando el original visible e intacto, y con el stock, el costo y el gasto siempre coherentes.
- **Dentro (PROPUESTA):** compra simple de una sucursal, ejemplares sucesivos, motivo obligatorio, resumen previo de efectos, historial visible.
- **Fuera:** factura documento (repartida) y facturas con notas de crédito vigentes (C3); fecha de la factura (otro comprobante); notas de crédito del proveedor (otro documento, etapa NC); cierre de períodos y asientos contables.
- **Forma más barata:** primero solo importes (E3 y E4) y la cabecera (E1 y E2); lo demás es etapa posterior con nombre (§9).

### Nivel 2. Actores y contexto

| Actor | Qué hace | Permiso | Estado |
|---|---|---|---|
| Administrador de la sucursal | Corrige una compra de su sucursal | `corregir_compra` (hoy admin en la semilla; **no** se crea clave nueva) | PROPUESTA |
| Operario | No corrige; carga | `proceso_compra` | HOY |
| Quien mira | Ve el original, la versión vigente y el historial | `reporte_compras` | PROPUESTA |

Contexto: pesos argentinos con IVA incluido, hora argentina, varias empresas y sucursales; no hay cierre de períodos todavía.

### Nivel 3. Casos de uso

| CU | Caso | Etapa |
|---|---|---|
| CU1 | Corregir el importe de un renglón (E3) | C0 |
| CU2 | Completar un importe faltante (E4) | C0 |
| CU3 | Corregir proveedor y N.º de factura dentro del mismo flujo (E1, E2) | C0 |
| CU4 | Corregir la cantidad de un renglón (E5), con límite exacto | C1 |
| CU5 | Corregir lote o depósito (E6, E7) | C1 |
| CU6 | Cambiar el producto de un renglón (E8), quitar uno (E9), agregar uno (E10) | C2 |
| CU7 | Ver el historial de una factura: original, correcciones, quién, cuándo, por qué | C0 |
| CU8 | Corregir una factura documento (repartida), con las partes de otras sucursales | C3 |

### Nivel 4. Conceptos y ciclo de vida

- **Ejemplar:** cada versión de la factura. El 1 es el original; cada corrección es el siguiente. Es una `Operacion` COMPRA completa, no un parche. La versión se calcula siguiendo la cadena `reemplazaAOperacionId`; no hay columna «ejemplar».
- **Estados de un ejemplar (derivados, sin columna nueva):**
  - **Vigente:** no anulado y no reemplazado. Es el único que cuenta para stock, costo y reportes.
  - **Reemplazado:** anulado con motivo y apuntado por otro ejemplar. Se muestra «Reemplazada por la versión 2», no «Anulada».
  - **Anulado:** anulado sin reemplazo (el caso «no existió», K1c).
- **Congelado:** el original y sus líneas nunca se actualizan. Solo cambia `anuladaEn`, `anuladaPorId` y `motivoAnulacion` (las columnas que hoy ya puede actualizar la aplicación).
- **Cadena lineal:** como `reemplazaAOperacionId` es única, un ejemplar se reemplaza una sola vez; dos personas corrigiendo la misma versión a la vez no pueden ganar las dos.

### Nivel 5. Invariantes y políticas

| # | Regla | Estado |
|---|---|---|
| I1 | El original y sus líneas no se editan ni se borran; el Kardex solo agrega | CONFIRMADA |
| I2 | Corregir es una sola operación atómica: contra-asiento del vigente + ejemplar nuevo + enlace + auditoría, o nada | PROPUESTA (patrón confirmado de B-REHACER) |
| I3 | **El stock se controla por el saldo final** (por producto, sección y lote): `saldo actual + (cantidad nueva − cantidad vieja) ≥ 0`. No se exige que lo comprado «siga todo en stock» | PROPUESTA (precisa el §12 del diseño de compras) |
| I4 | Un cambio solo de importe nunca mueve stock y por lo tanto nunca es rechazado por stock consumido | PROPUESTA |
| I5 | Si baja una cantidad más de lo que queda, se rechaza con el **límite exacto** y la salida correcta (devolución a proveedor si fue mercadería devuelta) | PROPUESTA |
| I6 | El ejemplar nuevo conserva la **fecha** del original (el período y el orden del costo vigente no cambian) y recibe un `creadoEn` nuevo | PROPUESTA |
| I7 | Mismo número de factura: el original se anula antes de insertar el ejemplar, así que la unicidad entre vigentes no choca | PROPUESTA |
| I8 | Importe: el que se escribe es el **del renglón con IVA incluido**, tal como figura en la factura; el precio por unidad se **calcula** y se muestra (nunca se tipea); dinero en `DECIMAL`, redondeo definido, moneda de la empresa | PROPUESTA |
| I9 | `$0` significa «sin dato» (CONFIRMADA); corregir de `$0` a un importe es un caso normal (CU2) y recién ahí el renglón empieza a fijar el costo | CONFIRMADA / PROPUESTA |
| I10 | Se rechaza si hubo un **conteo físico posterior** del mismo producto y sección, para los renglones cuya cantidad, lote, sección o producto cambian (regla M-3 de la anulación) | PROPUESTA |
| I11 | Motivo obligatorio (hasta 200), quién y cuándo en el ejemplar y en la auditoría | PROPUESTA |
| I12 | Guarda optimista: se envía la versión que la persona vio; si cambió, se avisa y no se pisa | PROPUESTA (patrón de K1b) |
| I13 | Idempotencia I3: clave obligatoria + huella; el reenvío devuelve el mensaje original; misma clave con otro contenido, conflicto | PROPUESTA |
| I14 | Una compra que es **parte de una factura documento** no se corrige suelta (regla D8, ya en código) | CONFIRMADA |
| I15 | No hay corrección sobre una compra **anulada** ni sobre un ejemplar **ya reemplazado** (hay que corregir el vigente) | PROPUESTA |
| I16 | La corrección **no cambia** la fecha ni el depósito de la cabecera (E11); si no coincide, es otro comprobante | PROPUESTA |

### Nivel 6. Historia y persistencia

- **Tablas nuevas: ninguna.** El ejemplar es una `Operacion` COMPRA con sus `MovimientoStock`, enlazada con `reemplazaAOperacionId`. El contra-asiento es el AJUSTE que ya escribe `anularCompra` (`revierteAOperacionId`).
- **Única migración (PROPUESTA, requiere autorización expresa por base, con respaldo y ensayo subir-bajar-subir):** ampliar el CHECK de `reemplazaAOperacionId` de «proceso = VENTA» a «proceso IN (VENTA, COMPRA)», sin tocar datos. Reversible: el `down.sql` aborta si ya hay una compra con ese enlace. No hay relleno de datos.
- **Puntos de extensión previstos (sin crearlos hoy):** un motivo estructurado de corrección (lista cerrada de motivos) si el texto libre no alcanza; un tipo de corrección guardado si la auditoría lo pide; el mismo enlace para `FacturaProveedor` (C3).
- **Historia:** nada se borra. La cadena completa se reconstruye siguiendo el enlace; la auditoría (`registrarCambioAuditado`) deja una fila por corrección, con el campo, el valor anterior y el nuevo, igual que K1b.
- **Guardián «solo agrega»:** el único `update` permitido sobre el original es `anuladaEn`, `anuladaPorId` y `motivoAnulacion`; un test lo verifica.

### Nivel 7. Atomicidad y concurrencia

Una transacción serializable, con reintento, en este orden (todo rechazo sale **antes** de escribir):

1. Idempotencia I3 (clave y huella).
2. Cargar el ejemplar vigente de la compra y sus líneas, de **esta** sucursal.
3. Guardas: es COMPRA; no está anulada ni reemplazada; no es parte de una factura documento; la versión que vio la persona es la actual (I12).
4. Reglas puras: calcular el **saldo final** por (producto, sección, lote), el conteo posterior, el número único en la empresa, el proveedor activo, los importes.
5. Escribir: marcar el original anulado con su motivo; contra-asiento AJUSTE; el ejemplar nuevo y sus líneas; re-apuntar el vínculo proveedor↔producto.
6. Auditoría y resultado idempotente.

El árbitro de dos correcciones simultáneas es la unicidad de `reemplazaAOperacionId` (ya existe) más el aislamiento serializable: gana una, la otra reintenta, ve el ejemplar nuevo y responde «la compra cambió mientras la editabas».

### Nivel 8. Acceso e interfaces

- Server Action `corregirFacturaDeCompra` (adaptador fino: permiso `corregir_compra` → formato → caso de uso → resultado), más un caso de uso nuevo que **absorbe** `corregir-compra` (cabecera) sin cambiar sus textos.
- Una función **pura** `evaluarCorreccionDeCompra(vigente, pedida, saldos)` que devuelve el resumen de efectos (stock, costo, total) o el rechazo con su límite exacto. La misma función alimenta la **vista previa** de la pantalla y la validación del servidor (una sola verdad).
- Lectura de la vista previa por una acción de solo lectura (no escribe).

### Nivel 9. Consultas y experiencia

Ver §4 (pantalla), §5 (qué se ve) y §6 (historial).

### Nivel 10. Pruebas, migración y operación

Ver §7 (qué pasa si…), §8 (combinaciones) y §10 (cómo se verifica).

## 4. La pantalla: partir del documento

### 4.1 Principios

1. **El documento manda:** se ve la factura tal como se cargó, congelada, y a su lado lo que cambiaría.
2. **Se pregunta primero qué corregir**, no se abre un formulario con todo: así quien no es técnico no se pierde.
3. **Lo que tipea es lo que dice el papel:** el importe del renglón con IVA (el número de la factura del proveedor). Los precios por unidad se calculan solos, nunca se escriben.
4. **Lo que no se puede, se explica con el número exacto** y con la salida correcta.
5. **Antes de guardar se ve el efecto** (stock, costo, total); después de guardar se ve antes/después y el historial.
6. **Lo que falta se muestra «pendiente de completar»** (por ejemplo, un renglón sin importe), no se inventa.

### 4.2 Caminos posibles (opciones)

| Camino | Cómo es | Ventajas | Desventajas |
|---|---|---|---|
| **A. Formulario sobre una copia del documento** | «Corregir esta factura» abre una copia editable de todo, con el original arriba | Todo en un solo lugar; un solo ejemplar aunque haya varios errores; la vista previa suma todo | Con facturas de muchos renglones es largo y se puede tocar de más |
| **B. Acción por renglón** | Cada renglón con «Corregir precio / cantidad / producto / quitar» en un diálogo | Muy exacto por campo; menos para leer | Varios errores en una factura = varios ejemplares seguidos; más toques; la vista previa pierde el conjunto |
| **C. Asistente por preguntas** | «¿Qué pasó?» con opciones en lenguaje común y recién después los campos | Lo más claro para quien no es técnico | Un paso más cuando ya se sabe qué corregir |
| **D. Anular y recargar** | Lo que existe hoy | Sirve cuando la factura **no existió** o es otra | Con mercadería vendida queda bloqueado; hay que tipear todo de nuevo |

**Recomendación (PROPUESTA): A con la pregunta de C como primer paso.** Es el camino A, pero antes de abrir los campos se marca qué se quiere corregir (varios a la vez si hace falta) y solo se muestran esos campos, con todo lo demás visible en solo lectura. **D se mantiene** como «Esta factura no existió o es otra: anularla». B no se construye (se puede sumar luego sin romper nada).

### 4.3 Boceto en celular (375 px)

Pantalla 1, en el detalle de la factura (el contenedor de hoy), un solo botón que reemplaza a «Corregir proveedor y factura»:

```
2026-11-06 · CORDECC · Factura A 00003-00004567        $216.000
Versión 1 (original)
  Cerveza Patagonia (reventa)   24 unidad    $144.000
  Agua 500 cc (reventa)         48 unidad     $72.000
Cargada por gerente@… · ver la operación
[ Corregir esta factura ]   [ Anular compra ]
```

Pantalla 2, «¿Qué querés corregir?» (casillas, se pueden marcar varias):

```
Corregir factura A 00003-00004567
¿Qué querés corregir?
 [ ] Proveedor o número de factura
 [x] Un importe (precio) de un renglón
 [ ] Una cantidad
 [ ] El producto de un renglón
 [ ] Agregar o quitar un renglón
 Si la factura no existió o es de otro día: Anular compra
[ Seguir ]
```

Pantalla 3, el original arriba (gris, solo lectura) y la copia abajo, con el cambio resaltado:

```
ORIGINAL · versión 1 (no se modifica)
 Cerveza Patagonia   24 unidad   $144.000
 Agua 500 cc         48 unidad    $72.000        Total $216.000

COMO DEBERÍA QUEDAR · versión 2
 Cerveza Patagonia   24 unidad   Importe [ 150.000 ]  ← antes $144.000
   precio por unidad $6.250 (calculado)
 Agua 500 cc         48 unidad   $72.000 (sin cambios)

Qué cambia
 · Total de la factura: $216.000 → $222.000
 · Costo de reposición de Cerveza Patagonia: $6.000 → $6.250
 · Stock: no cambia
 · Ventas ya hechas: sus márgenes reconstruidos se recalculan

Motivo (obligatorio) [ Error de tipeo ▾ ] [ …detalle ]
[ Guardar corrección ]   [ Cancelar ]
```

Cuando se corrige una cantidad, el límite se dice en el campo: «Comprados 24 · hoy quedan 22 · se puede bajar hasta 2». Si se pide menos, el campo se marca y el botón queda apagado con el motivo («Para devolver mercadería al proveedor usá Devolución a proveedor»).

### 4.4 Después de guardar y el historial

- El contenedor muestra la **versión vigente** y la etiqueta «Corregida · versión 2».
- Un enlace «Ver versiones» abre la línea de tiempo: **Versión 1 (original, congelada)** → **Versión 2 (quién, cuándo, motivo, qué cambió)**. Cada una se abre completa, en solo lectura.
- En Compras registradas, el original aparece como «Reemplazada por la versión 2», no como «Anulada», y no suma al total de la página.
- Aviso de éxito con antes/después, que recibe el foco (como `FormularioCorregirCompra` hoy).

### 4.5 Qué se evita a propósito

- Tipear precios por unidad o hacer cuentas.
- Editar el original en el lugar.
- Cambiar la fecha o el depósito de toda la factura (otro comprobante).
- Dos botones que parecen lo mismo («Corregir proveedor y factura» y «Corregir esta factura»): el segundo absorbe al primero.

## 5. Qué ve y qué avisa

- **Antes de guardar:** el resumen «qué cambia» (total, stock, costo, ventas afectadas) y los límites exactos.
- **Aviso de nota de crédito:** como la nota suelta no está enganchada a la compra (el número de factura va solo como texto en su motivo), el sistema no puede saber si ya existe una. Antes de guardar se agrega: «Si el proveedor ya mandó una nota de crédito por esta factura, la corrección del precio se suma a la nota: revisá que no se acredite dos veces». PROPUESTA; el enganche real es la etapa NC5.
- **Factura con pago declarado:** en la factura documento, corregir un importe ya pagado deja una diferencia; no se implementa en C0 (se rechaza: factura documento fuera de alcance).
- **«Pendiente de completar»:** un renglón con `$0` se muestra así en el original y en la copia, con el botón «Completar importe».

## 6. El mismo número, otra versión

El ejemplar nuevo lleva **el mismo N.º de factura** y la misma fecha. No choca con la regla de repetidos porque el original se anula antes de insertarlo y la unicidad rige entre las vigentes (índice parcial ya existente). Si la corrección cambia el número (E2), vale la regla de hoy: no puede repetir el de otro comprobante vigente del proveedor en la empresa.

## 7. «¿Qué pasa si…?» por comando

Comando principal: **corregir una factura** (importes, cantidades, lote, depósito, producto, renglones, cabecera).

| Escenario | Qué pasa | Estado |
|---|---|---|
| **Repetición** (doble clic o reintento) | La clave y la huella devuelven el mismo resultado; no se crean dos ejemplares | PROPUESTA |
| **Concurrencia: dos administradores corrigen a la vez** | La unicidad del reemplazo y la guarda optimista dejan una sola ganadora; la otra recibe «cambió mientras la editabas» | PROPUESTA |
| **Concurrencia: se vende mientras se corrige** | La verificación del saldo final corre dentro de la transacción serializable: si lo que queda ya no alcanza, se rechaza con el límite nuevo; un cambio de solo importe no se ve afectado | PROPUESTA |
| **Tiempo** (corrección de una compra de otro mes) | Permitida; el ejemplar conserva la fecha original, así que el período del gasto no se mueve; sí cambian los reportes **de ese período** (no hay cierre de períodos) | PROPUESTA |
| **Incertidumbre** (no se sabe si la factura ya se pagó o tiene nota) | La vista previa y el aviso lo dicen; el sistema no inventa un estado de pago de una compra simple | PROPUESTA |
| **Error parcial** | Todo o nada: si falla el contra-asiento, el ejemplar o la auditoría, no se escribe nada | PROPUESTA |
| **Datos faltantes** (renglón sin importe) | Se muestra «pendiente de completar»; corregirlo es el caso CU2; no se obliga a completarlo para guardar otra corrección | PROPUESTA |
| **Cambio de permisos entre abrir y guardar** | El permiso se vuelve a exigir en el servidor al guardar; la pantalla no manda | PROPUESTA |
| **La compra ya está anulada o ya fue reemplazada** | Se rechaza: «esta versión ya no es la vigente; abrí la vigente» | PROPUESTA |
| **Es parte de una factura documento** | Se rechaza (regla D8): se corrige la factura entera en la etapa C3 | CONFIRMADA |
| **Conteo físico posterior del mismo producto y sección** | Se rechaza para los renglones cuya cantidad, lote, sección o producto cambian; un cambio solo de importe pasa | PROPUESTA |
| **Baja de cantidad mayor a lo que queda** | Se rechaza con «comprados X, hoy quedan Y, podés bajar hasta Z» | PROPUESTA |
| **El importe pasa de $0 a un valor** | Se acepta; recién entonces el renglón fija el costo de reposición | PROPUESTA |

## 8. Combinaciones y oráculo (dimensiones que cambian dinero, stock o visibilidad)

| Dimensión | Valores |
|---|---|
| D1 qué cambia en el renglón | solo importe · cantidad sube · cantidad baja · lote · depósito · producto · quitar · agregar |
| D2 stock de lo comprado | todo disponible · parcialmente consumido · todo consumido |
| D3 el renglón es la entrada más reciente de su producto | sí · no |
| D4 conteo físico posterior del producto y sección | no · sí |
| D5 estado del ejemplar | vigente · reemplazado · anulado |
| D6 tipo de compra | simple · parte de factura documento |
| D7 estado de pago del documento | n/a (compra simple, C0 a C2) · pagada · pendiente (C3) |

Resultados esperados (el **oráculo legible**, escrito aparte del código en `docs/oraculo-correccion-de-compras-AAAA-MM-DD.md` cuando se implemente):

| Cambio | Con stock consumido | Resultado |
|---|---|---|
| Solo importe | cualquiera | **Acepta**; stock sin cambios; costo de reposición cambia solo si es la entrada más reciente; gasto del período cambia |
| Cantidad sube | cualquiera | Acepta (entra la diferencia) salvo conteo posterior |
| Cantidad baja | baja ≤ lo que queda | Acepta; sale la diferencia |
| Cantidad baja | baja > lo que queda | **Rechaza** con el límite exacto |
| Lote o depósito | lo movido no está disponible | Rechaza con el faltante; acepta si está |
| Producto cambia | el original ya se consumió | Rechaza (sacar el producto equivocado exige que esté); acepta si está |
| Quitar renglón | ya consumido | Rechaza igual que cantidad baja a cero |
| Agregar renglón | cualquiera | Acepta |
| Cualquiera | ejemplar reemplazado o anulado, o parte de factura documento | **Rechaza** (fallo cerrado) |

**Test:** exhaustivo sobre D1 × D2 × D3 × D4 × D5 × D6 (8 × 3 × 2 × 2 × 3 × 2 = 576 combinaciones), contra la tabla de arriba. **Guardián:** falla si aparece una opción nueva en el tipo de cambio, una columna nueva en `Operacion` o en `MovimientoStock`, sin declarar si afecta (se registra en `docs/mapa-cobertura-de-combinaciones-2026-10-28.md`).

## 9. Etapas (escalera de producto N0 a N5)

Cada peldaño no rompe lo cargado. Se migran solo las tablas de la etapa que se implementa (hoy: ninguna; solo el CHECK).

| Etapa | Entrega | Migración | Depende de |
|---|---|---|---|
| **N0 (hoy)** | Corregir cabecera; anular y recargar (bloqueado con consumo) | — | — |
| **C0 «importe y cabecera»** | «Corregir esta factura» con la pregunta inicial, original congelado, copia editable, resumen de efectos; corregir y completar **importes**; proveedor y N.º de factura dentro del mismo flujo; historial de versiones | **Solo el CHECK** de `reemplazaAOperacionId` a COMPRA | tu autorización por base |
| **C1 «cantidad, lote y depósito»** | Cantidad con límite exacto (saldo final); lote y depósito; regla de conteo posterior | Ninguna | C0 |
| **C2 «renglones y producto»** | Cambiar el producto, quitar y agregar renglones | Ninguna | C1 |
| **C3 «factura documento»** | Corregir una factura repartida (ejemplar de `FacturaProveedor`, partes de otras sucursales, pago declarado) | Aditiva, a diseñar (§12 del diseño de compras) | C0 y decisión sobre pagos |
| **C4 «versiones en los reportes»** | Filtrar «solo versión vigente» y mostrar «corregida» en reportes y exportaciones | Ninguna | C0 |
| **C5 «enganche con la nota de crédito»** | Aviso y neteo si la factura tiene notas | Las de NC5 | NC |

## 10. Cómo se verifica (cuando se implemente)

- **Reglas puras con propiedades (`fast-check`):** el saldo final es la suma exacta; un cambio de solo importe nunca mueve stock; el importe se reparte en centavos sin pérdida.
- **Integración contra la base real:** original intacto (guardián «solo agrega»); contra-asiento exacto; costo de reposición después de corregir; unicidad del número entre versiones; conteo posterior; compra anulada o reemplazada; parte de factura documento.
- **Concurrencia:** dos correcciones simultáneas de la misma versión dejan **exactamente un** ejemplar nuevo (3 corridas); una corrección de cantidad y una venta simultáneas nunca dejan stock negativo.
- **Idempotencia:** el mismo envío dos veces deja un solo ejemplar y devuelve el mismo mensaje.
- **Oráculo:** las 576 combinaciones contra la tabla del §8, más el guardián de dimensiones.
- **Invariancia:** corregir un renglón a su mismo valor no cambia nada («no hay nada que corregir», como K1b).
- **E2E (Playwright):** el recorrido de la maqueta (cargar, vender, corregir el precio, ver el historial) en celular y en escritorio.
- **Mutaciones:** (1) volver a exigir «todo lo comprado sigue en stock» → rojo en el caso de solo importe; (2) quitar la guarda optimista; (3) editar el original en el lugar; (4) escribir la fecha del ejemplar como «hoy».
- **Gate de 8 comandos** en la misma corrida: `npx tsc --noEmit`, `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto`, `npm test`, `npm run build`, `npm run plataforma:build` y `npm run test:e2e`; todos en verde y `analizar:muerto` con 0 hallazgos.
- **Migración:** el CHECK se ensaya subir-bajar-subir en una rama de Neon; el `down.sql` aborta si hay compras reemplazadas.

## 11. Decisiones y pregunta

**Decisiones**

| # | Decisión | Estado |
|---|---|---|
| D1 | Original congelado; corrección por ejemplar | **CONFIRMADA** (2026-11-06) |
| D2 | Sin tabla nueva; solo ampliar el CHECK de `reemplazaAOperacionId` a COMPRA | PROPUESTA (requiere autorización) |
| D3 | El control es por saldo final; un cambio de importe nunca se rechaza por stock | PROPUESTA |
| D4 | El ejemplar nuevo conserva la fecha; el costo vigente lo sigue solo | PROPUESTA |
| D5 | La pantalla parte del documento y pregunta primero qué corregir (camino A con la pregunta de C) | PROPUESTA |
| D6 | La fecha de la factura y el depósito de la cabecera no se corrigen (otro comprobante) | PROPUESTA |
| D7 | Permiso: se reutiliza `corregir_compra` (admin) | PROPUESTA |
| D8 | Etapa más barata primero: C0 (importes y cabecera) | PROPUESTA |
| D9 | La corrección del precio de una factura con nota de crédito suelta se avisa, no se bloquea | PROPUESTA |

**Una pregunta (cambia dinero).** Cuando se corrige el **precio de una compra vieja**, el margen **reconstruido** de las ventas ya hechas (que se calcula con el historial de compras vigentes) cambia hacia atrás, también en un mes que ya miraste. ¿Está bien que se recalcule siempre con el precio corregido? *Recomendación:* **sí**; el precio corregido es el verdadero, la versión original queda visible en el historial, y los reportes lo rotulan «reconstruido». Cuando exista el cierre de períodos, un mes cerrado pediría otra regla. Supuesto que declaro mientras no me contestes: se recalcula.

## 12. Lo que no se pudo verificar

- **NO VERIFICADA:** dónde se guarda la condición de pago («Pagada ahora») de una compra simple.
- **NO VERIFICADA:** la regla exacta con que `registrarVinculoDeCompraEnTx` decide el «precio vigente» del vínculo proveedor↔producto (hay que re-apuntarlo al ejemplar nuevo sin duplicar la fila).
- **NO VERIFICADA:** que el CHECK de `Operacion` para compras (`anulacion_coherente` y los de `revierteA…`) admita el nuevo enlace sin otra enmienda; se revisa al diseñar el nivel 6 de C0.
- **NO VERIFICADA:** si el ejemplar nuevo debería ser el más reciente entre varias compras de la misma fecha para el desempate del costo vigente (el orden usa `fecha` desc y luego el id de la línea): con la misma fecha, el ejemplar nuevo tiene id mayor, así que gana; se prueba.
- No se corrió ningún test ni se probó el boceto con una persona; el boceto es de papel.
- Las decisiones del plan de `motor2-docs` se leyeron del texto; no se verificó si hay un ADR posterior que las cambie.
