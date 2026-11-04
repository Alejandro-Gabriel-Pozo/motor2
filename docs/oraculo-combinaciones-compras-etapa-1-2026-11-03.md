# Oráculo de combinaciones: número de factura único en toda la empresa (Compras, etapa 1, 2026-11-03)

Tabla de reglas esperadas escrita APARTE del código (regla del dueño del 2026-10-28, «Combinaciones»). La recorre el test
`test/movimientos/combinaciones-comprobante-unico.test.ts` contra la base real y un guardián falla si aparece una dimensión nueva sin declarar.
Diseño: `docs/diseno-compras-factura-unica-y-rechazo-2026-11-03.md` (I2, I15, P2).

## Dimensiones que cambian el resultado (dinero, stock, permisos o lo que se ve)

| Dimensión | Valores | Qué representa |
|---|---|---|
| **N** número | `NUEVO` · `REPETIDO_MISMA_SUCURSAL` · `REPETIDO_OTRA_SUCURSAL` · `REPETIDO_FACTURA_REPARTIDA` | Si ya existe un comprobante VIGENTE del MISMO proveedor con el mismo número (normalizado), y dónde: una compra simple en la sucursal de quien carga, una compra simple en otra sucursal de la empresa, o la cabecera de una factura repartida |
| **L** letra del existente | `CON_LETRA` · `SIN_LETRA` | El comprobante existente tiene la misma letra que el nuevo (`A-00001-00001234` contra `A-1-1234`), o es una compra vieja de texto libre sin letra (`0001-00001234`, I15) |
| **P** permiso de ver la sucursal ajena | `SI` · `NO` | Quien carga tiene o no `proceso_compra` VER en la sucursal donde está el comprobante existente |
| **O** operación | `COMPRA_NUEVA` · `CORRECCION` | Registrar una compra simple, o corregir la cabecera de otra compra vigente poniéndole ese número |

## Regla (el resultado esperado de cada combinación)

1. **Rechaza** (`FACTURA_DUPLICADA`, mensaje EXACTO `MENSAJE_FACTURA_DUPLICADA`: «Ya hay una factura de este proveedor con ese número cargada en la empresa. Si hay que corregirla, anulala y volvé a cargarla.») si y solo si `N ≠ NUEVO` **y** `L = CON_LETRA`. No escribe nada: ni Operación, ni Kardex, ni vínculo, ni auditoría; en una corrección la compra queda como estaba.
2. **Acepta** en cualquier otro caso:
   - `N = NUEVO`: no hay otro comprobante con esa clave.
   - `L = SIN_LETRA`: la clave del comprobante es empresa + proveedor + **letra** + PV + número; un texto viejo sin letra no tiene la misma clave y NO se compara (I15: las cargas viejas no se tocan ni bloquean). Riesgo aceptado: un número viejo cargado sin letra puede volver a cargarse con letra una vez (lo sigue mostrando el aviso C25 de posible duplicado, que no bloquea; criterio conservador de `normalizarNumeroDeComprobante`).
3. **P no cambia nada**: ni el resultado ni el texto. El mensaje nunca dice fecha ni sucursal (P2), tenga o no permiso quien carga. (El aviso C25 de «posible factura repetida», que NO bloquea y sí puede dar el día a quien ve la otra sucursal, no aplica a un número exactamente repetido: el rechazo corre antes.)
4. **O no cambia la regla**: la corrección usa el mismo lector (`hayComprobanteVigenteEnLaEmpresa`) excluyendo a la propia compra (corregir una compra dejándole su mismo número acepta).

## Enumeración (32 combinaciones)

