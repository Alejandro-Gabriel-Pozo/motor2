# Diseño: atribución de costos empresa → sucursal → unidad de negocio (2026-10-27)

Estado: **PROPUESTA** salvo lo marcado CONFIRMADA. Pedido del dueño (2026-10-27): «Tenés 2 atribuciones: una a sucursales y otra a unidad de negocio. Lo ideal es que quede pendiente de distribuir y que cada sucursal divida ese costo en sus unidades de negocio. Planificá con las escaleras y las preguntas what if. Considerá que todo viene de empresa, sucursal, unidad de negocio.» Se apoya en `docs/diseno-circuito-de-abastecimiento-2026-10-27.md` (§1.bis: tres ejes independientes), ADR-029 (factura repartida entre sucursales) y ADR-031 (centros de costos y distribución por versiones). Inventario hecho contra el código y el esquema reales, y contra `motor2-docs`.

## 0. Inventario: qué existe ya (validado contra `prisma/schema.prisma` y los ADR)
- **Atribución 1, empresa → sucursal:** `FacturaProveedor` (cabecera de empresa, estado `PENDIENTE_DE_REPARTO` o `CONFIRMADA`), `FacturaProveedorSucursal` (la parte de cada sucursal), `ImputacionDeGasto` (cuánto del renglón SIN_STOCK le toca a cada sucursal, con IVA computable). Para mercadería, el dinero de cada sucursal es el `precioTotal` de sus líneas del Kardex.
- **Atribución 2, sucursal → unidad de negocio:** `PlanDeCostos` (por ejemplo «unidades de negocio», de empresa), `CentroDeCostos` (las unidades: hotel, restaurante…, de empresa, sin padre en la v1), `PlanDeCostosSucursal` (en qué sucursales aplica el plan), `DistribucionCostoVersion` + `DistribucionCostoLinea` (la distribución de UNA imputación entre los centros, por versiones que solo se agregan; la vigente es la de número mayor).
- **Estados que ya modela ADR-031:** «sin asignar» (el plan aplica y no hay versión) = el *pendiente de distribuir* que pide el dueño; «vigente»; «no aplica».
- **Todo está aplicado en la base de `stockhneuquen` desde 2026-10-13 y ningún caso de uso lo escribe todavía** (Etapa C sin código). Lo que pide el dueño NO necesita tablas nuevas: necesita los casos de uso, los permisos, las pantallas y la bandeja.
- **Hueco real encontrado:** ADR-031 reparte la distribución con los puntos básicos como pesos. Con un monto como 2/3 de 3.000.000 los puntos básicos redondeados (6667/3333) no dan el monto tipeado (2.000.100/999.900). No hay CHECK que ate `porcentajeBp` con `importe` (verificado en las migraciones), así que se resuelve en el caso de uso, sin migración (ver nivel 5).

## 1. Propósito y alcance
- **CONFIRMADA:** saber cuánto le costó cada cosa a cada sucursal y, dentro de cada sucursal, a cada unidad de negocio, con independencia de qué cuenta pagó (el pago es otro eje).
- **CONFIRMADA (dueño, hoy):** dos pasos con dos dueños: la empresa (central) reparte entre sucursales; cada sucursal divide su parte entre sus unidades. Lo que falta distribuir queda **pendiente de distribuir**, visible y contable, nunca inventado.
- Alcance de esta etapa: gastos y servicios SIN stock (luz, alquiler, honorarios…). Mercadería: ver pregunta única al dueño (§11).
- Fuera de alcance: ingresos/ventas por unidad de negocio, sub-centros (jerarquía de centros), prorrateo automático por métrica, cierre de períodos.

