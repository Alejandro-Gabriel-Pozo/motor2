# Diseño: a qué unidad de negocio (hotel o restaurante) va cada compra y cada servicio — 2026-11-11

Estado: **niveles 1 a 5 en revisión del dueño**. Solo diseño: sin código y sin migración. Estados: **CONFIRMADA** (lo dijo el dueño, con fecha), **PROPUESTA**, **PENDIENTE**, **NO VERIFICADA**. Leído contra `main` a0ca384f y `motor2-docs`. Antecedentes que se reutilizan: `docs/diseno-atribucion-de-costos-sucursal-y-unidad-2026-10-27.md` (atribución empresa → sucursal → unidad de negocio; tablas aplicadas en `stockhneuquen` desde el 2026-10-13, sin ningún caso de uso que las escriba), `motor2-docs/_planes/plan-distribucion-de-costos-y-servicios.md` (v4), `docs/adr/ADR-031` (distribución por versiones) y `docs/diseno-compras-servicios-y-bienes-2026-11-03.md`.

## 0. Resumen para el dueño (lenguaje de proceso)
1. Tu pedido tiene tres partes: (a) cada producto dice adónde va normalmente (restaurante, hotel o los dos); (b) en una compra de un producto que va a los dos se anota cuántas unidades van a cada uno; (c) cada servicio (reparación, mantenimiento) se anota al restaurante o al hotel. Con eso salen los reportes por unidad.
2. **CONFIRMADA (2026-11-11):** es **solo reparto del gasto**, con **un solo stock por hostería**. No hay stock separado por unidad.
3. Los **servicios** ya tienen su lugar en la base; falta construir la carga y la pantalla de reparto. **Sin migración.**
4. Para los **productos** no hay dónde guardarlo. Hacen falta dos tablas nuevas: **requieren tu autorización expresa**, cada una por separado y base por base.
5. **Todo nace cerrado:** un producto sin destino queda «pendiente de completar»; una compra sin reparto queda «pendiente de distribuir», en una bandeja; nunca se asume 50/50.
6. Las cuentas son exactas al centavo y nada se pisa: una corrección es una versión nueva con motivo.
7. Cambiar el destino habitual de un producto solo afecta compras futuras.

## 1. Nivel 1. Propósito, necesidad y alcance
- **Necesidad (CONFIRMADA, 2026-11-11):** «para sacar reportes tenemos que juntar más información. Incluso de los productos. Este producto siempre va a restaurante o a veces se vende en el hotel. Si va a los dos, bueno, cuando sea una compra que se determine cuántos van a hotel y cuántos van a restaurante. Lo mismo si realizó un servicio de mantenimiento o de reparación de algo. Fue reparación de un equipo del restaurante o del hotel. Así se dividen los gastos.»
- **Modelo (CONFIRMADA, 2026-11-11):** «Solo gasto, un solo stock por hostería» (respuesta a: dividir solo el gasto con un solo stock por hostería, o stock separado por unidad).
- **Respuesta a una pregunta abierta de octubre:** la atribución del 2026-10-27 dejó la mercadería fuera de alcance y recomendó no distribuirla al comprar; el pedido de hoy contesta lo contrario: la mercadería se reparte en la compra, por cantidad. CONFIRMADA.
- **Alcance:** destino habitual del producto; reparto de unidades y costo en la compra de un producto que va a los dos; imputación de un servicio a una unidad; ver lo pendiente y corregirlo; reporte de costo por unidad.
- **Fuera de alcance (lo no pedido queda como pregunta):** ventas o ingresos por unidad (P2); stock separado por unidad (descartado por el dueño); destino habitual distinto por sucursal (P4); porcentaje por defecto para «los dos»; regla sugerida por concepto de gasto; IVA computable por unidad en la mercadería; reparto de la Central entre hosterías.

## 2. Nivel 2. Actores y permisos (PROPUESTA)
| Actor | Qué hace | Permiso que se reutiliza |
|---|---|---|
| Quien mantiene el catálogo | Fija el destino habitual de un producto | `producto_editar` (pregunta P5: ¿operario o administrador?) |
| Operario que compra (solo su sucursal) | Reparte las unidades de su parte al cargar la compra, o las deja pendientes | `proceso_compra` |
| Operario de la sucursal destino | Reparte su parte al aceptar una factura repartida | `proceso_compra` |
| Operario de la sucursal | Completa lo pendiente desde la bandeja | `distribucion_costos` (sucursal; hoy reservada, piso operador propuesto) |
| Administrador | Corrige un reparto ya hecho (versión nueva con motivo); configura plan y unidades | `distribucion_costos_corregir`, `centros_costos` |
| Dueño o gerencia | Lee el costo por unidad | `reporte_gastos_por_unidad` (reservada) |

