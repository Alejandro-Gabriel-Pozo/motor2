# Oráculo de combinaciones — guarda de apagado de la recepción separada de compras

Regla «Combinaciones» del dueño (AGENTS.md, 2026-10-28). Este archivo es la tabla de reglas esperadas, escrita APARTE del código. La leen:

- `test/persistencia/combinaciones-compras-guarda-de-apagado.test.ts`: recorre TODAS las combinaciones (exhaustivo: 48) contra Postgres real, ejecutando la vía de verdad (la consola con el rol real `motor2_plataforma`, el script de emergencia y un UPDATE directo por SQL) y comparando el resultado, el estado final del módulo y el rastro de auditoría con la tabla de abajo.
- `test/arquitectura/combinaciones-compras-guarda-de-apagado-declaradas.test.ts`: falla si aparece una vía, un estado de recepción, un módulo con guarda o un estado del registro nuevos sin declarar si afectan o no.

Diseño de origen: `docs/diseno-compras-guarda-de-apagado-2026-11-17.md` (niveles 4, 5, 7 y 10). Pedido del dueño: «3.-lo recomendado por ahora» (2026-11-17, chat, registro `motor2-docs` a520c0e citado por el orquestador de Compras): el sistema no deja apagar la recepción separada mientras haya compras pendientes de recibir. Estado de las reglas: la decisión es CONFIRMADA; las columnas «Rastro» y el texto del rechazo son PROPUESTAS (el dueño las corrige si no son así).

## Dimensiones que cambian el resultado

| Dimensión | Valores | De dónde sale |
|---|---|---|
| **V** vía que escribe `ModuloEmpresa` | CONSOLA, SCRIPT, UPDATE_DIRECTO | La consola de plataforma (`cambiarModulosDesdeLaConsola`), el script de emergencia (`cambiarModulosDeEmpresa`) y cualquier otro camino con un UPDATE por SQL (psql, otro script, el techo del plan cuando se conecte). La guarda es de la BASE: las tres vías rinden igual. |
| **P** partes de compra de la empresa | CERO, UNA_SIN_ANULAR, SOLO_ANULADAS, SOLO_RECIBIDAS | `FacturaProveedorSucursal.estadoRecepcion` y `FacturaProveedor.anuladaEn`: una parte PENDIENTE de una factura no anulada bloquea; una PENDIENTE de factura anulada ya no se puede recibir y no bloquea; una RECIBIDA no está pendiente. |
| **L** dónde están esas partes | OTRA_SUCURSAL_DE_LA_EMPRESA, OTRA_EMPRESA | Las partes están en una sucursal distinta de la sucursal principal de la empresa que apaga (la plataforma no tiene sucursal: cuenta TODAS, pese a la RLS por sucursal), o en OTRA empresa (nunca bloquea). Con P = CERO no hay partes en ninguna: las dos filas dan lo mismo. |
| **A** qué se pide | DESACTIVAR, ACTIVAR | Pasar `recepcion_de_compras` de ACTIVO a INACTIVO, o de INACTIVO a ACTIVO. |

## Dimensiones que NO cambian el resultado

| Dimensión | Por qué no afecta |
|---|---|
| Cuántas partes pendientes hay (1 o muchas), cuántas facturas o sucursales | Solo importa si hay al menos una; la cantidad y las sucursales van en el MENSAJE del rechazo, no cambian si se rechaza. |
| Quién es el administrador de plataforma y desde qué instalación | La guarda no mira a la persona (la consola y el script ya autorizaron antes); solo queda en el rastro. |
| Condición de pago, importes, proveedor, producto | La recepción es de la mercadería, no del dinero. |
| Otros módulos de la empresa | La guarda solo mira `recepcion_de_compras` (el único con guarda de apagado). Apagar cualquier otro módulo no se mira. |
| Repetir el pedido | Apagar lo ya apagado no cambia nada (no-op, sin auditoría); un rechazo repetido da el MISMO rechazo y cada intento deja su fila de rastro. Se prueba aparte (idempotencia). |
| Que la parte pendiente nazca mientras se apaga (carrera) | No es una combinación de estado sino de tiempo: la prueba de concurrencia (`test/persistencia/guarda-de-apagado-recepcion.test.ts`) la cubre con dos transacciones reales. |

## Entradas de la regla y su efecto

Qué mira la base al decidir un apagado. Cada una es una dimensión de arriba o «no afecta» con su motivo. El guardián falla si el disparador de la migración mira una columna o un valor que no esté acá.

| Entrada | Efecto |
|---|---|
| modulo | no afecta: la guarda se aplica solo a `recepcion_de_compras`; cualquier otro módulo pasa sin mirar nada |
| estadoDelRegistro | A |
| estadoRecepcion | P |
| anuladaEn | P |
| empresaId | L |
| nivelDeAislamiento | no afecta: fuera de READ COMMITTED la base cierra y no deja apagar (falla cerrada); no depende de los datos |

