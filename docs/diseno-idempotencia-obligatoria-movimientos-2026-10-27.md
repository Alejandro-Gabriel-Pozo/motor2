# Diseño: clave de reintento obligatoria en `registrarMovimiento` (etapa E1 del circuito de abastecimiento)

Fecha: 2026-10-27. Estado: **PROPUESTA implementada** (los niveles 1 a 5 se apoyan en decisiones CONFIRMADAS del dueño: E1 de `docs/diseno-circuito-de-abastecimiento-2026-10-27.md` §4 y «usar de molde el pago al consignante»). Sin migración.

## 1. Propósito y alcance

Que ninguna carga del motor genérico de movimientos (Compra, Producción, Consumo, Ajuste, Transferencia, Merma, Devolución de consignación, de cliente y a proveedor) se pueda registrar dos veces por un doble clic, un reintento del navegador o un corte de red. Hoy la clave de reintento (I3) es **opcional** («rollout gradual», `docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md` §9.3): si no viene, el mecanismo se apaga y cada envío escribe una `Operacion` nueva (stock y dinero duplicados). E1 la vuelve **obligatoria**: sin clave, rechazo con mensaje claro y cero filas.

Fuera de alcance (siguen opcionales, anotado como pendiente en §8): `registrarVenta`, `reclasificarStock`, `registrarConteoFisico`, los pasos de traspasos, `anularCompra`/`anularVenta` y el pedido del salón.

## 2. Actores y contexto

- La persona que carga en la pantalla `/movimientos/[proceso]` (`panel-movimiento-form.tsx`), con el permiso del proceso (`ACCION_POR_PROCESO`).
- Los scripts de demo que llaman a la acción real (`scripts/seed-demo-pizzeria.ts`, `scripts/seed-demo-pizzeria-6-meses.ts`).
- Las pruebas (unitarias, de integración y e2e).

### Inventario real de puertas (búsqueda en el código, 2026-10-27)

| Puerta | Archivo | ¿Manda clave hoy? | Qué cambia |
|---|---|---|---|
| Server Action `registrarMovimiento` | `src/server/actions/movimientos/movimientos.ts` | — (la recibe) | Única entrada; adaptador fino → guard → caso de uso |
| Guard del comando | `src/core/features/movimientos/movimiento.guard.ts:55` | — | `!== undefined &&` → ausente/nula/vacía se rechaza |
| Tipo del comando | `src/core/features/movimientos/movimiento.schema.ts:46` | — | `claveIdempotencia?: string` → `claveIdempotencia: string` (tsc enumera a quien no la manda) |
| Caso de uso | `src/server/actions/movimientos/casos-de-uso/registrar-movimiento.ts` | — | Se sacan las 3 ramas «sin clave» (hash, escritura de clave/hash, `registrarResultadoIdempotente`) |
| Pantalla de los 9 procesos | `src/app/(app)/movimientos/[proceso]/panel-movimiento-form.tsx:119,289,298` | **Sí** (UUID al montar, se reenvía en el reintento, se renueva tras un éxito) | Nada |
| Salón / cierre de cuenta (POS) | `src/app/(pos)/...`, `cerrarCuenta` | No llama a `registrarMovimiento` (usa `registrarVentaEnTx`) | Nada |
| Venta de mostrador, conteo, reclasificación, traspasos | acciones propias | No pasan por este motor | Nada |
| Seed de 30 días | `scripts/seed-demo-pizzeria.ts` (9 llamadas) | No | Clave nueva por llamada (commit aparte) |
| Seed de 6 meses | `scripts/seed-demo-pizzeria-6-meses.ts` (3 llamadas) | No | Clave nueva por llamada (commit aparte) |
| `prisma/seed.ts` | — | No llama a la acción | Nada |
| Tests unitarios/integración | 101 archivos, 529 llamadas a `registrarMovimiento(` + 16 a `guardComandoRegistrarMovimiento` | Solo los de idempotencia | Codemod (commit aparte); las pruebas que documentaban «sin clave duplica» se reescriben |
| e2e (Playwright) | `test/e2e/movimientos-*.spec.ts` y otros 9 que pasan por la pantalla | Por la pantalla (sí) | Nada |