Los módulos `gastos` y `centros_de_costos` están «en desarrollo» (`src/core/modulos/catalogo.ts:37,39`): mientras sigan así nada de esto se ve. Cada autorización se decide en el servidor; rigen el alcance por sucursal (ADR-028) y el RLS por empresa.

## 3. Nivel 3. Casos de uso
1. Definir el destino habitual de un producto (una o varias unidades activas del plan «Unidad de negocio»; «los dos» = tildar las dos; sin elegir = pendiente de completar).
2. Comprar mercadería con reparto de unidades (por renglón y por la parte de la sucursal que carga). Un solo destino: se muestra «Restaurante: todas (destino habitual)», editable (P3). Los dos: se piden las dos cantidades y ningún número viene escrito. Sin destino: a mano o pendiente. La compra **no se traba** por lo pendiente.
3. Aceptar la parte de otra sucursal con su reparto (dentro de la aceptación existente).
4. Cargar un servicio con su imputación (U1 del diseño del 2026-10-27, sin tablas nuevas; depende de que exista la carga de servicios).
5. Ver lo pendiente en una bandeja por sucursal (servicios sin distribuir; renglones de mercadería con unidades pendientes) y, en catálogo, «productos sin destino habitual».
6. Corregir: versión nueva del reparto con motivo; la anterior queda como historia.
7. Reporte de costo por unidad, con la fila «Sin distribuir»: Σ unidades + sin distribuir = total de la sucursal.

## 4. Nivel 4. Conceptos y ciclo de vida
- **Destino habitual (PROPUESTA):** conjunto de unidades (centros del plan) adonde va normalmente un producto. Es una **sugerencia para la compra**, nunca atribuye dinero por sí solo. Las unidades son datos de la empresa, nunca un valor fijo en código (decisión del 2026-10-08).
- **«Los dos» sin porcentaje:** en cada compra hay que decir cuántas van a cada una. Las funciones de reparto existentes parten en partes iguales si todos los pesos son cero (`src/core/moneda.ts:130-133`, `src/core/compras/reparto-de-factura.ts:38,43`): el código nuevo debe rechazar ese caso antes de llamarlas.
- **Reparto de unidades (PROPUESTA):** por la parte de **una sucursal** en un renglón de mercadería; guarda por unidad la cantidad en unidad de stock y el importe con IVA; lo que falta es «pendiente de distribuir»; va por versiones que solo se agregan, como `DistribucionCostoVersion`.
- **Lo imputado vs. el destino habitual:** el reparto se **copia** en la compra; cambiar el destino del producto no reinterpreta ninguna compra.
- **Estados de un renglón frente al plan:** «no aplica» (el plan no aplica en la sucursal, como la Central), «pendiente de distribuir», «distribuido».
- **Productos ya cargados:** todos «pendiente de completar», sin relleno. Las compras anteriores muestran su mercadería como «sin distribuir por unidad».
- **Servicios:** no tienen producto; la unidad se elige en cada gasto.

## 5. Nivel 5. Invariantes
| # | Regla | Estado |
|---|---|---|
| I1 | Para cada (renglón, sucursal): Σ cantidades por unidad + pendiente = cantidad de esa parte, en pasos enteros de la unidad de stock; nunca se pasa de lo comprado | PROPUESTA |
| I2 | El importe se reparte exacto al centavo con `repartirImporte`, con las cantidades (incluido el pendiente) como pesos: Σ importes + sin distribuir = `precioTotal` de esa parte. Ejemplo: 3 botellas por $10.000, 2 al hotel y 1 al restaurante: $6.666,67 y $3.333,33 | PROPUESTA |
| I3 | Servicios: rigen sin cambios I1 a I3 de la atribución del 2026-10-27 | PROPUESTA ya escrita |
| I4 | Solo se agrega: sin UPDATE ni DELETE de dinero; corregir = versión nueva con motivo; el cambio de destino queda auditado | PROPUESTA |
| I5 | El reparto **no mueve stock**: no escribe `MovimientoStock` ni `Operacion`; valuación, costo de reposición y ratio no cambian | **CONFIRMADA (2026-11-11, un solo stock por hostería)** |
| I6 | Nace cerrado: sin destino ⇒ pendiente; «los dos» ⇒ sin números precargados; nunca se llama al reparto con todos los pesos en cero | CONFIRMADA (regla del 2026-11-11) |
| I7 | Una sucursal solo reparte su parte, solo con unidades activas de un plan que aplique en ella; RLS por empresa | PROPUESTA |
| I8 | Dinero exacto, decimal en centavos, nunca coma flotante; la pantalla muestra la misma cuenta del servidor | PROPUESTA |
| I9 | Lo no pedido no entra (ventas por unidad, stock por unidad, porcentaje por defecto, destino por sucursal) | CONFIRMADA |

