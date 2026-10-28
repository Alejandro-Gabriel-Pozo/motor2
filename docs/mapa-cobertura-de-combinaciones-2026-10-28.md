# Mapa de cobertura de combinaciones (2026-10-28)

Lectura estática del código (no se corrió ningún test), pedida por el dueño: cada módulo debe declarar las dimensiones cuyas combinaciones cambian dinero, permisos, visibilidad o stock, con una tabla de reglas esperada aparte del código (oráculo), un test que recorra todas las combinaciones y un guardián que falle ante una dimensión nueva sin declarar (regla en `AGENTS.md`). Este mapa dice qué hay y qué falta. **Ninguna de las matrices propuestas necesita migración.**

> **Corrección (2026-10-28, tras la auditoría de poda):** el «hueco» de que la carta pública no respeta la vigencia de las promos NO se arregla. El dueño decidió el 2026-10-20 (`docs/pendientes-sesion-2026-10-22.md`, 9.ª a 12.ª parte) que la promoción NO tiene vigencia desde/hasta ni días ni carga por fecha: se activa y se desactiva a mano. Lo correcto es retirar la vigencia (ocultarla y después borrar `vigenteDesde`, `vigenteHasta`, `diasDeSemana` con migración autorizada), no construir su respeto. Este mapa lo había listado como riesgo «alto» por no haber cruzado la decisión del dueño.

## Hallazgos principales
- **Existen pocas matrices exhaustivas con oráculo aparte, y son sólidas:** `test/core/features/traspasos/traspaso-guard.test.ts` (6 operaciones × 7 estados × 3 lados contra `ESPERADO`; es el modelo a copiar), la matriz de fábrica de permisos (`test/permisos/matriz-esperada.ts`) y proceso × sección dada de baja (`test/movimientos/seccion-desactivada.test.ts`).
- **Propiedades (fast-check) contra un oráculo:** promos y cupos, precio de línea con opciones, filas de Kardex, reparto de facturas, decisión de acceso.
- **Goldens/caracterizaciones** dominan en ventas, POS, reportes y permisos: son fotos de escenarios elegidos a mano, no recorridos de dimensiones.
- **Guardianes de «dimensión nueva sin declarar»:** existen para seguridad y arquitectura (tablas, claves, acciones, campos sensibles, columnas `Decimal` auditadas, «sin fila», lista cerrada de la carta pública, puertas de denegación). **No existe** ninguno para una columna booleana, de fecha, de máscara o con CHECK nueva que cambie precio, visibilidad o stock.
- **Hueco de negocio:** la carta pública NO respeta `vigenteDesde`, `vigenteHasta` ni `diasDeSemana` de las promos y no hay test que lo ejerza (ADR-032 línea 167 lo declara «pendiente aparte»; `src/server/lecturas/carta/menu.ts` filtra solo con `wherePromoOfrecidaEn`; `promoVigenteEl` solo se usa en el POS). Una promo vencida o de otro día se ve en la carta pública y el POS no la vende.

