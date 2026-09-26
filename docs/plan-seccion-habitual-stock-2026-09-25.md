# Plan: sección habitual por PV y resolución automática de la sección en el cierre del POS (Variante 5) — 2026-09-25

Rama `feat/seccion-habitual-stock`. Plan diseñado y verificado contra el código (solo lectura) por un agente de planificación,
confirmado por el dueño del producto, que autorizó expresamente las DOS migraciones (`SeccionHabitualProducto` y
`Seccion.sirveDeRespaldoEnVentas`). Implementado paso a paso, un commit por paso, con la suite completa en verde en cada uno.

## Problema

Al cerrar una cuenta del salón (`cerrarCuenta`, docs/plan-tomar-pedido-2026-09-25.md) había que elegir UNA sección de stock para
toda la mesa. Quien cobra no sabe de qué depósito sale cada insumo (la muzza está en Depósito, las bebidas en Barra), y una sola
sección para toda la cuenta deja saldos falsos: negativos en una sección y stock intacto en otra.

**Decisión (Variante 5):** el cierre no pide sección. Cada PV puede tener una **sección habitual** por sucursal; el núcleo de la
venta resuelve, insumo por insumo, de qué sección sale: primero la habitual, después las demás secciones activas que **sirven de
respaldo**, por vencimiento. Lo que falte queda en negativo (B6bis) en una sección determinada y se avisa y audita con su nombre.

## A. Lo encontrado en el código

- **H9 (bug real, dos casos):** en la venta, `resolverConsumoPorFamilia` (`src/core/movimientos/stock.ts`) leía el saldo de la base
  en cada línea y las filas se escribían todas juntas al final (`createMany`), sin llevar cuenta de lo ya asignado entre líneas. Con
  Muzza A (0,3, vence antes) y Muzza B (0,3), mismo insumo, y Pizza y Fugazzeta usando 0,25 de A cada una: la línea 1 toma A 0,25; la
  2 vuelve a ver A = 0,3 y toma A 0,25 → se piden 0,5 de A contra 0,3. En mostrador, RECHAZO FALSO (el insumo tiene 0,6); en el POS,
  AVISO FALSO (A en −0,2, B intacta). Con Pizza ×2 en una sola línea salía bien. El mismo patrón está en Producción
  (`src/server/actions/movimientos/movimientos.ts`): **no se arregla acá** (ver Pendientes).
- Ingredientes sin orden fijo (`include: { ingredientes: true }`): se agregó `orderBy: { id: "asc" }` para que el libro sea
  determinístico.
- Ya compatible con varias secciones por venta: `anularVenta` revierte cada movimiento en su propia sección; una Operación por línea;
  la boleta no muestra sección. «Ventas por sección» (`/reportes/ventas-por-seccion`) es de `SeccionCarta` (categoría del MENÚ), no de
  `Seccion` (stock): no se toca.
- `periodo.ts` acepta `filtros.seccionId` pero hoy no lo pasa nadie: el reporte de Período no necesita cambios (C7).
- Pantalla `/movimientos/secciones` (permiso `secciones`): tabla de alta/renombrar/activar con `FormConResultado`; lugar natural
  para el flag nuevo.

## B. Sub-decisiones

- **B1.** La venta de mostrador NO cambia de comportamiento visible: una sección elegida a mano y rechazo si falta stock. El núcleo
  tiene dos modos, `origen: { tipo: "seccion", seccionId } | { tipo: "automatico" }`; mostrador usa `"seccion"`, el cierre del POS
  `"automatico"`. El mostrador sí recibe el arreglo de H9 (mismo libro). El flag `sirveDeRespaldoEnVentas` no aplica al modo
  `"seccion"`.
- **B2.** Orden entre secciones de respaldo: por vencimiento a nivel de sección (el lote con disponible que vence antes, mirando
  toda la familia de hermanos del insumo), desempate más disponible primero, después nombre (`localeCompare("es")`). Dentro de cada
  sección: FEFO por lote (sin lote al final), desempate el producto de la receta antes que sus hermanos, después `productoId`.
- **B3.** El PV que se produce (stock propio) entra en la ubicación (cae en alguna sección) pero NO en la validación ni en los avisos
  de stock negativo — igual que antes (`test/stock/consolidado.test.ts:68` sin cambios; fijación equivalente del POS en
  `test/pos/cerrar-cuenta-origen.test.ts`). Validarlo es H4, próxima fase.
