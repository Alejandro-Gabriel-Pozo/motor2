# Oráculo de combinaciones — depósitos de uso RECHAZO y CUARENTENA, etapa (i) (Compras)

Regla «Combinaciones» del dueño (AGENTS.md, 2026-10-28). Este archivo es la tabla de reglas esperadas, escrita APARTE del código. La leen:

- `test/core/combinaciones-compras-cuarentena-y-rechazo.test.ts`: recorre TODAS las combinaciones de la regla pura de destinos (`decidirDestinosDeRecepcion`, con la puerta del módulo) contra la tabla de abajo (exhaustivo).
- `test/movimientos/combinaciones-compras-cuarentena-y-rechazo-integracion.test.ts`: recorre contra la base real (el caso de uso de confirmar la recepción, con controles y secciones de verdad, no solo la regla pura) las combinaciones de control × depósitos × elección con el módulo encendido, y la puerta del módulo con la Server Action.
- `test/arquitectura/combinaciones-compras-cuarentena-y-rechazo-declaradas.test.ts`: falla si aparece un uso de depósito, una entrada de la regla o una condición de control nuevos sin declarar su efecto.

Complementa a `docs/oraculo-combinaciones-compras-recepcion-2026-11-16.md` (quién puede confirmar, estado de la parte, sección propia o activa: allí la dimensión S dice si una sección sirve; acá, a cuál se propone y si falta). Diseño de origen: `docs/diseno-compras-cuarentena-y-rechazo-2026-11-17.md`.
Pedido del dueño: «4.-lo recomendado» (2026-11-17, citado en el diseño): como Pedernal, la línea rechazada va a RECHAZO y la con observaciones a CUARENTENA, propuesto según el control, modificable y auditado; y «la recepción no se puede confirmar si la sucursal no los tiene» (bloqueo, más estricto que Pedernal). Estado de las reglas: CONFIRMADAS por el dueño en lo dicho; lo demás (la primera por nombre, el rótulo «cambiado» sin propuesta, el orden de las razones) es PROPUESTA y el dueño lo corrige si no es así.

## Dimensiones que cambian el resultado

| Dimensión | Valores | De dónde sale |
|---|---|---|
| **M** módulo `recepcion_de_compras` de la empresa | APAGADO, ENCENDIDO | Registro `ModuloEmpresa` (lo enciende la plataforma por empresa; nace apagado) |
| **K** control de la línea al confirmar | SIN_CONTROL, CONFORME, CON_OBSERVACIONES, RECHAZADA | `ControlDeLineaDeRecepcion.condicion` (sin fila = «no se constató»); decide el uso de depósito que se propone |
| **U** depósitos ACTIVOS de uso especial en la sucursal | NINGUNA, UNA, VARIAS | Cuántos depósitos activos de CUARENTENA y cuántos de RECHAZO tiene la sucursal (cada uso con la misma cantidad: ninguno, uno o dos); la sucursal siempre tiene al menos dos de uso NORMAL activos |
| **X** elección de quien confirma | PROPUESTA, OTRA_NORMAL, OTRA_ESPECIAL | El depósito propuesto por el control (el primero activo por nombre del uso que pide); otro depósito de uso NORMAL; otro depósito especial que no es el propuesto (NO_APLICA si la sucursal no tiene ninguno) |

## Dimensiones que NO cambian el resultado

