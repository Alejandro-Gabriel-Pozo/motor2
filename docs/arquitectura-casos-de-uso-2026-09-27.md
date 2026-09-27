# Casos de uso para mutaciones (Task #41, Fase M) — 2026-09-27

Capa nueva para las **mutaciones relevantes**, incorporada por decisión del
dueño del proyecto después de revisar dos documentos externos sobre
convenciones de flujo de datos. Este documento fija cómo se traducen las
ideas de esos documentos a las convenciones que motor2 YA tiene, para no
duplicar nombres ni capas.

Piloto: `anularCompra` (M1-M4) y `corregirCompra` (M6), en
`src/server/actions/movimientos/compras.ts`. Las dos Server Actions tenían
toda la cadena (permiso, idempotencia I3, transacción, guardas de negocio,
auditoría, reversión) escrita en línea; se extrajo a capas separadas SIN
cambiar el comportamiento observable (mismos mensajes, mismo hash I3, mismo
orden de escrituras, mismos tests de Vitest y de Playwright sin tocar).

## Documento 1: equivalencias con motor2

Rutas verificadas contra el repo el 2026-09-27 (base `91f37d3`).

| Documento 1 (propuesta externa) | Convención real en motor2 |
|---|---|
| `public.ts` | El de la Fase C: `public.ts` + `public-servidor.ts` por dominio de `core/` (la regla `sin-internals-de-otro-dominio` de `.dependency-cruiser.cjs` ya está preparada; `DOMINIOS_CON_PUBLIC` arranca vacía y ningún dominio tiene todavía su `public.ts`) |
| `contratos.ts`, `proyecciones/` | Tipos en `core/features/<f>/<f>.schema.ts` (hoy: `compras/compra.schema.ts`, `traspasos/traspaso.schema.ts`) |
| `comandos/`, `guards/` | `<f>.schema.ts` + `<f>.guard.ts` (convención ya usada desde el 2026-09-25) más los módulos de reglas puras de `core/<dominio>/` (ej. `core/compras/anulacion.ts`, `core/compras/correccion.ts`) |
| `consultas/` | `server/consultas/` (Fase D, piloto `server/consultas/catalogo/productos.ts`) para lecturas de UI; para cargas DENTRO de una mutación, `server/persistencia/<dominio>/cargar-*.ts` |
| `casos-de-uso/` | `server/actions/<dominio>/casos-de-uso/<verbo>.ts` |
| `persistencia/` | `server/persistencia/` — NUNCA en `core/` |
| Evento/outbox | No se adopta ningún bus. `Operacion`, `anuladaEn`, la auditoría (`RegistroAuditoria`) y la clave I3 (`claveIdempotencia`/`payloadHash`/`resultadoMensaje`) cumplen ese papel |

## Documento 2: ideas que NO se adoptan ahora

| Idea | Decisión |
|---|---|
| Fábrica de conexión Prisma con nombres explícitos tipo `tenantDb` | No aplica: motor2 no es multi-tenant (una base, varias sucursales con `sucursalId`), y "tenant" ya significa otra cosa en este repo — el registro del portal de la carta (`docs/plan-registro-tenants-2026-09-24.md`, `SucursalPublica`). La conexión sigue siendo el singleton de `src/lib/db.ts`; la persistencia de escritura recibe el `tx` de quien la llama. |
| `puertos.ts` separado de `public-servidor.ts` | Redundante: `public-servidor.ts` (Fase C) ya es la fachada de lo que un dominio expone solo del lado del servidor. No se crea. |
| `Prisma TypedSQL` para reportes | No prioritario. Hoy el único candidato real es `core/reportes/costo-historico.ts` (el único `$queryRaw` de `src/`). Se reevalúa si aparecen más de 3 consultas crudas. |

## Qué es una "mutación relevante" (alcance de esta fase)

Operaciones que **mueven stock o dinero**, o **cierran un ciclo**
(anular/revertir), más los **campos auditados de precio**. El CRUD simple de
catálogo/carta/permisos NO entra en esta fase: sigue como Server Action
directa con `conPermiso`.

## Las capas del piloto

