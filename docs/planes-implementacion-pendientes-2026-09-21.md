# Planes de implementación de los pendientes abiertos (2026-09-21)

Seis planes diseñados con la skill `plan-con-verificacion-e2e` (un agente `Plan` con Opus por pendiente), a partir de `docs/p2109.md` y de `docs/grounding-decisiones-abiertas-erpnext-dolibarr-2026-09-21.md`. **Ningún plan está implementado.** Cada agente leyó el código de `main` (`d5b05b7`, árbol limpio) antes de proponer; donde el código contradice a un documento previo, se anota como corrección.

Este documento es una **versión condensada** de los seis informes: conserva hallazgos, decisiones abiertas, pasos, tests y riesgos, pero no reproduce cada párrafo. Las recomendaciones son criterio de los agentes, **no decisiones del negocio**.

## 1. Resumen

| Plan | Qué es | Migración | Decisión que falta | Corte implementable ya |
|---|---|---|---|---|
| ~~**E4**~~ | ~~Memoria por usuario de los últimos valores del alta de producto~~ **Descartada e implementada-revertida (`76a44fa`)** | — | — | — |
| **6b** | Costo de lo vendido (consumo) junto al ratio Compras/Ventas | No | ¿Se muestra? ¿Se aplica el paso 2 (ventas sin precio)? | Exponer el número en el core (paso 1) |
| **E1** | Digest diario de alertas de stock por mail | Sí (`AlertaStockAvisada`) | Digest o mail por ítem; a quién | Pasos 1 a 5 y 7 sin cuenta de Resend |
| **K1b/K1c** | Anular y corregir una compra confirmada | Sí (índice único) | Campos corregibles, bonificación, permisos, orden | Fase 0 |
| ~~**E5**~~ | ~~Conteo Físico: buscar por receta~~ **Descartada por innecesaria (2026-09-21)** | — | — | — |
| **Paso 7** | Pivot de reportes para el contador | No | 8 preguntas de alcance (el corte 1 no depende de ninguna) | Corte 1 |

**Reglas comunes a todos los planes**
- **Ninguna migración se aplica en Neon.** La autorización vigente (2026-09-21) cubre solo escribir y probar migraciones en bases **locales**. Todo paso con schema o migración va marcado «requiere autorización expresa» y aislado en su propio commit.
- `npm run build` ejecuta `prisma migrate deploy`: apuntar `DATABASE_URL`/`DIRECT_URL` a una base local descartable, nunca a producción.
- Antes de proponer algo sobre rutas, Server Actions, cookies o formularios hay que leer la guía en `node_modules/next/dist/docs/` (Next 16.3.5; `AGENTS.md`).
- Un commit por paso, en orden, cada uno reversible.

**Verificación final común (paso obligatorio de cada plan).** Se corre **en la misma corrida y en este orden**; el pendiente se cierra solo si todo pasa limpio a la vez:

1. **Línea de base antes de tocar nada:** `npm test` y `npx playwright test --list`, y anotar los conteos reales. Última cifra conocida (a confirmar corriendo): Vitest 100 archivos / 926 tests, axe 12/12, Playwright 193/193.
2. `npx tsc --noEmit` → salida vacía (único ruido preexistente y ajeno tolerado: `LayoutProps` de `layout.tsx`).
3. `npm run lint` → 0 errores, 0 warnings.
4. `npm test` (Vitest contra Postgres real, `fileParallelism: false`) → todo verde, conteo igual o mayor.
5. `npx playwright test test/e2e/accesibilidad.spec.ts` → todo verde, con un chequeo axe propio para cada pantalla o estado nuevo.
6. `npm run build` → OK sin warnings nuevos.
7. `npm run test:e2e` → todos los specs verdes, conteo igual o mayor; el servidor corre en modo `build` por defecto (la salida debe decir `[e2e] Servidor: build`).

**Aislamiento E2E (verificado por los agentes).** `global-setup.ts` vacía la base `_e2e` (todas las tablas leídas de `information_schema`, así que una tabla nueva queda cubierta sola) y siembra antes de cada corrida; `global-teardown.ts` la vacía al final; `workers: 1`. **Dentro de una misma corrida no hay limpieza entre specs**: los specs nuevos usan nombres únicos con `Date.now()` y limpian en `finally`. Ningún spec depende del modo dev. En Vitest, `test/setup/test-db.ts::limpiarBaseDeTest` es una lista **hardcodeada**: una tabla nueva exige agregarle su `deleteMany`.

## 2. E4: memoria de los últimos valores del alta de producto

> **DESCARTADA (2026-09-21).** Se implementó con la variante «base de datos» hasta el paso 5 (commits `e7acde1`, `7ddac47`, `59d7bf0`, `2f22bc9`, `d147113`) y se revirtió completa en `76a44fa` porque la función resultó innecesaria. La migración `PreferenciaUsuario` nunca se aplicó en Neon y se quitó de las bases locales (`motor2_dev`, `motor2_e2e`). Esta sección queda solo como registro.
>
> **Sigue vigente de este plan:** el hallazgo 4 (la pantalla de alta de producto **falla axe hoy**: los `<select>` y varios campos no tienen nombre accesible). Es deuda preexistente, independiente de E4, y conviene tratarla como pendiente propio.

### Recomendación

**Base de datos, con una tabla genérica `PreferenciaUsuario(usuarioId, clave, valor Json)`.**
- Es el patrón de ERPNext (`DefaultValue`, `__UserSettings`) y Dolibarr (`llx_user_param`) para lo «por usuario».
- «Olvidar» solo es honesto en base: con cookie solo borra en ese navegador.
- Una tabla genérica paga una sola migración y sirve también a E3.

