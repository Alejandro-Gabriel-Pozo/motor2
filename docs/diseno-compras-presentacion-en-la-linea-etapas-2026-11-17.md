# Propuesta de etapas — «presentación en la línea de compra, como Pedernal» (2026-11-17)

Estado: PROPUESTA para revisión del orquestador. Solo documento: sin código ni migración. Reemplaza el criterio de «no construir d1 a d5» de `docs/diseno-presentacion-en-la-linea-de-compra-2026-11-15.md`, que se apoyaba en una lectura de Pedernal que hoy no vale. Fuente de los hechos: `docs/oraculo-de-compras-y-presentaciones-contra-motor2-2026-11-17.md` (Frente 2, ejecutado contra Postgres real) y el oráculo de Pedernal (`ZuluHub-docs` `11-especificaciones/oraculo-de-casos-de-compra-y-presentaciones.md`, 17/11/2026, origin/main). Lo no verificado está marcado.

## 1. Por qué se retoma
- **CONFIRMADA (dueño, 2026-11-13, chat con el orquestador):** «El de Pedernal: presentación por producto (Recomendada)»: «caja x6» y «caja x12» son dos presentaciones del mismo producto; la oferta del proveedor apunta a la presentación. **CONFIRMADA (2026-11-14):** «Rechazarlo y pedir otro nombre (Recomendada)».
- La decisión del 2026-11-15 de NO construir d1 a d5 se tomó porque «Pedernal no compra por presentación». El oráculo de Pedernal del 17/11 dice lo contrario: hoy compra por presentación (un producto, varias presentaciones con nombre, cantidad fija y marca de peso variable; oferta por (proveedor, producto, presentación); la línea elige presentación o unidad de compra; ERP `migraciones/0037_compras.sql:138-176`, `calcular-linea.ts:26`). El orquestador reconoció que su lectura del 15/11 era incorrecta o vieja. Con la regla de paridad (2026-11-13) la premisa de la no-construcción cae; la decisión de fondo del dueño (13/11 y 14/11) sigue en pie y no se revocó.
- No se pregunta al dueño de nuevo: lo pedido y confirmado es «como Pedernal». Lo que sí queda a su criterio es la PRIORIDAD (ver §6).

## 2. Qué cubre hoy Motor2 y qué no (del oráculo del Frente 2)
| Caso | Hoy | Falta |
|---|---|---|
| C1 caja ×6 | Cubre (unidad de compra + factor en el producto) | Trampa C1 negativo: una unidad tecleada que no es presentación se ignora en silencio |
| C2 varias formas de un mismo producto | Con unidad+factor por producto no se puede (42 u en vez de 23); con presentaciones ya cargadas sí (23) | `nombre` inalcanzable desde la app; misma unidad dos veces se rechaza (`PRESENTACION_AMBIGUA`) |
| C3 dos proveedores | Cubre | — |
| C4 caja ×6 vs ×8 | No con la unidad compartida | La línea debe decir a qué presentación se refiere |
| C5 precio por presentación o por unidad | Parcial: costo correcto con precio total; un `precioUnitario` se acepta y guarda total 0 y costo 0 sin aviso | Rechazar lo desconocido; tipo de precio |
| C6 kg → g | Cubre con factor por producto; otra dimensión se acepta; no exacta se redondea en silencio; C6 negativo entra 2 g en vez de 2 kg | Conectar `convertirCantidadExacta` |
| C7 peso variable | Parcial: con `pesoReal` entra el real; sin él entra el aproximado sin error; la marca `pesoVariable` se ignora | Peso real obligatorio con la marca |
| C8, C9, C10, C11 | C8 y C9 cubren (Motor2 tiene más que Pedernal en C9); C10 no cubre (igual que Pedernal); C11 parcial | Fuera de alcance (C10 sin diseño; código de barras no pedido) |