```
Pantalla ─► Server Action ("use server", adaptador fino)
              conPermiso(clave) → guard del comando → caso de uso → aResultadoAccion
                                     │                    │
                     core/features/compras/          server/actions/movimientos/casos-de-uso/
                     compra.guard.ts / .schema.ts    anular-compra.ts, corregir-compra.ts
                                                       ("server-only", sin "use server")
                                                         │ conTransaccionSerializable(tx => …)
                                                         ├─ idempotencia I3 (core/movimientos/idempotencia.ts)
                                                         ├─ cargar-*   (server/persistencia/compras/, tx obligatorio)
                                                         ├─ reglas puras (core/compras/anulacion.ts, correccion.ts)
                                                         ├─ escribir-* (server/persistencia/compras/, tx obligatorio)
                                                         ├─ auditoría (core/permisos/auditoria.ts)
                                                         └─ ResultadoCaso (core/resultado-caso.ts)
```

- **`core/resultado-caso.ts`**: `ResultadoCaso<T, C>` = `{ ok: true, mensaje, datos }`
  o `{ ok: false, codigo, mensaje, erroresPorCampo? }`, con `exito()`,
  `fracaso()` y `aResultadoAccion()`. La traducción a `ResultadoAccion`
  (`src/server/actions/tipos.ts`, que NO se reemplaza) descarta a propósito
  `datos`, `codigo` y `erroresPorCampo`: la pantalla sigue recibiendo
  exactamente `{ ok, mensaje }`.
- **Comando + guard** (`core/features/compras/`): `ComandoAnularCompra`,
  `ComandoCorregirCompra`, sus `Resultado*` y `guardComando*` (forma
  `ResultadoDato` de `core/datos/resultado.ts`). Un `operacionId` que no es
  string da el mismo mensaje que «no encontrada» (antes: error crudo de
  Prisma). `esClaveIdempotenciaValida` se movió a
  `core/datos/clave-idempotencia.ts` (puro, sin `node:crypto`);
  `core/movimientos/idempotencia.ts` la reexporta.
- **Persistencia de escritura** (`server/persistencia/<dominio>/`): `tx:
  Prisma.TransactionClient` obligatorio como primer parámetro (nunca `db =
  prisma`: a diferencia de `server/consultas/`, siempre corre dentro de la
  transacción del caso de uso), devuelve tipos de dominio (los `Decimal` se
  convierten a `number` en el borde), sin reglas de negocio.
- **Caso de uso** (`server/actions/<dominio>/casos-de-uso/<verbo>.ts`):
  `import "server-only"` y sin `"use server"` (no es un endpoint), sin
  chequeo de permiso (lo hizo `conPermiso`), recibe `actor` (`usuarioId` +
  `sucursalId` del `ContextoUsuario`) y el comando ya validado. Orquesta
  dentro de UNA transacción serializable en el orden de siempre.

## Reglas de dependency-cruiser que lo sostienen

- **`persistencia-solo-desde-casos-de-uso`** (M5): solo un archivo bajo
  `server/actions/**/casos-de-uso/` (o la propia persistencia) importa
  `server/persistencia/`. Complemento en Vitest
  (`test/arquitectura/dependencias.test.ts`): ningún caso de uso lleva
  `"use server"` y todos abren con `import "server-only"`.
- **`accion-migrada-sin-orquestacion`** (M7): las Server Actions de
  `ACCIONES_CON_CASO_DE_USO` (`.dependency-cruiser-excepciones.cjs`) no
  importan `@/lib/db` ni `@prisma/client` en runtime (`import type` sí), ni
  reintento/idempotencia/auditoría, ni `server/persistencia/`: todo eso pasa
  por su caso de uso. Complemento en Vitest: cada archivo de la lista existe
  y lleva `"use server"`.

## Acciones migradas después del piloto