## Quién escribe el registro de módulos

Las vías de la dimensión V que pasan por código de la app. El guardián falla si otro archivo de `src/`, `plataforma/src/` o `scripts/` escribe `ModuloEmpresa` sin figurar acá (una vía nueva tiene que declararse, con su fila en la tabla de abajo, o no entra). UPDATE_DIRECTO no tiene archivo: es cualquier SQL a mano.

| Archivo | Vía |
|---|---|
| plataforma/src/servidor/modulos.ts | CONSOLA |
| src/server/operaciones-de-plataforma/cambiar-modulos-de-empresa.ts | SCRIPT |

## Qué pasa al pedir el cambio

La tabla completa: 3 vías × 4 estados de las partes × 2 ubicaciones × 2 pedidos = 48 filas. «Resultado»: APLICA (el módulo queda como se pidió) o RECHAZA_CON_PENDIENTES (nada cambia y se informa cuántas compras y de qué sucursales). «Rastro»: la fila de `AuditoriaPlataforma` que deja la vía (DESACTIVADO = «modulo-desactivado», ACTIVADO = «modulo-activado», RECHAZADO = «modulo-desactivar-rechazado» con el módulo y la cantidad) o NINGUNO (un UPDATE directo no pasa por ninguna vía que audite).

| V | P | L | A | Resultado | Rastro |
|---|---|---|---|---|---|
| CONSOLA | CERO | OTRA_SUCURSAL_DE_LA_EMPRESA | DESACTIVAR | APLICA | DESACTIVADO |
| CONSOLA | CERO | OTRA_SUCURSAL_DE_LA_EMPRESA | ACTIVAR | APLICA | ACTIVADO |
| CONSOLA | CERO | OTRA_EMPRESA | DESACTIVAR | APLICA | DESACTIVADO |
| CONSOLA | CERO | OTRA_EMPRESA | ACTIVAR | APLICA | ACTIVADO |
| CONSOLA | UNA_SIN_ANULAR | OTRA_SUCURSAL_DE_LA_EMPRESA | DESACTIVAR | RECHAZA_CON_PENDIENTES | RECHAZADO |
| CONSOLA | UNA_SIN_ANULAR | OTRA_SUCURSAL_DE_LA_EMPRESA | ACTIVAR | APLICA | ACTIVADO |
| CONSOLA | UNA_SIN_ANULAR | OTRA_EMPRESA | DESACTIVAR | APLICA | DESACTIVADO |
| CONSOLA | UNA_SIN_ANULAR | OTRA_EMPRESA | ACTIVAR | APLICA | ACTIVADO |
| CONSOLA | SOLO_ANULADAS | OTRA_SUCURSAL_DE_LA_EMPRESA | DESACTIVAR | APLICA | DESACTIVADO |
| CONSOLA | SOLO_ANULADAS | OTRA_SUCURSAL_DE_LA_EMPRESA | ACTIVAR | APLICA | ACTIVADO |
| CONSOLA | SOLO_ANULADAS | OTRA_EMPRESA | DESACTIVAR | APLICA | DESACTIVADO |
| CONSOLA | SOLO_ANULADAS | OTRA_EMPRESA | ACTIVAR | APLICA | ACTIVADO |
| CONSOLA | SOLO_RECIBIDAS | OTRA_SUCURSAL_DE_LA_EMPRESA | DESACTIVAR | APLICA | DESACTIVADO |
| CONSOLA | SOLO_RECIBIDAS | OTRA_SUCURSAL_DE_LA_EMPRESA | ACTIVAR | APLICA | ACTIVADO |
| CONSOLA | SOLO_RECIBIDAS | OTRA_EMPRESA | DESACTIVAR | APLICA | DESACTIVADO |
| CONSOLA | SOLO_RECIBIDAS | OTRA_EMPRESA | ACTIVAR | APLICA | ACTIVADO |
| SCRIPT | CERO | OTRA_SUCURSAL_DE_LA_EMPRESA | DESACTIVAR | APLICA | DESACTIVADO |
| SCRIPT | CERO | OTRA_SUCURSAL_DE_LA_EMPRESA | ACTIVAR | APLICA | ACTIVADO |
| SCRIPT | CERO | OTRA_EMPRESA | DESACTIVAR | APLICA | DESACTIVADO |
| SCRIPT | CERO | OTRA_EMPRESA | ACTIVAR | APLICA | ACTIVADO |
| SCRIPT | UNA_SIN_ANULAR | OTRA_SUCURSAL_DE_LA_EMPRESA | DESACTIVAR | RECHAZA_CON_PENDIENTES | RECHAZADO |
| SCRIPT | UNA_SIN_ANULAR | OTRA_SUCURSAL_DE_LA_EMPRESA | ACTIVAR | APLICA | ACTIVADO |
| SCRIPT | UNA_SIN_ANULAR | OTRA_EMPRESA | DESACTIVAR | APLICA | DESACTIVADO |
| SCRIPT | UNA_SIN_ANULAR | OTRA_EMPRESA | ACTIVAR | APLICA | ACTIVADO |
| SCRIPT | SOLO_ANULADAS | OTRA_SUCURSAL_DE_LA_EMPRESA | DESACTIVAR | APLICA | DESACTIVADO |
| SCRIPT | SOLO_ANULADAS | OTRA_SUCURSAL_DE_LA_EMPRESA | ACTIVAR | APLICA | ACTIVADO |
| SCRIPT | SOLO_ANULADAS | OTRA_EMPRESA | DESACTIVAR | APLICA | DESACTIVADO |
| SCRIPT | SOLO_ANULADAS | OTRA_EMPRESA | ACTIVAR | APLICA | ACTIVADO |
| SCRIPT | SOLO_RECIBIDAS | OTRA_SUCURSAL_DE_LA_EMPRESA | DESACTIVAR | APLICA | DESACTIVADO |
| SCRIPT | SOLO_RECIBIDAS | OTRA_SUCURSAL_DE_LA_EMPRESA | ACTIVAR | APLICA | ACTIVADO |
| SCRIPT | SOLO_RECIBIDAS | OTRA_EMPRESA | DESACTIVAR | APLICA | DESACTIVADO |
| SCRIPT | SOLO_RECIBIDAS | OTRA_EMPRESA | ACTIVAR | APLICA | ACTIVADO |
| UPDATE_DIRECTO | CERO | OTRA_SUCURSAL_DE_LA_EMPRESA | DESACTIVAR | APLICA | NINGUNO |
| UPDATE_DIRECTO | CERO | OTRA_SUCURSAL_DE_LA_EMPRESA | ACTIVAR | APLICA | NINGUNO |
| UPDATE_DIRECTO | CERO | OTRA_EMPRESA | DESACTIVAR | APLICA | NINGUNO |
| UPDATE_DIRECTO | CERO | OTRA_EMPRESA | ACTIVAR | APLICA | NINGUNO |
| UPDATE_DIRECTO | UNA_SIN_ANULAR | OTRA_SUCURSAL_DE_LA_EMPRESA | DESACTIVAR | RECHAZA_CON_PENDIENTES | NINGUNO |
| UPDATE_DIRECTO | UNA_SIN_ANULAR | OTRA_SUCURSAL_DE_LA_EMPRESA | ACTIVAR | APLICA | NINGUNO |
| UPDATE_DIRECTO | UNA_SIN_ANULAR | OTRA_EMPRESA | DESACTIVAR | APLICA | NINGUNO |
| UPDATE_DIRECTO | UNA_SIN_ANULAR | OTRA_EMPRESA | ACTIVAR | APLICA | NINGUNO |
| UPDATE_DIRECTO | SOLO_ANULADAS | OTRA_SUCURSAL_DE_LA_EMPRESA | DESACTIVAR | APLICA | NINGUNO |
| UPDATE_DIRECTO | SOLO_ANULADAS | OTRA_SUCURSAL_DE_LA_EMPRESA | ACTIVAR | APLICA | NINGUNO |
| UPDATE_DIRECTO | SOLO_ANULADAS | OTRA_EMPRESA | DESACTIVAR | APLICA | NINGUNO |
| UPDATE_DIRECTO | SOLO_ANULADAS | OTRA_EMPRESA | ACTIVAR | APLICA | NINGUNO |
| UPDATE_DIRECTO | SOLO_RECIBIDAS | OTRA_SUCURSAL_DE_LA_EMPRESA | DESACTIVAR | APLICA | NINGUNO |
| UPDATE_DIRECTO | SOLO_RECIBIDAS | OTRA_SUCURSAL_DE_LA_EMPRESA | ACTIVAR | APLICA | NINGUNO |
| UPDATE_DIRECTO | SOLO_RECIBIDAS | OTRA_EMPRESA | DESACTIVAR | APLICA | NINGUNO |
| UPDATE_DIRECTO | SOLO_RECIBIDAS | OTRA_EMPRESA | ACTIVAR | APLICA | NINGUNO |

## Cargar una parte pendiente (la otra mitad de la carrera)

La base respalda a `estadoInicialDeLaParte` (la parte nace pendiente solo con el módulo encendido): un INSERT de una parte PENDIENTE con el módulo sin fila ACTIVA de esa empresa se rechaza. Una parte RECIBIDA no mira el módulo.

| Módulo de la empresa | Estado de la parte que se inserta | Resultado |
|---|---|---|
| ACTIVO | PENDIENTE | ACEPTA |
| INACTIVO | PENDIENTE | RECHAZA_MODULO_APAGADO |
| SIN_FILA | PENDIENTE | RECHAZA_MODULO_APAGADO |
| ACTIVO | RECIBIDA | ACEPTA |
| INACTIVO | RECIBIDA | ACEPTA |
| SIN_FILA | RECIBIDA | ACEPTA |