## 2. Actores y contexto
- **Operador de central** (empresa): carga la factura y la reparte entre sucursales (piso `operador`, decisión del dueño del 2026-10-27).
- **Operador / encargado de sucursal:** distribuye la parte de SU sucursal entre sus unidades (PROPUESTA: piso `operador`, auditado).
- **Administrador:** corrige reparto y distribución ya hechos (siempre como versión nueva con motivo) y configura planes y unidades.
- **Dueño/gerencia:** lee costos por sucursal y por unidad; ve cuánto está «sin distribuir».
- Contexto: Argentina (UTC-3). La distribución rige desde `creadoEn` y vale para el período de `FacturaProveedor.fecha` (ADR-031). Las sucursales no ven las partes de otras (RLS por sucursal ya existente).

## 3. Casos de uso
1. **Repartir una factura entre sucursales** (empresa → sucursal): cada renglón SIN_STOCK genera una imputación por sucursal con importe exacto.
2. **Distribuir la parte de una sucursal entre sus unidades** (sucursal → unidad): crea la versión 1 con sus líneas.
3. **Corregir una distribución:** versión 2, 3… con motivo obligatorio (solo administrador).
4. **Ver la bandeja «Pendiente de distribuir»** de mi sucursal: imputaciones sin versión vigente, con antigüedad e importe.
5. **Leer** costo por sucursal y por unidad, con una fila explícita «Sin distribuir».
6. **Activar/desactivar un plan en una sucursal** (administrador).
7. **Anular la factura** y **registrar una nota de crédito** sobre un gasto ya distribuido (ver «¿qué pasa si…?»).

## 4. Conceptos y ciclo de vida
- **Imputación** (sucursal): `ImputacionDeGasto`, inmutable (solo INSERT). Nace al repartir la factura.
- **Distribución** (unidad): `DistribucionCostoVersion` por (imputación, plan, número) + líneas por centro. Estados derivados, no guardados: `sin asignar` → `vigente (v1)` → `vigente (v2…)`; `no aplica` si el plan no aplica en la sucursal.
- **Factura:** `PENDIENTE_DE_REPARTO` → `CONFIRMADA` → anulada (columnas de anulación). Una factura pendiente de reparto no tiene imputaciones, por lo tanto no genera pendiente de distribuir.
- Ciclo: carga → reparto (central) → bandeja de la sucursal → distribución → (corrección). Nada se borra.

## 5. Invariantes y políticas
- I1. Σ importes de las imputaciones de un renglón = su `precioTotal` (exacto, centavos); Σ IVA computable = su `importeIvaComputable`. (Caso de uso; la base no lo expresa sin disparador.)
- I2. Σ importes de las líneas de una versión = el importe de la imputación; Σ IVA computable igual; Σ puntos básicos = 10000. Un centro con puntos básicos > 0 puede quedar en 0,00 por redondeo (lo acepta la base).
- I3. **Regla de dinero (corrección sobre ADR-031/029):** cuando la persona tipea **importes**, esos importes son los pesos de `repartirImporte` (en centavos) y se guardan tal cual; el `porcentajeBp` queda como intención redondeada (Σ ajustada a 10000 por mayor residuo). Cuando tipea **porcentajes**, los pesos son los puntos básicos. Pruebas: 3.000.000 = 2.000.000 + 1.000.000; 100 = 33,33 + 33,33 + 33,34.
- I4. Una sucursal solo distribuye imputaciones de SU sucursal y con un plan que aplica allí y esté activo, con centros activos del mismo plan (la base ya impone lo del plan).
- I5. Nada de mercadería en esta etapa (la base lo impide: FK con discriminador `SIN_STOCK`).
- I6. «Pendiente de distribuir» **nunca se rellena solo**: si la sucursal no distribuye, el reporte muestra la fila «Sin distribuir» con su importe, y las sumas por sucursal siguen cerrando contra la imputación.
- I7. Permisos (PROPUESTA): `distribucion_costos` (sucursal) piso **operador** para la versión 1; una clave aparte, `distribucion_costos_corregir` (sucursal, piso administrador), para la versión ≥ 2; `centros_costos` (empresa, administrador) para planes y unidades; `reporte_gastos_por_unidad` (sucursal). Hoy las tres claves reservadas tienen piso administrador y no están en `ACCIONES`: el cambio de piso es de código, sin migración.
- Escalera de producto (peldaños acumulativos, lo cargado no se rompe): **U0** sin unidades (hoy); **U1** distribución manual por gasto, con bandeja de pendientes; **U2** regla sugerida por (sucursal, concepto) que **pre-llena** la pantalla sin guardar (se confirma con un toque; si no hay regla, «pendiente de completar»); **U3** confirmación en lote de varios pendientes con la misma regla; **U4** prorrateo por métrica (m², consumo) y sub-centros, más adelante.

