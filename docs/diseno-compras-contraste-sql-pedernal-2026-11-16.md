# Compras: contraste con el SQL real de Pedernal (0063 a 0066), 2026-11-16

Frente 5. Fuente: `ZuluHub-docs`, `main`, commit `3606afb`, carpeta `11-especificaciones/sql-compras-pendientes/` (README, 0063 recepción separada, 0064 entrada de compra a cuarentena/rechazo, 0065 producto en la línea de la factura, 0066 órdenes de compra revisada, y sus reversiones), leída completa línea por línea. **Aviso de Pedernal: no están aplicadas ni tienen PR; pueden cambiar hasta su merge; «idéntico» vale para esa versión. 0067 (conciliación y diferencias) no está publicada y no se construye todavía.** Contraste de lo construido (N3-a, rama `feat/compras-recepcion-separada-n3a`) y del diseño (`diseno-compras-n3b-n4-etapas-2026-11-16.md`). Motivos: **P** Prisma · **R** RLS · **D** datos/estructura existentes de Motor2 · **O** decisión del dueño (con cita) · **?** sin motivo declarado (defecto por la regla de paridad).

## 1. Lo más importante (las diferencias de resultado)

1. **«Recepción» no es lo mismo.** En Pedernal es una entidad propia (con remito, nivel, `es_atajo`) que puede existir sin factura; la factura «llega sola antes o después» (0065). En Motor2 la «recepción» es la **parte de la factura** (`FacturaProveedorSucursal.estadoRecepcion`) y toda compra lleva factura (**O**: «Toda compra sigue llevando factura (Recomendada)», 2026-11-16). Consecuencia: lo que 0067 concilia (recepción↔factura↔orden) en Motor2 tendrá otra forma. Diferencia **declarada con motivo O**.
2. **Control por línea: cuándo.** Pedernal lo carga **al crear la recepción pendiente** (en la misma transacción) y la confirmación solo mueve stock. El diseño de Motor2 lo carga **al confirmar**. Resultado distinto: en Pedernal quien recibe constata la mercadería al llegar y el gerente confirma después; en Motor2 el mismo gesto constata y confirma. **Sin motivo O.** Se propone alinear (ver §4, D-1).
3. **Un depósito por línea.** Pedernal: una entrada por línea **y depósito** (una línea puede repartirse en varios depósitos; un movimiento puede cubrir varias líneas del mismo depósito, `DDD:202`). Motor2 N3-a: **una sola sección** para toda la parte. Diferencia de resultado **sin motivo declarado** (la base de Motor2 lo permitiría: el Kardex es por línea). Se propone alinear (D-2).
4. **Cuarentena y rechazo.** Pedernal: `deposito.uso <> 'NORMAL'` y 0064 admite entradas de compra a esos depósitos. Motor2: `Seccion` no tiene uso ni estado de calidad (búsqueda en `src/` y `schema.prisma`: 0 coincidencias). **FALTA en Motor2 (D)**; etapa propia con migración.
5. **Línea RECHAZADA.** Pedernal: la línea rechazada **entra como entrada de stock** (puede ir a un depósito de rechazo, 0064) y **no cuenta como recibida contra la orden** (0066: se excluye del saldo). Motor2 (diseño N3-b): «las RECHAZADA no entran al stock». Resultado distinto y **peor**: la mercadería rechazada que está físicamente en el local no queda registrada. Se corrige el diseño (D-3).
6. **Control del exceso contra la orden.** 0066: control `compras.recepcion_excede_la_orden` con niveles PERMITIR/AVISAR/BLOQUEAR, **sin fila = PERMITIR** (el exceso pasa), `confirmo_exceso` por línea. El diseño de Motor2 asumía «tope firme». Es **dinero y permisos**: se pregunta al dueño (D-4).
7. **Orden de compra: forma.** 0066 trae saldo como **tabla** movida solo por triggers anidados; vínculo recepción↔orden **por línea** (`linea_de_recepcion_de_orden`); `sucursal_destino_id` **opcional**; `precio_unitario >= 0` (NULL = sin precio); **sin reemplazo de órdenes**; **sin cierre automático**; cierre bloqueado con recepciones pendientes. El diseño de Motor2 difería en todo eso (§3).

## 2. Contraste de N3-a (construido) con 0063/0064/0065