## 6. Alternativas (de la más barata a la más cara)
| Alt. | Qué es | Cubre | Migración |
|---|---|---|---|
| **A** | Reutilizar `ImputacionDeGasto` + `DistribucionCostoVersion/Linea` + `PlanDeCostosSucursal` para los **servicios**; la mercadería aparece en el reporte como «sin distribuir por unidad» | (c) entero; (a) y (b) como pendiente visible | **Ninguna** |
| **B1** | Tablas nuevas «reparto de unidades de mercadería» (versión + líneas por unidad, con cantidad e importe), espejo de ADR-031 | (b) | **REQUIERE AUTORIZACIÓN EXPRESA** |
| **B2** | Tabla nueva «destino habitual» (producto, unidad del plan); cero filas = pendiente de completar | (a) | **REQUIERE AUTORIZACIÓN EXPRESA** (va después de B1: antes nadie la leería) |
| Descartadas | Columna `destinoHabitual` HOTEL/RESTAURANTE/AMBOS en `Producto` (fija unidades en código); abrir `ImputacionDeGasto` a la mercadería (rompe «mercadería fuera por construcción» de ADR-031); usar la sección habitual como destino (no expresa «los dos») | — | — |
| C | Stock por unidad | — | **DESCARTADA por el dueño el 2026-11-11** |

Reglas para B1 y B2 (separadas, base por base, nunca en producción sin autorización): aditivas, con `down.sql` que aborta si hay datos, sin relleno, RLS por empresa y política de sucursal, guardianes de solo-agrega y de «sin fila = pendiente de completar». Un ADR nuevo dejará dicho que la mercadería ahora se reparte por unidad sin tocar ADR-031. El detalle de las tablas (nivel 6) se escribe recién después de que el dueño confirme los niveles 1 a 5.

**Quién lee cada dato nuevo:** el reparto (B1) lo lee el reporte de costo por unidad, la bandeja y la consulta de coherencia; el destino habitual (B2) lo lee la pantalla de compra y la lista «productos sin destino».

## 7. «¿Qué pasa si…?»
| Situación | Resultado |
|---|---|
| Repetición o doble clic | La clave de idempotencia de la factura, la aceptación o la versión devuelve lo ya hecho |
| Concurrencia: dos compras del mismo producto a la vez | Independientes: cada una lee el destino en su transacción y guarda su reparto; no hay contador compartido |
| Concurrencia: dos personas completan el mismo pendiente | Gana una (único por número de versión); la otra recarga |
| Tiempo: cambia el destino habitual | No toca compras pasadas |
| Incertidumbre: no se sabe cuántas van a cada lado | Queda pendiente; la compra entra igual; nadie completa por la sucursal |
| Reintento tras corte / error parcial | El reparto va en la misma transacción SERIALIZABLE que la compra; todo o nada; un renglón con más unidades que las compradas rechaza la compra entera |
| Datos faltantes: producto sin destino | Aparece en «sin destino»; se pide el reparto a mano o queda pendiente; nunca 50/50 |
| Plan sin unidades o que no aplica (Central) | «No aplica»; no está en la bandeja |
| Cambio de permisos | Se revalida en el servidor en cada guardado |
| Se anula la factura | El reparto queda como historia y los lectores lo excluyen |
| Se corrige un renglón de factura | Si la cantidad no cambió, el reparto vigente se copia; si cambió, queda «pendiente de distribuir» |
| Se desactiva una unidad | Deja de ofrecerse; las versiones viejas siguen valiendo |

