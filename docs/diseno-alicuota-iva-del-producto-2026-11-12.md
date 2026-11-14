# Diseño: cargar la alícuota de IVA del producto (paso 13 de la auditoría 2026-11-12)

Estado: **PROPUESTA** salvo lo marcado CONFIRMADA. Sigue la escalera de 10 niveles de `AGENTS.md` en versión corta (es un campo más de una pantalla existente, sin tablas nuevas).

## 1. Propósito y alcance

- **Necesidad** (hallazgo R5 de `docs/auditoria-primitivas-pedernal-motor2-2026-11-12.md`): `Producto.alicuotaIvaVenta` y `.alicuotaIvaCompra` existen (migración M0-IVA, `20261015100000`) pero **ninguna pantalla las escribe**: en `empresab` los 72 productos de venta están «sin declarar» (NULL) y no hay cómo completarlos (leído en solo lectura, 2026-11-12; `zuluhub` todavía no tiene la columna: su migración M0-IVA está pendiente de aplicar).
- **Pedido del dueño** (2026-11-12): «Sí, hacemos A», a la pregunta «¿Qué hago con los productos ya cargados "sin declarar": se quedan así hasta que alguien los edite…? (A) agrego la pantalla para cargar la alícuota del producto y los ya cargados siguen "sin declarar" hasta que alguien los edite». **CONFIRMADA**.
- **Dentro**: un campo en el formulario de producto (alta y edición): «IVA de venta» en un producto de venta (PV) y «IVA de compra» en una materia prima (MP). Sin valor = «sin declarar».
- **Fuera** (no se hace, no se pidió): listado o carga masiva de los que faltan, un IVA por defecto, reglas nuevas de facturación, cambios en cómo se leen las alícuotas (ya existen y tratan NULL como «sin declarar»).

## 2. Actores

Quien edita productos (permiso `producto_editar`). **PROPUESTA (DEC)**: cambiar la alícuota exige además la clave fina `producto_campos_sensibles`, igual que el precio de venta (es un dato fiscal que mueve plata).

## 3. Casos de uso

1. Elegir la alícuota al editar un producto que estaba «sin declarar».
2. Cambiarla o quitarla (volver a «sin declarar»).
3. Elegirla al dar de alta un producto (opcional).

## 4. Conceptos y ciclo de vida

Valor = uno de `ALICUOTAS_IVA` (`src/core/fiscal/iva.ts`: IVA_0, IVA_2_5, IVA_5, IVA_10_5, IVA_21, IVA_27, EXENTO, NO_GRAVADO) o «sin declarar» (NULL). Nada viene preelegido (todo nace cerrado, CONFIRMADA). Un PV solo tiene alícuota de venta; una MP solo la de compra (lo dice el comentario del esquema; se valida en la capa de aplicación).

## 5. Invariantes

| Id | Regla | Estado |
|---|---|---|
| I1 | El valor es de la lista cerrada o vacío; cualquier otro se rechaza sin escribir | PROPUESTA |
| I2 | Alícuota de venta solo en PV; de compra solo en MP | PROPUESTA (comentario del esquema) |
| I3 | Quien no tiene `producto_campos_sensibles` no la cambia; un valor que no viene queda como estaba | PROPUESTA (DEC) |
| I4 | Cada cambio deja su fila de auditoría (del anterior al nuevo) en la misma transacción | PROPUESTA (regla de trazabilidad) |
| I5 | Ningún producto existente cambia por esta etapa: sin backfill ni valor deducido | CONFIRMADA (opción A) |

## 7. Atomicidad y concurrencia («¿qué pasa si…?»)

| Situación | Resultado |
|---|---|
| Se guarda dos veces lo mismo | No escribe ni audita de nuevo (igual que el resto de la edición) |
| Dos personas editan a la vez | La edición ya es SERIALIZABLE; además, si la alícuota cambia, la que mostraba el formulario (`alicuotaVista`) tiene que ser la guardada: si no, `ALICUOTA_DESACTUALIZADA` y no se guarda nada (mismo patrón que el precio visto) |
| Falla la auditoría | Se deshace todo (una transacción) |
| Valor raro por la red | Rechazo I1, sin escribir |
| Cambian los permisos mientras edita | El servidor los vuelve a exigir |
| Pantalla abierta sin la clave fina | El campo viaja deshabilitado: «no viene = queda como estaba» |

## 8–10. Acceso, experiencia, pruebas

- El campo vive en `producto-form.tsx` junto a «¿Cómo se vende?» y copia su patrón (campo sensible, solo lectura sin la clave). Si está sin declarar, la pantalla lo dice: «Pendiente de completar».
- Pruebas: núcleo puro (lista cerrada, tipo vs. campo), caso de uso contra la base real (permiso, desactualizado, idempotencia, auditoría atómica, tipo equivocado), carrera de dos ediciones, y e2e a 375 px del formulario. La columna ya está declarada en `test/arquitectura/guardas/columnas-de-significado.ts` (dinero).
- **Migración: ninguna** (las columnas y sus CHECK ya existen en la base de `empresab`; `zuluhub` ya está atrasada respecto de `main` en esa migración y hay que aplicarla antes de desplegar cualquier versión actual).

## Decisiones que esperan el OK del dueño

- **DEC-a**: la clave fina que protege el cambio (`producto_campos_sensibles`, como el precio). Costo de revertir: cambiar una condición.
- **DEC-b**: en el alta el campo es opcional y nace vacío.