| # | Tema | Pedernal | Motor2 N3-a | Veredicto | Motivo |
|---|---|---|---|---|---|
| 1 | Entidad recepción | tabla propia, puede no tener factura | parte de la factura | DIFIERE-RESULTADO | D+O |
| 2 | Estados | `PENDIENTE`/`CONFIRMADA`/`ANULADA` por recepción | `PENDIENTE`/`RECIBIDA` por parte; la anulación es de la factura | DIFIERE-FORMA y RESULTADO (no se anula una recepción pendiente por separado) | D |
| 3 | Transición | PENDIENTE→CONFIRMADA\|ANULADA y CONFIRMADA→ANULADA, trigger | PENDIENTE→RECIBIDA una vez, trigger existente (20261016101500) | IGUAL para confirmar | |
| 4 | Quién y cuándo confirma | `confirmada_por`, `confirmada_en = now()` fijado por la base | `recibidaPorId` y `recibidaEn` = **fecha de stock elegida**; la hora real queda solo en la auditoría | DIFIERE-RESULTADO | **?** → D-5 |
| 5 | Permiso de confirmar | gerente o administrador (clave no está en el SQL) | `compra_recibir`, piso administrador, validado en el servidor | IGUAL en resultado | O |
| 6 | Dos confirmaciones | trigger de estado + PK de la entrada + trigger que exige `confirmada_en = now()` | FOR UPDATE de cabecera + `WHERE estado='PENDIENTE'` + SERIALIZABLE + trigger | IGUAL | P |
| 7 | Idempotencia | por estado y clave única de entrada | por estado (`YA_RECIBIDA`) | IGUAL | |
| 8 | Dónde entra el stock | una entrada por línea y depósito | una sección para toda la parte | DIFIERE-RESULTADO | **?** → D-2 |
| 9 | Tope de entradas | suma ≤ `cantidad_en_stock` de la línea | entra el renglón entero | DIFIERE-FORMA | P (sin fraccionar) |
| 10 | Depósito inactivo / ajeno | rechazo por trigger / FK compuesta | `SECCION_INACTIVA` / `SECCION_NO_ENCONTRADA` | IGUAL | |
| 11 | Cuarentena/rechazo | 0064 | no existe | FALTA-EN-MOTOR2 | D |
| 12 | Remito único (pendientes y confirmadas) | índice parcial | Motor2 no tiene remito | FALTA-EN-MOTOR2 | D+O («solo carga de facturas sin remito por ahora», 2026-11-03, según el diseño de factura única; cita no releída) |
| 13 | `nivel`/`es_atajo` por recepción | columnas y CHECK | módulo `recepcion_de_compras` por empresa (nace apagado) | DIFIERE-FORMA | O («Ya, con interruptor por empresa (Recomendada)», 2026-11-16) |
| 14 | `producto_id` en la línea de la factura (0065) | columna nueva, FK, índice | `FacturaProveedorRenglon` ya lleva el producto | IGUAL en resultado, **sin migración** | D |
| 15 | Migración | cambia tablas, CHECK, índice, trigger, GRANTs | una sentencia `GRANT UPDATE ("operacionId")` | DIFIERE-FORMA | D+P |
| 16 | Reversión | frena SIEMPRE con PENDIENTE; con otros datos, solo con `confirmar_reversion='SI'` | `down.sql` solo REVOKE: sin frenos | DIFIERE-FORMA | **?** → D-6 |
| 17 | Fecha de stock permitida | no está en el SQL (regla de la app: NO VERIFICADA) | entre la fecha de la factura y hoy | SIGUE-NO-VERIFICADA | |

## 3. Contraste del diseño N3-b y orden de compra con 0063/0066

**N3-b (control por línea).** Valores `CONFORME`/`CON_OBSERVACIONES`/`RECHAZADA`, observación obligatoria si no es conforme (≤500, texto válido), cantidad según remito opcional >0, «sin fila = no se constató», solo inserción: **IGUAL, confirmado por el SQL**. Diferencias: (a) **temperatura** (`numeric(5,1)`, CHECK de plausibilidad) existe en 0063 y el diseño la dejó fuera («nadie la pidió»): queda **como pregunta**, no se construye sin pedido; (b) el SQL **no exige** control de todas las líneas, el diseño de Motor2 sí («línea sin control: rechazo»): más estricto, sin motivo → D-1; (c) momento del control: ver §1.2.