**Alternativa: cookie httpOnly.** Cero migraciones y reversible, pero no acompaña al usuario entre dispositivos y hay que guardar el `usuarioId` dentro de la cookie para descartarla si no coincide con la sesión (otra persona en la misma PC). Descartado `localStorage`: el formulario se vería vacío un instante en cada alta.

Memoria por **usuario**, no por usuario × sucursal: `Producto` y el catálogo son globales.

### Hallazgos del código

1. **«Uso» no se puede recordar:** se eliminó a propósito y se deriva del tipo (`usoDeTipo()`).
2. **Insumo no estaba en la lista del motor viejo** y queda **fuera** de la memoria: agruparía productos sin relación y chocaría con E3, que propondrá ese campo.
3. **De los 5 campos recordados, 3 son estado controlado** (`tipo`, `categoriaId`, `unidadStockId`) y 2 no (`unidadCompraId`, `factorConversion`); estos dos pasan a controlados para poder resetearlos.
4. **La pantalla de alta falla axe hoy**, antes de E4: los `<select>` y varios campos no tienen nombre accesible. Deuda preexistente; se arregla en un paso propio previo al chequeo axe.
5. **El alta rápida del wizard de Compra no se toca** (crea con `tipo: "MP"` fijo, factor 1, sin categoría); un test fija la decisión.

### Qué se recuerda y qué no

- **Sí (5):** `tipo`, `categoriaId`, `unidadStockId`, `unidadCompraId`, `factorConversion`. El factor solo sobrevive junto con su par de unidades; si alguna no sobrevive, vuelve a 1.
- **No:** `nombre` y `codigo` (unicidad), precios (dinero), `observaciones`, `esConsignacion`, `proveedorConsignacionId`, `seProduce`, `insumoId`, «Uso».
- **Cuándo se guarda:** solo tras un alta exitosa, en modo best-effort (`try/catch`: un fallo de la memoria nunca rompe el alta). Nunca al tipear, al editar ni desde el alta rápida.

### Diseño

- `src/core/catalogo/memoria-alta-producto.ts` (puro): forma con `v: 1`, `parsearMemoria` tolerante (nunca lanza), `sanearMemoria` contra las listas que ve el usuario.
- `memoria-alta-producto-almacen.ts` (`server-only`): **único archivo que cambia entre cookie y base**.
- Acción `olvidarMemoriaAltaProducto()` sin `conPermiso` (preferencia personal, como `cambiarSucursalActiva`), con `obtenerContextoUsuario()` y `irAlLogin()` si no hay sesión.
- **Invariante:** la memoria nunca preselecciona algo que el usuario no podría elegir a mano. Un valor borrado o desactivado queda vacío, sin cartel de error; el resto se aplica.
- `editar/page.tsx` no recibe la memoria.
- **UI:** «Precargado con lo último que cargaste.» y un botón `type="button"` «Olvidar los últimos valores»; al terminar, `role="status"`, reset de campos, foco al campo Nombre y `router.refresh()` desde el cliente.
- **Precedencia para E3:** tipeado > sugerencia (E3) > memoria (E4) > vacío.
- **Restricciones de selectores de specs existentes:** ningún `<select>` nuevo antes del primero ni con `required` (`catalogo-alta-producto.spec.ts`, `catalogo-editar-producto.spec.ts`).

### Pasos (un commit cada uno)

0. Línea de base (sin commit).
1. Módulo puro + tests.
2. **Requiere autorización expresa, solo variante base:** migración `PreferenciaUsuario` (con `onDelete: Cascade` desde `User`), más su `deleteMany` en `limpiarBaseDeTest` **antes** de `user.deleteMany()`. Con la variante cookie este paso se reemplaza por generalizar el stub de `next/headers` de Vitest a un cookie jar real.
3. Almacén de la memoria.
4. El alta exitosa guarda la memoria (`darDeAltaProducto` pasa a `conPermiso`).
5. El alta precarga los valores.
6. Botón «Olvidar».
7. `fix(a11y)`: nombres accesibles de los campos de alta y edición (prerrequisito de axe).
8. E2E y axe.
9. Documentación.
10. Verificación total.

### Tests y E2E

- **Vitest:** extracción, parseo tolerante, saneo, alta exitosa guarda solo los 5 campos, alta fallida y alta rápida no guardan, un almacén que lanza no rompe el alta.
- **Playwright** (`catalogo-memoria-alta-producto.spec.ts`): alta con memoria y el contraespejo (nombre, código y precio vacíos), «Olvidar» con recarga, valor recordado inexistente, y con cookie, memoria de otro usuario. Axe de `/catalogo/productos/nuevo`.
- **Riesgo real con la variante base:** todos los specs comparten `e2e-admin@local.test` y la memoria sobrevive entre specs de la misma corrida. Mitigación: usuario, rol y sesión propios (patrón `abrirComoRol`) y sembrar y borrar en `try/finally`. Con cookie el aislamiento sale gratis.
- Mirar con atención: `catalogo-alta-producto.spec.ts`, `catalogo-editar-producto.spec.ts`, `catalogo-productos-permiso-editar.spec.ts`, `movimientos-compra-wizard.spec.ts`.

## 3. 6b: costo de lo vendido (consumo) junto al ratio Compras/Ventas

> **ESTADO (2026-09-21): HECHA**, con el paso 2 (excluir las ventas sin precio) aplicado; ver `docs/p2109.md` §1.c. Quedan sin hacer los pasos opcionales 4 (columna por producto) y 5 (Resumen operativo).

### Hallazgo principal

**El cálculo ya existe.** `calcularMargenDelPeriodo` (`src/core/reportes/periodo.ts`) acumula `costoRealTotal` pero no lo devuelve. 6b es exponerlo y presentarlo: cero consultas nuevas, cero columnas.

### Correcciones a p2109 y a documentos previos

