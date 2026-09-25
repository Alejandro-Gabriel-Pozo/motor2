# Grounding: modelo mesa / cuenta / comanda(KOT) contra 5 POS de referencia (2026-09-24)

Complementa `docs/grounding-unificacion-carta-stock-2026-09-23.md` §7
(POS/comandas). Responde 4 preguntas abiertas del plan de "Mapa de
Mesas" (`Agent subagent_type: "Plan"`, hand-back del 2026-09-24):
vocabulario mesa/cuenta/comanda, cuánto tiempo puede quedar abierta una
mesa o una comanda, cómo se manejan las correcciones post-pedido, y
cómo se arma la cuenta final — contra 5 repos públicos de GitHub,
leídos completos (no solo README), citando archivo/ruta por cada
afirmación.

Repos investigados: `satisfecho/pos` (FastAPI+SQLModel+Postgres+Angular),
`Shahzaib-Awann/Foodya-Restaurant` (Next.js+Drizzle+MySQL),
`ahmedali5530/restaurant-pos` (React/Vite+Bun+SurrealDB, offline-first
con Dexie), `ury-erp/ury` (app Frappe/ERPNext), `FreeOpenSourcePOS/FloCafe`
(Electron+Next.js+better-sqlite3). Los 5 accesibles, ninguno vacío.

---

## 1. Vocabulario y separación de entidades

**Hallazgo principal: la separación mesa / cuenta abierta / ticket de
cocina ("KOT" — Kitchen Order Ticket) es vocabulario de industria, no
una idiosincrasia de este proyecto.**

- `ury-erp/ury` — DocType persistido literal `URY KOT`
  (`ury/ury/ury/doctype/ury_kot/ury_kot.json`), separado de `URY Table`
  y del `POS Invoice` estándar de ERPNext que hace de cuenta abierta
  (`ury_order.py:690`, `_resolve_or_create_pos_invoice`).
- `ahmedali5530/restaurant-pos` — 3 capas explícitas: `Table`
  (`src/api/model/table.ts`), `Order` (`src/api/model/order.ts:17-65`),
  y `OrderItemKitchen`/`KitchenOrderTicket` (`order_item_kitchen.ts:8-15`,
  `kitchen.ts:16-34`) — "KOT" aparece literal en permisos
  (`"orders.print_kot"`, `access.rules.ts:398`) y en el código de
  impresión.
- `FreeOpenSourcePOS/FloCafe` — usa "KOT" constantemente en impresión/
  config (`main/printers/document-kot.ts:38`, `main/db.ts:1034`) pero
  **sin tabla propia**: es un documento reconstruido on-the-fly desde
  `orders`+`order_items`+`kitchen_stations` cada vez que se imprime.
- `satisfecho/pos` y `Shahzaib-Awann/Foodya-Restaurant` — **no tienen el
  concepto**. En `satisfecho` el estado de cocina vive directo en
  `OrderItem.status` (`back/app/models.py:1304`, enum
  pending/preparing/ready/delivered/cancelled); en `Foodya` no existe
  ni eso (`orderItemsTable` es una tabla de snapshot sin estado,
  `lib/drizzle-schema/restaurant.schema.ts:111-121`).

**Conclusión para motor2 (confianza alta):** separar `Mesa` / `Cuenta`
(la cuenta abierta) / comanda-KOT es correcto y sigue el patrón de los
2 repos más maduros. No hace falta persistir el KOT como tabla completa
desde el día uno si no hay ruteo multi-estación real (bar/cocina/
postres) — el enfoque de FloCafe (KOT derivado, sin tabla) es
razonable para empezar. Si se necesita imprimir y marcar "ya impresa"
(§6.1 de la unificación), conviene el camino de ury/ahmedali5530: una
fila propia por lote de impresión, no reconstruirlo cada vez.

## 2. Ciclo de vida y duración — ¿cuánto tiempo puede quedar abierta una mesa o una comanda?

**Ningún repo de los 5 cierra automáticamente una mesa/cuenta
individual por inactividad.** Cierre siempre manual (alguien cobra):

- `satisfecho/pos`: sin timeout/auto-close aplicado a `Order`
  (`grep -rniE "timeout|auto.?close|expir"` solo encuentra expiración
  de tokens de sesión). Ciclo: pending → preparing → ready →
  partially_delivered → completed → paid (o cancelled),
  `back/app/models.py:48-57`. `completed` ≠ `paid`: hay una vista
  dedicada "Not Paid Yet" para servicio completo sin cobrar
  (`docs/0008-order-management-logic.md:1382-1411`).