**Orden de compra.**

| Tema | Pedernal 0066 | Diseño Motor2 | Acción |
|---|---|---|---|
| Estados y transiciones | `BORRADOR→PEDIDA\|ANULADA`, `PEDIDA→CERRADA\|ANULADA` | iguales | IGUAL |
| Número | `max+1` por empresa al pedir, bajo `pg_advisory_xact_lock`; único `(empresa, numero)` | contador atómico al pedir | IGUAL en resultado (P) |
| Idempotencia | clave `[A-Za-z0-9_-]{16,128}` única por empresa + huella sha256 | clave + hash | IGUAL |
| Sucursal destino | **opcional**, informativa | «obligatoria» | **corregir: opcional** |
| Reemplazo de órdenes | **no existe** en 0066 | `reemplazaAId` | **quitar del diseño** (O: «sin reemplazar» según el aviso del orquestador general) |
| Cierre | solo manual; bloqueado con recepciones pendientes; `cierre_motivo` COMPLETA/CON_SALDO calculado por la base | «se cierra sola al recibirse todo» | **corregir: sin cierre automático** |
| Anulación | motivo obligatorio; bloqueada con recepciones PENDIENTE o CONFIRMADA | igual | IGUAL |
| Precio de la línea | `>= 0`; NULL = sin precio | «nunca cero» | **corregir: `>= 0`** (D-4b: cambia dinero, se pregunta) |
| Saldo por línea | **tabla** movida solo por triggers anidados | «calculado» | **corregir: tabla + UPDATE con tope en el WHERE** |
| Vínculo recepción↔orden | **por línea** (`linea_de_recepcion_de_orden`) con validaciones (orden PEDIDA, mismo proveedor, mismo producto, línea no retirada) | columna en la parte | **corregir: por renglón** |
| Qué suma al saldo | `cantidad_en_stock` **al confirmar**, excluye líneas RECHAZADAS; anular una confirmada devuelve lo sumado | no detallado | **adoptar** |
| Exceso | nivel de control, sin fila = PERMITIR, `confirmo_exceso` | tope firme | **pregunta D-4** |
| Tolerancias | no hay en 0066 (llegan con 0067) | `ToleranciaDeCompras` | etapa 3V **espera a 0067** |
| Permiso de crear/pedir/cerrar/anular | gerente o administrador (no está en el SQL) | igual | IGUAL (O) |

## 4. Decisiones que cambian el diseño (y las preguntas al dueño)

Todas **PROPUESTA** hasta que el dueño confirme; ninguna se construye antes.

- **D-1 Control en la recepción.** Alinear a Pedernal: el control por línea se carga al **crear** la recepción pendiente (quien recibe), y confirmar solo mueve stock. En Motor2 «crear» = cargar la compra pendiente, que hoy hace quien carga la factura. Propuesta: el control se carga en un paso propio **antes** de confirmar, sin exigirlo para todas las líneas (como el SQL). *Cambia comportamiento de una etapa ya construida (N3-a): se declara.*
- **D-2 Un depósito por línea.** Alinear: la confirmación recibe una sección por renglón (y, si se pide, fraccionar un renglón). Cambia la pantalla y el comando de N3-a.
- **D-3 Rechazadas.** Corregir el diseño: la línea RECHAZADA **no se pierde del stock**; depende del depósito de rechazo (0064), que Motor2 no tiene: etapa propia «cuarentena y rechazo» con una migración de uso de sección. Hasta entonces, **pregunta**: ¿qué hace Motor2 con lo rechazado mientras no exista ese depósito (entra al depósito elegido marcado como rechazado, o no entra)?
- **D-4 Exceso contra la orden (dinero/permisos).** Pedernal: PERMITIR por defecto. ¿Motor2 igual (PERMITIR/AVISAR/BLOQUEAR configurable, base PERMITIR) o tope firme? **Pregunta al dueño**; 4b: ¿precio de línea de orden en cero permitido (Pedernal sí, `>= 0`)?
- **D-5 Hora real de confirmación.** Guardar `recibidaEn` como hora real y la fecha de stock aparte: requiere columna nueva en la parte (migración aditiva) o dejar la hora real solo en la auditoría; hoy está solo en la auditoría. Propuesta: mantener y declarar la diferencia (la auditoría ya dice quién y cuándo).
- **D-6 Reversión.** Pedernal frena la reversión con datos. Motor2 N3-a: `down.sql` solo REVOKE (no destructivo). Propuesta: agregar a `verificacion-previa.sql` el conteo de partes PENDIENTE (si hay, la reversión de la migración las deja imposibles de confirmar) y el aviso. Sin cambios de datos.
- **D-7 Recepción sin factura (N1 de Pedernal) y remito.** Fuera por decisión del dueño (opción A, 2026-11-16).
- **D-8 Temperatura del control.** Existe en 0063; no pedida: pregunta, no entra.

