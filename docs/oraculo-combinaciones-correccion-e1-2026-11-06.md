# Oráculo de combinaciones: corregir unidades de una línea de un ticket cerrado (E1, 2026-11-06)

Tabla de reglas esperadas escrita APARTE del código (regla del dueño del 2026-10-28, «Combinaciones»). Diseño: `docs/diseno-correccion-por-ajuste-2026-11-06.md` (niveles 4, 5 y 10; caso de uso C2, etapa E1).
La recorre `test/core/correccion-por-unidades.combinaciones.test.ts`: lee las reglas de ESTE archivo, arma TODAS las combinaciones de las dimensiones y compara cada una contra `evaluarCorreccionPorUnidades`. Si cambia el código sin cambiar esta tabla (o al revés), falla.
Un guardián del mismo test falla si `EntradaDeLaCorreccion` o `VentaParaCorregirPorUnidades` ganan un campo que no está declarado abajo.

Necesidad: pedido del dueño del 2026-11-06 («cobré 2 cervezas y la mesa tomó 1»), plan aprobado B-REHACER de `motor2-docs` («sí a ambas»: unidad y línea entera).

## Dimensiones que cambian el resultado (dinero, stock, permisos o lo que se ve)

| Dimensión | Valores | Qué representa |
|---|---|---|
| **PERM** permisos | `LOS_DOS` · `FALTA_ANULAR` · `FALTA_EMITIR` | La persona tiene `anular_venta` y `pos_emitir_ticket_corregido`, o le falta uno de los dos |
| **REP** repetición del envío | `NUEVA` · `MISMA_IGUAL` · `MISMA_DISTINTA` | Primera vez; la misma clave de idempotencia con el mismo contenido (clic doble, reintento); la misma clave con otro contenido |
| **ESTADO** de la venta | `VIGENTE` · `REEMPLAZADA` · `ANULADA` · `NO_ES_VENTA` | La venta que se corrige: vigente; ya la reemplazó otra corrección (otra persona llegó antes); anulada sin reemplazo; la operación no es una venta |
| **VISTO** lo que la persona vio | `IGUAL` · `DISTINTO` | Las unidades que veía en pantalla coinciden con las que hoy vende la venta, o no (guarda optimista) |
| **PROMO** | `NO` · `SI` | La venta es un componente de una promo: una promo se corrige entera |
| **ADIC** adicionales | `NINGUNO` · `CON_ADICIONALES` · `ES_ADICIONAL` | La línea no tiene adicionales; el producto tiene adicionales vigentes; la venta ES un adicional |
| **UNID** unidades a quitar | `PARTE` · `TOTAL` · `INVALIDA` | De 1 a (unidades − 1); todas las unidades (es anular la línea entera); 0, negativas, fracciones o más de las que hay |
| **POST** lo que pasó después de la venta | `NINGUNO` · `CONTEO` · `PAGO` · `AMBOS` | Un conteo o ajuste del mismo producto en la misma sección; un pago al consignante de lo que consumió; los dos (D7) |

Dimensiones que NO cambian la decisión (declaradas para que nadie las dé por olvidadas): **descuento de cliente** (B copia el precio de lista y el precio cobrado de A en proporción: lo cubre la prueba de propiedades de `copiarVentaConMenosUnidades`), **moneda** (siempre pesos), **sucursal** (la sesión manda; lo cubre el aislamiento de la persistencia, PR 2).

## Reglas (la primera que cumple, manda)

`*` = cualquier valor. El resultado es `ACEPTA <alcance>` o `RECHAZA <motivo>`.

| N | Condición | Resultado |
|---|---|---|
| R1 | PERM=FALTA_ANULAR,FALTA_EMITIR | RECHAZA SIN_PERMISO |
| R2 | REP=MISMA_DISTINTA | RECHAZA CLAVE_REUTILIZADA |
| R3 | REP=MISMA_IGUAL | ACEPTA REPETIDA |
| R4 | ESTADO=NO_ES_VENTA | RECHAZA NO_ES_VENTA |
| R5 | ESTADO=REEMPLAZADA | RECHAZA LA_VENTA_CAMBIO |
| R6 | ESTADO=ANULADA | RECHAZA YA_ANULADA |
| R7 | VISTO=DISTINTO | RECHAZA LA_VENTA_CAMBIO |
| R8 | PROMO=SI | RECHAZA ES_PROMO |
| R9 | ADIC=ES_ADICIONAL | RECHAZA ES_ADICIONAL |
| R10 | ADIC=CON_ADICIONALES | RECHAZA CON_ADICIONALES |
| R11 | UNID=INVALIDA | RECHAZA UNIDADES_INVALIDAS |
| R12 | POST=CONTEO,AMBOS | RECHAZA CONTEO_POSTERIOR |
| R13 | POST=PAGO | RECHAZA PAGO_CONSIGNANTE_POSTERIOR |
| R14 | UNID=TOTAL | ACEPTA TOTAL |
| R15 | UNID=PARTE | ACEPTA PARCIAL |

Lectura en lenguaje de proceso:

- Se piden los dos permisos antes que nada; sin alguno no se mira más.
- Un reintento con la misma clave y el mismo contenido NO escribe de nuevo: devuelve el mensaje de la primera vez (`REPETIDA`). La misma clave con otro contenido es un error de uso.
- Si la venta ya la reemplazó otra corrección (o cambió desde lo que la persona vio), gana la primera y la segunda responde «la venta cambió mientras la corregías». Lo garantizan los índices únicos de la base (PR 2).
- Promo: se corrige entera, nunca un componente por unidades. Adicional: va con su producto; mientras no esté definido cuántos adicionales quedan al quitar unidades del producto, una línea con adicionales se corrige entera (pregunta abierta al dueño).
- D7: si después de la venta hubo un conteo o un ajuste del mismo producto en la misma sección, o se le pagó al consignante, se rechaza; el conteo manda sobre el pago.
- Quitar todas las unidades no es un error: es la anulación de la línea entera (la corrección de la etapa E0, sin venta nueva).

## Campos declarados (guardián)

Todo campo de la entrada de la decisión aparece acá con la dimensión que lo cubre, o `NO_AFECTA` con el motivo.

| Campo | Cubierto por |
|---|---|
| `permisos` | PERM |
| `repeticion` | REP |
| `venta.proceso` | ESTADO |
| `venta.anuladaEn` | ESTADO |
| `venta.yaReemplazada` | ESTADO |
| `venta.promoCuentaId` | PROMO |
| `venta.operacionPadreId` | ADIC |
| `venta.hijasVigentes` | ADIC |
| `venta.unidades` | UNID, VISTO |
| `unidadesVistas` | VISTO |
| `unidadesAQuitar` | UNID |
| `posteriores` | POST |