- El ratio se ve en **una sola pantalla**: la tarjeta «Compras» de `/reportes/periodo`. `reportes/compras` es el listado de facturas y no tiene nada que acompañar.
- La columna «Margen Real» que «queda vacía» está en **Promociones**, no en Período; se vacía por falta de productos en promoción o por `promocionesHabilitadas`, no por `costoUnitarioVenta`.
- **El seed de la demo no inserta ventas a mano:** llama a `registrarVenta`, que graba `costoUnitarioVenta`, y además el reporte reconstruye los costos faltantes con el historial de compras. Lo esperable es un valor poblado con cobertura parcial en los primeros días.
- **El remedio de p2109 está invertido:** ventas con `costoUnitarioVenta: null` producen justo el caso «no lo guardó». La decisión del seed sigue siendo aparte.

### Diseño

- **Dónde:** sublínea nueva en la tarjeta «Compras» de `/reportes/periodo`. Opcional: sublínea en «Gastado en compras» de `/reportes` (paso 5) y columna por producto en «Ventas por producto» (paso 4, con riesgo de maquetación a 1024 px). No se toca Consolidado, Promociones ni `reportes/compras`.
- **Numerador:** `costoRealTotal` (costo congelado, o reconstruido con el historial de compras). **Denominador:** `ingresoConCostoReal`, **no** el total facturado: mezclarlos daría un porcentaje artificialmente bajo.
- **Cobertura:** `ingresoConCostoReal / (ingresoConCostoReal + ingresoSinCostoReal)`. No usar `margen.ingresoTotal` como base (incluye ventas estimadas).
- **Rótulos:** «Compras / Ventas (desembolso)» y «Costo de lo vendido (consumo): $X (Y %)», con `· reconstruido` y `· parcial (cubre Z %)` en ámbar (`text-amber-700 dark:text-amber-600`). Sin ningún costo real: «sin datos todavía».
- **Permisos y migración:** ninguno nuevo; sigue detrás de `ver_reportes_dinero`.
- **Asimetrías que hay que declarar:**
  1. **Packaging.** El costo congelado incluye packaging y limpieza; el ratio de compras los excluye. No son comparables al centavo; el aviso lo dice. Separarlos exigiría una columna nueva (fuera de alcance, requeriría autorización).
  2. **Ventas sin precio.** El bucle del margen Real suma su costo pero no su ingreso, así que el Margen Real ya está subestimado y el consumo saldría inflado. Es un hallazgo previo a 6b.
  3. Ventas estimadas frente a cobertura (ya cubierto arriba).

### Si el negocio dice «no»

Se pierde el único número que responde cuánto costó lo que se vendió; el food cost % queda sin mostrar aunque esté calculado; y se pierde la señal de calidad de datos (`ingresoSinCostoReal`). El paso 1 (exponer en el core, sin UI) es inofensivo y se puede hacer igual.

### Pasos

0. Línea de base, más una consulta de solo lectura para medir qué muestra la demo (sin modificarla).
1. Core: exponer `costoDeLoVendidoTotal`, `costoDeLoVendidoPctTotal`, `coberturaCostoRealPct` y `avisoCostoDeLoVendido`.
2. **Recomendado, a decidir:** excluir de `costoRealTotal` las ventas con `precioTotal <= 0`. **Cambia números ya visibles** (`margenRealTotal` y la columna de Promociones). Si no se hace, el aviso debe decir que esas ventas inflan el porcentaje.
3. UI de Período (con `data-tarjeta="costo-de-lo-vendido"`). **No agregar validación de fechas:** `pantalla-de-error.spec.ts` depende de que una fecha inválida siga reventando.
4. Opcional: columna por producto.
5. Opcional: Resumen operativo (todo derivado de `rep.margen`, sin recalcular).
6. E2E y axe.
7. Documentación (incluye corregir la fila «Seed de la demo» de p2109).

### Tests

- Nuevo `test/reportes/costo-de-lo-vendido.test.ts`: cobertura total con la identidad `costo ≈ ingresoConCostoReal − margenRealTotal`; **cobertura parcial con aserción de que el denominador NO es el total facturado**; sin ningún costo real; sin ventas; reconstruido; el guardián que justifica mostrar los dos (compra grande de stockeo con pocas ventas: ratio alto y consumo bajo); packaging; y, si se hace el paso 2, venta sin precio.
- E2E con **ventana de fechas exclusiva** (p. ej. marzo de 2024), porque el reporte agrega sobre toda la sucursal; axe acotado a la tarjeta.
- Mirar: `venta-costo-congelado.test.ts` (el más sensible), `periodo.test.ts`, `costo-historico.test.ts`, `no-comestibles.test.ts`, `promociones.test.ts`, `resumen-operativo.test.ts`, `catalogo-una-sola-carga.test.ts` y `carga-unica-catalogo.test.ts` (fallan si se agrega una consulta), `contraste-de-color.test.ts`, `maquetacion-general.spec.ts`.

## 4. E1: alertas de stock por mail

### Recomendaciones

- **A1, digest diario por sucursal**, no mail por ítem. Ningún referente manda mail por ítem; con mínimos recién cargados el volumen no tendría tope y chocaría con el límite de Resend (10 pedidos por segundo).
- **B1, a todos los usuarios con `notificar_alertas` en esa sucursal.** No requiere migración; hoy solo `admin` tiene el permiso. Para llegar a una sola persona se puede crear un rol dedicado con las pantallas existentes. **B2** (un responsable por sucursal) exige la columna `UsuarioSucursal.recibeAlertasStock` y queda como paso 9 aislado, con autorización expresa.
- Sub-decisión menor propuesta: el destinatario se define por `puedeVer` (no `puedeEditar`), porque Ver ⊇ Editar.

### Hallazgos del código

