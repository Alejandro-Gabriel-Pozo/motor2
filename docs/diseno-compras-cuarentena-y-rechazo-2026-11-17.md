# Diseño — Compras: depósitos de uso RECHAZO y CUARENTENA (2026-11-17)

Estado del documento: `Seccion.uso`, propuesta de destino por control, bloqueo ESTRICTO y piso del permiso APROBADOS por el orquestador el 2026-11-17; la exclusión de lo disponible va en una SEGUNDA etapa, precedida de una auditoría de lectores (ver «Etapas»). Orden de turnos de schema: #364 → guarda de apagado → `Seccion.uso`, de a uno. Sin código ni migración. Escalera de 10 niveles, versión corta. Reemplaza la decisión del 2026-11-16 («depósito común»). Lo no leído está marcado NO VERIFICADO.
Base: `feat/compras-recepcion-separada-n3a` (#364, `a7cdaea7`) y Pedernal ZuluHub-ERP origin/main 9786b8f9 + ZuluHub-docs (ficha `deposito-y-su-uso.md`, SQL 0063/0064, decisiones 2026-11, filas :120, :198, :208, :209).

## 1. Propósito y alcance
- **Necesidad (CONFIRMADA, dueño 2026-11-17, chat, registro `motor2-docs` a520c0e, citado por el orquestador):** «4.-lo recomendado» → como Pedernal: depósitos de uso RECHAZO y CUARENTENA; la línea rechazada va a RECHAZO, la con observaciones a CUARENTENA (propuesto según el control, modificable y auditado); la confirmación se BLOQUEA si la sucursal no los tiene configurados (falla cerrada).
- Entra: un «uso» de la sección (NORMAL / CUARENTENA / RECHAZO), cómo se configura, la propuesta de destino al confirmar y el bloqueo.
- No entra (otras etapas): devolución al proveedor desde esos depósitos, reclasificar lo ya recibido, mover stock de cuarentena a normal (hoy se hace con transferencia/ajuste existentes).
- Pregunta abierta de alcance: ver «Preguntas abiertas».

## 2. Actores y contexto
- Configura el uso de un depósito: igual a Pedernal, gerente y administrador (`empresa.ts:85,104`). En Motor2 eso es el nivel «administrador». La acción `secciones` existente (nivel administrador, módulo stock, `acciones.ts:60`) puede tener un piso distinto: al construir se declara cuál se usa y, si difiere, se crea la acción propia. NO VERIFICADO aún cómo mapea el nivel de Motor2 a gerente/administrador.
- Confirma la recepción: `compra_recibir` (gerente y administrador). Controla: administrador y operador.

## 3. Casos de uso
- CU1: crear una sección eligiendo su uso (por defecto NORMAL).
- CU2: confirmar recepción: cada renglón recibe un destino propuesto según el control (CONFORME o sin control → sección normal; CON_OBSERVACIONES → CUARENTENA; RECHAZADA → RECHAZO). Quien confirma puede cambiarlo a cualquier sección activa de la sucursal; el cambio queda en la auditoría.
- CU3: confirmar con línea CON_OBSERVACIONES o RECHAZADA y sin sección de ese uso en la sucursal → bloqueada, nada entra (falla cerrada).
- CU4: desactivar o renombrar una sección de uso especial: hoy se puede sin guarda; queda como riesgo (sección 9).

## 4. Conceptos y ciclo de vida
- `uso` de una sección: se define al crearla y NO cambia después (como Pedernal: `deposito_uso_inmutable`, `0030_stock.sql:371-373`). Si hace falta otro uso, se crea otra sección.
- No hay unicidad «una por sucursal»: Pedernal lo decidió así (dueño 2026-11-16, «2B», `decisiones-del-dueno-2026-11.md:209`: se elige cuando hay más de una; la fila :120 decía «como máximo uno»: tensión no resuelta en Pedernal). Motor2: propone la primera por nombre y deja elegir.
- Hoy en Motor2 no existe ningún concepto de uso de sección (VERIFICADO por grep en `src`, `schema.prisma`, `docs`); solo `sirveDeRespaldoEnVentas`, que no sirve para esto.

## 5. Invariantes y políticas
- I-1: una línea RECHAZADA o CON_OBSERVACIONES nunca entra a una sección normal «en silencio»: o va a la de su uso, o quien confirma la cambia a propósito (auditado), y si la sucursal no tiene la sección de ese uso se bloquea (palabras del dueño).
- I-2: el `uso` es inmutable y está limitado por CHECK a tres valores (lista de permitidos).
- I-3: stock en CUARENTENA/RECHAZO no cuenta como disponible para vender. Ver «Preguntas abiertas»: hoy Motor2 no lo distingue y es la decisión que más cambia el resultado.
- Una línea rechazada no actualiza el último precio del proveedor (Pedernal DEC-0703): NO VERIFICADO en Motor2 (si N3-a actualiza ese precio al confirmar). Verificar antes de construir.

## 6. Historia y persistencia
- Migración aditiva (turno de schema, de a uno): `Seccion.uso text NOT NULL DEFAULT 'NORMAL' CHECK (uso IN ('NORMAL','CUARENTENA','RECHAZO'))` + disparador `BEFORE UPDATE` que rechaza cambiar `uso`. Con `down.sql` (se niega si existe alguna sección con uso distinto de NORMAL; si no, borra la columna) y `verificacion-previa.sql`. Compatible hacia atrás: todas las secciones existentes quedan NORMAL.
- Sin tabla nueva. El destino elegido por línea queda en la auditoría de la confirmación: `{renglón, sección propuesta, sección elegida, cambiado: sí/no}` (como `destinos[].destinoElegido` de Pedernal).
- Las recepciones ya confirmadas antes de esta etapa no se tocan.

## 7. Atomicidad y concurrencia
- La confirmación sigue siendo una operación COMPRA con una línea de Kardex por renglón, `FOR UPDATE` de cabecera y SERIALIZABLE con reintento (sin cambios). Se agrega: leer las secciones destino con `FOR SHARE` para que una desactivación concurrente no deje entrar stock a una sección recién apagada (hoy `obtenerSeccionPropia` + estado INACTIVA; si ya hay candado, NO VERIFICADO).
- `uso` inmutable ⇒ no hay carrera por cambio de uso entre proponer y confirmar.
- Idempotencia: sin cambios (repetir confirmar devuelve éxito `yaExistia`).

## 8. Acceso e interfaces
- Pantalla de secciones (`movimientos/secciones/page.tsx`): selector «Uso» solo al crear; en la lista, etiqueta del uso si no es NORMAL.
- Bandeja «Por recibir»: el selector de depósito por renglón arranca en la sección propuesta por el control; si cambia, se muestra como «cambiado» y queda auditado. Hoy arranca en `secciones[0]` (`bandeja-para-aceptar.tsx:158-159`).
- Textos nuevos (PROPUESTA, a aprobar por el dueño): «Uso del depósito» · «Normal» · «Cuarentena» · «Rechazo» · «Esta sucursal no tiene un depósito de rechazo: no se puede confirmar una recepción con mercadería rechazada.» · «Esta sucursal no tiene un depósito de cuarentena: no se puede confirmar una recepción con mercadería con observaciones.» · «Propuesto por el control».
- Diferencia con Pedernal, declarada con motivo: Pedernal permite que quien confirma elija un depósito normal para una línea rechazada aunque la sucursal no tenga el de rechazo; en Motor2 se bloquea. Motivo: palabras del dueño (2026-11-17, chat, vía orquestador): «la recepción no se puede confirmar si la sucursal no los tiene». Ratificado por el orquestador.

## 9. Consultas y experiencia
- Mensajes de bloqueo con el nombre del uso faltante; no se muestra nada pendiente oculto.
- Riesgo: desactivar la única sección de rechazo después de configurarla hace que las recepciones con rechazo queden bloqueadas hasta crear otra (falla cerrada, no pierde stock). Pedernal evita desactivar con existencia por trigger; Motor2 no tiene esa guarda en secciones (`actualizar-activa-seccion.ts`): sugerencia, no entra sin pedido.
- Los lectores de stock disponible (reportes, POS, respaldo de ventas, conteos) no se auditaron: NO VERIFICADO cuántos hay.

## 10. Pruebas, migración y operación
- Dimensiones (oráculo escrito aparte, recorrido completo): {condición del control: sin control, CONFORME, CON_OBSERVACIONES, RECHAZADA} × {secciones de uso en la sucursal: ninguna, una, varias} × {elección: la propuesta, otra sección normal, otra sección especial} × {módulo encendido/apagado}. Guardián: falla si aparece un `uso` nuevo sin declarar su efecto.
- Pruebas: concurrencia (confirmar dos veces a la vez con líneas mixtas: una sola entrada por renglón; desactivar la sección de rechazo mientras se confirma); idempotencia (repetir confirmar); aislamiento (sección de otra sucursal o empresa como destino → rechazada); inmutabilidad del `uso` (UPDATE directo falla); `down.sql` se niega con usos cargados.
- Orden: después de #364 y en su propia rama y PR. La migración se pide en turno de schema propio.

## Tabla «¿qué pasa si…?»
| Caso | Resultado esperado |
|---|---|
| Se repite confirmar | Éxito `yaExistia`, sin stock ni auditoría nuevos |
| Dos confirmaciones a la vez | Una escribe, la otra devuelve `yaExistia`; una entrada por renglón |
| Línea RECHAZADA, hay sección RECHAZO | Propone RECHAZO; entra ahí |
| Línea RECHAZADA, no hay sección RECHAZO | Se bloquea la confirmación entera; nada entra |
| Línea CON_OBSERVACIONES, no hay CUARENTENA | Se bloquea igual |
| Varias secciones del mismo uso | Propone la primera por nombre; se puede elegir otra |
| Quien confirma manda una línea rechazada a una sección normal | Permitido solo si la sucursal tiene sección RECHAZO; queda «cambiado» en auditoría |
| La sección propuesta se desactiva a mitad | Rechaza esa confirmación (sección inactiva); nada entra |
| Sección de otra sucursal o empresa como destino | Rechazada («No se encontró la sección») |
| Sin control en la línea | Propone sección normal; entra igual |
| La sucursal no tiene sección RECHAZO pero quien confirma quiere mandar la línea rechazada a una normal | Bloqueada igual (estricto) |
| Falta el dato (renglón sin destino) | Rechazada, como hoy |
| Cambia el permiso del usuario a mitad | La acción se valida en el servidor al ejecutar |
| Se intenta cambiar el `uso` de una sección | Rechazado por la base |

## Etapas (decisión del orquestador, 2026-11-17)
- Etapa (i): uso + destino por control + bloqueo. Es esta.
- Etapa (ii): exclusión de lo que está en RECHAZO/CUARENTENA de lo disponible para vender, como Pedernal. Motivo: el dueño dijo «como Pedernal» («4.-lo recomendado») y Pedernal lo excluye; NO se le vuelve a preguntar. Antes de construirla, auditoría de TODOS los lectores de «disponible» (cuántos son, cuáles, riesgo), entregada como documento al orquestador. Hasta que llegue la etapa (ii), lo que entra a RECHAZO/CUARENTENA se vería como stock vendible: riesgo conocido y declarado, y por eso conviene no encender la etapa (i) en una empresa real sin la (ii).

## Preguntas abiertas
- Ninguna para el dueño. Pendiente de verificar al construir: si N3-a actualiza el último precio del proveedor con una línea rechazada (Pedernal DEC-0703: no).

## Diferencias con Pedernal
- Bloqueo más estricto (palabras del dueño, arriba).
- Piso del permiso: igual a Pedernal (gerente y administrador); en Motor2 mapea al nivel administrador.
- Sin trigger de «sin existencia» al desactivar (sugerencia).
- Mensajes propios (Pedernal usa el genérico para `DEPOSITO_DE_CALIDAD_NO_CONFIGURADO`, NO encontré texto propio).
- Modelo: columna `uso` en `Seccion` (Pedernal: `deposito.uso`); misma lista y misma inmutabilidad.

## Implementación — etapa (i) (2026-11-17)
Estado: implementada en la rama `feat/compras-cuarentena-y-rechazo-uso`, sin aplicar a ninguna base real (la migración se aplica en turno de schema propio, con respaldo y ensayo). La etapa (ii) (excluir de lo disponible) NO está hecha.

- **Migración** `20261117126000_compras_uso_de_seccion` (aditiva, con `down.sql` y `verificacion-previa.sql`): `Seccion.uso` (TEXT NOT NULL DEFAULT 'NORMAL', CHECK `Seccion_uso_chk` con NORMAL / CUARENTENA / RECHAZO) y el disparador `Seccion_uso_inmutable_chk` (23514 si un UPDATE cambia el uso). Las secciones que ya existen quedan NORMAL. Sin unicidad por sucursal. El `down.sql` se niega (55000) si alguna sección tiene un uso distinto de NORMAL. Sin políticas ni privilegios nuevos: la tabla ya los tiene (la columna hereda los de la tabla; el guardián de grants no encontró diferencias).
- **Crear la sección con su uso**: caso de uso `crear-seccion.ts` (lleva el `uso`), guard con lista de permitidos (`undefined` = NORMAL; cualquier otro valor fuera de los tres se rechaza), acción `crearSeccion(nombre, uso?)` y pantalla «Configuración · Depósitos» (selector «Uso del depósito» solo al crear; en la lista, «Uso del depósito: Cuarentena/Rechazo» si no es normal). El uso no se edita (la base lo impide).
- **Permiso**: se usa la acción existente `secciones` (módulo stock, de sucursal, piso «administrador»: administrador y gerente), que es lo mismo que Pedernal (gerente y administrador configuran el uso de un depósito, `empresa.ts:85,104`). No se creó acción propia: el piso coincide.
- **Confirmar la recepción**: regla pura `src/core/compras/destino-de-recepcion.ts` (uso propuesto por el control, primera sección ACTIVA del uso por nombre, bloqueo estricto, destino propuesto contra elegido) y caso de uso `confirmar-recepcion-de-factura.ts`: lee TODAS las secciones de la sucursal con `FOR SHARE` (antes no había ningún candado sobre la sección: una desactivación concurrente podía dejar entrar stock a una sección recién apagada) y el control guardado de cada renglón con la cabecera ya bloqueada; el bloqueo viene después de «parte, anulada, ya recibida, sección ajena o inactiva» y de «cada renglón con un solo destino», y antes de «producto disponible». La auditoría de la confirmación (mismo registro `recepcion`, una sola fila) suma «Destino por renglón: <producto>: propuesta «X», elegida «Y», cambiado | sin cambio».
- **Pantalla «Por recibir»**: cada renglón arranca en la sección propuesta por el control GUARDADO (lo que se está tipeando y no se guardó no cuenta), muestra «Propuesto por el control: X» y «cambiado» si se la cambia a mano; si la sucursal no tiene el depósito del uso necesario muestra el mensaje de bloqueo y deshabilita «Confirmar recepción» (el servidor igual lo rechaza).
- **Último precio del proveedor** («una línea rechazada no mueve el último precio», fila 248 de Pedernal): NO APLICA a esta etapa. La confirmación no escribe ningún precio de proveedor (`upsertProveedorPorProducto` ya no guarda el precio desde 2026-11-06 y la confirmación ni lo llama). Lo que sí ocurre: la comparativa de precios, la ficha del proveedor y el costo de reposición se DERIVAN del Kardex vigente (`ofertas-de-proveedor.ts`, `obtenerCostoActualPorMP`), y ahí una compra rechazada que entró a RECHAZO cuenta como «la última compra» con su precio. Es un lector de la etapa (ii) y queda declarado como riesgo conocido.
- **Oráculo** `docs/oraculo-combinaciones-compras-cuarentena-y-rechazo-2026-11-17.md` (módulo × control × depósitos × elección, 72 filas) con su test exhaustivo de la regla pura, su recorrido contra la base real y su guardián de dimensiones (un uso nuevo, una condición nueva o una entrada nueva de la regla sin declarar pone rojo).
- **Textos nuevos** (PROPUESTOS, los ve el cliente de empresa; aprobar o corregir): «Uso del depósito» · «Normal» · «Cuarentena» · «Rechazo» · «Esta sucursal no tiene un depósito de rechazo: no se puede confirmar una recepción con mercadería rechazada.» · «Esta sucursal no tiene un depósito de cuarentena: no se puede confirmar una recepción con mercadería con observaciones.» · «Propuesto por el control» · «cambiado». Además, para que la acción no acepte cualquier cosa: «Elegí un uso de depósito válido: normal, cuarentena o rechazo.» (rechazo del guard) y una frase de ayuda en «Por recibir» («el control propone uno: la mercadería rechazada va al depósito de rechazo y la que tiene observaciones, al de cuarentena»).
- **Diferencias con Pedernal, declaradas con motivo**: (1) bloqueo ESTRICTO: aunque quien confirma elija otro depósito, si falta el del uso que pide el control no se confirma (Pedernal deja elegir uno normal). Motivo: palabras del dueño (2026-11-17, chat, vía orquestador) «la recepción no se puede confirmar si la sucursal no los tiene». (2) Piso del permiso: igual a Pedernal; en Motor2 es el nivel «administrador» (acción `secciones`). (3) Mensajes propios (Pedernal usa el genérico). (4) Con un depósito de uso especial INACTIVO la sucursal cuenta como «no lo tiene». (5) Sin trigger de «sin existencia» al desactivar (sugerencia, no entra). Modelo: columna `Seccion.uso` (Pedernal: `deposito.uso`), misma lista e inmutabilidad.
- **Pruebas**: `test/persistencia/migracion-compras-uso-de-seccion.test.ts` (base temporal migrada, CHECK, inmutabilidad, concurrencia, `down.sql` con usos cargados y limpio, subir-bajar-subir); `test/casos-de-uso/confirmar-recepcion-uso-de-seccion.test.ts` (propuesta, bloqueo, auditoría, idempotencia, aislamiento de sucursal y empresa, concurrencia: dos confirmaciones con líneas mixtas y desactivar el depósito de rechazo mientras se confirma, en los dos órdenes); `test/movimientos/secciones-uso.test.ts` (crear con uso por la Server Action, lista de permitidos, autorización en el servidor); más el oráculo.
