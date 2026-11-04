# Oráculo: conciliación de pagos por correo, con una persona en el circuito (2026-11-03)

Estado: **BORRADOR en papel**, parte de `docs/diseno-pagos-y-conciliacion-2026-11-03.md` (nivel 5 y nivel 10). Sin código ni migración. Lo escribí leyendo los archivos de referencia del dueño (no los ejecuté) y los patrones que motor2 ya tiene. Cada regla lleva su estado: CONFIRMADA (dicha por el dueño), PROPUESTA, PENDIENTE o NO VERIFICADA.

**Pedido del dueño (2026-11-03):** «¿qué pasa si al hilo respondieran con un comprobante y una percepción (docx) que no son de ese pedido? La conciliación debe considerar un human in the loop en cada caso y ver todas las salidas y combinaciones posibles sobre errores operativos clásicos y no clásicos sobre el envío de mails.»

## 1. Principios (nivel 5)

| # | Principio | Estado |
|---|---|---|
| H1 | **En cada caso decide una persona.** El sistema lee, cruza y **propone**; nunca marca una factura como pagada, ni aplica un pago, ni cierra una conciliación por su cuenta. | CONFIRMADA («un human in the loop en cada caso») |
| H2 | Lo leído del correo (importe, fecha, destinatario, tipo) es un **dato propuesto con su evidencia** (archivo y mensaje de origen), no un hecho. Corregirlo deja el valor original, el nuevo, quién, cuándo y el motivo. | PROPUESTA |
| H3 | **Gana la peor señal:** si dos señales discrepan, rige la de mayor gravedad. Una señal nueva nunca baja la gravedad de un caso. | PROPUESTA |
| H4 | Todo lo que llega queda **registrado**, aunque se descarte; descartar exige motivo. Nada se ignora en silencio. | PROPUESTA |
| H5 | Quien confirma un pago no es quien cargó la factura (separación de funciones), y el permiso se verifica en el servidor. | PROPUESTA (I8 del diseño) |
| H6 | Un mismo mensaje procesado dos veces genera **una sola** propuesta (clave propia del mensaje, no «leído o no leído»). | PROPUESTA |
| H7 | Un comprobante no se puede aplicar a dos pagos distintos, y lo aplicado nunca supera su importe. | PROPUESTA |
| H8 | Enviar un correo es un efecto externo: si no se sabe si salió, el estado es **INCIERTO** y se reconcilia; **nunca se reenvía a ciegas**. | PROPUESTA (mismo criterio que el estado INCIERTO de la facturación electrónica en `motor2-docs/04-contabilidad-y-caja/integracion-holistica-motor2.md`, fila P3 EXT) |

## 2. El ejemplo del dueño, paso a paso

**Situación:** Administración (o alguien) responde en el hilo del lote con un comprobante de transferencia y un documento `.docx` que dice «percepción», y **ninguno corresponde a ese pedido**.

| Paso | Qué hace el sistema | Salida |
|---|---|---|
| 1. Remitente | Verifica contra la lista de remitentes autorizados. Si no es uno de ellos → se corta acá (regla R1). | — |
| 2. Ancla | El hilo es el correcto, pero el mensaje no trae identificador, o trae uno de otra solicitud o de otro lote. No se puede **anclar** al pedido. | señal «sin ancla» o «ancla ajena» |
| 3. Documentos | Comprobante: lee importe, fecha, destinatario y compara con lo pedido → no coincide. El `.docx`: el tipo «percepción» **no es un tipo esperado en una respuesta de pago** (ver nota). | señales «importe ajeno», «destinatario ajeno», «tipo inesperado» |
| 4. Decisión (regla) | Gana la peor señal. | **S2: bandeja «sin asignar»** (cuarentena) y aviso a quien concilia |
| 5. Estado del pedido | **No cambia.** Sigue enviado, sin pago. | — |
| 6. La persona | Ve el correo, los archivos y el pedido lado a lado, y elige: **asignar a otro pedido** (si lo hay y coincide), **pedir aclaración** a Administración, o **descartar con motivo**. | decisión humana registrada |
| 7. Registro | Queda guardado qué llegó, quién lo vio, qué decidió y cuándo. | auditoría |

**Nota sobre «percepción» y «retención».** Son cosas distintas: la **percepción** la suma el proveedor en su factura (en motor2 existe `FacturaProveedorTributo`); la **retención** la practica quien paga y se informa en un comprobante aparte. En el flujo de referencia, el `.docx` de la respuesta de pago se trata como **retención**. Una «percepción» que llega en la respuesta de un pago es, por sí sola, una anomalía: o es un archivo mal adjuntado, o es una retención mal rotulada. En ambos casos decide la persona.

## 3. Dimensiones (nivel 10: lo que cambia el resultado)

