# Oráculo de combinaciones — la venta no usa depósitos de cuarentena ni de rechazo, etapa (ii-a) (Compras)

Regla «Combinaciones» del dueño (AGENTS.md, 2026-10-28). Este archivo es la tabla de reglas esperadas, escrita APARTE del código y ANTES de él. La leen:

- `test/movimientos/combinaciones-compras-exclusion-de-venta-integracion.test.ts`: recorre contra la base real (la venta de mostrador, el cierre de cuenta del POS y el origen automático con sección habitual) TODAS las filas de la tabla de abajo.
- `test/arquitectura/combinaciones-compras-exclusion-de-venta-declaradas.test.ts`: falla si aparece un uso de depósito en el código (o en el CHECK de la base) sin declarar su efecto en la venta, o si cambia una dimensión sin declararla.

Complementa a `docs/oraculo-combinaciones-compras-cuarentena-y-rechazo-2026-11-17.md` (etapa (i): a qué depósito entra una recepción). Diseño de origen: `docs/diseno-compras-cuarentena-y-rechazo-2026-11-17.md` (sección «Implementación — etapa (ii-a)»). Auditoría de lectores: `docs/auditoria-lectores-de-disponible-2026-11-17.md`.
Pedido del dueño: «4.-lo recomendado» y «Sí, todo como Pedernal» (2026-11-17, citado en el diseño y en la auditoría): como Pedernal, «disponible» para vender solo cuenta depósitos de uso NORMAL y la venta rechaza un depósito que no sea NORMAL. Estado de las reglas: CONFIRMADAS en lo dicho; el texto del rechazo del mostrador es PROPUESTO (no aprobado).

## Dimensiones que cambian el resultado

| Dimensión | Valores | De dónde sale |
|---|---|---|
| **O** origen de la venta | AUTOMATICO, MOSTRADOR, HABITUAL | AUTOMATICO: cierre de cuenta del POS, sin sección habitual del producto. MOSTRADOR: la persona elige la sección. HABITUAL: cierre de cuenta del POS con una sección habitual guardada para el producto |
| **U** uso de los depósitos | SOLO_NORMAL, ESPECIAL_CON_STOCK, ELEGIDA_ESPECIAL, UNICA_CON_STOCK_ESPECIAL | SOLO_NORMAL: la sucursal tiene solo depósitos de uso normal. ESPECIAL_CON_STOCK: además hay un depósito de cuarentena o de rechazo con stock del producto. ELEGIDA_ESPECIAL: la sección que se elige (mostrador) o la habitual guardada es de uso especial y tiene stock. UNICA_CON_STOCK_ESPECIAL: el único stock del producto está en un depósito especial; los normales tienen 0 |
| **S** saldo en los depósitos normales | ALCANZA, NO_ALCANZA | Si lo que hay en depósitos de uso NORMAL cubre lo vendido |

## Dimensiones que NO cambian el resultado

| Dimensión | Por qué no afecta |
|---|---|
| Rol de quien vende, permisos, estado de la caja | Los decide la acción antes de llegar al origen; acá se fija un administrador con permiso. |
| Cantidad de renglones, precios, lotes, consignación | El origen decide por producto con la misma regla; no cambia a qué uso se acepta. |
| Cuál de los dos usos especiales (CUARENTENA o RECHAZO) | La venta los trata igual: ninguno sirve para vender (se prueba el rechazo del mostrador con los dos). |
| Depósitos de uso especial INACTIVOS | Un depósito inactivo ya no es candidato por estar dado de baja (regla P17 existente). |
| Stock mínimo, reportes, alertas, valuación, conteos, existencia para ocultar o desactivar, anulaciones, consumo, merma, producción, traspasos | No son «la venta»: son las etapas (ii-b) y (ii-c) y otras reglas; esta etapa NO los toca. |

## Usos de depósito y su efecto en la venta

| Uso | Efecto |
|---|---|
| NORMAL | sirve para vender: puede ser candidato, respaldo, sección por defecto, habitual vigente, o la elegida en el mostrador |
| CUARENTENA | no sirve para vender: nunca es candidato, respaldo, por defecto ni habitual, el mostrador la rechaza y su stock no cuenta como disponible |
| RECHAZO | no sirve para vender: nunca es candidato, respaldo, por defecto ni habitual, el mostrador la rechaza y su stock no cuenta como disponible |

## Resultado de la venta

Resultados posibles:

