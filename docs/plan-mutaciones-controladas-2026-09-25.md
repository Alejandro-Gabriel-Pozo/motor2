# Plan: confirmación de intención en la UI y guard de transición en el servidor — 2026-09-25

Rama `feat/mutaciones-controladas`, desde `origin/main` (`917c25b`). Plan diseñado por un agente de planificación contra el código real,
confirmado por el dueño del producto (guard + componente + arreglo de la carrera de stock + los 3 botones de la bandeja, en un solo
pase) e implementado un commit por paso. **Sin migración ni cambio de `schema.prisma`.**

## 1. El problema

El caso puntual del dueño: en `/traspasos`, «Cancelar solicitud» (`src/app/(app)/traspasos/bandeja.tsx`, `FilaEsperando`) llamaba a
`cancelarSolicitudTransferencia` al primer clic, sin confirmación. En el mismo archivo hay dos «Rechazar» más en la misma situación,
pegados a los botones de acción de su fila (miss-click típico):

- `FilaParaAprobar` → `rechazarSolicitudTransferencia` (Origen rechaza lo que le pidieron).
- `FilaParaAceptar` → `rechazarTransferencia` (Destino rechaza lo que le mandaron).

`/traspasos` no tenía ningún spec E2E propio (solo aparece en `test/e2e/rutas-sin-parametros.ts`, para `maquetacion-general.spec.ts`).

## 2. Qué ya confirma hoy (dos variantes)

- **Variante ACCESIBLE** (la de referencia): `src/components/boton-activar-desactivar.tsx`, `src/components/activar-desactivar-fila.tsx`,
  `src/app/(app)/reportes/compras/boton-anular-compra.tsx`. Foco a «Cancelar» al abrir; aviso con `role="alert"` y `aria-describedby`;
  Escape cancela y devuelve el foco; `BotonAnularCompra` genera la clave de idempotencia I3 al abrir. Cubierta por
  `compras-anular.spec.ts`, `administracion-desactivar-confirma.spec.ts`, `administracion-desactivar-sucursal.spec.ts`,
  `catalogo-productos-desactivar.spec.ts`, `catalogo-disponibilidad-por-sucursal.spec.ts` y `accesibilidad.spec.ts`.
- **Variante BÁSICA** (sin foco, sin Escape, sin `role`, texto ámbar): `reportes/trazabilidad/boton-anular-venta.tsx`,
  `stock/minimo/boton-eliminar.tsx`, `stock/conteo-frecuencia/boton-eliminar.tsx`, `movimientos/conteo-fisico/acciones-historial.tsx`,
  `form-renombrar-insumo.tsx`. **No se migra en este plan** (fase F2).
- `window.confirm` no se usa en ningún lado (solo aparece, prohibido, en comentarios).

## 3. Inventario de lo que este plan toca (Server Actions de `src/server/actions/traspasos/traspasos.ts`)

Se recorrieron los 39 archivos de `src/server/actions/`; acá va solo lo que este plan cambia.

| Acción | Antes | Riesgo real |
|---|---|---|
| `cancelarSolicitudTransferencia` | `findUnique` → chequea estado → `prisma.traspasoSucursal.update`, **sin transacción y sin condición de estado** | Doble clic / dos pestañas: las dos responden «cancelada». Y la carrera de abajo. |
| `rechazarSolicitudTransferencia` | Igual: sin transacción | **Bug de servidor, no solo de UI**: si `aprobarYEnviarTransferencia` (serializable) hace commit de SALIDA + ENVIADA entre la lectura y la escritura del rechazo, el traspaso queda RECHAZADA_ORIGEN con el stock YA afuera del origen, y nadie lo puede reingresar (el reingreso exige RECHAZADA_DESTINO): **se pierde stock en tránsito**. |
| `rechazarTransferencia` | Ya serializable (arreglo del Plan I3, §6.3) | Nada que arreglar en concurrencia: solo se conecta al guard y a la confirmación. |
| `aprobarYEnviarTransferencia`, `aceptarTransferencia`, `confirmarReingresoTransferencia` | Ya serializables | Solo se conectan al guard (mismos mensajes, mismo comportamiento). |

Es el mismo patrón que ya se cerró para `rechazarTransferencia` (docstring en `traspasos.ts`; test «rechazo simultáneo» de
`test/auditoria/traspasos-en-transito.test.ts`): las dos acciones de la solicitud quedaron afuera de aquel arreglo.

## 4. Qué ya existe y NO se duplica

- **Auditoría**: `src/core/permisos/auditoria.ts` (`registrarCambioAuditado`). Traspasos no la necesita: la fila `TraspasoSucursal` se
  audita a sí misma con sus campos (quién y cuándo decidió cada lado, motivos, cierre). No se agrega ningún módulo de auditoría.
- **Idempotencia**: `src/core/movimientos/idempotencia.ts` (I3) solo sirve para acciones que crean una `Operacion`. Cancelar o rechazar un
  traspaso no crea ninguna: se resuelve con una guarda de estado atómica dentro de una transacción, no con clave I3 (mismo criterio que
  ya decidió I3 §6.2).
- **Concurrencia**: `conTransaccionSerializable` (`src/core/movimientos/con-reintento.ts`) + `conPermiso` (limitador de tasa + permiso) +
  guardas optimistas sin columna de versión ya en uso (`corregirCompra(…, esperado)`, `anularItemEnviado(…, restanteVisto)`,
  `RecetaVersion.version`). No se agrega ningún `version: Int` genérico.
- **Guard de transición**: ya existe puro para compras (`evaluarAnulacion`, `src/core/compras/anulacion.ts`) y está repetido en línea en
  traspasos, ventas, POS y conteo físico. Lo nuevo es la EXTRACCIÓN para traspasos (`src/core/features/traspasos/traspaso.guard.ts`,
  misma convención de carpetas que `src/core/features/compras/compra.guard.ts`), no una construcción desde cero. `evaluarAnulacion` no
  se mueve.

## 5. Decisión de alcance

Sin módulo transversal (`src/core/mutaciones/`, `src/components/mutaciones/`): el problema real es acotado. Alcanza con 1 componente de
confirmación (`src/components/boton-con-confirmacion.tsx`), 1 guard de transición para traspasos, 1 arreglo de una carrera real en el
servidor, 3 botones de la bandeja migrados y 1 test de arquitectura. Sin prop de «nivel de impacto» en el componente (el nivel decide SI
se confirma, como política documentada — §8), sin `version: Int` nuevo, sin migración.

## 6. Línea de base (Paso 0, corrida real en este worktree antes de tocar nada)

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | 0 errores (con los tipos generados de `.next/types`; en un worktree recién clonado, ANTES del primer build, da 1 error ambiental — `LayoutProps` no existe hasta que Next genera sus tipos) |
| `npm run lint` | 0 errores, 0 advertencias |
| `npm test` | 186 archivos, 2150 tests, todos verdes |
| `npm run build` | limpio; `prisma migrate deploy`: 39 migraciones, «No pending migrations to apply» |
| `npm run test:e2e` | 51 specs, 298 tests, todos verdes |