## 3. Casos de uso

1. Cargar un movimiento nuevo → se registra una vez.
2. Doble clic / dos pestañas con el mismo formulario / reintento del navegador → una sola `Operacion`; el segundo envío recibe el mensaje original («repetida»).
3. Reintento tras un corte (la respuesta no llegó) con el mismo contenido → mensaje original, sin duplicar.
4. Misma clave con otro contenido (la persona cambió algo y reenvió algo que ya había entrado) → rechazo explícito «Esta operación ya se había enviado con datos distintos — recargá la página e intentalo de nuevo.» (`MENSAJE_CONFLICTO_IDEMPOTENCIA`).
5. Pedido sin clave (pantalla vieja, llamada a mano, script) → rechazo «Falta la clave de reintento: recargá la pantalla.» y cero filas.

## 4. Conceptos y ciclo de vida

La clave (UUID v1–v5) nace en la pantalla al abrir el formulario, viaja igual en cada reintento del mismo envío y se renueva después de un éxito. En el servidor se guarda en `Operacion.claveIdempotencia` (índice único) junto con la huella (`payloadHash`: SHA-256 del comando validado + proceso + sucursal) y el mensaje del resultado (`resultadoMensaje`). Nada se borra: la `Operacion` original es el comprobante del primer envío.

## 5. Invariantes y políticas

- **I-E1-1**: una clave produce como máximo una `Operacion` (árbitro: el índice único `Operacion_claveIdempotencia_key`, más el chequeo dentro de la transacción SERIALIZABLE).
- **I-E1-2**: sin clave válida no se escribe nada (el guard corre dentro de `conPermiso` y antes de abrir la transacción).
- **I-E1-3 (misma clave, distinto contenido)**: rechazo `CONFLICTO_IDEMPOTENCIA`; nunca se devuelve el resultado de otro pedido en silencio. Es el molde que ya usan el pago al consignante (`registrar-pago-consignante.ts`: relee al ganador y compara huellas), el conteo físico y el pedido del salón (`agregar-items.ts`).
- **I-E1-4 (clave de otra empresa o sucursal)**: la `Operacion` ajena no se ve (RLS por empresa y alcance por sucursal); como la clave es única GLOBAL, el insert choca contra el índice. Decisión (molde de `agregar-items.ts`, «nunca un error genérico ni el contenido de otro»): si el choque es del índice de la clave y el ganador no es visible o tiene otra huella → `CONFLICTO_IDEMPOTENCIA`; nunca se devuelve el mensaje ajeno ni se escribe nada. Cualquier otro choque de unicidad no reconocido se relanza (falla cerrado).
- El mensaje y el código del guard son los del pago al consignante (`"vacio"`, «Falta la clave de reintento: recargá la pantalla.»; `"formato"`, «Clave de reintento inválida.»).

## 6. Historia y persistencia

Sin cambios de esquema. Las columnas `claveIdempotencia`, `payloadHash` y `resultadoMensaje` de `Operacion` existen desde I3 (nulables: las operaciones viejas sin clave y las de otros procesos siguen válidas; el índice único admite varios NULL). Nada se migra.

## 7. Atomicidad y concurrencia — tabla «¿qué pasa si…?»

