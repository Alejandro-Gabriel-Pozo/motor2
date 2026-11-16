# Compras: paridad con Pedernal (Fase 1, solo documentos)

Fecha: 2026-11-16. Frente 5 (COMPRAS) del programa de paridad. Orquestador general: `session_014d2PePHcw9fkQhuU9Q3SiL`. **No hay código, ni migraciones, ni DEC, ni nada aplicado a ninguna base.**

Tres archivos:
1. `diseno-compras-paridad-auditoria-2026-11-16.md` — qué hay hoy en Motor2 (código real) y en Pedernal (vigente), con la tabla de paridad.
2. `diseno-compras-paridad-escalera-2026-11-16.md` — escalera de 10 niveles con estado de cada decisión y la tabla «¿qué pasa si…?».
3. Este — pedido, etapas, carril, dependencias y preguntas.

## Pedido del dueño

«compras, bueno, nosotros algo teníamos en Motor 2 de compras, nota de crédito y demás. No teníamos recepción separada, orden de compra, etcétera» — 2026-11-16, `motor2-docs/seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, sección «Paridad con Pedernal: qué falta y cómo se trabaja».

Honestidad sobre una frase del dueño: dice que Motor2 «algo tenía… nota de crédito». En el código real hay **tablas** de notas de crédito (`NotaCreditoProveedor*`) pero **ningún caso de uso, acción ni pantalla** que las escriba (auditoría §1.2). Para el producto, hoy una nota de crédito no se puede cargar.

## Resumen

- Motor2 ya tiene lo central de N1/N2 (compra con factura, reparto, anular, pago sin importe). No tiene orden de compra, tres vías, diferencias, notas cargables, devolución ligada a nota, saldo, reintegro, corrección de líneas ni caja.
- **Hallazgo que abarata todo:** la base de Motor2 ya prevé la recepción pendiente (`FacturaProveedorSucursal.estadoRecepcion`, `operacionId` opcional, acción `compra_recibir` reservada). N3 es **activar lo ya diseñado**, sin tabla nueva en su primer peldaño.
- **Riesgo existente:** anular una factura con pago vigente no tiene bloqueo (Pedernal lo cerró en D5). Arreglo chico, etapa C0.
- Pedernal tiene construido solo N1/N2 (+0058 mergeada). N3 (0063) está aprobado sin código verificable; N4 solo diseño; la valorización «opción A» al corregir cantidad **no está construida ni en Pedernal**. Igualar «a lo vigente» significa construir en Motor2 cosas que Pedernal aún no tiene: se hace desde el diseño y las decisiones del dueño, y se declara.
- Contradicción de Pedernal resuelta a favor de lo posterior: la diferencia ofrece **cuatro** resoluciones (`DDD:197`, 16/11), no siete (`DDD:121`, 14/11).

## Etapa mínima (regla «primero lo más barato»)

**¿Alcanza con N3 sin orden de compra? Sí.** El pedido nombra primero «recepción separada»; la orden de compra, las tres vías y la devolución dependen de que la recepción exista, no al revés (`DDD:196`: N4 requiere N3).

Peldaño mínimo, **N3-a «recibir después de cargar»**: la compra cargada puede quedar con su parte `PENDIENTE` (sin stock, sin costo, sin gasto); la confirma gerente o administrador (`compra_recibir`, hoy reservada), eligiendo el depósito; recién ahí entra el stock. Sin migración (la base ya lo soporta; a confirmar en Fase 2 que no falte un CHECK que impida stock con parte pendiente). Sin control por línea, sin perillas nuevas obligatorias si el dueño acepta que quede detrás de un interruptor de empresa mientras el frente 4 no entregue las perillas.

Antes de N3-a, **C0** (anular con pago vigente: rechazar, como D5): sin migración, es corrección de integridad.

## Etapas con nombre

| Etapa | Contenido | Migración | Depende de | Habilita |
|---|---|---|---|---|
| **C0** | Bloqueo de anulación con pago vigente (`COMPROBANTE_YA_PAGADO{pagoId}`); anular pago primero | no | — | — |
| **N3-a** | Recepción pendiente → confirmar con depósito (mínima) | no (verificar) | C0; permiso `compra_recibir` (zona restringida) | perilla `recepcion_separada` (frente 4) |
| **N3-b** | Control por línea (conforme / con observaciones / rechazada, observación obligatoria) | **sí, aditiva: requiere autorización expresa por base** | N3-a | — |
| **N3-c** | Costo provisional (solo N3/N4) y recibir a cuarentena/rechazo | **sí: requiere autorización expresa por base** (toca la validación de stock) | frente 2 / stock; SQL real de 0064 de Pedernal | — |
| **COR-1** | Corregir precio de una línea (fórmula A del costo, oferta que sigue) y completar «Sin precio» | probable (requiere autorización expresa por base) | N3-a no; frente 2 (precio por unidad) | — |
| **COR-2** | Corregir cantidad / peso real con valorización «opción A» | **sí: requiere autorización expresa por base** | COR-1, stock | — |
| **PAGO-1** | Pago con importe; efectivo siempre desde caja abierta | **sí: requiere autorización expresa por base** | **frente 1 (caja)** | — |
| **N4-a** | Orden de compra sin aprobación + tolerancias (configura el gerente) + tres vías (conciliar) + diferencias con 4 resoluciones | **sí: requiere autorización expresa por base** | N3-b, perilla `conciliacion_de_tres_vias` (frente 4) | — |
| **N4-b** | Devolución ligada a la compra; pedido y carga de nota de crédito (reutilizando `NotaCreditoProveedor*`); anulación en cadena | **sí: requiere autorización expresa por base** | N4-a, N3-c | — |
| **N4-c** | Saldo a favor, aplicación, reintegro, cuenta corriente | **sí: requiere autorización expresa por base** | N4-b, PAGO-1; **lectura de `primitiva-de-libro-diseno.md`** | — |

Todas aditivas y reversibles (`down.sql` y `verificacion-previa.sql`), sin aplicar a ninguna base real. «Primero lo más barato»: nada de las etapas N4 se arranca hasta que el dueño use N3.

## Carril de escritura (declaración exacta)

**Rutas donde el frente 5 puede escribir en Fase 2 (propuesta):**
- `src/core/compras/**` (reglas puras de compras)
- `src/server/actions/movimientos/casos-de-uso/` **solo** los archivos de compras: `registrar-factura-proveedor.ts`, `aceptar-propuesta-de-factura.ts`, `anular-factura-proveedor.ts`, `corregir-factura-proveedor.ts`, `declarar-pago-de-factura-proveedor.ts`, `anular-pago-de-factura-proveedor.ts` y los nuevos `confirmar-recepcion-*`, `orden-de-compra-*`, `conciliar-*`, `nota-de-credito-*`, `credito-de-proveedor-*`
- `src/server/actions/movimientos/facturas-proveedor.ts`, `pagos-factura-proveedor.ts` (adaptadores finos) y nuevos adaptadores de compras
- `src/server/lecturas/compras/**` y `src/server/persistencia/compras/**` (nuevas, si hacen falta)
- `test/casos-de-uso/*` y `test/movimientos/*` de compras; `test/compras/**` (nuevo); el oráculo `docs/oraculo-combinaciones-compras-paridad-*.md`
- `docs/diseno-compras-paridad-*.md`

**Modelos de `schema.prisma` (cada frente edita solo los suyos y avisa):** `FacturaProveedor`, `FacturaProveedorRenglon`, `FacturaProveedorSucursal`, `FacturaProveedorPropuesta`, `FacturaProveedorPropuestaRenglon`, `AnulacionDeFacturaProveedor`, `PagoDeFacturaProveedor`, `AnulacionDePagoDeFacturaProveedor`, `NotaCreditoProveedor` (+ `Linea`, `Imputacion`, `Tributo`), y los modelos **nuevos** de N3-b/N4 (control de línea, orden de compra y su línea, tolerancia, diferencia, pedido de nota, crédito/destino/reintegro o su equivalente en el libro).

**Solo lectura para este frente (no escribe):** `Presentacion`, `ProveedorPorProducto`, `Unidad` y conversión (frente 2); `Proveedor` y la ficha/`Parte` (corriente Roles P1 Parte); `Operacion` y `MovimientoStock` (se **usan** por el motor existente, sin editar su modelo; si N3-c exige cambiar la validación de stock lo pide al orquestador general); catálogo de módulos y planes (frente 4); cajas (frente 1); `ConceptoDeGasto`, `ImputacionDeGasto`, planes y centros de costos (no pedidos).

**Zona restringida (se pide al orquestador general, por turno):** `src/core/permisos/acciones.ts` (activar `compra_recibir`, acciones nuevas), `src/core/textos/*`, numeración de migraciones, `test/aislamiento/m1-…`, `test/modulos/__golden__/*`, `test/arquitectura/caracterizaciones-congeladas.test.ts`, `knip.jsonc`, `.dependency-cruiser*.cjs`, `docs/registro-de-decisiones.md`, `package.json`.

## Dependencias con los otros frentes y corrientes

| Con | Qué necesita compras | Qué ofrece | Contrato propuesto (a acordar por mensaje) |
|---|---|---|---|
| 1 CAJA | Puerto de **egreso** por pago en efectivo desde caja abierta; luego puerto de **ingreso** por reintegro; error `SIN_SESION_ABIERTA`/`CAJA_NO_ABIERTA` | Id del pago/reintegro como origen del movimiento | Función `egresoDeCaja.registrar` / `ingresoDeCaja.registrar` con origen e idempotencia. Hoy no existe nada en Motor2. |
| 2 UNIDADES y CLASIFICACIÓN | Conversión exacta de la línea y presentación (`unidadCompraId`, factor); «precio por» al completar «Sin precio» | Líneas con `cantidadStock`, `precioPorUnidadStock` | Compras **consume**; no toca `Presentacion` ni `PRESENTACIONES_VISIBLES`. |
| 3 DATOS | Ids que genera la app, fechas con zona, «no se borra» desde la base, lista de caracteres permitidos en motivos/observaciones | — | Compras adopta lo que decida el frente 3 para modelos nuevos. |
| 4 PLANES y PERILLAS | `recepcion_separada` (N3), `conciliacion_de_tres_vias` (N4, requiere N3), interruptor del bloqueo de anulación en un paso (futuro); `exigirPerilla` | Nombres de las perillas y qué comando exige cuál | N3 y N4 se habilitan por perillas (`DDD:196`); mientras no existan, interruptor de empresa mínimo (pregunta 3). |
| 6 PANTALLAS | Bandeja «Por recibir», confirmar recepción, órdenes, diferencias, notas, cuenta corriente | Los casos de uso con su contrato | Las pantallas de compras las dibuja el frente 6 sobre la ficha declarativa. |
| Ocultar | — | — | Sin choque (otra zona). |
| Roles P1 Parte / Roles P2 | Que `compra_recibir`, `compras.configurar` y los permisos de saldo respeten «gerente/administrador» y los nombres visibles | — | Roles P2 `rolesPropiosMax` (nace 0): compras no crea roles. |
| Textos T2… | Textos de recepción, control, diferencias, saldo (23 ya aprobados en Pedernal sin clave) | — | Alta por catálogo T1 vía orquestador general. |

Mensajes a los vecinos (1, 2, 4, 6): se envían junto con el aviso de PR, por `send_message`, con la ruta/modelo exacto de este carril.

## Qué entra al producto

Nada: este PR es solo documentos. Todo lo de las etapas es PROPUESTA hasta que el dueño confirme los niveles 1 a 5; los únicos puntos CONFIRMADOS son los del nivel 1 de la escalera.

## Preguntas al dueño (una por vez; solo las que cambian modelo, dinero o permisos)

**Pregunta 1 (la que se hace ahora) — modelo de datos.** En Pedernal existe comprar y recibir **sin factura** (nivel simple). En Motor2 hoy toda compra es una factura (decisión del 2026-11-06). Para la recepción separada: **A) Motor2 mantiene «toda compra lleva factura»**; la recepción separada es esa misma factura con la mercadería «pendiente de recibir» hasta que gerente o administrador la confirma (cambio mínimo, la base ya lo soporta). **B) Motor2 agrega también la compra sin factura** (remito solo), con tablas nuevas de recepción como Pedernal. Recomendación: **A**.

Cola de preguntas (no se hacen todavía):
2. Pago: ¿el pago pasa a llevar **importe** (y pagos parciales) o sigue siendo «toda la factura»? Cambia dinero. Depende del frente 1.
3. Hasta que el frente 4 entregue las perillas: ¿N3 detrás de un interruptor por empresa que enciende solo el dueño? Cambia permisos/planes.
4. Notas de crédito: ¿se reutilizan las tablas `NotaCreditoProveedor*` que ya existen (recomendado) o se descartan y se arman las de Pedernal? Cambia el modelo.
5. Saldo a favor: ¿se espera a que se lea el «libro común de saldos» de Pedernal antes de decidir su forma? Cambia el modelo.
6. Permisos: ¿gerente **y administrador** destinan saldo, pagan y corrigen, como en Pedernal? Hoy en Motor2 `anular_compra`/`corregir_compra` son piso administrador y `declarar_pago_compra` piso operario (de empresa).
7. ¿Se confirma el estado de **COR-2 (valorización opción A)** pese a que Pedernal no la construyó todavía?

## Riesgos y pendientes

- La auditoría de Pedernal se hizo sobre un clon `--depth 1` y `git ls-remote`; 0063/0064/0065 no están en origin: su SQL real es **NO VERIFICADO**. Pedirlo al orquestador de Pedernal antes de la Fase 2.
- `primitiva-de-libro-diseno.md` no se leyó a fondo: condiciona N4-c.
- Citas literales del dueño de Motor2 (2026-10-12, 2026-11-03, 2026-11-06) no releídas: se citan por el documento que las registra.
- Contradicciones documentales de Pedernal (`EMITIDA` vs `PEDIDA`; ubicación de la tabla de tolerancias; siete vs cuatro resoluciones) quedan declaradas.
- El riesgo de C0 existe hoy en la base de Motor2: no corregido en este PR (solo documentos).

## Reglas cubiertas (en el diseño)

Concurrencia (cerrojos por estado y `FOR UPDATE` de cabecera), idempotencia (clave + huella en cada comando), atomicidad (stock/caja/comprobante todo o nada), aislamiento por empresa, autorización en servidor, dinero exacto en ARS, fechas de Argentina, trazabilidad sin borrado, validación con lista de permitidos, migraciones aditivas y reversibles sin aplicar. Detalle en la escalera, niveles 5, 7 y 10.

## Prueba que puede hacer el dueño sin leer código

Esta fase no cambia el sistema: **leé** `diseno-compras-paridad-escalera-2026-11-16.md` (niveles 1 a 5) y contestá la pregunta 1 con A o B; con eso se puede avanzar. Para ver el riesgo C0 en la pantalla real (sin aplicar nada): declará el pago de una compra en una copia de prueba y anulá esa compra; hoy el sistema lo deja pasar, y debería rechazarlo.