1. `calcularAlertasStock` sirve para el digest, pero devuelve filas por **producto × sección** (fija la granularidad del «ya avisado») y **no filtra productos ni secciones inactivos**. El filtro va en la capa del digest, no en la función, porque la consumen `/stock/alertas`, `salud-por-producto.ts` y `resumen-operativo.ts`.
2. `notificar_alertas` está definida y nadie la consume. Se resuelve por **rol × acción global + sucursal**, no usuario × sucursal.
3. **El opt-out por sucursal ya existe sin migración:** `CapacidadSucursal` con `notificar_alertas` (pantalla `/administracion/capacidades-sucursal`).
4. **`test/arquitectura/region-de-las-funciones.test.ts` afirma la lista completa de crons** y se rompe a propósito al agregar el tercero; se actualiza en el mismo commit.
5. El patrón de cron ya está fijado (`sincronizar-ipc`, `sincronizar-dolar`: `CRON_SECRET`, 401, `reportarErrorUnaVez`, 502) y se testea importando el `GET` directo.
6. No hay dependencia de mail, ni variable de Resend, ni URL pública de la app.
7. `fechaArgentina()` ya existe en `src/core/reportes/cotizacion-dolar.ts`.
8. **`RegistroAuditoria` no sirve:** su `entidad` es una unión cerrada y `actorId` es obligatorio; un cron no tiene actor.

### Diseño

- Puerto `EnviadorDeMail` con enviador en memoria (deduplica por clave de idempotencia, para tests) y enviador nulo (sin API key no manda nada y avisa una vez); fábrica `src/lib/mail.ts`, único lugar que lee env; adaptador de Resend con `fetch` directo. **Recomienda no agregar la dependencia `resend`** (el proyecto ya habla con tres APIs externas sin SDK).
- **«Ya avisado»:** tabla `AlertaStockAvisada` por producto × sección, con `estado` BAJO o CRITICO.
  - Se borra la fila cuando el ítem se recupera, para re-avisar si vuelve a caer.
  - Se re-avisa si empeora de BAJO a CRITICO.
  - No se re-avisa si mejora de CRITICO a BAJO ni si sigue igual.
  - Los flags se escriben **después** de un envío exitoso; se prefiere un posible duplicado antes que una alerta perdida.
- **Idempotencia en tres capas:** el flag, el orden de escritura, y la clave `Idempotency-Key` de Resend `alertas-<sucursalId>-<YYYY-MM-DD ARG>-<usuarioId>`.
- **Destinatarios:** `User.activoGlobal`, `UsuarioSucursal.activo`, `Rol.activo`, `Sucursal.activo`, capacidad de la sucursal. Una sucursal con alertas y **cero destinatarios** se reporta con `reportarErrorUnaVez`, no en silencio.
- **Contenido:** sucursal, fecha, conteos y una tabla de código, nombre, sección, saldo, mínimo, diferencia y estado. **Sin precios, costos, proveedores ni los mails de los demás.** Un envío por destinatario. Digest vacío: no se manda mail. Link a `/stock/alertas` solo si existe `MOTOR2_URL_BASE`.
- **Fallas parciales:** envío secuencial; una sucursal que falla no corta las demás; los flags se escriben si al menos un envío salió bien; el route decide 200 con `errores[]` o 502 si falló todo.
- **Horario:** `0 11 * * *` (08:00 ART).

### Riesgos y bloqueos externos

1. **Límite de crons del plan Hobby:** el repo ya tiene 2 y el límite histórico de Hobby es 2. El agente no pudo confirmar el límite actual. **Verificar en el dashboard de Vercel antes de tocar `vercel.json`.** Si es 2, alternativas: consolidar los tres en un solo endpoint diario (paso propio previo), o subir de plan. Los pasos 1 a 8 no dependen de esto.
2. Resend (cuenta, dominio verificado, API key) es acción de la persona responsable. Sin eso el sistema queda completo pero con el enviador nulo.
3. La migración de `AlertaStockAvisada` requiere autorización expresa (solo local).

### Pasos

0. Línea de base.
1. Puerto de mail, enviador en memoria y nulo.
2. Cálculo de destinatarios.
3. Armado del contenido (función pura).
4. Orquestación del envío, todavía sin flag.
5. Endpoint de cron, `vercel.json` (tras verificar el límite), actualizar `region-de-las-funciones.test.ts` y `.env.example`.
6. **Requiere autorización expresa:** migración de `AlertaStockAvisada`, con `deleteMany` en `limpiarBaseDeTest` antes de los borrados de producto, sección y sucursal.
7. Usar el flag: idempotencia, recuperación y re-alerta.
8. Adaptador real de Resend (se escribe y testea con `fetch` simulado, sin cuenta).
9. Solo si el negocio elige B2: **requiere autorización expresa.**
10. Documentación.
11. Verificación total.

**Regla durante la verificación:** no mandar un solo mail real, no cargar `RESEND_API_KEY` en el entorno local, no apuntar a Neon.

### Tests

Nuevos: destinatarios por sucursal, cron (sin secreto, secreto incorrecto, sin header, correcto), digest (orden, sin datos sensibles, escape de HTML, con y sin URL base), estado (umbral 0, recuperación y re-alerta, escalada, mejora parcial, falla de envío que no escribe flags), enviador en memoria y nulo, adaptador de Resend. **`test/stock/alertas.test.ts` debe seguir verde sin modificarse.** Los pasos 1 a 8 no tocan pantallas: axe no debería moverse.

## 5. K1b / K1c: corregir y anular una compra confirmada

> **ESTADO (2026-09-21): K1c (anular) y K1b (corregir) están HECHAS**, en local; ver `docs/p2109.md` §1.b y §1.d. Las decisiones (4) y (6) se resolvieron con las recomendaciones: K1b corrige solo la cabecera (variante V4) y los permisos son `anular_compra` y `corregir_compra`, solo admin. Sigue fuera de alcance K1d (notas de crédito).

