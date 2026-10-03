# ADR-015: Dependencias completas entre módulos, Recetas y Clientes

> Redactado el 2026-10-03 (Bloque 5A, después de ADR-014). **Decidido, todavía sin implementar.** Completa y corrige la tabla de dependencias de
> ADR-014 §3 con las tres respuestas del dueño a la revisión del catálogo de módulos y del mapeo de las 123 acciones de `ACCIONES`. No cambia
> ninguna otra decisión de ADR-011 ni de ADR-014.

## Contexto

Al armar el mapeo acción → módulo bajo ADR-014 aparecieron tres huecos que el ADR no resolvía (etiquetas: VERIFICADO EN CÓDIGO / PROPUESTA):

| Hueco | Evidencia | Estado |
|---|---|---|
| Clientes básico es un módulo de soporte calculado, pero ningún módulo lo requería: la pantalla de clientes habría quedado inalcanzable | la acción `clientes` (alta y % de descuento) y `pos_asignar_cliente` (el POS asigna un cliente a la cuenta); ADR-014 §2 y §3 | VERIFICADO EN CÓDIGO / ausencia en el ADR |
| Compras, Traspasos y Consignación mueven stock pero no declaraban requerir Stock | `proceso_compra`, `anular_compra` y `corregir_compra` tocan stock y gasto (comentarios en `ACCIONES`); los traspasos y la devolución al consignante son movimientos | VERIFICADO EN CÓDIGO / ausencia en el ADR |
| ADR-014 nombra un módulo «Recetas» como requisito de Producción, pero no lo incluía en la lista de módulos | ADR-014 §3, fila de Producción | inconsistencia del ADR |

## Decisión

### 1. Recetas es un módulo propio

Recetas es un módulo vendible con sus propias acciones: recetas centrales, calibración de rendimiento por sucursal, receta propia por sucursal
(editar, copiar, volver a la central), food cost objetivo y los reportes que dependen de recetas (costos y márgenes, rendimiento de recetas y por
sucursal, ventas sin receta, insumos sin receta). Requiere Catálogo básico; usa Stock y Carta si existen. Producción requiere Stock **y** Recetas.

### 2. Salón requiere Clientes básico

Clientes básico lo trae Salón: el POS asigna a la cuenta un cliente con descuento, y el alta de cliente es liviana. Un cliente solo tiene sentido
junto a quien lo usa, así que no se vende aparte. Si más adelante otro módulo necesita clientes, lo requerirá también y el soporte seguirá
calculado.

### 3. Compras, Traspasos y Consignación requieren Stock

Los tres mueven stock, de modo que sin Stock no pueden funcionar. Consignación sigue sin requerir Compras (ADR-014 §3).

### 4. Tabla de dependencias vigente

Reemplaza la tabla de ADR-014 §3. «Requiere» es dura y «usa si existe» es blanda (definiciones en ADR-011 §3).

| Módulo | Tipo | Requiere (duro) | Usa si existe (blando) |
|---|---|---|---|
| Administración | fijo | — | — |
| Catálogo básico | soporte calculado | — | — |
| Proveedores básico | soporte calculado | — | — |
| Clientes básico | soporte calculado | — | — |
| Stock | vendible | Catálogo básico | — |
| Compras | vendible | Proveedores básico, Stock | — |
| Traspasos | vendible | Stock | — |
| Consignación | vendible | Proveedores básico, Stock | Salón |
| Recetas | vendible | Catálogo básico | Stock, Carta |
| Producción | vendible | Stock, Recetas | — |
| Carta | vendible | Catálogo básico | Salón |
| Promociones | vendible | Carta | Salón |
| Salón | vendible | Stock, Clientes básico | Carta, Promociones |

Los módulos de soporte se calculan como la clausura por `requiere` (ADR-014 §2): por ejemplo, con solo Consignación activa quedan activos también
Proveedores básico, Stock y Catálogo básico, pero no Compras. Con solo Salón quedan Stock, Clientes básico y Catálogo básico.

### 5. Mapeo acción → módulo

Las 123 acciones se asignan cada una a un solo módulo siguiendo el criterio de ADR-014 §5 (la pantalla o caso de uso que la usa; si no, el dueño del
dato). El mapeo detallado, con las asignaciones dudosas marcadas, vive en el plan del 5A y se materializa como el campo `modulo` de cada entrada de
`ACCIONES`. Quedan como asignaciones a revisar al implementar: la regla de venta rápida de `proceso_venta` y `anular_venta` (ADR-014 §4), y
`proceso_devolucion_cliente`, `proceso_devolucion_proveedor` y `notificar_alertas` (esta última no tiene ninguna pantalla que la use).

## Alternativas descartadas

- **Clientes como módulo vendible aparte**: obligaría a vender y activar un módulo solo para poder dar de alta clientes que el Salón ya necesita.
- **Dejar Compras, Traspasos y Consignación sin requerir Stock**: permitiría un plan que active la compra sin el motor de movimientos y deje la
  acción rota.
- **Recetas dentro de Stock o de Catálogo básico**: ata a quien solo quiere inventario a las pantallas de recetas y costos, y no deja vender
  Producción ni Recetas por separado.

## Correcciones a otros ADR

Los ADR originales no se reescriben; ADR-014 lleva una línea de estado que apunta a este.

1. **ADR-014 §3, tabla de dependencias.** Se reemplaza por la tabla del punto 4 de este ADR: se agregan Stock como requisito de Compras, Traspasos y
   Consignación, el módulo Recetas, y Clientes básico como requisito de Salón.
2. **ADR-014 §2.** La lista de soportes no cambia (siguen siendo tres) y se aclara quién trae cada uno: Catálogo básico lo trae Stock, Recetas y Carta;
   Proveedores básico, Compras y Consignación; Clientes básico, Salón.

## Consecuencias

- **El catálogo de módulos tiene 13 entradas**: Administración fija, tres soportes calculados y nueve vendibles (Stock, Compras, Traspasos,
  Consignación, Recetas, Producción, Carta, Promociones y Salón).
- **Planes (ADR-013)**: para vender Salón solo hay que listar Salón; el cálculo suma Stock, Clientes básico y Catálogo básico. La consola muestra
  «incluido por Salón» en cada uno.
- **Guard y pantalla usan la misma función de módulos activos** (ADR-014, consecuencias). Un test debe probar la clausura con estos casos: con
  Consignación activa y sin Compras, la acción de proveedores queda habilitada y la de comparar precios no; con Salón activo, la acción de clientes
  queda habilitada.
- **Desactivar Stock exige que ningún módulo activo lo requiera** (Compras, Traspasos, Consignación, Producción, Salón): la consola lo bloquea
  según ADR-011 §3.
- **Rollback**: el cambio es solo documental; se revierte con `git revert` del commit.
