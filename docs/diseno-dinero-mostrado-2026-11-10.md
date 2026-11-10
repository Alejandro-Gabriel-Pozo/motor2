# Diseño: todo el dinero mostrado sale de la función central (2026-11-10)

Estado de las decisiones: **CONFIRMADA** = dicha por el dueño; **PROPUESTA** = supuesto declarado, el dueño corrige.

## 1. Propósito y alcance
- **Necesidad (CONFIRMADA, dueño 2026-11-10):** «Si es dinero no puede quedar como deuda». Regla de fondo (2026-11-09): todo número mostrado sale de `src/core/formato-de-numero.ts`; el dinero SIEMPRE con 2 decimales y símbolo («$ 1.234,50»).
- **Alcance:** que ningún DINERO mostrado a una persona quede fuera de `formatearMonto` (o `formatearDolares` para la conversión a USD). Reportes, `EnDolares`, mensajes de servidor y de dominio con importes, carta pública. Cantidades/porcentajes: solo si es trivial y está en la misma línea. Fuera de alcance: entrada tecleada (sesión E-N, `CampoNumero`, parser), estilo de tablas (#220).

## 2. Actores y contexto
Dueño/gerente (reportes, mensajes de error al cargar), mozo (mensajes del POS), **cliente final** (carta pública). Moneda ARS fija (`MONEDA_FIJA`); la única excepción es la conversión informativa a dólares de `EnDolares`.

## 3. Casos de uso
Leer un reporte; recibir un mensaje de rechazo con un importe (piso de promo, reparto de factura, pago a consignante, alertas del período); ver un precio en la carta pública; ver la cotización en el encabezado.

## 4. Conceptos y ciclo de vida
`formatearMonto(n)` redondea con `redondearMoneda` (decimal exacto) y formatea; `null`/`NaN` → «—». Se agrega `formatearDolares(n)` (2 decimales, sin símbolo; la pantalla pone «US$») porque `formatearMonto` es ARS fijo: es la única salida de dinero no-ARS. `IMPORTE_MINIMO_TEXTO` pasa de `core/moneda.ts` a `formato-de-numero.ts` (evita el ciclo de importación y sale «$ 0,01»).

## 5. Invariantes y políticas
- Ningún redondeo cambia: lo mostrado sigue siendo `redondearMoneda` ARS (antes se mostraba el número crudo con hasta 3 decimales; ahora el mismo valor redondeado a 2).
- Dinero exacto: no se introduce ningún float nuevo; los importes ya venían como `number` y se convierten en el borde como en el resto del repo.
- **Cambio visible para el cliente final (carta pública):** el precio pasa de «$3.500» a «$ 3.500,00». Es decisión derivada de la regla «dinero siempre con 2 decimales»; marcado en el PR. PROPUESTA: no se hace excepción para la carta (el dueño la corrige si quiere «$ 3.500» ahí).
- `CLAVES_FIJAS_DEL_SISTEMA.precio_*` (tema de la carta) quedan como constantes del tema; `formatearPrecioCarta` ya no las lee.

## 6. Historia y persistencia
Sin cambios de datos ni migraciones. Solo texto de salida. Los textos guardados en base (p. ej. mensajes de auditoría ya escritos) no se reescriben.

## 7. Atomicidad y concurrencia
No aplica: funciones puras de salida. Ningún mensaje deja de generarse en la misma transacción que antes.

## 8. Acceso e interfaces
Sin cambios de permisos ni de contratos de acción: los `mensaje` de los resultados siguen siendo texto.

## 9. Consultas y experiencia
Las tablas ordenan por el valor numérico (`valor:`), no por el texto: el formato no altera el orden. Las celdas de dinero ya llevan `whitespace-nowrap`. Exportaciones a Excel: siguen mandando el valor numérico.

## 10. Pruebas, migración y operación
- **Guardián** (`test/arquitectura/cerco-numero-sin-formato-central.test.ts`): línea de base 120 → 8 usos en 6 archivos; nuevo tipo `signo-pesos-pelado` (un «$» escrito a mano delante de una interpolación, que el guardián anterior no veía); nuevo test de cierre: todo archivo que queda en la línea de base está declarado como no-dinero con motivo (`RESTANTES_DECLARADOS_NO_DINERO`). Un dinero nuevo sin formato central hace fallar el cerco (sube la cuenta) o el cierre (archivo sin declarar).
- **Dimensiones cuyas combinaciones cambian lo mostrado:** (a) valor: negativo / cero / positivo / `null` / con más de 2 decimales (empate de redondeo); (b) contexto: celda de tabla / texto corrido / mensaje de servidor / gráfico / carta pública; (c) moneda: ARS / USD. Oráculo: tests de `formato-de-numero` (ya existen, #221) + los textos esperados de los mensajes. No se agregan combinaciones nuevas: no se creó ninguna dimensión de producto.
- **Tablas «¿qué pasa si…?»:** repetición/concurrencia/permisos/reintento: no aplican (puro). Datos faltantes: «—» (y «costo incompleto» donde ya existía). Valor con más de 2 decimales: se redondea ARS (empate lejos del cero). Importe negativo: «-$ 5,00». Cambio de redondeo: no hay.
- Migración: ninguna. Reversible: revertir el PR.

## Clasificación de los 120 usos de la línea de base

| Clase | Usos | Qué se hizo |
|---|---|---|
| DINERO mostrado | **96** | Migrados a `formatearMonto` / `formatearDolares`: reportes (período, valuación, consolidado, categorías, consignación, devoluciones, descuentos clientes y productos, pérdidas, ventas por sección, margen de promociones, tabla-resumen, historial, rendimiento de recetas, gráfico de gasto por grupo), `EnDolares`, carta pública, mensajes (`registrar-pago-consignante`, `periodo-margen`, `periodo-alertas`, `reparto-de-factura`, piso de $0,01) |
| Cantidad / porcentaje / conteo mostrado | **15** | Migrados porque eran triviales y estaban en la misma línea: `formatearEntero` (ventas, unidades, promos vendidas, tope de cuentas, minutos), `formatearCantidad` (cantidad del ticket, comensales promedio, R²), `formatearPorcentaje` (suma de porcentajes del reparto), cantidad de las alertas |
| Entrada tecleada | 1 | `campo-numero-logica.ts`: lo resolvió #222 (E-N entrada) al mergear main; ya no está en la línea de base |
| Cálculo interno, no mostrado | 5 | `huella-de-opciones` (2, hash), `componer-precio-de-linea` (validación del factor), `registrar-factura-proveedor` (2, redondeo a 4 decimales antes de guardar). Verificado en el código: no llegan a pantalla ni a un mensaje |
| Factor, no dinero | 1 | `factor-de-escala.ts` («1,3»: texto de la comparación) |
| Cantidad en un mensaje (no trivial de unir con su unidad) | 2 | `actualizar-activo-sucursal`, `actualizar-decimales-unidad`: quedan con el vencimiento 2027-01-03 |
| **Total** | **120** → quedan **8** | |

**Dinero escrito a mano que el guardián anterior no veía** (`$${x}`; también corregido): piso de promo (3 lugares en `piso-de-promo.ts`, 2 en `promo-combo.ts`), `guardar-precio-local-promo-carta`, `reparto-de-factura` (faltan/sobran), `IMPORTE_MINIMO_TEXTO`.

**Límite declarado del guardián:** un dinero ya como `number` que se imprime tal cual (`{a.saldo}`) no se ve en el AST (no hay tipos); lo cubre la revisión. Este PR no encontró casos de dinero en esa forma en `src/` ni en `plataforma/src` (la consola no tenía ningún uso de los 4 tipos medidos).