### Orden de fases recomendado

**Fase 0 (cimientos) → K1c (anular) → K1b (corregir).** K1d (notas de crédito) queda fuera. K1a (el listado de compras registradas) **ya está hecho y mergeado**. Sin K1c, K1b no tiene salida para un precio mal cargado.

### Hallazgos del código que cambian el diseño

1. **«Anular y recargar» falla por dos barreras:** el índice único parcial `Operacion_factura_unica_key` y el chequeo rápido de `registrarMovimiento` (`movimientos.ts:257-262`), que no mira `anuladaEn`. Hay que tocar ambas.
2. **El índice nuevo va en dos migraciones de una sentencia cada una** (`CREATE` y `DROP INDEX CONCURRENTLY` no pueden ir en una transacción). No se reescribe la migración ya aplicada (rompería el checksum).
3. **`anularVenta` no excluye la venta anulada del ingreso de los reportes:** escribe líneas de reversión con `proceso: "AJUSTE"` y `calcularVentasDelPeriodo` solo suma las de VENTA. La frase de K1c «los reportes la excluyen» es falsa hoy. Hallazgo preexistente; **este plan no lo arregla**, queda anotado como pendiente propio.
4. **La anulación se valúa sola al costo de la compra original** (cada línea ya guarda su precio y la reversión lo niega). Coincide con ERPNext y no depende de la decisión (2).
5. **Anular una compra vieja cambia retroactivamente** el costo de reposición y el margen Real reconstruido de períodos cerrados (`obtenerCostoActualPorMP`, `costo-historico.ts`). Es correcto, pero hay que avisarlo en la UI y fijarlo con un test. `costoUnitarioVenta` congelado no cambia nunca.
6. **Kardex es append-only por invariante del schema:** se contra-asienta con líneas inversas (copiando `loteVencimiento`), nunca se edita. Se usa `proceso: "AJUSTE"`, no un `Proceso` nuevo ni líneas `COMPRA` negativas (romperían el costo de reposición y chocarían con el índice único).
7. **`RegistroAuditoria.entidad`** es unión de literales solo en TypeScript: agregar `"Operacion"` no requiere migración.
8. **Una ruta nueva bajo `/reportes`** rompe `reportes-con-permiso.test.ts`: anular y corregir van **en línea** dentro de `/reportes/compras`.
9. Una `Accion` nueva exige su entrada en `acciones.ts` más una migración de datos idempotente (molde `20260919120000_permisos_reportes_y_acciones_faltantes`) y su test espejo.

### Decisiones que siguen siendo del negocio (el plan no decide ninguna)

- **(4) Campos corregibles.**
  - V1: editar en el lugar proveedor, N.º de factura y precios; exige `UPDATE` de `MovimientoStock`, contradice el append-only y es más laxa que ERPNext y Dolibarr.
  - V2: solo cabecera.
  - V3: estándar puro, anular y recargar.
  - **V4 (recomendada):** V2 más anular y recargar para los precios y, más adelante, NC de bonificación.
  - Bloquea solo el alcance de la Fase 2.
- **(2) Bonificación sobre el costo de reposición:** solo bloquea K1d. Si se eligiera V1, (2) y (4) quedan acopladas.
- **(6) Permisos:** **A (recomendada)** claves nuevas `anular_compra` y `corregir_compra`, solo admin; B reusar `anular_venta`; C reusar `proceso_ajuste` y `proceso_compra`. Bloquea un solo paso por fase.
- **(7) Por dónde empezar:** la recomendación de arriba.
- Ya resueltas por el estándar: (1) NC vinculada por defecto, (3) gasto neto con bruto visible (para anulación se recomienda excluir), (5) bloquear la anulación con stock consumido y ofrecer la NC.

### Diseño técnico

- **`anularCompra`** (`src/server/actions/movimientos/compras.ts`): `conPermiso` → transacción serializable → idempotencia opcional → cargar la operación filtrando por sucursal → guardas (es COMPRA, no anulada) → validación de stock por bucket `(producto, sección, lote)` agregando líneas que comparten bucket → `Operacion` de reversión `AJUSTE` con `detalleLibre` que cita la compra → líneas negadas con el mismo lote → marcar `anuladaEn` y `anuladaPorId` → `registrarCambioAuditado`.
- **`corregirCompra`** (variante V2/V4): guarda optimista contra los valores esperados, validación de largo, chequeo de duplicado **excluyendo anuladas y la propia operación**, más `esChoqueDeFacturaUnica` como árbitro bajo concurrencia; `update` de `Operacion` y una fila de auditoría por campo cambiado. El Kardex no se toca.
- El cliente hace `router.refresh()`; la acción **no** llama a `refrescarVistaSiHaceFalta` (lo vigila `refrescar-vista.test.ts`).

### Pasos

**Fase 0, cimientos (ninguna decisión los bloquea)**
- **P0.1** Los reportes de dinero dejan de contar compras anuladas. Hoy es un no-op semántico. Puntos de lectura afectados, lista cerrada: el `findMany` maestro y el `groupBy` del período anterior en `periodo.ts`, `obtenerPrecioAnteriorPorInsumo`, `obtenerCostoActualPorMP`, `costo-historico.ts` (findMany y `$queryRaw`), `rendimiento-recetas.ts` (×2), `compras-registradas.ts`, `trazabilidad.ts`. El `groupBy` del ratio excluye solo COMPRA anuladas, para no cambiar en silencio el tratamiento de ventas anuladas.
- **P0.2** Test guardián de arquitectura que exige que toda consulta de reportes sobre COMPRA filtre anuladas, con lista blanca comentada.
- **P0.3** La anulación se ve para cualquier proceso (Trazabilidad y listado), y se excluye del total de la página.
- **P0.4** **Requiere autorización expresa:** índice único que ignora anuladas (dos migraciones de una sentencia), `factura-unica.ts` acepta ambos nombres de índice, y el chequeo rápido agrega `anuladaEn: null`. Aplicar en Neon es una acción aparte; antes, verificar duplicados con `SELECT ... WHERE anuladaEn IS NULL ... HAVING count(*) > 1` (debe dar 0 filas).
- **P0.5** **Requiere autorización expresa por tocar el archivo:** docstrings del schema «Solo VENTA» a «VENTA y COMPRA». Son comentarios `///`; confirmar con `prisma migrate diff` (salida vacía).