- **B4.** H9 se arregla como efecto necesario del libro de asignación, en los dos caminos de venta; no en Producción.
- **B5 (pregunta del dueño, respondida).** ¿Se pueden excluir secciones del respaldo automático? Hoy no hay ninguna que excluir,
  pero se quiere la herramienta: `Seccion.sirveDeRespaldoEnVentas Boolean @default(true)`. Todas las secciones, existentes y nuevas,
  siguen sirviendo de respaldo sin configurar nada. El flag SOLO decide si una sección se ofrece como RESPALDO; una sección con el flag
  en `false` que es la HABITUAL de un producto se sigue usando (la preferencia explícita manda).

## C. Diseño

- **C1.** Tabla nueva `SeccionHabitualProducto` (sucursal × producto → sección), no una columna en `DisponibilidadProducto` (ahí
  "fila ausente" ya significa "no disponible"; acá "fila ausente = sin preferencia", como `PrecioLocalProducto`/`StockMinimoProducto`).
  Análogo de ERPNext `Item Default → default_warehouse`. Solo PV, sin backfill. La pertenencia de la sección a la sucursal se valida en
  la acción y se filtra al leer (solo secciones activas de la sucursal).
- **C2.** Pantalla `/stock/seccion-habitual` (molde de `/stock/minimo`), permiso REUSADO `stock_minimo`. Acciones en
  `src/server/actions/stock/seccion-habitual.ts`; guard de formato en `src/core/features/seccion-habitual/seccion-habitual.guard.ts`;
  dato de solo lectura en la ficha del producto.
- **C3.** Núcleo puro `src/core/movimientos/origen-venta.ts`: `crearLibroDeStock`, `asignarConsumo`, `elegirSeccionDeStockPropio`,
  `faltantesDe`. Si nada alcanza: se consume todo lo disponible y SOLO el resto se carga al producto de la receta en la sección de
  faltante (con el lote de la última parte tomada ahí, o sin lote). Comparaciones redondeando a 4 decimales. Modo `"seccion"`:
  habitual = la fija, sin respaldos → idéntico a antes salvo H9.
- **C4.** Cargador `src/core/movimientos/origen-venta-datos.ts`: todo en lote (un `groupBy` de saldos). Sin secciones activas →
  «Esta sucursal no tiene ninguna sección activa: pedile a un admin que cree una.» (mensaje existente). Sección de REFERENCIA de un
  producto: la de su último movimiento entre las de respaldo (`groupBy` + `_max.creadoEn`, nunca `findMany distinct`). Error nuevo
  "sin respaldo" (antes de escribir): un PV sin habitual y ningún respaldo → «Ninguna sección de «X» sirve de respaldo automático en
  ventas y «Producto» no tiene sección habitual: configurá su sección habitual (Stock → Sección habitual) o marcá una sección como
  respaldo (Movimientos → Secciones).»
- **C5.** `registrarVentaEnTx`: `seccionId` → `origen`; la línea se valida igual que antes y devuelve lo que pide cada ingrediente;
  las secciones y lotes se asignan con UN libro para toda la venta. Fila VENTA: PV que se produce → la sección de su stock; PV común →
  la habitual, si no la del primer consumo, si no la de referencia; modo `"seccion"` → la fija. `faltantesDe` reemplaza a
  `requeridoPorClave` con el mismo formato de mensaje. CONSUMO y LIQUIDACION_CONSIGNACION en la sección de cada parte.
  `AvisoStockNegativo` suma `seccionId`/`seccionNombre`.
- **C6.** `cerrarCuenta(cuentaId)` sin segundo parámetro, modo automático + `permitirStockNegativo`. Auditoría por sección (enlazada al
  primer CONSUMO de ese producto EN esa sección). Mensaje `"Muzzarella" en «Cocina» (tenía 0,5, se consumió 1,5, quedó en -1)`.
  Diálogo sin `<select>`; texto «Cada producto se descuenta de su sección habitual; si ahí no alcanza, de otra sección con stock.».
  Sucursal de una sola sección: filas del Kardex IDÉNTICAS a elegirla a mano (fijado con un test).
- **C7.** Período: sin cambios de código. La VENTA va a la sección de la línea, cada CONSUMO a la suya (fijado con un test).
- **C8.** Compatibilidad: sin filas de habitual y el flag en `true` (día uno) = resolución automática pura. Mostrador, Producción,
  traspasos y seeds sin cambio visible (salvo H9 en mostrador). La transacción serializable lee más: `conTransaccionSerializable` ya
  maneja los reintentos.
- **C9.** Comentario de excepción junto a `exigeSeccion` (`src/core/movimientos/transiciones.ts`).
- **C10.** Flag en `/movimientos/secciones`: columna «Respaldo automático en ventas» (Sí/No + botón), línea de ayuda, acción
  `actualizarRespaldoSeccion` (`conPermiso("secciones")`, rechaza sección ajena).

## D. Migraciones (autorizadas)