| Dim. | Qué mide | Valores |
|---|---|---|
| **A. Remitente** | quién escribe | autorizado de Administración · interno conocido · externo desconocido · nombre visible igual al de un autorizado pero dirección distinta · el propio sistema (eco) · respuesta automática (fuera de oficina) |
| **B. Ancla** | a qué pedido se refiere | lote y solicitud correctos · lote correcto, solicitud ajena · lote de otro envío · sin identificador · identificador mal escrito · lote ya cerrado · identificador solo en el texto citado · varios identificadores |
| **C. Hilo** | dónde llegó | respuesta en el hilo original · hilo nuevo · reenviado · asunto editado · lote reenviado dos veces (dos hilos) |
| **D. Adjuntos: cantidad y forma** | qué trae | ninguno · uno · varios · protegido con contraseña · ilegible · archivo comprimido · con enlaces o macros · mismo archivo ya procesado · mismo contenido con otro nombre · imagen de firma o logo |
| **E. Adjuntos: tipo** | qué es | comprobante de transferencia · comprobante de retención · percepción · factura o nota de crédito · otro · no reconocido |
| **F. Contenido contra el pedido** | cómo se compara | coincide · difiere dentro de la tolerancia declarada · difiere fuera · suma de varios pedidos · destinatario o CUIT distinto · CBU distinto del declarado · fecha anterior a la solicitud · fecha futura · moneda distinta · importe duplicado en otro pedido (colisión) |
| **G. Decisión escrita** | qué dice el texto | aprobado · pagado · observado · rechazado · ambigua («ok», «listo») · contradictoria · mixta (lote más individuales) · condicional · negada («no aprobado») · sin decisión |
| **H. Estado del pedido** | cómo estaba | enviado · ya aprobado · ya pagado · rechazado · anulado · corregido después del envío |

No se recorre el producto completo (más de 100.000 combinaciones): se usa una **lista de decisión en orden** (§5) probada con **pares de dimensiones** y propiedades (§7).

## 4. Salidas posibles

| Salida | Nombre | Qué pasa | Quién actúa |
|---|---|---|---|
| **S0** | Propuesta limpia | Todo coincide; queda lista **para confirmar** | La persona confirma o corrige |
| **S1** | Propuesta con aviso | Coincide con una diferencia dentro de la tolerancia o un dato dudoso | La persona revisa y confirma |
| **S2** | Sin asignar (cuarentena) | No se puede anclar al pedido o hay un documento ajeno | La persona asigna, pide aclaración o descarta |
| **S3** | Bloqueo con alerta | Señal de riesgo (remitente dudoso, destinatario o CBU distinto, comprobante reutilizado) | Una persona con permiso revisa; no avanza sin motivo escrito |
| **S4** | Observada | Falta información para decidir | Se pide aclaración y el pedido queda pendiente |
| **S5** | Descartado con registro | Eco, duplicado exacto o respuesta automática | Se registra; no genera propuesta |

**Ninguna salida marca un pago como hecho.** El máximo automático es S0.

## 5. Lista de decisión (el oráculo): se evalúa en este orden, gana la primera que aplica

| Regla | Condición | Salida | Motivo |
|---|---|---|---|
| R1 | Remitente externo desconocido, o nombre visible de un autorizado con otra dirección | **S3** | posible suplantación |
| R2 | Remitente es el propio sistema, o es una respuesta automática | **S5** | eco |
| R3 | Adjunto idéntico (mismo contenido) a uno ya procesado y aplicado | **S5** si es el mismo pedido; **S3** si se quiere aplicar a otro | duplicado o reutilización |
| R4 | Destinatario o CUIT distinto del proveedor del pedido, o CBU distinto del declarado | **S3** | posible desvío |
| R5 | Archivo protegido, ilegible, comprimido, con macros o enlaces | **S4** | no se puede leer con seguridad |
| R6 | Sin ancla, ancla ajena, ancla de lote cerrado, o varias anclas incompatibles | **S2** | no se sabe a qué pedido pertenece |
| R7 | Tipo de documento inesperado (percepción, factura, otro, no reconocido) | **S2** | documento ajeno |
| R8 | Decisión escrita ambigua, contradictoria, condicional o negada | **S4** | texto no concluyente |
| R9 | Pedido ya pagado, rechazado o anulado | **S3** | pago o respuesta sobre un pedido cerrado |
| R10 | Importe fuera de tolerancia, fecha anterior a la solicitud, fecha futura o moneda distinta | **S1** si es una diferencia aclarable; **S3** si es fecha anterior a la solicitud o moneda distinta | dato dudoso |
| R11 | Importe igual al de otro pedido pendiente del mismo proveedor (colisión) | **S1** con el pedido sugerido y la alternativa | puede ser de otro pedido |
| R12 | Suma de varios pedidos | **S1** con el reparto propuesto | un pago, varias facturas |
| R13 | Todo coincide | **S0** | — |

**Combinación de señales (H3):** si aplican varias reglas, rige la de salida más grave: S3 > S2 > S4 > S1 > S0, y S5 solo si no hay ninguna de S3. *Ejemplo del dueño:* R6 (sin ancla) + R7 (percepción) + R4 (destinatario ajeno) → **S3**.

## 6. Envío saliente: errores clásicos y no clásicos (¿qué pasa si…?)