| Dimensión | Por qué no afecta |
|---|---|
| Rol de quien confirma, sucursal de la parte, estado de la parte, depósito propio o ajeno o inactivo | Ya los decide el oráculo de la recepción (`compra_recibir`, piso administrador; la regla `decidirConfirmacionDeRecepcion` corre ANTES: un depósito ajeno o dado de baja se rechaza sin llegar al bloqueo). Acá se fijan: administrador, parte propia pendiente, depósitos propios y activos. |
| Cantidad de renglones, productos, precios, lotes | Cada renglón se decide por separado con su control; con más de un renglón basta que UNO pida un depósito de uso que falta para bloquear TODA la confirmación (se prueba aparte). |
| Depósitos de uso especial INACTIVOS | Un depósito de rechazo o de cuarentena dado de baja no cuenta como «tiene»: es igual a no tenerlo (se prueba aparte, con la desactivación concurrente). |
| Cantidad según remito, observación del control | Datos del control: no cambian a qué depósito va la línea. |
| Que la línea rechazada o con observaciones cuente como disponible para vender | Es la etapa (ii) (excluir RECHAZO y CUARENTENA de lo disponible), que NO está hecha: hasta entonces esa mercadería se ve como vendible. Riesgo declarado en el diseño. |
| Último precio del proveedor | La confirmación no escribe ningún precio de proveedor (el vínculo ya no guarda el precio desde 2026-11-06). Lo que muestran la comparativa y la ficha sale del Kardex vigente (`ofertas-de-proveedor.ts`), que sí vería una compra rechazada: es un lector de la etapa (ii), no de esta. |

## Destino de la línea al confirmar

Orden de las razones (la primera que corresponda): la fila no se puede armar (NO_APLICA: pide «otro depósito especial» y la sucursal no tiene ninguno) → módulo apagado (RECHAZA_MODULO_NO_ACTIVO: lo decide el guard de la Server Action) → la línea es RECHAZADA y la sucursal no tiene un depósito de RECHAZO activo (RECHAZA_SIN_DEPOSITO_DE_RECHAZO) → la línea es CON_OBSERVACIONES y no hay un depósito de CUARENTENA activo (RECHAZA_SIN_DEPOSITO_DE_CUARENTENA). El bloqueo es ESTRICTO: aunque quien confirma elija otro depósito, si falta el del uso que pide el control no se confirma nada. Si ninguna razón corresponde, CONFIRMA: entra el stock en el depósito elegido y la auditoría deja, por renglón, la propuesta, la elegida y si se la cambió. CONFIRMA_SIN_CAMBIO = la elegida es la propuesta (la primera por nombre del uso que pide el control); CONFIRMA_CAMBIADO = la elegida es otra (también cuando la sucursal no tiene un depósito normal activo: no hay propuesta y la elegida cuenta como cambiada). Sin control o CONFORME se propone un depósito NORMAL; CON_OBSERVACIONES, CUARENTENA; RECHAZADA, RECHAZO.