| N | L | P | O | Resultado |
|---|---|---|---|---|
| NUEVO | CON_LETRA | SI | COMPRA_NUEVA | ACEPTA |
| NUEVO | CON_LETRA | SI | CORRECCION | ACEPTA |
| NUEVO | CON_LETRA | NO | COMPRA_NUEVA | ACEPTA |
| NUEVO | CON_LETRA | NO | CORRECCION | ACEPTA |
| NUEVO | SIN_LETRA | SI | COMPRA_NUEVA | ACEPTA |
| NUEVO | SIN_LETRA | SI | CORRECCION | ACEPTA |
| NUEVO | SIN_LETRA | NO | COMPRA_NUEVA | ACEPTA |
| NUEVO | SIN_LETRA | NO | CORRECCION | ACEPTA |
| REPETIDO_MISMA_SUCURSAL | CON_LETRA | SI | COMPRA_NUEVA | RECHAZA |
| REPETIDO_MISMA_SUCURSAL | CON_LETRA | SI | CORRECCION | RECHAZA |
| REPETIDO_MISMA_SUCURSAL | CON_LETRA | NO | COMPRA_NUEVA | RECHAZA |
| REPETIDO_MISMA_SUCURSAL | CON_LETRA | NO | CORRECCION | RECHAZA |
| REPETIDO_MISMA_SUCURSAL | SIN_LETRA | SI | COMPRA_NUEVA | ACEPTA |
| REPETIDO_MISMA_SUCURSAL | SIN_LETRA | SI | CORRECCION | ACEPTA |
| REPETIDO_MISMA_SUCURSAL | SIN_LETRA | NO | COMPRA_NUEVA | ACEPTA |
| REPETIDO_MISMA_SUCURSAL | SIN_LETRA | NO | CORRECCION | ACEPTA |
| REPETIDO_OTRA_SUCURSAL | CON_LETRA | SI | COMPRA_NUEVA | RECHAZA |
| REPETIDO_OTRA_SUCURSAL | CON_LETRA | SI | CORRECCION | RECHAZA |
| REPETIDO_OTRA_SUCURSAL | CON_LETRA | NO | COMPRA_NUEVA | RECHAZA |
| REPETIDO_OTRA_SUCURSAL | CON_LETRA | NO | CORRECCION | RECHAZA |
| REPETIDO_OTRA_SUCURSAL | SIN_LETRA | SI | COMPRA_NUEVA | ACEPTA |
| REPETIDO_OTRA_SUCURSAL | SIN_LETRA | SI | CORRECCION | ACEPTA |
| REPETIDO_OTRA_SUCURSAL | SIN_LETRA | NO | COMPRA_NUEVA | ACEPTA |
| REPETIDO_OTRA_SUCURSAL | SIN_LETRA | NO | CORRECCION | ACEPTA |
| REPETIDO_FACTURA_REPARTIDA | CON_LETRA | SI | COMPRA_NUEVA | RECHAZA |
| REPETIDO_FACTURA_REPARTIDA | CON_LETRA | SI | CORRECCION | RECHAZA |
| REPETIDO_FACTURA_REPARTIDA | CON_LETRA | NO | COMPRA_NUEVA | RECHAZA |
| REPETIDO_FACTURA_REPARTIDA | CON_LETRA | NO | CORRECCION | RECHAZA |
| REPETIDO_FACTURA_REPARTIDA | SIN_LETRA | SI | COMPRA_NUEVA | ACEPTA |
| REPETIDO_FACTURA_REPARTIDA | SIN_LETRA | SI | CORRECCION | ACEPTA |
| REPETIDO_FACTURA_REPARTIDA | SIN_LETRA | NO | COMPRA_NUEVA | ACEPTA |
| REPETIDO_FACTURA_REPARTIDA | SIN_LETRA | NO | CORRECCION | ACEPTA |

Nota sobre `REPETIDO_FACTURA_REPARTIDA` + `SIN_LETRA`: una factura repartida siempre se guarda con número estructurado (con letra) desde la etapa 1; las anteriores pueden tener texto libre. El caso se siembra directo en la base como dato viejo.

## Dimensiones que NO cambian el resultado (declaradas para el guardián)

| Dimensión | Por qué no afecta |
|---|---|
| Cómo está escrito el número (ceros a la izquierda, espacios, guiones) | Se compara normalizado (`normalizarNumeroDeComprobante`): `A-23-237728` = `A-00023-00237728` |
| Mayúsculas de la letra | Se normaliza a mayúscula |
| Otro proveedor con el mismo número | No es la misma clave: acepta (equivale a `N = NUEVO`) |
| Comprobante existente ANULADO | No es vigente: acepta (equivale a `N = NUEVO`) |
| Otra empresa con el mismo proveedor/número | Aislamiento por empresa (RLS): no se ve, acepta (equivale a `N = NUEVO`) |
| Concurrencia (dos cargas a la vez) | Una gana y la otra recibe el mismo rechazo (cerrojo + SERIALIZABLE); probado aparte en `comprobante-unico-en-la-empresa.test.ts` |
| Reintento con la misma clave de idempotencia | Devuelve «repetida» (no rechazo), sin duplicar; probado aparte |
| Aceptar una parte de factura repartida | Por construcción: el número de la parte es el de su factura, que ya pasó la regla al cargarse; probado aparte |

## Dimensiones de etapas posteriores (NO APLICAN en la etapa 1)

| Dimensión | Etapa | Por qué no aplica todavía |
|---|---|---|
| Letra y punto de venta tomados de la ficha del proveedor (`PuntoDeVentaDeProveedor`, letras admitidas) | 2 | No existe la columna de letras; la letra la escribe el operador |
| Código del proveedor separado de la descripción (`codigoDelProveedor`) | 2 | Requiere migración |
| UM y unidades por línea (migración 2a) | 2a | Requiere migración; no cambia la unicidad del número |
| Parte RECHAZADA de una factura repartida (vuelve a la sucursal de origen) | 3 | No existe el estado RECHAZADA |
| Tipo de proveedor / servicios | E4 | Fuera de alcance |