**Fase 1, K1c**
- P1.1 Reglas puras (`src/core/compras/anulacion.ts`).
- P1.2 **Bloqueado por (6), requiere autorización expresa:** clave nueva, migración de datos y test espejo.
- P1.3 La acción `anularCompra` y sus tests (feliz, stock consumido, doble anulación, otra sucursal, no-COMPRA, por lote, auditoría, idempotencia).
- P1.4 UI en línea, con las mejoras de accesibilidad de `boton-activar-desactivar.tsx`. El botón se dibuja solo con permiso de editar.
- P1.5 Test de «anular y recargar» con el mismo N.º (secuencial y en carrera).
- P1.6 E2E y axe de cada estado nuevo (confirmación abierta, bloqueo por stock, fila anulada).

**Fase 2, K1b (alcance bloqueado por (4); un paso por (6))**
- P2.1 Reglas puras. P2.2 Clave `corregir_compra` (puede fusionarse con P1.2). P2.3 `corregirCompra`. P2.4 UI en línea. P2.5 E2E y axe. P2.6 Documentación.

### Tests nuevos mínimos

Anular con stock consumido (incluido el caso del lote); anular y recargar; compra anulada fuera de todos los reportes; doble envío idempotente; concurrencia de dos anulaciones; corrección (completar «Sin proveedor», choque contra vigente y contra anulada, corrección sobre anulada rechazada, guarda optimista, auditoría); migración de permisos; guardián de arquitectura; E2E y axe.

### Riesgos

Retroactividad de la anulación sobre costos históricos; asimetría preexistente de VENTA; sin cuentas a pagar, así que no hay saldo con el proveedor que compensar; `npm run build` aplica migraciones.

## 6. E5: Conteo Físico, búsqueda por receta

> **DESCARTADA (2026-09-21):** la persona responsable la consideró innecesaria. Esta sección queda solo como registro; no hay nada pendiente.

### Hallazgos del código (corrigen el grounding y reducen el peso de las 7 preguntas)

1. **Un ingrediente no puede ser un PV con `seProduce`:** `validarIngredientes` (`recetas.ts`) solo acepta MP activas. El caso recursivo real es una **MP con `seProduce`** (salsa base, prepizza).
2. **Todo ingrediente de primer nivel es siempre contable** (pasa `tieneStockReal`), así que el corte mínimo nunca genera una fila que el guardado rechace por tipo.
3. **No hay doble conteo de stock entre un intermedio y sus MP:** `PRODUCCION` consume las MP y da de alta el intermedio; son dos stocks reales independientes, contar ambos es correcto. La pregunta 3 del grounding estaba mal planteada.
4. **El riesgo real es el doble ajuste por lote:** la grilla trae una fila por `(producto, lote)` y una fila manual sin lote usa `calcularSaldoTotal`. Agregar por receta una MP que ya tiene filas por lote escribiría dos `ConteoFisico` y dos movimientos `CONTROL` sobre el mismo stock. **Resaltar en vez de duplicar es una restricción técnica, no una decisión de negocio.**
5. **Hoy el buscador no encuentra platos** (`soloConStockReal` = MP o PV con `seProduce`). Ya existe el filtro que hace falta, `elegibleParaReceta`; no hay que tocar `productos.ts`.
6. La receta es global; el saldo es por sección. E5 no usa cantidades, así que la merma queda fuera por diseño.
7. **No hace falta migración.**

### Corte 1 (implementable ya, sin decidir ninguna pregunta)

Un segundo buscador, «Buscar por receta (plato o preparación elaborada)», con filtro `{ soloActivos: true, elegibleParaReceta: true }`. Al pulsar «Ver ingredientes» se abre un **panel de propuesta** (todavía no agrega nada) con los ingredientes de primer nivel de la versión vigente. Por cada uno: código, nombre, unidad, saldo en la sección (por lote si tiene) y un estado textual, nunca solo color:
- `ya está en la grilla`: no se agrega, se resalta.
- `sin saldo en esta sección`: agregable como fila sobre saldo 0.
- `inactivo — no se puede contar`: informativo, no seleccionable.
- `tiene receta propia`: pista para buscarlo a él en el mismo buscador.

«Agregar las N seleccionadas» agrega filas normales y editables (mismo mecanismo `filasManuales`), resalta las existentes, anuncia el resultado en `role="status"` y deja el foco en «Contado» de la primera fila agregada. **Sin efecto sobre el stock**; las cantidades ya tipeadas no se tocan.

### Las 7 preguntas: recomendación y qué bloquea

| Pregunta | Recomendación (opinión técnica) | Bloquea |
|---|---|---|
| P1 MP directas o BOM recursivo | Solo nivel 1 ahora; recursivo (todos los nodos) como extensión detrás de un control explícito, nunca por defecto | Expansión recursiva automática, control de profundidad |
| P2/P3 ingrediente con `seProduce` | Él solo (es stock real). El único doble a evitar es duplicar `(producto, lote)` en la grilla | Regla automática «intermedio y sus MP» |
| P4 sumar o reemplazar el filtro | Suma sobre la grilla precargada (lo que ya hace «+ Agregar producto») | Modo «la búsqueda filtra la grilla» |
| P5 MP sin saldo | Listarlas y agregarlas si la persona las tilda (el default del tilde es una constante reversible) | Cambiar el default, exclusiones silenciosas |
| P6 merma y MP compartidas | Una fila por MP, siempre; sin cantidades ni merma en el corte 1 | Cantidad teórica por ingrediente |
| P7 alcance | Solo Conteo Físico; la lógica queda reusable | Llevarlo a Consumo, Merma, Ajuste, Producción o Traspasos |