| ¿Qué pasa si… | Resultado |
|---|---|
| **repetición**: el mismo envío llega dos veces seguidas | El segundo encuentra la clave con la misma huella → éxito «repetida» con el mensaje original; cero filas nuevas |
| **concurrencia**: 8 envíos simultáneos con la misma clave | SERIALIZABLE + índice único: uno escribe; los demás reciben 40001 o 23505, se reintentan (`tambienChoqueDeUnico`) y ven al ganador → «repetida». Una sola `Operacion` (probado en compra sin proveedor, consumo, merma y ajuste) |
| **concurrencia con claves distintas** (dos cargas legítimas) | Dos operaciones, como siempre; el stock lo arbitra SERIALIZABLE (sin cambios) |
| **tiempo**: el reintento llega horas o días después | La clave no vence; la huella incluye la fecha elegida (no la hora del servidor) → «repetida». Límite: si la fecha elegida quedó fuera de la ventana de `validarFechaOperacion`, el guard rechaza antes de llegar a la clave (no duplica) |
| **incertidumbre**: la respuesta se perdió (corte de red) | La pantalla conserva la clave (solo la renueva tras un éxito) → reenviar devuelve el resultado original |
| **reintento tras corte** con el contenido cambiado | `CONFLICTO_IDEMPOTENCIA` («recargá la página»): el primero ya entró, no se registra otro con la misma clave |
| **error parcial**: falla una línea, el stock o el vínculo proveedor↔producto | Todo dentro de una transacción: rollback completo, la clave no queda tomada → el reintento con la misma clave corre de nuevo |
| **datos faltantes**: sin clave, clave vacía, nula o que no es UUID | Rechazo del guard, cero filas en `Operacion` y `MovimientoStock` |
| **clave de otra empresa/sucursal** | No se ve; choque del índice → `CONFLICTO_IDEMPOTENCIA`, sin filas nuevas y sin el mensaje ajeno |
| **cambio de permisos** entre el primer envío y el reintento | `conPermiso` corre antes del guard: el reintento se rechaza por permiso aunque el primero haya entrado (no duplica; la persona ve el movimiento en el historial). Sin cambios respecto de hoy |
| **pantalla vieja** abierta antes del despliegue | La pantalla ya manda la clave desde I3: no hay pantallas viejas sin clave que se rompan |

## 8. Acceso e interfaces

- Sin cambios de permisos: `ACCION_POR_PROCESO` → `conPermiso` → guard → caso de uso.
- El tipo `DatosMovimientoInput.claveIdempotencia` pasa a obligatorio: el compilador obliga a todo llamador a mandarla.
- Pendientes fuera de E1 (cada uno su etapa): volver obligatoria la clave en `registrarVenta`, `reclasificarStock`, `registrarConteoFisico`, traspasos, anulaciones y pedido del salón; que la clave sea única por empresa (`@@unique([empresaId, claveIdempotencia])`) en vez de global — **requiere migración**, no se hace acá.

## 9. Consultas y experiencia

La pantalla no cambia: ya genera, reenvía y renueva la clave, y el botón «Confirmar» se deshabilita mientras guarda. Lo único visible es el mensaje de rechazo si algo llega sin clave.

## 10. Pruebas, migración y operación

- Línea de base antes de tocar (2026-10-27, rama `alegp/carril-e` sobre `5cb1e52d`): **1101** archivos `*.test.ts` (y 42 `*.test.tsx`), **157** specs e2e + **1** de e2e-demo.
- Prueba nueva `test/movimientos/registrar-movimiento-clave-obligatoria.test.ts`: sin clave (ausente, nula, vacía) ⇒ rechazo y cero filas en `Operacion`/`MovimientoStock`; 8 envíos simultáneos con la misma clave ⇒ una sola `Operacion` en compra sin proveedor, consumo, merma y ajuste; misma clave con contenido distinto ⇒ `CONFLICTO_IDEMPOTENCIA`; clave de otra empresa ⇒ conflicto sin filas ni datos ajenos; reintento tras éxito ⇒ mensaje original sin duplicar. Cada una con mutación (ver §11).
- Las pruebas de auditoría que documentaban «sin clave se duplica» pasan a documentar el rechazo.
- Migración: ninguna. Reversión: revertir los commits de producción (las filas escritas con clave siguen siendo válidas con el código anterior).

## 11. Evidencia de mutaciones

Se completa al cerrar la etapa (ver commits).