## Tabla por riesgo
| Módulo | Dimensiones principales | Cobertura actual | Guardián de dimensión nueva | Brecha | Riesgo |
|---|---|---|---|---|---|
| Cobro/precio (POS salón y mostrador) | precio local × capacidad, descuento de producto, descuento de cliente, tipo de línea, opciones/base, canal, IVA de línea | goldens (`venta-matriz*`, `precios`, `cobro-y-carta`), propiedades de opciones, ejemplos de descuentos | No | Sin matriz {línea} × {precio local} × {descuento} × {cliente} × {canal} | **Alto** |
| Carta pública / visibilidad | promo: activa, sucursal, soloSalon, vigencia, días, módulo; producto: disponible, visible, sección, agrupado, opción apagada | lista cerrada de campos, tests de soloSalon y módulo | Parcial | La carta pública ignora la vigencia; sin matriz de lectores × reglas | **Alto** |
| IVA de compras | perilla, condición, letra, naturaleza, alícuota, tributos | CHECKs y propiedades SQL; sin código en `src/` | Parcial | Matriz de exigencia antes de la Etapa C | Alto a futuro / medio hoy |
| Promos, combos, cupos | tipo de cupo, mín/máx, entradas, vigencia, alícuota, precio local | propiedades con oráculo + ejemplos | No | Sin matriz de qué se ofrece hoy, a quién y a qué precio | Medio-alto |
| Factura repartida / propuesta / anulación | estados de cabecera, parte, propuesta, anulación; modo de reparto; claves | propiedades de reparto + integración (~20 casos) | No | Sin tabla de estados × permisos × lado | Medio-alto |
| Stock / Kardex / conteo | 16 procesos, lote, sección activa, conteo, negativo, sustituto | Record de procesos (compila) + CHECKs + propiedades + diferencial | Parcial | Sin tabla legible proceso × campos | Medio-alto |
| Consignación | esConsignacion, proveedor, precio, devolución, liquidación, pago | ejemplos + 1 invariante | No | Sin matriz con permiso y operación | Medio |
| Reportes de costos / valuación | fuente del costo, IVA incluido, anuladas, consignación, traspaso | un golden + ejemplos | No | Sin matriz de fuente de costo | Medio |
| Clientes / descuentos | %, activo, snapshot | ejemplos | No | Se resuelve con la matriz de cobro | Medio |
| Permisos y acceso | rol × clave × nivel × alcance × módulo × capacidad | matriz esperada + propiedades + golden con hash + denegación | **Sí** | Rol × clave por muestras; sin recorrido total por puerta | Bajo-medio |
| Traspasos y costo | estados × operación × lado; copia de costo | matriz exhaustiva con oráculo + ejemplos | Parcial | `ESTADOS` escrito a mano | Bajo-medio |
| Mesas / cuentas | estado de mesa, cuenta, ítem, ticket, puesto | ejemplos + huella + guardián de puesto | Parcial | Sin matriz estado × operación | Bajo-medio |

## Las 8 matrices a agregar primero (ninguna con migración)
1. **Cobro de una línea** (medio): tipo de línea × precio local (capacidad on/off) × descuento de producto × descuento de cliente × canal; oráculo con decimal.js contra `precioCobradoConDescuentos`, el total de la cuenta y el ticket.
2. **Visibilidad de carta y promos** (chico-medio): reglas de promo y de producto × los 4 lectores (pública, selector POS, promo para agregar, contador del hub); decidir la vigencia en la carta pública. *En curso en el módulo Carta (carril `alegp/carril-car`).*
3. **IVA de compras, antes de la Etapa C** (chico): perilla × condición × letra × naturaleza × alícuota.
4. **Factura repartida** (chico-medio): estados de cabecera, parte, propuesta y anulación × permisos × sucursal (patrón de `traspaso-guard.test.ts`).
5. **Proceso × campos del Kardex** (medio): tabla legible de signo, precio, lote, sección, conteo y origen por proceso.
6. **Rol × clave por puerta** (medio-grande): escenario «rol sin su clave» para todas las puertas inventariadas.
7. **Consignación + fuente de costo** (medio).
8. **Guardián transversal de dimensión** (medio): parsea `prisma/schema.prisma` y falla ante un booleano, fecha, máscara o columna con CHECK nueva en modelos de dinero, visibilidad o stock sin declaración «afecta: sí/no» con motivo.

Arreglos baratos de pasada: derivar `ESTADOS` y `OPERACIONES` de `traspaso-guard.test.ts` desde el enum; que `caracterizaciones-congeladas` enumere los `*.golden.*` y falle ante uno no declarado.

## Límites de este mapa
No se leyeron los e2e de Playwright, la consola de plataforma ni el contenido de los goldens grandes; no se ejecutó ningún test («cubierto» = existe el test y, por lectura, cubre eso).