| Si… | Clase | Qué debe pasar (PROPUESTA) |
|---|---|---|
| El correo sale pero falla el registro en la base | clásico | Estado **INCIERTO**; se reconcilia buscando el correo enviado; no se reenvía |
| Se registra, pero el correo no sale | clásico | Queda **PENDIENTE DE ENVÍO**; un reintento seguro con la misma clave |
| Doble clic o reintento del operario | clásico | Un solo lote (clave de idempotencia); el segundo clic devuelve el mismo resultado |
| Cuota diaria de correo agotada | clásico | No se envía nada a medias: se avisa y queda en cola ordenada |
| Destinatario equivocado o inexistente (rebote) | clásico | Se detecta el rebote, el lote vuelve a «no entregado» y una persona decide |
| Adjunto demasiado grande | clásico | Se avisa antes de enviar; no se envía recortado |
| El lote sale incompleto (algunos renglones sí, otros no) | no clásico | O sale todo o no sale: el lote se arma antes y se envía entero |
| Se anula o corrige una factura **después** de enviar el lote | no clásico | Aparece una alerta en el pedido; la respuesta que llegue se compara con el importe vigente, no con el enviado |
| Se emite una nota de crédito después del envío | no clásico | El neto cambia: la conciliación usa el neto vigente y lo muestra |
| El proveedor cambia de CBU entre el envío y la respuesta | no clásico | R4 → S3; no se acepta el comprobante sin revisión |
| Administración responde desde otra casilla o un reenvío | no clásico | R1 → S3 hasta que una persona lo valide |
| Dos lotes iguales en el mismo día para el mismo proveedor | no clásico | Los importes colisionan: R11 → S1 con las dos alternativas |
| Gmail agrupa dos envíos distintos en un solo hilo por el asunto | no clásico | Se ancla por identificador, nunca por hilo |
| Administración responde **dentro** del texto citado | no clásico | Se lee también lo citado, marcando de dónde sale, y se pide confirmación (S4) |
| Llega el comprobante **antes** de que se registre el envío | no clásico | Queda en S2 hasta que el pedido exista |
| Llega un comprobante por un pedido ya rechazado | no clásico | R9 → S3 |
| Administración paga dos veces | no clásico | El segundo comprobante no se aplica; queda como saldo a favor o devolución pendiente, a decidir |
| El banco devuelve la transferencia después | no clásico | Se registra la reversión con un registro nuevo; el pedido vuelve a pendiente |
| Un comprobante con importe retocado o editado | no clásico | Siempre revisa una persona (H1); la lectura automática nunca prueba autenticidad |
| Respuesta automática de «fuera de oficina» con imágenes de firma | no clásico | R2 → S5; las imágenes de firma no se leen como comprobantes |
| Diferencia de zona horaria en la fecha de la respuesta | no clásico | Todas las fechas en hora argentina; un corte de día se muestra como aviso |
| Pago parcial o en cuotas | no clásico | Se aplica por importe; el pedido queda con saldo, no «pagado» |
| Un solo comprobante para facturas de dos proveedores | no clásico | R4 → S3 |

## 7. Propiedades que el test debe verificar (nivel 10)

| # | Propiedad | Cómo |
|---|---|---|
| P1 | **Ninguna combinación** produce «pago aplicado» sin una confirmación humana | recorrido por pares sobre A–H |
| P2 | Monotonía: agregar una señal de riesgo **nunca baja** la gravedad | propiedad con `fast-check` |
| P3 | El mismo mensaje dos veces = una sola propuesta | idempotencia |
| P4 | Un documento ajeno (tipo o ancla) **nunca** se asigna solo | oráculo de la lista de decisión |
| P5 | Todo descartado deja registro con motivo | integración |
| P6 | Un comprobante no se aplica a dos pagos; lo aplicado ≤ importe del comprobante | concurrencia: dos aplicaciones simultáneas |
| P7 | Un reintento de envío no duplica el lote | idempotencia con corte entre «enviado» y «registrado» |
| P8 | Una dimensión nueva sin declarar (un tipo de adjunto, un remitente) hace fallar un guardián | guardián de dimensiones |

La lista de decisión (§5) vive en un archivo de datos legible aparte del código, igual que el oráculo de combinaciones de compras (`docs/oraculo-combinaciones-compras-etapa-1-2026-11-03.md`, en la rama de Compras etapa 1).

## 8. Pendientes y no verificado

1. **PENDIENTE (dueño):** la pregunta del diseño principal: ¿motor2 registra solo el pago hecho y su conciliación, o absorbe también la solicitud y la aprobación? Este oráculo vale en los dos casos, pero con la segunda opción se suma el envío saliente (§6) al sistema nuevo; con la primera, §6 queda como requisito del circuito externo.
2. **PENDIENTE:** la tolerancia de diferencia (monto y quién la define), la lista de remitentes autorizados y quién puede confirmar un pago.
3. **NO VERIFICADO:** el comportamiento real de Gmail con hilos, citas y respuestas automáticas; se probó solo leyendo el código del flujo de referencia, no ejecutándolo. Los casos de §6 son los que **se me ocurren**; el dueño conoce los que ocurrieron de verdad y conviene sumarlos.
4. **NO VERIFICADO:** si la lectura de comprobantes por OCR del flujo de referencia es confiable para decidir algo; por H1 no se decide nada con ella sin una persona.