## 6. Historia y persistencia
- Sin tablas nuevas para U1: se usan las cinco de ADR-031 y las de ADR-029. Idempotencia por clave única global ya existente en la versión y en la factura.
- **U2 (regla sugerida)** sí necesitaría una tabla nueva (regla por sucursal + concepto + plan con sus pesos): se diseña después de U1, con su propia migración aditiva y autorización expresa. No se migra nada hoy.
- Auditoría: reparto y cada versión registran actor, fecha y motivo (la versión ≥ 2 exige `motivo`, CHECK existente); los cambios de `aplica` se auditan.

## 7. Atomicidad y concurrencia
- Repartir una factura: cabecera, partes e imputaciones en **una sola transacción SERIALIZABLE**; error en una sucursal ⇒ no queda nada.
- Distribuir: versión + líneas en la misma transacción; `numero` = vigente + 1 calculado en la transacción; el único `(imputación, plan, numero)` elige una sola ganadora; la perdedora recibe «otra persona distribuyó este gasto, recargá» y no escribe.
- Idempotencia: clave generada por la pantalla; reenviar la misma devuelve la versión ya creada, sin duplicar.
- Cambiar `aplica` de un plan: se rechaza (mostrando el conteo) si la sucursal ya tiene gastos con ese plan.

## 8. Acceso e interfaces
- Central: «Cargar factura» ya contempla el reparto entre sucursales (importes o %). Sin pasar por traspaso.
- Sucursal: bandeja **«Pendiente de distribuir»** (lista con importe, concepto, proveedor, antigüedad) → pantalla «Distribuir» con las unidades del plan y total por completar; botón «Guardar» deshabilitado hasta que cierre el total.
- Administración: planes y unidades (ABM), aplicabilidad por sucursal.
- Siempre del servidor: quién pide, qué sucursal, qué permiso. Nada se confía al navegador.

## 9. Consultas y experiencia
- Costo por sucursal: suma de imputaciones (con mercadería aparte, por stock). Costo por unidad: suma de líneas de las versiones vigentes **más** la fila «Sin distribuir» por sucursal, de modo que la suma de unidades + sin distribuir = total de la sucursal.
- Vistas: por sucursal, por unidad dentro de una sucursal, y de empresa (suma de sucursales). Período por `FacturaProveedor.fecha`.
- Lo que no se sabe se muestra «pendiente de completar», con contador en el menú de la sucursal.
- Ingresos/ventas por unidad: **NO VERIFICADA**, queda fuera; el punto de extensión es que la unidad de negocio de una venta saldría del punto de venta.

## 10. Pruebas, migración y operación
- Migración: **ninguna para U1** (todo está aplicado). Código nuevo: casos de uso, guardas, claves en `ACCIONES`, pantallas, lecturas, bandeja.
- Pruebas obligatorias: repartir 3.000.000 en 2.000.000 + 1.000.000 exacto; mismo clic dos veces (una sola versión/ un solo reparto); dos operadores distribuyen a la vez (una ganadora, la otra recibe aviso); distribución con importes que no suman (rechazo, cero filas); plan que no aplica en la sucursal; sucursal ajena (denegado); cambio de permiso entre abrir y guardar (se rechaza en el servidor); factura anulada; consulta de coherencia (sumas) en cero; mutaciones (mutar → rojo → revertir → verde) para I1, I2, I3.
- Operación: la consulta de coherencia de `docs/deploy-con-migraciones.md` corre después de cada despliegue que toque esto.