- `Shahzaib-Awann/Foodya-Restaurant`: sin timeout para `orders`; el
  único timeout es para **reservas** de mesa (`expired`, calculado al
  leer, `lib/crud-actions/bookings-tables.ts:81,150-153`) — no aplica a
  una cuenta ya abierta.
- `ahmedali5530/restaurant-pos`: sin timeout por-orden. Existe un
  **barrido de fin de jornada opt-in** (`AutoCheckCloseSettings`,
  `src/lib/auto-check-close.service.ts:258-346`) que liquida todas las
  órdenes `In Progress` al cierre del día — no es un timeout individual.
- `ury-erp/ury`: sin timeout (`grep` sin resultados). Liberar la mesa es
  una llamada explícita (`release_tables_after_print`,
  `ury_order.py:385-411`), disparada junto con imprimir la cuenta final
  en el flujo típico de UI, pero separada en código.
- `FreeOpenSourcePOS/FloCafe`: sin timeout (`grep -rniE
  "auto.?close|idle.*table"` sin resultados). Hitos como columnas de
  timestamp (`cooking_started_at`, `ready_at`, `served_at`,
  `completed_at`, `cancelled_at`, `main/db.ts:5473-5508`).

**Conclusión (confianza alta, unanimidad 5/5):** no implementar ninguna
expiración automática de mesa/cuenta individual. "Hace 42 min" en la
tarjeta de mesa es puramente informativo. Si algún día se quiere un
cierre de seguridad, el único precedente es un job de fin de
turno/jornada opt-in (estilo ahmedali5530) — nunca un timeout silencioso
de una cuenta abierta.

## 3. Correcciones post-pedido (una vez que el ítem ya se mandó a cocina)

Espectro claro, de más pobre a más rico:

- **Foodya — sin ninguna lógica.** No hay endpoint para cancelar/anular
  un ítem ya creado, ni motivo, ni rol especial (confirmado por búsqueda
  de "void"/"cancel" en toda la carpeta `app/`). Laguna real, no solo
  falta de documentación.
- **satisfecho — permiso + motivo condicional.** `PUT
  /orders/{order_id}/items/{item_id}/cancel`
  (`back/app/main.py:15644`) requiere `Permission.ORDER_CANCEL`, bloquea
  cancelar ítems ya `delivered`, y **exige motivo solo si el ítem ya
  está en `ready`** ("required for tax reporting",
  `main.py:15678-15683`). Nunca borra: soft-delete con
  `removed_by_user_id`/`removed_at`/`removed_reason`
  (`models.py:1344-1353`).
- **FloCafe — PIN de supervisor a partir de cierto estado.** Si el ítem
  está `pending`, cualquiera con permiso normal lo cancela. Si ya está
  `preparing`/`ready`, **se exige PIN de manager/owner**
  (`main/routes/index.ts:340-429`, `override_pin`), y en vez de tocar la
  fila original se inserta una **fila espejo negativa**
  (`status='void_adjustment'`) mientras la original queda
  `status='voided'` — nunca se edita ni borra. Mismo patrón para
  refunds post-pago (`main/services/refund.ts:190-210`), con aprobador
  registrado. Tiene una tabla `order_audit_log` creada pero sin ningún
  INSERT real en el código — parece scaffold sin uso, no copiar tal cual.
- **ahmedali5530 — entidad dedicada `OrderVoid`.** `order_void.ts:17-26`
  con `reason: OrderVoidReason` (enum tipado: FOHNotMade, BOHNotMade,
  GuestNotMade, PunchByMistake, Testing, etc.), `comments` libre,
  `deleted_by`, permiso dedicado `"orders.cancel"`. El modal de
  cancelación exige elegir motivo y cantidad antes de confirmar, y
  además dispara una "Deletion print" a la impresora de cocina afectada
  (`order.cancel.modal.tsx:156-198`) — la anulación también se
  comunica a cocina, no solo se registra.
- **ury — nunca editar, siempre agregar un documento nuevo.** Cancelar/
  modificar ítems de un KOT existente crea un **nuevo `URY KOT`** de
  tipo `Cancelled`/`Partially cancelled`, enlazado al original vía
  `original_kot` (`ury/api/ury_kot_generate.py:194-331`). Motivo en
  texto libre (`comments`), permisos configurables por rol vía POS
  Profile, no fijo a "supervisor" por código.