- **M8 — `anularVenta`** (`src/server/actions/movimientos/venta.ts`): comando + guard en `core/features/ventas/` (`venta.schema.ts`,
  `venta.guard.ts`: un `operacionId` que no es string da «no encontrada»; antes, con `undefined`, Prisma ignoraba el filtro y cargaba la
  primera operación de la sucursal); reglas puras (`evaluarAnulacionDeVenta`, `construirReversionDeVenta`, textos de mensaje y de
  auditoría) en `core/movimientos/anulaciones.ts` — es la guarda "F3" de ventas de `plan-mutaciones-controladas-2026-09-25.md`, antes en
  línea; persistencia en `server/persistencia/movimientos/` (`cargar-venta-para-anular.ts`, con `cargarVentaParaAnular` y
  `cargarHermanasDePromo`, y `escribir-anulacion-de-venta.ts`, una llamada por Operación anulada); caso de uso
  `casos-de-uso/anular-venta.ts`. Sin I3: `anularVenta` nunca la tuvo y no se agregó. Las hermanas de promo (Task #16, D4) se cargan
  recién después de las guardas, igual que antes, y cada Operación escribe su contra-asiento y su fila de auditoría en el mismo orden.
- **Efecto colateral en `registrarVenta`** (mismo archivo): la regla `accion-migrada-sin-orquestacion` se aplica al archivo entero, así que
  su bloque transaccional (I3 + `registrarVentaEnTx`) pasó TAL CUAL a `casos-de-uso/registrar-venta.ts`. Sus validaciones de entrada
  siguen en la Server Action; pasarlas a un guard de comando queda para la migración propia de `registrarVenta`.
- **M11a — `aprobarYEnviarTransferencia`, `cancelarSolicitudTransferencia`, `rechazarSolicitudTransferencia`**
  (`src/server/actions/traspasos/traspasos.ts`): guards de comando en `core/features/traspasos/traspaso-comandos.guard.ts` (el guard de
  TRANSICIÓN, `traspaso.guard.ts`, no se tocó: lo llama el caso de uso dentro de la transacción), comandos y resultados en
  `traspaso.schema.ts`; persistencia en `server/persistencia/traspasos/` (`cargar-traspaso.ts`, `escribir-aprobacion-de-traspaso.ts`,
  `escribir-cierre-de-solicitud.ts`); casos de uso en `server/actions/traspasos/casos-de-uso/` (`aprobar-y-enviar-traspaso.ts`,
  `cancelar-solicitud-de-traspaso.ts`, `rechazar-solicitud-de-traspaso.ts`, más el paso compartido `producto-transferible.ts`). Sin I3
  (ninguna de las tres la tenía). Un `seccionOrigenId` que no es string da «Elegí de qué sección propia sale.» (antes: error crudo de
  Prisma). **Migración PARCIAL a propósito:** `traspasos.ts` NO entra todavía en `ACCIONES_CON_CASO_DE_USO` — sigue teniendo
  mutaciones sin migrar (M11b: aceptar/rechazar envío/reingreso; M11c: crear solicitud/envío directo) que tocan Prisma directo, y la
  regla vale para el archivo entero. Se suma cuando termine M11c; hasta entonces, `obtenerProductoTransferible`, `buscarTraspaso` y
  `escribirMovimientoTraspaso` siguen en el archivo para esas acciones.
- **M12a — `cerrarCuenta`** (`src/server/actions/pos/cuenta-cierre.ts`): comando + guard en `core/features/cuentas/` (`cuenta.schema.ts`,
  `cuenta.guard.ts`: un `cuentaId` que no es string da «No se encontró esa cuenta en esta sucursal.», igual que antes); persistencia en
  `server/persistencia/pos/` (`cargar-cuenta-para-cerrar.ts`: la cuenta, el último número de boleta de la sucursal y la Operacion del
  consumo para la auditoría de stock negativo; `cerrar-cuenta.ts`: ejemplar A de la boleta, enlace ítem → Operacion, cierre de la cuenta);
  caso de uso `pos/casos-de-uso/cerrar-cuenta.ts`, que llama a `registrarVentaEnTx` sin tocar ese núcleo y numera DESPUÉS de que la venta
  salió bien (un `fracaso` devuelto adentro confirma la transacción). Sin I3: sigue idempotente por estado (`YA_CERRADA`). El archivo NO
  entra todavía en `ACCIONES_CON_CASO_DE_USO`: `emitirBoletaCorregida` (mismo archivo) se migra en M12b.

## Cómo se migra la próxima acción

1. Comando + `Resultado*` en `<f>.schema.ts`, `guardComando*` en `<f>.guard.ts`, armadores puros de mensajes en `core/<dominio>/`.
2. `cargar-*`/`escribir-*` en `server/persistencia/<dominio>/`, copiando las consultas tal cual.
3. El caso de uso, con el mismo orden de pasos que la acción original.
4. La acción queda como adaptador fino y se suma a `ACCIONES_CON_CASO_DE_USO`.
5. Los tests existentes de la acción (Vitest y Playwright) no se tocan: `git diff` vacío sobre ellos es la prueba de que no cambió el comportamiento.