### Diseño

- **Core puro** `src/core/catalogo/explosion-receta.ts`: `explotarReceta(raizId, cargarNivel, { profundidad, maxNiveles })` con carga por nivel (sin N+1), dedupe por insumo, orden estable y guarda de ciclo. La UI solo pasa `"directa"`. **No se toca `costos.ts`** ni se usa `construirIndiceRecetas()` (carga todas las recetas).
- **Servidor** `src/server/actions/movimientos/conteo-por-receta.ts`: una sola lectura `proponerFilasDeConteoPorReceta(productoId, seccionId)` con `requerirVer("proceso_control")` y `obtenerSeccionPropia` (evita leer saldos de otra sucursal). Cuatro consultas fijas, con **un solo `groupBy` de saldos** para todos los ingredientes, y redondeo con `redondearACantidadDeUnidad` para coincidir con la grilla. Sin `refrescarVistaSiHaceFalta` (es lectura). Es una sola llamada porque la guía de esta versión de Next lo pide.
- **UI** en `conteo-fisico-grid.tsx`, con `useLeerServidor`. Agregar filas no toca `estados` ni reordena; el panel es una `<ul>` (no una tabla anidada); la marca de origen «por receta de {plato}» va dentro de la celda existente, sin `<th>` nuevo (protege `maquetacion-general.spec.ts` y `encabezados-de-tabla.test.ts`). **Rechazar duplicados** en `agregarProducto` (esto endurece de paso el camino manual; opcional aparte).
- **Accesibilidad:** combobox reutilizado con label propio e inequívoco, foco al encabezado del panel al abrirse, `Escape` cierra, casillas con label real, `data-resaltada="true"` para los specs.

### Pasos

0. Línea de base. 1. Core puro y tests. 2. Servidor, tests y fila nueva en `lecturas-con-permiso-de-ver.test.ts`. 3. UI. 4. E2E y axe. 5. Documentación (copiar a la fila E5 de p2109 qué quedó bloqueado por cada pregunta). Opcional: endurecer «+ Agregar producto». **No hay paso de schema.**

### Tests

- **Vitest core:** receta simple, directa frente a recursiva, receta vacía, ciclo, misma MP en dos ramas.
- **Vitest servidor:** ingrediente con `seProduce` (no se expande), sin saldo, inactivo, versión vigente (`MAX(version)`), saldos de la sección pedida, sección de otra sucursal lanza, sin permiso lanza, sin N+1.
- **Playwright:** receta simple; cantidades ya cargadas intactas; misma MP dos veces (no se duplica, se resalta); MP sin saldo (queda `saldoSistema 0` y `diferencia +5`); producto sin receta; ingrediente inactivo; foco y anuncio.
- **Axe** completo con el panel abierto y con las filas agregadas.
- Mirar: `conteo-fisico.test.ts` (no debe cambiar un caso), `stock-para-conteo.test.ts`, `conteo-fisico-grilla.spec.ts`, `maquetacion-general.spec.ts` (1024 y 1280 px), `acciones-con-guarda.test.ts`.

### Riesgos

Doble ajuste por lote (mitigado); explosión de filas sobre el tope de 60 por llamada (nivel 1 y selección explícita; vale un aviso); rendimiento (4 consultas fijas); regresión de maquetación; sobre-diseño (el modo recursivo queda en ~20 líneas con tests sin cablear; si molesta, se recorta a nivel 1 puro).

## 7. Paso 7: pivot de reportes para el contador

### Primer corte mínimo (sin decidir ninguna pregunta)

Pantalla nueva **`/reportes/pivot`**, con `ver_reportes_dinero`, que muestra **Compras**: filas por insumo (con el bucket «Sin insumo asignado» idéntico al de `gastoPorInsumo`), columnas por período (mensual, trimestral o anual), medida en pesos, columna y fila Total, export `.xlsx`, y todo el estado en la URL (`?desde=&hasta=&dim=insumo&periodo=mensual`). Sin migración. La ruta es neutra para poder agregar Ventas después sin renombrar.

### Las 8 preguntas

| Pregunta | Recomendación (opinión técnica) | Bloquea |
|---|---|---|
| Q1 reportes | Solo Compras, con el agregador genérico. Ventas mezcla real y estimado; Margen tiene tres márgenes distintos | Ventas y Margen; rótulos de «estimado» y cobertura por celda |
| Q2 dimensiones | Insumo primero; grupo plano después. Árbol con acumulado es lo más caro; sucursal arriesga dinero de una sucursal sin permiso | Proveedor, sucursal, árbol de grupos |
| Q3 granularidad | Mensual, trimestral y anual. Semanal exige definir la semana y da tablas ilegibles | Semanal y tope de columnas |
| Q4 valor y cantidad | Solo valor. Sumar cantidades entre insumos mezcla unidades: en modo cantidad habría que suprimir el Total | Toggle de medida |
| Q5 IPC | Nominal (es lo único que concilia exacto) | Toggle IPC y redacción de sus avisos |
| Q6 pantalla y export | Ambos, en commits separados | Si fuera «solo export», se caen los pasos de pantalla |
| Q7 permiso | Reusar `ver_reportes_dinero` (una clave nueva exigiría migración) | La página, hasta saber la clave |
| Q8 totales | Total por fila y por columna, calculado sobre valores crudos y redondeado al final | Subtotales jerárquicos (atados al árbol) |