| M | K | U | X | Resultado |
|---|---|---|---|---|
| APAGADO | SIN_CONTROL | NINGUNA | PROPUESTA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | SIN_CONTROL | NINGUNA | OTRA_NORMAL | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | SIN_CONTROL | NINGUNA | OTRA_ESPECIAL | NO_APLICA |
| APAGADO | SIN_CONTROL | UNA | PROPUESTA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | SIN_CONTROL | UNA | OTRA_NORMAL | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | SIN_CONTROL | UNA | OTRA_ESPECIAL | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | SIN_CONTROL | VARIAS | PROPUESTA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | SIN_CONTROL | VARIAS | OTRA_NORMAL | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | SIN_CONTROL | VARIAS | OTRA_ESPECIAL | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | CONFORME | NINGUNA | PROPUESTA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | CONFORME | NINGUNA | OTRA_NORMAL | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | CONFORME | NINGUNA | OTRA_ESPECIAL | NO_APLICA |
| APAGADO | CONFORME | UNA | PROPUESTA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | CONFORME | UNA | OTRA_NORMAL | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | CONFORME | UNA | OTRA_ESPECIAL | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | CONFORME | VARIAS | PROPUESTA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | CONFORME | VARIAS | OTRA_NORMAL | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | CONFORME | VARIAS | OTRA_ESPECIAL | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | CON_OBSERVACIONES | NINGUNA | PROPUESTA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | CON_OBSERVACIONES | NINGUNA | OTRA_NORMAL | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | CON_OBSERVACIONES | NINGUNA | OTRA_ESPECIAL | NO_APLICA |
| APAGADO | CON_OBSERVACIONES | UNA | PROPUESTA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | CON_OBSERVACIONES | UNA | OTRA_NORMAL | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | CON_OBSERVACIONES | UNA | OTRA_ESPECIAL | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | CON_OBSERVACIONES | VARIAS | PROPUESTA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | CON_OBSERVACIONES | VARIAS | OTRA_NORMAL | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | CON_OBSERVACIONES | VARIAS | OTRA_ESPECIAL | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | RECHAZADA | NINGUNA | PROPUESTA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | RECHAZADA | NINGUNA | OTRA_NORMAL | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | RECHAZADA | NINGUNA | OTRA_ESPECIAL | NO_APLICA |
| APAGADO | RECHAZADA | UNA | PROPUESTA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | RECHAZADA | UNA | OTRA_NORMAL | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | RECHAZADA | UNA | OTRA_ESPECIAL | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | RECHAZADA | VARIAS | PROPUESTA | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | RECHAZADA | VARIAS | OTRA_NORMAL | RECHAZA_MODULO_NO_ACTIVO |
| APAGADO | RECHAZADA | VARIAS | OTRA_ESPECIAL | RECHAZA_MODULO_NO_ACTIVO |
| ENCENDIDO | SIN_CONTROL | NINGUNA | PROPUESTA | CONFIRMA_SIN_CAMBIO |
| ENCENDIDO | SIN_CONTROL | NINGUNA | OTRA_NORMAL | CONFIRMA_CAMBIADO |
| ENCENDIDO | SIN_CONTROL | NINGUNA | OTRA_ESPECIAL | NO_APLICA |
| ENCENDIDO | SIN_CONTROL | UNA | PROPUESTA | CONFIRMA_SIN_CAMBIO |
| ENCENDIDO | SIN_CONTROL | UNA | OTRA_NORMAL | CONFIRMA_CAMBIADO |
| ENCENDIDO | SIN_CONTROL | UNA | OTRA_ESPECIAL | CONFIRMA_CAMBIADO |
| ENCENDIDO | SIN_CONTROL | VARIAS | PROPUESTA | CONFIRMA_SIN_CAMBIO |
| ENCENDIDO | SIN_CONTROL | VARIAS | OTRA_NORMAL | CONFIRMA_CAMBIADO |
| ENCENDIDO | SIN_CONTROL | VARIAS | OTRA_ESPECIAL | CONFIRMA_CAMBIADO |
| ENCENDIDO | CONFORME | NINGUNA | PROPUESTA | CONFIRMA_SIN_CAMBIO |
| ENCENDIDO | CONFORME | NINGUNA | OTRA_NORMAL | CONFIRMA_CAMBIADO |
| ENCENDIDO | CONFORME | NINGUNA | OTRA_ESPECIAL | NO_APLICA |
| ENCENDIDO | CONFORME | UNA | PROPUESTA | CONFIRMA_SIN_CAMBIO |
| ENCENDIDO | CONFORME | UNA | OTRA_NORMAL | CONFIRMA_CAMBIADO |
| ENCENDIDO | CONFORME | UNA | OTRA_ESPECIAL | CONFIRMA_CAMBIADO |
| ENCENDIDO | CONFORME | VARIAS | PROPUESTA | CONFIRMA_SIN_CAMBIO |
| ENCENDIDO | CONFORME | VARIAS | OTRA_NORMAL | CONFIRMA_CAMBIADO |
| ENCENDIDO | CONFORME | VARIAS | OTRA_ESPECIAL | CONFIRMA_CAMBIADO |
| ENCENDIDO | CON_OBSERVACIONES | NINGUNA | PROPUESTA | RECHAZA_SIN_DEPOSITO_DE_CUARENTENA |
| ENCENDIDO | CON_OBSERVACIONES | NINGUNA | OTRA_NORMAL | RECHAZA_SIN_DEPOSITO_DE_CUARENTENA |
| ENCENDIDO | CON_OBSERVACIONES | NINGUNA | OTRA_ESPECIAL | NO_APLICA |
| ENCENDIDO | CON_OBSERVACIONES | UNA | PROPUESTA | CONFIRMA_SIN_CAMBIO |
| ENCENDIDO | CON_OBSERVACIONES | UNA | OTRA_NORMAL | CONFIRMA_CAMBIADO |
| ENCENDIDO | CON_OBSERVACIONES | UNA | OTRA_ESPECIAL | CONFIRMA_CAMBIADO |
| ENCENDIDO | CON_OBSERVACIONES | VARIAS | PROPUESTA | CONFIRMA_SIN_CAMBIO |
| ENCENDIDO | CON_OBSERVACIONES | VARIAS | OTRA_NORMAL | CONFIRMA_CAMBIADO |
| ENCENDIDO | CON_OBSERVACIONES | VARIAS | OTRA_ESPECIAL | CONFIRMA_CAMBIADO |
| ENCENDIDO | RECHAZADA | NINGUNA | PROPUESTA | RECHAZA_SIN_DEPOSITO_DE_RECHAZO |
| ENCENDIDO | RECHAZADA | NINGUNA | OTRA_NORMAL | RECHAZA_SIN_DEPOSITO_DE_RECHAZO |
| ENCENDIDO | RECHAZADA | NINGUNA | OTRA_ESPECIAL | NO_APLICA |
| ENCENDIDO | RECHAZADA | UNA | PROPUESTA | CONFIRMA_SIN_CAMBIO |
| ENCENDIDO | RECHAZADA | UNA | OTRA_NORMAL | CONFIRMA_CAMBIADO |
| ENCENDIDO | RECHAZADA | UNA | OTRA_ESPECIAL | CONFIRMA_CAMBIADO |
| ENCENDIDO | RECHAZADA | VARIAS | PROPUESTA | CONFIRMA_SIN_CAMBIO |
| ENCENDIDO | RECHAZADA | VARIAS | OTRA_NORMAL | CONFIRMA_CAMBIADO |
| ENCENDIDO | RECHAZADA | VARIAS | OTRA_ESPECIAL | CONFIRMA_CAMBIADO |