## ¿Qué pasa si…? (por comando)

| Situación | Repartir factura (empresa → sucursales) | Distribuir a unidades (sucursal) |
|---|---|---|
| **Repetición** (doble clic, reintento) | Misma clave de idempotencia ⇒ devuelve la factura ya creada; el índice único (empresa + proveedor + número) impide otra | Misma clave ⇒ devuelve la versión creada; sin versión duplicada |
| **Concurrencia** | Dos cargas del mismo comprobante: una gana, la otra recibe «ya está cargada» | Dos operadores sobre la misma imputación: gana una versión, la otra recarga (único por número) |
| **Tiempo** | El período sale de `fecha` de la factura, no de cuándo se reparte | Distribuir tarde no cambia el total de la sucursal, solo cómo se parte; hasta distribuir figura «Sin distribuir» (provisorio) |
| **Incertidumbre** (no sé cómo partirlo) | Queda `PENDIENTE_DE_REPARTO` en central; no genera costo por sucursal todavía | Se deja pendiente; nadie lo completa por la sucursal |
| **Reintento tras corte de red** | Todo o nada (transacción); al reintentar con la misma clave no duplica | Igual |
| **Error parcial** | Falla una sucursal (ej. sin permiso de compra) ⇒ no se crea nada | Falla una unidad (inactiva) ⇒ no se crea nada |
| **Datos faltantes** | Falta proveedor, renglón sin concepto ⇒ rechazo con mensaje | Falta una unidad o no cierra el total ⇒ botón deshabilitado y rechazo en el servidor |
| **Cambio de permisos** | Se revalida en el servidor al guardar; si perdió el permiso, se rechaza | Ídem; la corrección (v≥2) exige la clave de administrador |
| **Anular la factura** | Anulación entera y atómica; bloqueada si lo recibido ya se consumió | Las distribuciones quedan como historia y las lecturas las excluyen por estado de la factura |
| **Nota de crédito sobre gasto distribuido** | Se reparte con su propio importe por sucursal | PROPUESTA: la parte de cada sucursal se acredita en la **misma proporción de la distribución vigente**; si no hay distribución, queda pendiente. Se decide en la etapa de notas de crédito |
| **Plan desactivado/no aplica a la sucursal** | — | El estado es «no aplica» (no «pendiente»); no aparece en la bandeja |
| **Sucursal cerrada o sin operador** | Central puede repartir igual; el costo ya queda imputado | Queda pendiente; central ve el aviso «sucursal con X pendientes»; el administrador puede distribuir |

## 11. Una pregunta clave para el dueño (cambia el modelo)
**¿La mercadería también se atribuye a unidad de negocio? ** Hoy ADR-031 la excluye: el costo de la mercadería sigue al stock de la sucursal.
- **Recomendación:** no distribuir mercadería al comprar. La unidad de negocio de la mercadería sale de **dónde se consume** (sección de stock o destino de consumo por unidad), no de una distribución de la compra. Evita repartir lo que después se consume en otro lado y no cambia el modelo.
- Alternativa: distribuir la compra por unidad al recibirla. Exige abrir la regla de ADR-031 (mercadería fuera por construcción) y una tabla/columna nueva.

## 12. Plan por etapas (sin tocar tablas hasta que esté confirmado)
- **E3a/E4 (ya planificadas):** reparto entre sucursales y gastos sin stock, con importes exactos y reparto a nivel operador.
- **E8a (nueva, sin migración):** distribución por unidad **U1**: casos de uso, claves `distribucion_costos` (operador) y `distribucion_costos_corregir` (administrador), bandeja «Pendiente de distribuir», pantallas y lecturas «costo por unidad con Sin distribuir».
- **E8b (con migración, requiere autorización expresa):** U2, regla sugerida por (sucursal, concepto).
- Verificación al cerrar cada etapa: los 8 comandos del gate en la misma corrida, con línea de base de conteos.