Micro-pregunta: si aparecen las dimensiones **sin gasto**. `gastoPorInsumo` solo muestra las que tuvieron movimiento; se recomienda lo mismo para que concilie.

### Hallazgos que condicionan el diseño

1. **No se puede llamar `obtenerReportePorPeriodo` una vez por mes:** multiplicaría por 12 todo su cálculo y rompería `perf/reportes-catalogo-una-carga`. El pivot necesita su propia capa.
2. **La ruta tiene que ser de primer nivel:** `/reportes/compras/pivot` rompería `reportes-con-permiso.test.ts` (exige ítem de menú con el href exacto).
3. **La tabla ancha** necesita `overflow-x-auto` (`maquetacion-general.spec.ts` recorre una lista literal `RUTAS`, a la que hay que agregar la ruta), y ese contenedor debe tener `tabIndex={0}`, `role="region"` y `aria-labelledby` para axe (`scrollable-region-focusable`). Encabezados `<th scope="col">` y `<th scope="row">`, celda esquina con `sr-only`, `<tfoot>` para el Total.
4. **La sucursal activa no viaja en la URL:** un link compartido se abre en la sucursal de quien lo recibe. Se muestra en pantalla y en el nombre del archivo exportado.
5. **`TablaReporte` no sirve tal cual** (sin `<th scope="row">`, `<tfoot>` ni scroll; tiene 5 consumidores): componente propio, reusando `generarExcel` con import diferido. Las celdas se escriben como `String`, lo que mantiene la defensa contra fórmulas.

### Arquitectura

- `src/core/reportes/pivot.ts` (puro): `clavePeriodo` en **UTC**, `listarPeriodos` (incluye los vacíos), `etiquetaPeriodo`, `armarPivot` (acumula crudo y redondea al emitir; orden estable), `resolverParametrosPivot(sp, hoy)`.
- `src/core/reportes/pivot-compras.ts` (datos): **una** consulta de `movimientoStock` con el mismo predicado que `periodo.ts` (para que concilie) y un `select` acotado, más **una** carga de catálogo recibible por parámetro. Devuelve arrays planos serializables (nunca un `Map`).
- `src/app/(app)/reportes/pivot/page.tsx` y `tabla-pivot.tsx`, más un ítem en `GRUPOS_NAV`.
- **Rendimiento:** una consulta proporcional a las líneas del rango y agregación O(n). El costo real es el HTML, no la base. `MovimientoStock` no tiene índice por `proceso`: medir antes de indexar; la alternativa sin migración es filtrar por `operacion: { sucursalId, proceso, fecha }`, verificando con un test que el resultado sea idéntico.

### Pasos

0. Línea de base.
1. Lógica pura y tests (período sin datos, un solo mes, cruce de año, dimensión sin gasto, orden estable, redondeo desde crudos, trimestral y anual, parámetros inválidos).
2. Capa de datos y conciliación.
3. Pantalla sin export (más agregar la ruta a `RUTAS` de `maquetacion-general.spec.ts`).
4. Export `.xlsx` (commit aparte).
5. E2E y axe (URL compartible y botón Atrás, `—` en meses sin compras, scroll con teclado, descarga `.xlsx`, permisos en `reportes-permisos.spec.ts`).
6. Opcional: sticky de encabezado y primera columna (con fondo opaco propio; nunca `display: block` en el `th`).
7. Opcional: dimensión «grupo».
- **Paso X, solo si aparece:** clave de permiso propia o índice nuevo. **Requiere autorización expresa.** Se espera que ninguno haga falta.

### Tests

- **El más importante:** la conciliación contra `obtenerReportePorPeriodo` (`totalGeneral === compras.totalGastado` y el total de cada fila igual al `importe` de `gastoPorInsumo`). Si falla, el reporte no sirve.
- También: compras sin precio suman 0; el bucket «Sin insumo asignado» coincide; aislamiento por sucursal; rango invertido devuelve vacío; **conteo de consultas** (un rango de 14 meses hace 1 `producto.findMany` y 1 `movimientoStock.findMany`).
- Mirar: `periodo.test.ts`, `catalogo-una-sola-carga.test.ts` y `carga-unica-catalogo.test.ts`, los tests de arquitectura de reportes, menú y enlaces, `encabezados-de-tabla.test.ts`, `contraste-de-color.test.ts`, `maquetacion-general.spec.ts` (el más probable de romperse).

### Riesgos

La conciliación falla por centavos si se suman celdas ya redondeadas; falla la maquetación a 1024 px sin `overflow-x-auto`; axe marca la región desplazable si falta `tabIndex` o el nombre; una ruta anidada rompe un test; reintroducir consultas repetidas; el link compartido muestra otra sucursal.

## 8. Decisiones del negocio que destraban cada plan

| Plan | Decisión | Sin ella |
|---|---|---|
| 6b | ¿Se muestra el consumo? ¿Se aplica el paso 2 (ventas sin precio)? | Solo se puede hacer el paso 1 (core, sin UI) |
| E1 | ¿Digest o mail por ítem? ¿A todos con el permiso o a un responsable? Además, límite de crons de Vercel y cuenta de Resend | Se pueden construir los pasos 1 a 5 y 7 |
| K1b/K1c | Campos corregibles (4), bonificación (2), permisos (6), orden (7) | Se puede empezar por la Fase 0 |
| Paso 7 | Aprobar el alcance del corte 1 | Nada; las 8 preguntas son extensiones |

**Nota operativa:** `AGENTS.md` empieza con un bloque que `next dev` reescribe. Si aparece modificado en un diff, se commitea junto con el trabajo (borrarlo solo lo recrea).