**Conclusión (confianza alta, coincide en 4 de 5 con algo serio de
anulación):** nunca `DELETE` de un ítem ya confirmado; usar estado +
fila de reversa o documento de anulación aparte, con **motivo
obligatorio solo a partir de que el ítem ya está "en preparación"** (no
antes — cancelar algo que ni se empezó no necesita fricción), y
permiso/PIN elevado a partir de ese mismo punto. **Esto es insumo para
el pendiente futuro "tomar pedido"** (todavía sin planificar, ver §7.1
de la unificación) — no para Mapa de Mesas, que no gestiona ítems
individuales.

## 4. Cómo se arma la cuenta final

- **satisfecho:** `OrderPayment`/`OrderPaymentItem` soportan split by
  amount y split by line (no por comensal — listado como "Deferred").
  Pagar y cerrar desacoplados: `completed` sin `paid_at` es un estado
  válido y visible aparte.
- **Foodya:** una sola factura por orden, `isPaid=true` se fija en el
  mismo submit que la genera — **pagar, facturar y cerrar mesa son la
  misma acción atómica**. Sin split.
- **ahmedali5530:** `OrderSplit`/`OrderMerge` como entidades propias
  auditadas (por ítems). Pagar marca `status=Paid` y libera la mesa en
  el mismo flujo, pero son llamadas separadas (settle + unlockTable).
- **ury:** `split_bill(...)` mueve ítems a un `POS Invoice` hermano
  (por línea). Pagar = `submit` del invoice; liberar mesa es función
  aparte, normalmente disparada junto en la UI.
- **FloCafe:** split por línea (`split_group_id`). A diferencia de los
  otros 4, aquí pagar SÍ cierra la orden y libera la mesa
  automáticamente en el mismo `UPDATE`.

**Conclusión (confianza media-alta):** en los repos más flexibles,
pagar/cobrar y cerrar/liberar mesa son operaciones separadas aunque se
disparen juntas desde la UI — confirma que dejar "Facturar" fuera del
alcance de Mapa de Mesas (no mezclarlo con el estado libre/en_pedido/
ocupada) fue la decisión correcta. Split "por comensal" no tiene
precedente en ninguno de los 5 — si motor2 lo necesita más adelante, es
diseño propio, no algo para confirmar contra referencia.

## 5. Advertencia de calidad de las fuentes

`Foodya-Restaurant` es, con diferencia, la implementación más débil de
las 5 (CRUD básico, sin auditoría, sin estados de cocina) — sirve como
ejemplo de "qué NO hacer", no como patrón a imitar. El resto son
implementaciones activas y razonablemente production-grade, aunque con
más superficie (multi-marca, fiscalidad) de la que motor2 necesita como
referencia mínima.

## 6. Decisiones que esto resuelve, en el plan de Mapa de Mesas

1. **Nombre:** `Comanda`/`ComandaItem` del plan original pasan a
   llamarse **`Cuenta`/`CuentaItem`** — es la cuenta abierta de la mesa,
   no el ticket de cocina. El campo `numeroEnvio: Int?` en `CuentaItem`
   queda igual, como placeholder liviano de "a qué lote de impresión
   pertenece" — la entidad real de comanda/KOT (con anulación, motivo,
   permiso elevado, reimpresión a cocina — §3 arriba) se construye
   cuando se planifique el pendiente "tomar pedido", no ahora.
2. **Duración/timeout:** ninguno. Confirmado, no hace falta lógica de
   expiración para Mapa de Mesas.
3. **Regla de "segunda ronda" (mesa ocupada que vuelve a en_pedido):**
   razonablemente alineada con cómo trackean estado los repos maduros
   (por ítem, no por mesa entera) — se puede aceptar tal como la
   propuso el plan.
4. **Alcance de la migración:** se confirma `Mesa` + `Cuenta` +
   `CuentaItem` ahora; la entidad de comanda/KOT con su lógica de
   anulación queda para "tomar pedido".

> **Actualización 2026-09-25 — pendiente «tomar pedido»:** lo que acá quedaba «para cuando se planifique tomar pedido» (comanda/KOT,
> anulación con motivo y permiso elevado) ya está diseñado e implementado: ver `docs/plan-tomar-pedido-2026-09-25.md`. En corto: el
> KOT se deriva de `numeroEnvio` (sin tabla propia), la anulación de un ítem enviado es una fila espejo negativa con motivo y
> auditoría, y el permiso elevado es una clave propia (`pos_anular_item`), sin PIN de supervisor.