## 3. Etapas propuestas (más barata y segura primero; cada una es un PR)
**P0 — Corrección de seguridad (EN CURSO, encargo del orquestador 2026-11-17; sin migración).** La compra y la devolución a proveedor se rechazan sin escribir cuando la unidad tecleada no es presentación activa, ni la unidad de compra del producto, ni la de stock, ni una conversión exacta de la misma dimensión (`convertirCantidadExacta`). Cubre: C1 negativo, C6 negativo, C6 (otra dimensión y no exacta). Falla cerrado. Rama `fix/compras-unidad-tecleada-rechazo`.
**P1 — Cerrar otro silencio, sin migración (a confirmar el alcance con el orquestador):** una línea con `precioUnitario` hoy se acepta y guarda total 0 y costo 0. Rechazar toda clave de precio no reconocida en la línea (lista de permitidos). Cubre la parte de seguridad de C5 (no el tipo de precio).
**P2 — Peso variable obligatorio, sin migración:** con una presentación activa marcada `pesoVariable`, la compra exige `pesoReal` y usa ese valor; sin él se rechaza. Las columnas ya existen (`schema.prisma:778`, sin uso). Cubre C7 completo. Dependencia: para que la marca pueda ponerse desde la app hace falta P3.
**P3 — Escritor de presentaciones con nombre y peso variable (hoy «etapa b»), sin migración:** el alta y la edición exponen `nombre` y `pesoVariable` (columnas existentes de la etapa a), con el rechazo «Ya existe una presentación con ese nombre y otra cantidad. Usá otro nombre.» (texto aprobado T8, 2026-11-14) y control de versión. Cubre C2 (nombres) y habilita C7. Detrás de `PRESENTACIONES_VISIBLES` (apagado).
**P4 — La línea de compra dice la presentación (d1, CON migración aditiva):** `MovimientoStock.presentacionId` opcional (FK compuesta con la unidad de la presentación, viabilidad NO VERIFICADA según el §13 del diseño), la línea acepta `presentacionId`, resuelve por id y no por unidad; `PRESENTACION_AMBIGUA` deja de aplicar cuando viene el id. Cubre C2 «misma unidad dos veces» y C4. Golden de costo idéntico obligatorio para las compras sin presentación. Cambia dinero y stock: un PR propio, turno de schema.
**P5 — Factura de proveedor con presentación (d2, migración aditiva):** el renglón lleva `presentacionId`.
**P6 — Pantallas (d3)** de Compra y de Compra por pasos con presentaciones por nombre (detrás del interruptor).
**P7 — Oferta por presentación y tipo de precio (d4, migración):** `ProveedorPorProducto` por presentación; `precio por tipo (PRESENTACION o UNIDAD)`. Cubre C5 completo y C3/C4 por presentación.
**P8 — Encender** `PRESENTACIONES_VISIBLES` (revisando tests de congelación y goldens que fijan «apagado») y **relleno** de presentaciones para los productos con unidad de compra y factor distinto de 1; el retiro de `Producto.unidadCompraId`/`factorConversion` es destructivo y va aparte, con aviso y autorización expresa.

## 4. Orden y dependencias
P0 → P1 (ambas sin migración, seguridad) → P3 → P2 (sin migración; P2 útil solo cuando P3 permite marcar el peso variable) → P4 (primera migración: turno de schema) → P5 → P6 → P7 → P8. P0 y P1 pueden ir ya. P3/P2 son sin migración pero detrás del interruptor apagado: construibles sin riesgo para producción.

## 5. Riesgo y qué se construye primero sin migración
- Riesgo mayor: P4 a P7 tocan dinero y stock (208 líneas en 38 archivos de `src/` y 110 de `test/` mencionan `factorConversion|unidadCompraId|unidadCompra`; 6 scripts). El permiso `producto_campos_sensibles` hoy protege el factor; si el factor pasa a ser dato de la línea/presentación esa protección debe mantenerse (`acciones.ts:260`, `actualizar-producto.ts:168-180`): quien tiene solo `proceso_compra` no puede cambiar cuánto stock entra por unidad.
- Datos de producción NO VERIFICADOS: cuántos productos tienen factor distinto de 1 (la migración `20261115151000` indica que hoy no hay presentaciones).
- Primero, sin migración: P0, P1, P3, P2. Todo lo demás espera turno de schema, de a uno, cada migración con `down.sql` y `verificacion-previa.sql`, sin aplicar a bases reales.

## 6. Preguntas
- Al dueño (PRIORIDAD, no el qué): ¿se hace ya la presentación en la línea (P4 a P8) o primero cerrar lo funcional pendiente? Mientras no responda, P0 a P3 avanzan porque son seguridad y no cambian lo que ve el cliente.
- Al orquestador: ¿P1 (rechazar clave de precio desconocida) va dentro del encargo de P0 o es un PR aparte?

## 7. Diferencias con Pedernal (a mantener declaradas)
La línea de Pedernal es `linea_de_recepcion` con `presentacion_id` nullable; Motor2 la lleva en `MovimientoStock` y en el renglón de factura (no hay recepción separada de la compra salvo la etapa N3, ya construida). La oferta de Pedernal tiene clave con `NULLS NOT DISTINCT`; Motor2 conserva `referenciaProveedor` (C9, que Pedernal no tiene). El factor en Pedernal sale de la tabla de unidades del sistema o de la presentación, nunca del producto; en Motor2 el factor por producto convive hasta P8.