## 8. Combinaciones (oráculo en papel, nivel 10 adelantado)
Dimensiones: destino habitual (pendiente / solo restaurante / solo hotel / los dos) × naturaleza del renglón (mercadería / servicio) × reparto (completo / parcial / vacío) × plan en la sucursal (aplica / no aplica) × factura (vigente / anulada). Reglas esperadas: solo un destino ⇒ 100 % a esa unidad; los dos con reparto completo 2/1 de $10.000 ⇒ $6.666,67 y $3.333,33 (Σ = $10.000,00); parcial ⇒ lo repartido + «sin distribuir», en la bandeja; vacío ⇒ todo «sin distribuir», nunca 50/50; plan que no aplica ⇒ «no aplica»; factura anulada ⇒ excluida del reporte y de la bandeja; servicio completo ⇒ las líneas de distribución suman la imputación. Prueba: exhaustiva sobre esta tabla más propiedades con `fast-check` para I1 e I2; un guardián que falla si aparece una dimensión nueva sin declarar.

## 9. Etapas (un PR cada una; el código lo escribe Sonnet)
- **E0 (docs):** este diseño; nota en `diseno-atribucion…` §11 diciendo que la pregunta de la mercadería quedó contestada el 2026-11-11; borrador del ADR de mercadería por unidad.
- **E1 (sin migración):** carga de renglones de servicio con su imputación por sucursal (E4 del plan v4; hoy ningún código la escribe).
- **E2 (sin migración):** U1 de servicios: casos de uso, claves `distribucion_costos` y `distribucion_costos_corregir`, alta del plan y las unidades, bandeja.
- **E3 (sin migración):** reporte «Costo por unidad»: servicios por unidad y la mercadería entera como «sin distribuir por unidad». Con esto ya se puede empezar a usar.
- **E4 [MIG, REQUIERE AUTORIZACIÓN EXPRESA]:** B1, reparto de unidades de mercadería.
- **E5 [MIG, REQUIERE AUTORIZACIÓN EXPRESA]:** B2, destino habitual del producto.

Paso FINAL obligatorio en cada etapa, sobre la suite TOTAL y en la MISMA corrida, todo limpio: `npx tsc --noEmit`, `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto`, `npm test`, `npm run build`, `npm run plataforma:build`, `npm run test:e2e`; línea de base antes de tocar nada; en las etapas con migración, `up` y `down` contra Postgres real y la consulta de coherencia de `docs/deploy-con-migraciones.md` en cero; pruebas nuevas con mutación demostrada (mutar → rojo → revertir → verde) para I1, I2 e I6.

## 10. Preguntas abiertas (PENDIENTES, de a una)
- P2. «A veces se vende en el hotel»: ¿querés ver también las **ventas** por unidad, o por ahora solo los gastos?
- P3. Si un producto es «solo restaurante», ¿quien compra puede mandar alguna unidad al hotel en esa compra, o tiene que cambiar primero el destino del producto?
- P4. ¿El destino habitual es el mismo en todas las hosterías, o puede cambiar por sucursal?
- P5. ¿Quién fija el destino del producto: cualquiera que edite productos, o solo un administrador?
- P6. ¿Autorizás las dos migraciones (E4 y E5), cada una por separado y base por base?
- P7. Los códigos de las unidades en tu otro sistema (D-CODIGO-UN del plan v4).

## 11. Hallazgos aparte (vistos, sin tocar)
1. La pantalla de compra nace con una sección elegida (preselecciona la primera: `panel-compra-por-pasos.tsx:150`, `panel-movimiento-form.tsx:86`): choca con «todo nace cerrado».
2. `repartirImporte` y `repartirEnteros` parten en partes iguales con todos los pesos en cero: un valor por defecto que abre.
3. No existe escritor de servicios: la factura solo escribe renglones `MERCADERIA` (`src/server/persistencia/compras/escribir-factura-proveedor.ts:68`); ningún código de producción escribe imputaciones ni distribuciones; la columna `mesDeImputacion`, autorizada el 2026-11-04, tampoco está en el esquema.
4. NO VERIFICADO: si en la base de `stockhneuquen` ya existen filas del plan «Unidad de negocio» y los centros HOTEL y RESTAURANTE; se mira en solo lectura antes de E2.