- VENDE_DE_NORMAL: la venta se registra y el consumo sale solo de depósitos de uso normal, sin aviso de faltante.
- VENDE_CON_FALTANTE_AVISADO: la venta se registra (el cierre de cuenta del POS deja registrar con stock negativo, como hoy) y el aviso de faltante nombra un depósito NORMAL; el stock del depósito especial no se toca.
- RECHAZA_STOCK_INSUFICIENTE: el mostrador rechaza por stock insuficiente (como hoy) y la pista «Tiene stock en: …» no nombra depósitos de uso especial; no se escribe nada.
- RECHAZA_DEPOSITO_ESPECIAL: el mostrador rechaza la sección elegida por ser de cuarentena o de rechazo (falla cerrada); no se escribe nada.
- NO_APLICA: la combinación no se puede armar (por ejemplo, un cierre automático no «elige» una sección; con el único stock en un depósito especial el saldo normal no puede alcanzar).

En TODAS las filas armables, además: el stock de los depósitos de uso especial queda intacto (cero movimientos de venta ahí).

| O | U | S | Resultado |
|---|---|---|---|
| AUTOMATICO | SOLO_NORMAL | ALCANZA | VENDE_DE_NORMAL |
| AUTOMATICO | SOLO_NORMAL | NO_ALCANZA | VENDE_CON_FALTANTE_AVISADO |
| AUTOMATICO | ESPECIAL_CON_STOCK | ALCANZA | VENDE_DE_NORMAL |
| AUTOMATICO | ESPECIAL_CON_STOCK | NO_ALCANZA | VENDE_CON_FALTANTE_AVISADO |
| AUTOMATICO | ELEGIDA_ESPECIAL | ALCANZA | NO_APLICA |
| AUTOMATICO | ELEGIDA_ESPECIAL | NO_ALCANZA | NO_APLICA |
| AUTOMATICO | UNICA_CON_STOCK_ESPECIAL | ALCANZA | NO_APLICA |
| AUTOMATICO | UNICA_CON_STOCK_ESPECIAL | NO_ALCANZA | VENDE_CON_FALTANTE_AVISADO |
| MOSTRADOR | SOLO_NORMAL | ALCANZA | VENDE_DE_NORMAL |
| MOSTRADOR | SOLO_NORMAL | NO_ALCANZA | RECHAZA_STOCK_INSUFICIENTE |
| MOSTRADOR | ESPECIAL_CON_STOCK | ALCANZA | VENDE_DE_NORMAL |
| MOSTRADOR | ESPECIAL_CON_STOCK | NO_ALCANZA | RECHAZA_STOCK_INSUFICIENTE |
| MOSTRADOR | ELEGIDA_ESPECIAL | ALCANZA | RECHAZA_DEPOSITO_ESPECIAL |
| MOSTRADOR | ELEGIDA_ESPECIAL | NO_ALCANZA | RECHAZA_DEPOSITO_ESPECIAL |
| MOSTRADOR | UNICA_CON_STOCK_ESPECIAL | ALCANZA | NO_APLICA |
| MOSTRADOR | UNICA_CON_STOCK_ESPECIAL | NO_ALCANZA | RECHAZA_STOCK_INSUFICIENTE |
| HABITUAL | SOLO_NORMAL | ALCANZA | VENDE_DE_NORMAL |
| HABITUAL | SOLO_NORMAL | NO_ALCANZA | VENDE_CON_FALTANTE_AVISADO |
| HABITUAL | ESPECIAL_CON_STOCK | ALCANZA | VENDE_DE_NORMAL |
| HABITUAL | ESPECIAL_CON_STOCK | NO_ALCANZA | VENDE_CON_FALTANTE_AVISADO |
| HABITUAL | ELEGIDA_ESPECIAL | ALCANZA | VENDE_DE_NORMAL |
| HABITUAL | ELEGIDA_ESPECIAL | NO_ALCANZA | VENDE_CON_FALTANTE_AVISADO |
| HABITUAL | UNICA_CON_STOCK_ESPECIAL | ALCANZA | NO_APLICA |
| HABITUAL | UNICA_CON_STOCK_ESPECIAL | NO_ALCANZA | VENDE_CON_FALTANTE_AVISADO |

## Avisos de stock (selector del POS, opciones por sucursal, carta del panel de administración)

El stock teórico que alimenta esos avisos suma SOLO depósitos de uso NORMAL: el stock de un depósito de cuarentena o de rechazo no cuenta como «disponible para vender». Un producto con stock únicamente en un depósito especial se ve como sin stock (el aviso nunca bloquea).