- `20260925232936_seccion_habitual_producto` — tabla `SeccionHabitualProducto`, único `(sucursalId, productoId)`, FKs RESTRICT.
- `20260926000754_seccion_sirve_de_respaldo_en_ventas` — `Seccion.sirveDeRespaldoEnVentas BOOLEAN NOT NULL DEFAULT true`.

Las dos ADITIVAS, sin migración de datos. Generadas con `prisma migrate dev --create-only`; en ambas se sacaron a mano las cuatro
sentencias ajenas que Prisma agrega por la deriva conocida `Operacion_motivoId_fkey`/`Operacion_destinoId_fkey` (ver el encabezado de
`20260925152432_pos_tomar_pedido`).

## E. Pasos (commits)

1. `test(ventas): reproducir H9` — rojo real en el mensaje del commit, casos como `it.fails`.
2. `feat(ventas): núcleo puro de origen de la venta`.
3. `fix(ventas): registrarVentaEnTx resuelve el origen con el libro (modo sección fija)` — H9 en verde.
4. `feat(pos): cerrarCuenta resuelve la sección de cada insumo (sin preferencia)`.
5. (autorización de las migraciones: ya dada)
6. `feat(db): SeccionHabitualProducto`.
7. `feat(pos): el cierre prefiere la sección habitual del PV`.
8. `feat(stock): pantalla Sección habitual`.
9. `test(e2e): sección habitual`.
10. `feat(db): Seccion.sirveDeRespaldoEnVentas`.
11. `feat(pos): secciones excluibles del respaldo automático`.
12. `docs` (este documento, comentario C9, nota en plan-tomar-pedido B6).
13. Verificación final de punta a punta (tipos, lint, Vitest completo, build contra una base descartable nueva, E2E completo).

## Notas de implementación (lo que el plan dejaba abierto)

- **Partes juntadas:** `asignarConsumo` junta las partes del mismo (producto, sección, lote) en una sola: sin eso, un faltante en
  la misma sección y lote que lo tomado se escribía como dos filas de CONSUMO donde antes había una (y el test de "filas idénticas en
  una sola sección" no se cumplía).
- **Saldo negativo previo en un lote:** además del disponible por lote, nunca se toma más que el saldo TOTAL que queda del producto en
  la sección (un lote negativo resta). Así `asignarConsumo` y `faltantesDe` (que compara totales, como `validarStockSuficiente`)
  coinciden.
- **Sección del faltante:** la habitual; si no hay, la de referencia del INSUMO; si no, la de referencia del PV; si no, la primera de
  respaldo por nombre. (El insumo primero: la muzza que nunca se movió en «Barra» no debería quedar negativa en «Barra» solo porque la
  pizza nunca se vendió.)
- **Orden por nombre:** las secciones activas se ordenan con `localeCompare("es")` en JS (no con la intercalación de la base), igual que
  el desempate de B2.
- **Mensaje de rechazo con familia:** si el insumo con hermanos no alcanza, ahora se toma lo de los hermanos y el mensaje nombra solo
  lo que se le cargó al producto de la receta (antes cargaba todo el pedido a él). Sin hermanos, el mensaje es byte a byte el de
  siempre.
- **Diálogo de cierre:** en el paso 4 (todavía sin habituales) el texto fue «Cada insumo se descuenta de una sección con stock…»; el
  definitivo del plan entró con la pantalla de sección habitual (paso 8).
- **Axe en modo oscuro de `/stock/seccion-habitual`:** se audita `main`. El marco de la app (menú y encabezado, `text-neutral-500`
  sobre `#0a0a0a`, 4,17:1) ya fallaba el contraste en modo oscuro antes de esta pantalla (ver Pendientes).

## Pendientes explícitos (no se hacen acá)

- **H9 en Producción:** `resolverConsumoPorFamilia` (y `obtenerLoteMasProximoAVencer`) siguen leyendo la base en cada llamada; dos
  ingredientes/líneas de la misma producción que consumen la misma familia pueden pedir el mismo lote dos veces. Bug separado y
  anterior; la salida natural es usar el mismo libro de `origen-venta.ts`.
- **H4:** validar/avisar el stock PROPIO del PV que se produce (hoy puede quedar negativo sin aviso, en mostrador y en el POS).
- **Opción «Automático» en la venta de mostrador:** hoy el mostrador sigue con la sección elegida a mano.
- **Seeds de demo:** sembrar habituales desde `seccionDe()` de los seeds, para que la demo muestre la preferencia.
- **Contraste del marco de la app en modo oscuro** (menú de sección y encabezado `text-neutral-500`), encontrado al auditar la
  pantalla nueva: ajeno a este cambio.