## Usos de depósito y su efecto

Cada valor de `Seccion.uso` (el CHECK `Seccion_uso_chk` de la migración 20261117126000 y la lista `USOS_DE_SECCION` del código). El uso se elige al crear el depósito y no cambia (disparador de la base). Un uso nuevo sin una fila acá pone rojo el guardián.

| Uso | Efecto |
|---|---|
| NORMAL | Se propone para las líneas SIN_CONTROL y CONFORME; nunca bloquea la confirmación (no hace falta tener uno para confirmar). |
| CUARENTENA | Se propone para las líneas CON_OBSERVACIONES; si hay una línea así y la sucursal no tiene uno activo, bloquea la confirmación entera. |
| RECHAZO | Se propone para las líneas RECHAZADA; si hay una línea así y la sucursal no tiene uno activo, bloquea la confirmación entera. |

## Entradas de la regla de destinos y su efecto

Cada entrada de `decidirDestinosDeRecepcion` y cada campo de lo que recibe, con la dimensión a la que responde o «no afecta» con su motivo. Un campo nuevo sin declarar (el tipo obliga a sumarlo en el guardián) pone rojo el guardián.

| Entrada | Efecto |
|---|---|
| lineas | K |
| secciones | U |
| elegidas | X |
| renglonId | no afecta: identifica el renglón para unir su control con el depósito que se eligió; no cambia a dónde va. |
| condicion | K |
| id | no afecta: identifica el depósito; el resultado no depende de cuál es sino de su uso y de si está activo. |
| nombre | no afecta: solo decide cuál de varios depósitos del mismo uso se propone (el primero por nombre); no cambia si se confirma ni si hay bloqueo. |
| uso | U |
| activa | U |
| seccionId | X |