## 5. Dependencias de 0066 (y lo que pide de stock)

0066 depende de **0063** (columna de confirmación, estado PENDIENTE, tabla de inspección para excluir las RECHAZADAS) y de 0037/0007 (no leídos); **no depende** de 0064 ni de 0065 y **no pide nada** al libro de stock: el saldo de la orden lo mueven la confirmación y la anulación de la recepción. La reversión de 0063 de Pedernal **no comprueba** si 0066 está aplicada (riesgo en Pedernal, no nuestro; se avisa).

## 6. NO VERIFICADO (sigue)

Los SQL 0037, 0030, 0007 y 0025 de Pedernal (`es_atajo`, `compras_hija_en_la_transaccion_de_su_cabecera`, `solo_insercion`, `texto_de_catalogo_valido`, tabla `deposito`); el código de aplicación de Pedernal (`confirmarRecepcion`, su catálogo de permisos: el SQL no trae permisos); qué hace Pedernal con una línea `CON_OBSERVACIONES` frente a la orden (el SQL no la excluye: cuenta completa); costo y gasto de una compra pendiente en Pedernal; 0067. **Resultado de la verificación:** de lo que el diseño marcaba «NO VERIFICADO», el SQL **confirma** el control por línea, los estados de la orden, el número correlativo, la idempotencia y el destino de lo rechazado (mecanismo); **refuta** saldo calculado, vínculo por parte, sucursal obligatoria y precio nunca cero; y **no resuelve** cierre automático, reemplazo (no existe), tolerancias y permisos.

## 7. Efecto sobre lo ya hecho

- **Migración 20261117120000 y N3-a (rama local, PR a abrir):** no se cambian sin aviso. Las diferencias D-1/D-2/D-5 se tratan como **etapas siguientes** (cambian un comando ya construido); si el dueño las pide, se hacen como PR aparte sobre N3-a.
- **Diseño N3-b/OC (`#341`):** se corrige según §3 antes de construir cualquier etapa.

## 8. Respuestas del dueño y decisiones del orquestador general (2026-11-16)

Literales del dueño (AskUserQuestion; las registra el orquestador general en `motor2-docs`):
- **Exceso contra la orden (D-4a):** «Como Pedernal: permitir, configurable (Recomendada)» — CONFIRMADA. PERMITIR por defecto; configurable PERMITIR/AVISAR/BLOQUEAR con `confirmo_exceso` por línea, como Pedernal; configurar: solo gerente y administrador.
- **Rechazadas (D-3):** «Registrarla en un depósito común (Recomendada)» — CONFIRMADA. La línea rechazada **entra al stock** en un depósito que se elige al recibir y **no cuenta contra la orden**; cuando exista el depósito de rechazo/cuarentena (0064, etapa propia) se mueve ahí.

Decisiones del orquestador general (declaradas; el dueño las corrige):
- **D-4b** precio de línea de orden `>= 0` (NULL = sin precio), como Pedernal.
- **D-8 / 7c** la temperatura del control **no entra** (no pedida; «lo que el dueño no pidió no entra»): queda como sugerencia.
- **D-1** el control por línea se carga **antes** de confirmar y no se exige en todas las líneas; **D-2** un depósito por línea y fraccionar una línea entre depósitos: **se alinean con Pedernal** por la regla del 2026-11-13 («Necesitamos ser iguales [a Pedernal] en todo»). Como N3-a todavía no está pusheado, se corrige el **comando construido** antes de pushear.
- La diferencia (1) «recepción = parte de la factura» queda declarada con la cita del dueño «Toda compra sigue llevando factura (Recomendada)» (2026-11-16).
