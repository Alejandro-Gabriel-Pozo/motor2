# Grounding: pendientes de motor2 contra referentes de gastronomía y ERP (2026-09-18)

**Motivo**: tras el último commit de `origin/main` (`c0d6c36`) el usuario pidió el inventario completo de pendientes y, para los que lo admiten, contrastarlos con sistemas de referencia: TastyIgniter, NexoPOS, URY (ERPNext para restaurantes) y ERPNext, más su framework Frappe por la integración con Google Drive/Sheets, que el usuario pidió profundizar (§7). Este documento junta el inventario, los hallazgos por tema y un roadmap actualizado. **No modifica** `docs/grounding-reportes-compras-2026-09-18.md`, pero corrige dos afirmaciones de ese documento (§1.3 y §5.2).

**Método, distinto al de la pasada 3 de `grounding-reportes-compras`**: esta vez hubo salida de red hacia GitHub, así que se leyó el **código fuente real** de cada referente en un clon local (versiones fijadas en "Fuentes"), no resúmenes de WebSearch. Lo que sigue son lecturas directas con ancla `archivo:línea`. Lo que es inferencia o propuesta propia está marcado como tal.

## 1. Inventario de pendientes (estado según `origin/main` `c0d6c36`)

Los 34 hallazgos de `auditoria-motor2-backlog-2026-09-16.md` están cerrados; no se repiten acá.

### 1.1 Reportes de Compras (`grounding-reportes-compras`, roadmap)

| # | Pendiente | Estado |
|---|---|---|
| 6 | "Insumos no comestibles" (Grupo padre + hijos Packaging/Limpieza) **y** excluirlo de `calcularRatioGastoVentas` | Pendiente — **decidido: convención USAR** (§2) |
| 1 (resto) | Corte Pareto 80/20 y % sobre el total en gasto por insumo/grupo | Pendiente (`git grep -i pareto` sobre `src/` de `origin/main`: sin resultados) |
| 7 | Selector de dimensión + período estilo pivot / export para el contador | Pendiente, el de menor prioridad |
| — | Fuentes del paso 6 leídas solo vía resúmenes de WebSearch | Sin verificar con fetch directo |

### 1.2 IPC y monedas

| Pendiente | Origen |
|---|---|
| Serie IPC "Alimentos y bebidas" en lugar de Nivel General: falta un id real verificado | fila 5 del roadmap; sesión del 2026-09-18 sin acceso a `apis.datos.gob.ar` |
| Meses en curso sin IPC (rezago INDEC ~1 mes) caen en `ingresoSinIPC` | `comparativa-ux-erpnext-dolibarr.md` §10 |
| Método 2, doble moneda/USD (`CotizacionDolar`, serie `168.1_T_CAMBIOR_D_0_0_26`) | §10, descartado a propósito |
| Margen real desglosado por producto (`FilaMargenProducto` sin equivalente) | §9 |

### 1.3 Correcciones a `grounding-reportes-compras-2026-09-18.md`

1. **Fila del paso 0**: dice "Pendiente" pero está implementado (`calcularRatioGastoVentas`, `periodo.ts:135` y `:261`; commit `7ed7362`, "pasos 0-1").
2. **Fila 5 (IPC Alimentos)**: afirma que cambiar la constante de serie y resincronizar alcanza "sin tocar la lógica". Con el schema actual no alcanza: ver §5.2.

### 1.4 Producción y operación

| Pendiente | Fuente |
|---|---|
| Correr `npm run db:seed` en el ambiente destino: sin él `ver_auditoria` no existe y nadie ve `/administracion/auditoria` | `auditoria-motor2-pivote6-auditoria-administrativa-2026-09-18.md`, "Paso de deploy pendiente" |
| Prueba 5 de I3 (concurrencia real contra Neon): nunca verificada | `auditoria-motor2-pivotes-2026-09-16.md` §13 |
| Flake de C2: causa confirmada (se agotan los 5 reintentos, sin backoff); falta decidir si se sube `maxIntentos` o se agrega backoff/jitter, y monitorear en logs de Vercel `[con-reintento][investigacion] conflicto de escritura agotó los reintentos` | `auditoria-motor2-deuda-tecnica-flake-eslint-2026-09-17.md` |

### 1.5 UX y funciones de Apps Script no portadas

| Pendiente | Fuente |
|---|---|
| Propagar links accionables de "costo incompleto" a `perdidas`, `devoluciones`, `periodo`, `resumen-operativo` | `comparativa-ux-erpnext-dolibarr.md` (tabla de brechas). Puede estar desactualizado, no se verificó en el código |
| Colapsar "+ Agregar ingrediente"/"+ Agregar paso" del editor de recetas | ídem |
| **E1** Alertas de stock por mail (`notificarAlertasStockPorMail`, `Stock.js:2342-2387`). La Acción `notificar_alertas` ya está en `src/core/permisos/acciones.ts:41` | `plan-migracion.md`, huecos conocidos #5 |
| **E2** Export CSV del reporte por período | huecos conocidos #6 |
| **E3** Sugerencia de Insumo/Familia al tipear el nombre de un producto nuevo | `plan-migracion.md`, "Encontrados, no implementados" |
| **E4** Memoria por usuario de los últimos valores del alta de producto | ídem |
| **E5** Búsqueda en Conteo Físico que resuelva la MP a contar vía receta | ídem |

## 2. Paso 6: convención USAR (decidida)

**Decisión del usuario (2026-09-18)**: Cost of Sales = solo comida/bebida; Paper/Packaging y Cleaning Supplies = Direct Operating Expenses, fuera del food cost. Ver `grounding-reportes-compras` §6 para las fuentes de USAR.

**¿Es por gasto variable?** No. El corte USAR es **comida vs no comida**, no variable vs fijo: la muzzarella también es variable. URY lo confirma desde otro ángulo: modela "fijo vs variable" como **forma de calcular el monto** (`ury_daily_p_and_l.py:361`, `:502` gastos fijos; `:511` mensuales prorrateados por `amount/días del mes`; `:521` gastos como % de ventas brutas o netas), un eje independiente de qué es COGS y qué es gasto operativo.

**URY no fija categorías**: los gastos son texto libre (`expense` es un campo `Data` en `ury_fixed_expenses`/`ury_variable_expenses`). El packaging entra al COGS si figura en la receta (BOM); si no, cae en un gasto fijo o porcentual. Ningún referente hardcodea "packaging". El corte lo elige cada negocio, como ya advertía `grounding-reportes-compras` §6.

**Pregunta abierta**: si una caja de pizza figura como ingrediente en una receta de motor2, entra al costo del plato aunque USAR la saque del food cost. Decidir si los no comestibles quedan fuera de las recetas o solo fuera del ratio.

## 3. Alertas de stock por mail (E1)

Comparación de cómo lo resuelve cada referente (URY no tiene alertas de stock):

| | TastyIgniter | NexoPOS | ERPNext |
|---|---|---|---|
| Disparador | Al registrar el movimiento (`Stock.php:142-160`) | Job diario 00:02 (`routes/console.php:83`) | Scheduler `daily_maintenance` (`hooks.py:519`, `:543`) |
| Qué compara | Saldo vs umbral, `umbral >= saldo` (`:277-279`) | `low_quantity > quantity` (`DetectLowStockProductsJob.php:37`) | **Stock proyectado** (`Bin.projected_qty`) `<= reorder_level` (`reorder_item.py:58`) |
| Canal | Mail (`mailSend`, `:157`) | Notificación **en la app**, sin mail | Mail digest |
| Agregación | Un mail por ítem | Una sola notificación con el conteo (`Job:51-52`) | Un mail por empresa con todos los ítems (`:312-323`) |
| Destinatario | Mail de la sucursal (`mailGetRecipients`, `:321`) | Roles Admin y StoreAdmin | Usuarios activos con rol Purchase/Stock Manager de esa empresa (`:326-349`) |
| No repetir | Flag `low_stock_alert_sent`: true al avisar, vuelve a false al reponer/recontar, no al vender (`:149-151`) | Sin dedupe: avisa cada día | El proyectado sube al hacer el pedido, sin flag |
| Cantidad sugerida | No | No | Sí: `max(reorder_qty, reorder_level − proyectado)` (`:59`) |
| Opt-in | Flag por ítem (`low_stock_alert`) | Flag por unidad (`stockAlertEnabled`) | `auto_indent` y `reorder_email_notify` en Stock Settings, ambos en 0 por defecto (`stock_settings.json:179`, `:186`) |
| Errores | — | — | Mail aparte a los administradores del sistema (`:371`) |

**Qué no copiar**:
- TastyIgniter: `hasLowStock()` usa `$this->low_stock_threshold && ...` (`:277-279`), así que un mínimo de 0 nunca alerta. Es la misma clase de bug que motor2 corrigió el 2026-09-16 (Alertas de stock ignoraba un mínimo explícito de 0). Además `computeStockQuantity` recorta a 0 (`max($stockQty, 0)`, `:309`) y motor2 sí admite saldo negativo.
- NexoPOS: sin dedupe, el mismo aviso llega todos los días hasta reponer.

**Dedupe por proyección no aplica a motor2**: `prisma/schema.prisma` no tiene ningún modelo de orden/pedido de compra (`git grep` de `^model (Orden|Pedido|Purchase)` y `OrdenCompra|PedidoCompra`: sin resultados). Las compras entran directo al Kardex, así que no existe "stock proyectado" y hace falta un flag de "ya avisado" como el de TastyIgniter.

**Diseño propuesto** (propuesta propia, combinando los tres):
1. Digest **diario por sucursal**, un solo mail agregado. El cron sigue el patrón que motor2 ya usa para el IPC (`vercel.json`, `CRON_SECRET`).
2. Destinatarios por permiso: los usuarios con la Acción `notificar_alertas`.
3. Cada fila incluye la cantidad sugerida `max(cantidad de reposición, mínimo − saldo)`.
4. Flag "ya avisado" por producto/sección, que se reinicia al reponer. Necesita persistir estado; `calcularAlertasStock` (`src/core/stock/alertas.ts:42`) hoy calcula al vuelo.
5. Opt-in por sucursal y omitir productos inactivos.
6. Si falla el envío, avisar a un admin (patrón ERPNext).

**Proveedor de mail**: el usuario propuso **Resend** (2026-09-18); ver §7.6 para el SDK, la idempotencia y lo que falta verificar. Siguen faltando la cuenta, el dominio remitente y la API key.

ERPNext también trae un **Email Digest** genérico (frecuencia diaria/semanal/mensual, ~26 KPIs con checkbox, destinatarios propios; `hooks.py:545`). Es una referencia para mandar por mail el bloque de alertas fijas del paso 3, que hoy solo se ve en `/reportes/periodo`.

## 4. Costeo y food cost

| | URY | NexoPOS | ERPNext |
|---|---|---|---|
| Base del COGS | **Consumo**: cantidad vendida × receta (BOM) × precio de compra **vigente** de la lista de la sucursal (`ury_daily_p_and_l.py:61-272`) | **Consumo**: promedio de **todas** las entradas `procured` y `convert-in` de la historia, `sum(total_price)/sum(quantity)`, sin filtro de fechas (`ProductService.php:839-871`) | Método de valuación configurable: FIFO, Moving Average, LIFO, Standard Cost (`stock_settings.json:119`) |
| Último precio | — | `getLastPurchasePrice`, `ProductService.php:1800` | `last_purchase_rate`, actualizado por el sistema al comprar |
| Contable | Ventas netas − COGS − gastos directos = ganancia bruta; − indirectos = neta; todo como % de ventas netas (`:330`, `:361`, `:502`) | COGS como evento contable propio de la venta (`AccountingEventCatalog.php:39`, `TransactionService.php:1079`) | `is_stock_item` (defecto 1): sin marcar, no genera asiento en el libro de stock (`item.json`) |
| Precio faltante | Lista los ítems sin precio y avisa que se **excluyen** del COGS (`:261-277`) | — | — |

**Hallazgos**:
1. Los referentes calculan el costo sobre **lo consumido**, no sobre lo comprado. El ratio Compras/Ventas de motor2 mide desembolso, y su propio `aviso` lo admite (`periodo.ts:261-290`). Según `comparativa-ux-erpnext-dolibarr.md` §9, motor2 ya congela `costoUnitarioVenta` al vender (`prisma/schema.prisma:895`, Método 3, solo hacia adelante). **Propuesta**: mostrar un food cost basado en consumo al lado del ratio de compras. Excluir "No comestibles" sigue siendo necesario para el ratio de compras.
2. El aviso de precios faltantes de URY es el mismo criterio que `hayComprasSinPrecio` y `aviso` de motor2: refuerza mantenerlo.
3. El COGS de NexoPOS (promedio de toda la vida) queda muy por detrás con inflación alta. El precio por compra de motor2 es mejor. ERPNext ofrece elegir método pero tampoco resuelve la inflación.
4. ERPNext refresca costos de recetas con un job diario opcional (`auto_update_latest_price_in_all_boms`, `hooks.py:546`, activado por `update_bom_costs_automatically`). Solo aplica si motor2 algún día cachea costos de receta.

**No verificado**: que en ERPNext un ítem no-stock vaya directo a gasto al comprarse es lo habitual, pero acá solo se leyó la descripción del campo `is_stock_item`, no el circuito contable.

## 5. IPC y tipo de cambio

### 5.1 Ningún referente ajusta por inflación

- ERPNext: la búsqueda de código sobre todo el repo (`gh search code`) da **0 resultados** para "inflation" y "hyperinflation". Se validó antes que la búsqueda funciona con un término que sí existe (`reorder_email_notify`). La única coincidencia con "IPC" es una cuenta del plan de cuentas brasileño (`br_planilha_de_contas.json`, "Correção Monetária - Diferença IPC/BTNF (Lei 8.200/1991)"): una cuenta heredada, no una función.
- URY usa una lista de precios cargada a mano; NexoPOS el último precio de compra y un promedio histórico; TastyIgniter no tiene costos ni compras.

Conclusión: el ajuste por IPC sigue siendo un diferencial de motor2, sin referente que validar.

### 5.2 Corrección: cambiar la serie no alcanza con el schema actual

`grounding-reportes-compras` (fila 5) dice que basta cambiar la constante `SERIE_IPC_GBA_NIVEL_GENERAL` y resincronizar. Contra `origin/main`:
- `IndicePrecio` tiene `mes` único y `valor`, **sin columna de serie** (`prisma/schema.prisma`, modelo `IndicePrecio`).
- `sincronizarIPC` nunca reescribe un mes ya guardado (comentario del modelo).
- La URL de la API usa la constante (`indices-economicos.ts:25`) y el margen ajustado por IPC lee la misma tabla.

Consecuencias: los ~125 meses ya cargados seguirían siendo de Nivel General; una segunda serie chocaría con el índice único de `mes`; y cambiar la constante movería en silencio el margen ajustado ya implementado. Hace falta agregar una columna de serie (con migración) **antes** de tocar la constante.

### 5.3 Modelo a imitar: tipo de cambio de ERPNext

`erpnext/setup/utils.py:62-157`, `get_exchange_rate`. Orden de resolución:
1. Último `Currency Exchange` guardado hasta la fecha, respetando `stale_days` salvo que `allow_stale` esté activo (`:78-94`).
2. Si no hay, una API externa configurada **como datos** en `Currency Exchange Settings` (endpoint, parámetros y ruta JSON del resultado, `:125-144`), con caché de 6 horas (`:144`).
3. Si falla, registra el error y avisa (`:156`).

Dos ideas para motor2 (propuestas propias):
- La **fuente como configuración**: endpoint e id de serie en una fila de configuración y una columna de serie en `IndicePrecio`, en lugar de una constante en código. Encaja con §5.2 y habilita la serie de Alimentos y el Método 2 (USD) con el mismo patrón.
- Una **antigüedad máxima explícita** (`stale_days`), en lugar de dejar que el mes en curso caiga en silencio en `ingresoSinIPC`.

**No probado**: el acceso a `apis.datos.gob.ar` desde esta sesión. La serie de Alimentos sigue sin verificar.

## 6. Otros pendientes

| Pendiente | Qué se encontró |
|---|---|
| **E2** Export CSV | NexoPOS arma el archivo en el servidor, lo guarda en disco público y devuelve un link temporal de 5 minutos, con tope de 27 columnas (`CrudController.php:320`, `:354`, `:429`). No sirve para Vercel: un Route Handler que devuelva `text/csv` directo es el equivalente. Motor2 ya exporta CSV por tabla del lado del cliente en `TablaReporte`. **Frappe sí da un modelo más completo y expone dos brechas del export actual de motor2: ver §7.4.** |
| **Paso 7** Pivot | Los reportes de NexoPOS y URY son listas fijas, sin pivot. Refuerza dejarlo al final. |
| Día de negocio | URY corta el día de reporte con una hora configurable (`hours` de `URY Report Settings`, `ury_daily_p_and_l.py:98-99`), para locales que cierran pasada la medianoche. **Pregunta abierta**: cómo agrupa motor2 las ventas por día para una pizzería que cierra tarde. |
| **E3, E4, E5** | Sin referente: no se encontró nada equivalente en NexoPOS (`ProductCrud`), URY ni ERPNext (`stock`, `buying`, `setup`). En Frappe no se buscó (§10). |
| Producción y operación (§1.4), UX (§1.5) | No aplican: son pendientes internos. |
| **Sesión vencida en el cliente (2026-09-19)** | Tras exigir sesión en las lecturas de servidor (`2729fa2`), quedan cuatro pendientes (la letra E se usa acá para no confundirla con C3 = tabla `Comprobante`): **(A)** `reclasificar-form.tsx` llama `obtenerSaldoDisponibleParaReclasificar`, que no usa `requerirSesion()`: con la sesión vencida devuelve `null` en silencio (el operario ve «disponible: —») y ante un corte de red su `.then()` no tiene rama de rechazo. **(B)** En `panel-movimiento-form.tsx` la carga de productos por proveedor tiene su propio manejo del rechazo (avisa y vacía las filas) sin pasar por `useLeerServidor`: no pide el refresco, así que con la sesión vencida el reintento falla siempre y no lleva al login. **(E) — resuelto en `1da8137` (2026-09-19)** Las **escrituras** con la sesión vencida no llevaban al login: `conPermiso` devolvía `ok: false` con «No autenticado…» y el formulario seguía abierto. Ahora hace `redirect("/login")` si no hay contexto (sesión vencida, usuario desactivado o sin sucursal activa); un permiso denegado sigue siendo un mensaje. Riesgos que quedan: se pierde el borrador en pantalla al redirigir (wizard de Compra, grilla de conteo), y en `conteo-fisico-grid` las filas ya escritas antes de que venza la sesión quedan escritas sin que el usuario reciba el parcial. `detectarInsumosConUnidadMezclada` (`unidades.ts:81`) sigue con el contrato viejo `{ ok: false, mensaje }`; es una lectura de un Server Component, y se alinearía con `requerirSesion()`, no con el redirect. **(D)** No hay ningún `error.tsx` en la app: cualquier error no manejado de una transición muestra la pantalla de error por defecto de Next. Además, decisión abierta: el `maxAge` de la sesión (hoy el valor por defecto de Auth.js) y si hace falta guardar borradores. |

## 7. Google Drive y Sheets en ERPNext/Frappe

ERPNext delega esto en el framework Frappe, y "trabaja con Google Drive" de tres maneras distintas, con modelos de acceso muy diferentes. El backup a Drive existió en el núcleo de Frappe hasta el commit `422995cd4` (2025-04-15, "fix: seperate backup options into app"), que además sacó Dropbox y S3. Hoy vive en la app aparte `frappe/offsite_backups`.

### 7.1 Las tres integraciones

| | Backup a Drive (`offsite_backups`) | Selector de Drive (adjuntos) | Importar desde Google Sheets (Data Import) |
|---|---|---|---|
| Acceso | OAuth en el **servidor**, con refresh token guardado (`access_type=offline&prompt=consent`, `google_oauth.py:138`) y scope `auth/drive` **completo** (`google_oauth.py:10`) | OAuth en el **navegador**, token de corta vida, scope `drive.file` (`google_drive_picker.js:4`). Sin refresh token | **Sin OAuth**: la URL se convierte en `/export?format=csv&gid=…` y se descarga de forma anónima (`csvutils.py:235-260`) |
| Requisito | Cuenta autorizada una vez | `client_id` y `app_id` cargados en Google Settings y el picker habilitado (`google_settings.py:31-41`) | La hoja debe ser **pública**; si no, error "Google Sheets URL is invalid or not publicly accessible" (`:256-259`) |
| Qué mueve | Dump de la base + config (+ archivos), en `.gz` | Adjuntos que elige el usuario | Filas a importar |
| Disparo | Scheduler `daily_long` / `weekly_long` según el setting Daily/Weekly (`offsite_backups/hooks.py`) | Manual | Manual |

Solo importa desde una URL `https://docs.google.com/spreadsheets/...`: valida esquema y host (`csvutils.py:272-280`), una defensa útil si el servidor descarga URLs que pone el usuario.

### 7.2 Backup a Drive: cómo funciona y qué no copiar

`offsite_backups/.../google_drive/google_drive.py`, leído completo (237 líneas):
- **Carpeta**: nombre configurable. Busca listando **todas** las carpetas del Drive (`files().list(q="mimeType='application/vnd.google-apps.folder'")`, `:136-138`) y compara por nombre; si no existe, la crea y guarda su id. Cambiar el nombre borra el id (`:45-48`).
- **Subida**: `MediaFileUpload(..., resumable=True)` (`:197-199`), como job de cola `long` con timeout de 1500 s (`:153-160`) y progreso en 3 pasos por eventos en tiempo real (`:232-237`).
- **Tamaño**: si el último backup pesa más de 1 GB, no genera uno nuevo y reutiliza el último (`offsite_backup_utils.py:95-101`).
- **Aviso**: mail a la dirección configurada. El de éxito es opcional (`send_email_for_successful_backup`), el de fallo siempre (`offsite_backup_utils.py:11-38`).

**Defectos a no copiar** (lectura del código, no ejecutado):
1. Un `HttpError` en la subida manda el mail de fallo pero **no corta el flujo**: al terminar el bucle igual actualiza `last_backup_on`, manda el mail de éxito (si está activado) y devuelve "Google Drive Backup Successful" (`google_drive.py:203-212`).
2. **No hay rotación**: el doctype no tiene ningún campo de retención (campos: `enable`, `backup_folder_name`, `frequency`, `email`, etc.) y el módulo solo llama a `files().create` y a `files().list` de carpetas, nunca a un borrado. El Drive crece sin límite.
3. Scope `drive` completo para escribir en una sola carpeta.

**No aplica tal cual a motor2**: corre en Vercel (serverless, sin disco persistente ni `pg_dump`) sobre Neon, así que respaldar la base es asunto de Neon (no evaluado acá).

### 7.3 Lo aplicable a motor2 (propuestas propias, a decidir)

Frappe usa **dos modelos**: uno estrecho e interactivo (Picker en el navegador, `drive.file`, sin credenciales guardadas) y otro amplio y desatendido (backup, refresh token en servidor, `drive`). Para motor2 el estrecho encaja mejor.

1. **Exportar a Drive para el contador** (paso 7 / E2). Guardar el CSV o XLSX del reporte en una carpeta de Drive del negocio con scope `drive.file`, que solo ve los archivos que crea la propia app. Subida desde el navegador con token de corta vida, como el Picker: no hay que guardar ningún refresh token.
2. **Importar desde una hoja de Google** (carga masiva de proveedores, precios, catálogo). Tiene sentido porque el sistema original (`motor`) era Apps Script sobre Sheets (`plan-migracion.md`). No copiar el modelo de Frappe de "hoja pública": son precios y proveedores del negocio. Mejor un selector donde el usuario elija la hoja y otorgue acceso solo a esa.
3. **Adjuntar comprobantes de compra** (factura del proveedor), guardados en Drive y no en Neon. El usuario lo pidió; el diseño está en §7.6. Motor2 no tiene hoy ningún concepto de adjuntos.

**Estado de la autenticación de motor2** (`origin/main`): `src/lib/auth.ts` usa el provider Google de Auth.js sin `scope` ni `access_type` propios, es decir, con los permisos básicos de login. El modelo `Account` de `prisma/schema.prisma` ya tiene `refresh_token`, `access_token`, `expires_at` y `scope`, pero hoy no se pide acceso offline ni a Drive. Un flujo de servidor exigiría un consentimiento adicional (`access_type=offline`, `prompt=consent`), porque Google entrega el refresh token solo en el consentimiento (esto último es conocimiento general). Sobre los scopes: según la documentación de Google (consultada con WebFetch, ver §7.6), `drive.file` es **no sensible**, recomendado y por usuario, y `drive` completo es **restringido**.

### 7.4 Export (E2): el modelo de Frappe y por qué motor2 pasó de CSV a Excel

Frappe exporta en el servidor (`frappe/desk/reportview.py:438-470`, `_export_query`):
- Sin límite de filas; formato **CSV o Excel** (`.xlsx` con estilos y fila de totales opcional).
- Puede exportar solo la selección (`selected_items`) o solo lo visible, en el orden del cliente (`visible_names`).
- **Parámetros CSV**: delimitador (`,` por defecto), comillas `QUOTE_NONNUMERIC` y **separador decimal configurable** (`desk/utils.py:75-116`).
- **Defensa contra inyección de fórmulas**: a los textos que empiezan con `=`, `+`, `-`, `@`, tab o retorno les antepone una comilla simple (`utils/csvutils.py:14-21`). Solo a `str`: los números no se tocan.
- **Exportación en segundo plano** opcional: encola un job largo, guarda el archivo como privado y manda un mail con el link; se borra solo a las 48 h por defecto (`desk/utils.py:128-153`, `delete_background_exported_reports_after`).

El export original de motor2 (`src/components/tabla-reporte.tsx:66-75` en `origin/main`) era un CSV del lado del cliente: separador `,`, punto decimal, BOM UTF-8. Tenía dos brechas:
1. **Sin escape de fórmulas.** Un texto que empiece con `=`, `+`, `-` o `@` se evalúa como fórmula al abrir el CSV en una planilla. Lo cargan usuarios autenticados, así que la gravedad es baja o media; los nombres de catálogo ya tenían una regla de caracteres (§7.5), pero el resto de los campos de texto libre no.
2. **Depende de la configuración regional de cada PC** (separador de columnas y decimal).

**Qué se intentó y qué pasó (2026-09-18).** Primero se implementó un CSV en formato es-AR (`;` y coma decimal, con escape de fórmulas), por pedido del usuario. Al abrir las dos muestras en su Excel, el archivo nuevo cayó entero en la columna A y además se partió en las comas decimales; el archivo anterior abrió bien. Es decir, el Excel del usuario usa `,` como separador de columnas y `.` como decimal, no la configuración es-AR estándar. Un CSV no puede servir a la vez a una PC con esa configuración y a una es-AR estándar, como la que podría tener el contador (esto último es conocimiento general de Excel; el lado del usuario lo muestran las capturas). Nada de eso llegó a `origin/main`.

**Solución: export a `.xlsx`** (`src/core/excel.ts`, librería `write-excel-file` 4.1.1, licencia MIT, una dependencia: `fflate`). Verificado inspeccionando el XML del archivo generado (`test/core/excel.test.ts`: 14 tests cuando se escribió el módulo, 31 hoy):
- los `number` se guardan como números (`<v>5262.44</v>`), sin depender de la configuración regional;
- los textos se guardan como cadenas (`t="s"`) y **ninguno se guarda como fórmula** (no hay elementos `<f>`), incluidos `=1+1`, `+cmd|...`, `-2+3` y `@SUM(...)`;
- un valor nulo o no finito no genera celda; se escapan los caracteres especiales de XML; el nombre de la hoja se sanea a las reglas de Excel.

Además pone el encabezado en negrita y ajusta el ancho de las columnas. **Fechas**: las 11 columnas de fecha de 8 tablas (`tabla-auditoria`, `conteos`, `diferencias`, `historial`, `perdidas`, `sin-receta`, `trazabilidad`, `vencimientos`) llevan un marcador `tipoFecha` (10 llegan a un export: la de `trazabilidad` está en una tabla sin botón de exportar, así que allí el marcador es inerte) y se exportan como fechas reales de Excel (formato `dd/mm/yyyy`; la de auditoría, `dd/mm/yyyy hh:mm`), para que se puedan ordenar y filtrar. La conversión es explícita, no una heurística sobre el texto. El orden en pantalla sigue usando el texto ISO. Las columnas de solo día se exportan como el día que muestra la pantalla (UTC); la de auditoría, con la hora local del navegador, igual que `toLocaleString`, porque la librería convierte una `Date` al número de serie de Excel en UTC. Un texto que no sea una fecha válida se exporta como texto, sin romper. Verificado en los tests (31 en `test/core/excel.test.ts`, incluido el resultado bajo cuatro husos horarios distintos) y con los números de serie de un archivo de muestra; sin abrir en un Excel real.

La librería se carga con `import()` recién al hacer clic en "Exportar Excel", para no pesar en la carga de la página. Reemplaza al CSV: el helper `celdaCsv` y sus tests se descartaron antes de commitear (nunca llegaron a un commit).

**Verificado además**: `next build` compila todas las rutas con la librería (import dinámico), que queda en un chunk propio y diferido de 85 KB (24 KB con gzip), fuera de la carga inicial, eslint limpio y `tsc` sin errores propios (solo `LayoutProps` de `layout.tsx`, ajeno). **Verificado por el usuario en su Excel** (captura del 2026-09-18, sobre un archivo generado con el mismo código): columnas separadas, encabezado en negrita, números alineados como números con los decimales de su configuración (incluido un `-5`), y `=1+1 (…)` y `-2+3` se ven como texto sin evaluarse. **Sin verificar**: la descarga desde el botón "Exportar Excel" en el navegador.

### 7.5 Reglas de entrada de datos que hay hoy (verificado en `origin/main`)

El usuario recordaba una regla general de datos ("solo coma", "2 decimales") y que los nombres no admitían ciertos caracteres. Lo que hay:

**Números**
- **Navegador** (`src/components/campo-numero.tsx`): acepta coma **o** punto (el último que aparece es el decimal; el otro se descarta como separador de miles), elimina todo carácter que no sea dígito, punto o un `-` inicial, y muestra en es-AR con hasta **4** decimales. No es "solo coma" ni 2 decimales, y solo existe en el navegador.
- **Servidor**: las cantidades se redondean a los decimales de la unidad (`redondearACantidadDeUnidad`, 9 usos: movimientos, venta, conteo, traspasos). Los importes **calculados** se redondean a 2 decimales (`redondearMoneda`, p. ej. `venta.ts:219`, costos y reportes). Los precios **tecleados** no se redondean en el código: `setPrecioLocalProducto` solo valida `precio >= 0` (`precio-local.ts:24`) y guarda lo que llegó. Lo que redondea es la columna. La precisión depende del campo (`prisma/schema.prisma`): los precios de venta y los importes totales son `Decimal(14,2)` (`Producto.precioVenta`, `PrecioLocalProducto.precio`, `MovimientoStock.precioTotal`, `Producto.precioConsignacion`), y los precios y costos **unitarios** y las **cantidades** son `Decimal(14,4)` (`precioPorUnidadStock`, `costoUnitarioVenta`, `ProveedorPorProducto.precioUnitario`, `MovimientoStock.cantidad`, `RecetaIngrediente.cantidad`, `factorConversion`, `conteoReal`, `StockMinimoProducto.minimo`). La merma es `Decimal(6,2)`. Un precio unitario es un total dividido por una cantidad (`precioTotal / cantidadStock`) y las recetas usan cantidades chicas, y con 2 decimales el error se acumularía: por eso 4 (decisión de "cero tolerancia" en `auditoria-motor2-pivotes-2026-09-16.md`, Pivote 4). `CampoNumero` es genérico y muestra hasta 4 decimales en cualquier campo, así que en uno de 2 decimales se puede tipear de más y la base redondea (comportamiento estándar de Postgres, no probado acá).
- **Validaciones (estado en `origin/main`)**: cantidades con `!(x > 0)` (que rechaza NaN pero no `Infinity`) y precios con `>= 0`. `Number.isFinite` no aparecía en `src/server`. Además, `mermaPorcentaje` y `minutos` de receta se validaban con `< 0`, que deja pasar NaN, y `precioVenta` de un producto no tenía ninguna validación.
- **Cambio hecho (rama local `fix/csv-export-formulas`, commiteado en local y sin push)**: `esNumeroFinito` (`src/core/numero.ts`) se agregó como chequeo **adicional**, colocado después de la validación existente para no cambiar ningún mensaje que ya se mostraba, en `conteo-fisico`, `movimientos` (`armarLineaMovimiento`), `precio-local`, `venta`, `consignacion`, `reclasificacion`, `stock-minimo`, `traspasos` (2 sitios), `productos` (factor, precio de consignación, presentación y `precioVenta`) y `recetas` (cantidad, merma y minutos). Solo agrega rechazos: `Infinity` y NaN en los sitios `< 0`. **Sigue sin validarse** que `precioVenta` no sea negativo, ni los campos de cabecera de receta (`rendimientoCantidad`, `racionTamano`, tiempos).

**Texto**
- **Los nombres de catálogo sí tienen una regla de caracteres**: `validarTextoCatalogo` en `src/core/texto.ts` (port de `Core.js:675`) admite letras, números, espacio y `- . , ( ) % & / ' _`, con un máximo de 80 caracteres. La aplican todos los sitios de alta y edición de nombre: sucursal, categoría, insumo, grupo, producto (alta y alta rápida), proveedor, unidad, sección y rol. Por eso `=`, `+`, `@`, comillas dobles, `|`, `!` y `;` no entran en un nombre. La regla que el usuario recordaba existe; la primera versión de este documento afirmó lo contrario por un error de búsqueda.
- **Hueco que dejaba**: el charset permite `-`, el cuarto disparador de fórmula de una planilla. Un nombre como `-A1` o `-SUM(1,2)` pasaba la validación. **Cambio hecho** en la misma rama: `validarTextoCatalogo` rechaza un nombre que empieza con `-`. Los registros ya guardados con ese formato no se modifican, pero al editarlos habría que cambiarles el nombre.
- **Lo que la regla no cubre**: los demás campos de texto libre que llegan a pantallas y exports (según `prisma/schema.prisma`, excluyendo ids, enums y campos únicos): `nroFactura`, `detalleLibre`, `detalle` (movimientos, conteos, traspasos); `notas` (proveedor, membresía, pago a consignante); `observaciones`; `motivoRechazoOrigen/Destino`; `condicionesPago`, `contacto`, `cuit`, `email`, `telefono` de Proveedor; `referenciaProveedor`; textos de recetas; `descripcion`, `valorAnterior` y `valorNuevo` de `RegistroAuditoria`; `User.name`.

**Conclusión**: los nombres estaban protegidos salvo por el `-` inicial, ya cerrado. Los otros ~25 campos de texto libre no tienen restricción de caracteres y no conviene imponérsela (son notas y detalles). Ahí el escape del export (§7.4) es la defensa, y también cubre datos ya guardados, seeds y una futura importación desde Sheets (G2).

### 7.6 Comprobantes de compra en Drive y mails con Resend (diseño, nada implementado)

**Pedido del usuario (2026-09-18)**: poder cargar el comprobante desde la app, guardarlo en **Drive y no en Neon**, y gestionar el envío de mails con Resend "o algo así".

**Qué iría a Neon**: solo la referencia (id del archivo de Drive, nombre, tipo, tamaño, quién y cuándo lo subió), atada a la `Operacion` de la compra, que ya tiene `nroFactura`. Es una tabla nueva y una migración: no se hace sin autorización expresa. Hoy no hay nada de adjuntos en `prisma/schema.prisma` ni en `package.json`.

**Restricciones verificadas** (fuentes en "Fuentes")
- **Vercel**: el cuerpo de una request o response de una Function tiene un tope de **4,5 MB** (error 413 `FUNCTION_PAYLOAD_TOO_LARGE`). Una foto de una factura sacada con un celular puede superarlo (esto último es una estimación mía), así que el archivo no debería pasar por una Server Action ni una ruta de motor2.
- **Drive `drive.file`**: clasificado como **no sensible** y recomendado; es **por usuario** y solo da acceso a archivos que la app crea o que el usuario abre o comparte con la app mediante el Picker. El scope `drive` completo es **restringido**.
- **Subida resumible de Drive**: `POST .../upload/drive/v3/files?uploadType=resumable` devuelve un URI de sesión en el header `Location`; los bytes se envían con `PUT`, en una sola request o en fragmentos múltiplos de 256 KB; la sesión vence después de una semana.

**Tres caminos para subir el archivo**

| | Cómo | A favor | En contra / sin verificar |
|---|---|---|---|
| 1 | El **navegador** sube con el token del propio usuario (`drive.file`), como el Picker de Frappe (§7.1) | No hay credenciales guardadas ni pasa por Vercel | Cada usuario autoriza una vez. El archivo queda a nombre de quien lo sube. Para que caiga en una carpeta compartida, cada usuario tendría que elegirla con el Picker; que eso permita **crear** dentro de esa carpeta **no está confirmado** por las docs consultadas |
| 2 | El **servidor** abre la sesión resumible y el navegador sube los bytes directo | Archivos del negocio, sin autorización por usuario | Requiere una credencial del negocio en el servidor (cuenta de servicio o refresh token de una cuenta admin, hoy no hay ninguno). **Las docs no dicen** si un cliente distinto del que abrió la sesión puede usar el URI, ni nada de CORS: hace falta una prueba. Una cuenta de servicio sobre una carpeta de "Mi unidad" puede tener problemas de cuota (conocimiento general, sin verificar) |
| 3 | El archivo pasa por el servidor de motor2 | Simple | Descartado por el tope de 4,5 MB |

**Recomendación provisoria**: el camino 1, porque es el único que se apoya solo en hechos verificados. Depende de las respuestas de §9 (¿Workspace y Unidades compartidas?, ¿quién debe ver los comprobantes?). Antes de construir nada conviene un **spike** (C1) que confirme los puntos sin verificar.

**Resend** (SDK `resend` 6.28.1, `resend/resend-node`)
- `resend.emails.create(payload, options)` (`src/emails/emails.ts`). El payload admite `from`, `to`, `subject`, `html`, `text` o `react`, `attachments` (**hasta 40 MB por email**, según el comentario del SDK), `scheduledAt`, `headers` y `tags`. El segundo argumento admite una **clave de idempotencia** (header `Idempotency-Key`, verificado en los tests del SDK para el envío en lote y en el tipo `IdempotentRequest` del envío simple).
- Límite por defecto: **10 requests por segundo por equipo** (docs de Resend).
- **Sin verificar**: la retención de la clave de idempotencia, los requisitos de verificación de dominio (DNS del remitente) y los límites del plan gratuito.

**Usos posibles de Resend en motor2**
1. **E1, alertas de stock** (§3): resuelve el bloqueo del proveedor de mail. Es el primer uso real y el más acotado.
2. **Enviar el comprobante al contador**: mejor con el link de Drive que con el archivo adjunto. Adjuntarlo obligaría a bajar el archivo de Drive dentro de una Function (mi observación).
3. **Digest de alertas fijas** del paso 3, hoy solo visible en `/reportes/periodo` (§3, Email Digest de ERPNext).

**Idempotencia**: motor2 ya protege las operaciones manuales con `claveIdempotencia` (I3). El envío de mails debería seguir el mismo criterio: la clave de Resend más un registro propio de "ya enviado", para que un reintento no duplique el aviso.

**Pasos propuestos** (cada uno chico y reversible, en este orden; ver roadmap C1-C4 y la regla del proyecto de pasar por `architecture-governor` antes de cada commit):
1. **C1**: spike de subida a Drive desde el navegador, sin tocar schema.
2. **C2**: Resend con E1 (necesita cuenta, dominio verificado, API key y variables de entorno).
3. **C3**: tabla `Comprobante` + migración + campo de carga en Compra.
4. **C4**: envío del comprobante al contador.

### 7.7 Revisión de la rama por `architecture-governor` (2026-09-18)

El subagente revisó el bloque antes de commitearlo (solo lectura) y decidió **GO parcial, en 3 commits separados**; el push y el deploy los aprueba el usuario.
- **Commit 1, validaciones numéricas** (`numero.ts` + 10 Server Actions): listo. Confirmó por lectura de código que los 12 chequeos son estrictamente aditivos y que ningún mensaje existente cambió. Encontró un error en el comentario de `numero.ts` (decía "ANTES" y el código coloca el chequeo **después**), ya corregido, junto con los tests de `null`, `""` y `[]`.
- **Commit 2, export**: el governor pedía abrir un export en Excel es-AR antes de declararlo verificado. Al probarlo el usuario, el CSV es-AR falló en su Excel (§7.4) y el export pasó a `.xlsx`, con el helper en `src/core/excel.ts` y la documentación de `comparativa-ux-erpnext-dolibarr.md` actualizada. Solo `TablaReporte` exportaba y ningún test e2e lo toca. Esa revisión fue sobre la versión CSV; la versión XLSX tuvo una segunda revisión (abajo).
- **Segunda revisión del governor, sobre la versión XLSX (2026-09-18)**: **GO parcial**. Push de la rama: GO, con dos condiciones de exactitud documental (cumplidas) y una que solo podía resolver el usuario: a qué base apunta el entorno de preview de Vercel, porque un push de rama dispara un preview y `npm run build` incluye `prisma migrate deploy`. **Resuelta**: el usuario confirmó que el preview apunta a la demo (`demo-pizzeria-la-cuadra`, no a producción); la rama no agrega migraciones, así que ese comando no tiene nada nuevo que aplicar. Merge a `main` y deploy: **en espera** hasta ejercitar una vez la descarga real desde el botón en un preview (una tabla con `nombreExport` dinámico y la de auditoría). No hay CI (no existe `.github/workflows`): un push no corre tests.
  - **Dependencia**: sin objeciones. Dos entradas nuevas en el lockfile (`write-excel-file` 4.1.1 y `fflate` 0.8.3), MIT, sin avisos en `npm audit --omit=dev` (los 4 avisos altos son de `prisma`, preexistentes). Riesgo residual: mantenedor único en cada una. El `import()` dinámico separa la librería en un chunk propio, medido en el build local: 85 KB crudos, 24 KB con gzip; no entra en la carga inicial.
  - **Revisó los 22 usos de `TablaReporte`**: ninguna columna devuelve `Date`, booleano ni objeto en runtime; `undefined` (por indexar mapas) se trata como celda vacía.
  - **G1 (media)**: el botón no tenía manejo de error ni estado "exportando": si fallaba la carga diferida de la librería (red caída o un deploy nuevo con la página abierta) no pasaba nada visible. **Corregido**: mensaje de error visible y botón deshabilitado mientras exporta. Falta ejercitarlo en el navegador (por ejemplo bloqueando la carga del chunk en DevTools).
  - **G2, G3, G4**: celda de más de 32.767 caracteres, apóstrofo al principio o al final del nombre de hoja, y nombre de archivo sin sanear. **Corregidos** (`src/core/excel.ts`, `nombreDeArchivo`); el del apóstrofo es la regla documentada de Excel, no probada en un Excel real.
  - **G5 (decisión de producto)**: las fechas se exportaban como texto ISO y no como fechas de Excel, así que el contador no podía ordenar ni filtrar por fecha. **Resuelto**: el usuario eligió fechas reales de Excel (ver §7.4).
  - **G6, G7**: el mensaje del commit de validaciones decía 12 chequeos y son 17 (12 eran archivos): **corregido**. `precioVenta` usa `esNumeroFinito` sin validación previa: no es regresión y ya está registrado en §7.5.
  - **G8, G9, G10**: documentos desactualizados sobre el CSV y una referencia a archivos que nunca se commitearon: **corregidos**.
- **Tercera revisión del governor, antes de pushear a `main` (2026-09-18)**: **HOLD para `main`; GO para pushear la rama a `origin`** (lo aprueba el usuario). No encontró hallazgos de gravedad alta. El único bloqueante es **M1**: la descarga nunca se ejercitó en un navegador, y el nuevo flujo tiene un cambio real frente al CSV que corre en producción. `a.click()` ocurre ahora después de un `await import()`, fuera del gesto del usuario, y `URL.revokeObjectURL` se llama de inmediato; si algún navegador descarta la descarga por eso, **no se lanza ninguna excepción**, así que el mensaje de error del botón no aparece: un fallo silencioso. Una prueba manual lo descarta o lo confirma.
  - **Verificado por el governor**: `origin/main` no se movió (`c0d6c36`); la rama no toca `prisma/`; el lockfile solo suma `write-excel-file` y `fflate`; los 5 commits reescritos con `git rebase` tienen árbol idéntico y solo cambió el mensaje; "17 chequeos" es correcto; 58 tests puros pasan en `HEAD` y en el commit de las fechas aislado; `tsc` limpio salvo `LayoutProps`; la librería queda fuera de la carga inicial; las 11 columnas marcadas coinciden con lo que muestra la pantalla y no quedó ninguna columna de fecha sin marcar.
  - **Al pushear a `main`** (inferido, sin acceso a Vercel): Vercel presumiblemente despliega producción y `npm run build` corre `prisma migrate deploy` contra la base de producción; sin migraciones nuevas es un no-op siempre que producción ya esté al día con `c0d6c36`. Ningún dato se modifica.
  - **Rollback** (todo es código): Instant Rollback de Vercel si está habilitado (no verificado); o `git revert --no-commit c0d6c36..HEAD` y push, que redeploya. Por commit, el de las fechas, el de validaciones y el del nombre con `-` se revierten solos; el export a Excel es una pila que se revierte en orden inverso (`9a16414`, `f3534f1`, `1798561`, `b59f9b6` en la numeración previa al rebase).
  - **Hallazgos bajos, sin corregir**: M2, `TablaReporte` no tiene tests y nada verifica que etiquetas, valores y `tiposFecha` queden alineados; `TIPO_MIME_XLSX` sin uso; el test importa `fflate`, que es dependencia transitiva; el formato de auditoría descarta los segundos; faltan tests de horario de verano y de un `YYYY-MM-DD` en una columna `fechaHora`. Preexistente: las columnas de día exportan el día **UTC**, igual que la pantalla, y para Argentina una operación posterior a las 21:00 locales cae al día siguiente; al ser ahora fechas ordenables, se nota más (relacionado con la decisión abierta #4).
  - **Evidencia mínima que levanta el HOLD**, con el preview de la rama: (1) `/reportes/vencimientos`: la columna Vence queda alineada a la derecha, con `dd/mm/yyyy` y filtro de fecha; (2) `/administracion/auditoria`: la hora coincide con la de la pantalla; (3) `/reportes/historial` con un `nombreExport` dinámico: el archivo se llama `historial-<código>.xlsx`; (4) bloquear la carga del chunk en DevTools y comprobar que aparece el mensaje rojo.
- **Prueba en un navegador real (2026-09-18)**. No se pudo probar el preview de Vercel: está detrás del login de Vercel y, además, la app pide un login de Google que hace el usuario, y el dominio del preview probablemente no esté autorizado en la app de Google (cada dirección de retorno se autoriza una por una). En su lugar se levantó, en la máquina del usuario, el build de producción con una página de prueba temporal que usa la misma `TablaReporte` (sin commitear y ya borrada) y se probó en su Chrome:
  - **Descarga real (M1 descartado en Chrome)**: con un clic real sobre "Exportar Excel", el `a.click()` ocurrió con la activación del usuario todavía vigente (`navigator.userActivation.isActive === true`), el archivo se guardó en la carpeta de Descargas con el nombre saneado (`historial-D'Oro-Quesos.xlsx`) y no hubo errores ni mensaje.
  - **Contenido del archivo generado por el navegador**: coincide con lo esperado. Las fechas tienen los números de serie exactos (incluido `46283,6458` para las 15:30 locales de Argentina), `=1+1 (…)` quedó como texto, no hay fórmulas, el valor nulo no genera celda y el nombre de la hoja quedó saneado.
  - **Camino de error**: con una falla real de carga de la librería (su chunk respondía HTTP 500), el botón pasó a "Exportando…" (deshabilitado) y, medio segundo después, volvió a "Exportar Excel" con el mensaje "No se pudo generar el archivo. Recargá la página e intentá de nuevo."; no hubo descarga. Limitación: el clic de esta prueba se disparó por código, porque la ventana de automatización estaba oculta y los clics reales no llegaban; el gesto real ya estaba cubierto por la prueba anterior.
  - **Sigue sin probarse**: el preview de Vercel con datos reales (las columnas de fecha de `/reportes/vencimientos` y `/administracion/auditoria` abiertas en Excel), Firefox y Safari. La suite con base de datos sí se corrió después (ver más abajo).
- **Proyectos de Vercel**: hay dos conectados a este repositorio, `motor2-demo` y `stockhneuquen`. Ambos construyeron la rama sin errores (el build incluye `prisma migrate deploy`). El usuario informó que `stockhneuquen` es el que va a quedar para el cliente, pero que admite pruebas. Un push a `main` desplegaría en los dos, si `main` es su rama de producción (no verificado: no hay acceso al panel de Vercel).
- **Commit 3, nombre sin `-` inicial**: estaba en **HOLD** y las dos condiciones se cumplieron el 2026-09-18. El usuario confirmó que quiere la regla y se hizo la consulta de solo lectura a Neon (proyecto `inventario-api`): **0 nombres con `-` inicial** en 9 tipos de entidad, en la rama `demo-pizzeria-la-cuadra` (44 productos, 8 proveedores, 11 unidades) y en `main` (rama casi vacía: 0 productos y 0 proveedores). Es el único cambio que restringe entradas hoy válidas: `actualizarProducto` revalida el nombre, así que un producto ya guardado con `-` inicial no se podría guardar con ningún cambio hasta renombrarlo. La regla rechaza también nombres como `- Promo` o `-40% combo`. El usuario autorizó los commits locales el 2026-09-18; el push sigue pendiente de su aprobación.
- **Suite completa con base de datos (2026-09-18)**: 61 archivos y **452 tests pasan (452/452)** contra un Postgres 17.11 portátil en la máquina del usuario, con configuración regional es-AR, migraciones aplicadas con `prisma migrate deploy` y solo por `127.0.0.1` (nunca contra Neon). Corrida con la rama a partir del commit `4f834ca`. En un primer intento pasaron 451 de 452: el fallo fue `test/catalogo/productos.test.ts` ("rechaza nombre duplicado, ignorando mayúsculas"), causado por haber inicializado ese Postgres sin configuración regional (`--no-locale`), con lo que `lower()` y `ILIKE` no pliegan letras con tilde (comprobado: `lower('AZÚCAR') = 'azúcar'` da falso ahí y verdadero con es-AR); con la configuración regional correcta pasó. Quedan fuera los tests e2e de Playwright (`test/e2e`), que no se corrieron. `next build` sí se corrió antes.
- **Registrado, sin corregir**: una cantidad NaN aborta un Ajuste pero se saltea en silencio en los demás procesos (comportamiento previo). Los puntos del governor sobre `celdaCsv` (`+3`, `-12.5%`, notación exponencial) dejaron de aplicar al eliminarse el CSV.

## 8. Roadmap consolidado actualizado

Esfuerzos: los de los pasos 1-7 vienen del roadmap de `grounding-reportes-compras`; los marcados con * son estimación propia, sin verificar.

| # | Paso | Esfuerzo | Estado |
|---|---|---|---|
| 6 | Grupo "No comestibles" (Packaging, Limpieza) + excluirlo de `calcularRatioGastoVentas` | Bajo | **Decidido (USAR)**, listo para implementar |
| 6b | Food cost por consumo (`costoUnitarioVenta`) junto al ratio de compras | Bajo-Medio* | Propuesta nueva (§4) |
| E1 | Digest diario de stock por mail, con cantidad sugerida y flag "ya avisado" | Medio* | Diseño en §3. Proveedor de mail: Resend, propuesto por el usuario (§7.6). Falta cuenta, dominio y API key |
| 5b | Columna de serie en `IndicePrecio` + fuente como configuración | Medio* | Prerrequisito de la serie Alimentos y del USD (§5.2) |
| 5c | Antigüedad máxima explícita del IPC | Bajo* | Propuesta (§5.3) |
| 1 | Corte Pareto 80/20 + % sobre el total | Bajo | Pendiente |
| E2 | Export del reporte por período | Bajo* | **Cubierto por E2b**: cada tabla del reporte por período ya exporta a Excel. No existe un export único de todo el reporte en un solo archivo |
| E2b | Export de `TablaReporte` a Excel (.xlsx) en lugar de CSV: números como números, fechas como fechas de Excel, textos sin evaluar como fórmula | Bajo* | **Implementado** en rama local `fix/csv-export-formulas`, commiteado en local y sin push (§7.4). Probado en el Excel del usuario con un archivo de muestra; sin probar la descarga desde el botón en el navegador |
| E2c | Chequeo de número finito en Server Actions numéricas; un nombre no puede empezar con `-` | Bajo* | **Implementado** en la misma rama, commiteado en local y sin push (§7.5). La suite con base de datos pasa completa (452/452, §7.7) |
| C1 | Spike: subir un archivo a Drive desde el navegador (`drive.file`) y confirmar los puntos sin verificar de §7.6 | Bajo* | Propuesto, sin tocar schema |
| C2 | Resend: primer uso real con E1 (alertas de stock) | Medio* | Propuesto. Necesita API key, dominio verificado y variables de entorno |
| C3 | Tabla `Comprobante` (solo la referencia a Drive) + migración + campo en Compra | Medio* | Propuesto. **Migración: requiere autorización expresa** |
| C4 | Envío del comprobante (link de Drive) al contador por Resend | Bajo* | Propuesto, depende de C2 y C3 |
| G1 | Exportar reportes a una carpeta de Drive del negocio (`drive.file`, token en el navegador) | Medio* | Idea (§7.3), a decidir |
| G2 | Importar desde una hoja de Google con selector, sin hacerla pública | Medio* | Idea (§7.3), a decidir |
| 7 | Pivot / export para el contador | Alto | Pendiente, el último |
| — | Método 2 USD (`CotizacionDolar`) | Medio* | Solo si el negocio lo pide, mismo patrón que 5b |
| — | Corregir fila del paso 0 y fila 5 en `grounding-reportes-compras` | Muy bajo | Pendiente (§1.3) |

## 9. Decisiones abiertas para el usuario

1. Alertas de stock: ¿un mail por ítem o digest diario? ¿Quién recibe: todos con `notificar_alertas`, o solo el responsable de cada sucursal? El proveedor de mail lo propone el usuario: Resend (§7.6).
2. ¿Los no comestibles quedan fuera de las recetas o solo fuera del ratio? (§2)
3. ¿Se agrega el food cost por consumo junto al ratio de compras? (§4)
4. ¿Cómo debe agruparse el día de ventas para locales que cierran pasada la medianoche? (§6)
5. ¿Se autoriza la migración de la columna de serie en `IndicePrecio`? (§5.2)
6. Comprobantes (§7.6): ¿tienen Google Workspace y Unidades compartidas? ¿Quién debe poder ver los comprobantes? ¿Qué mails se mandarían con Resend (alertas de stock, comprobante al contador, otros)? ¿Con qué dominio remitente?
7. Google Drive, resto (§7.3): ¿exportar reportes a Drive para el contador (G1) o importar desde Sheets (G2)? Hoy quedan como ideas.

**Resueltas el 2026-09-18** (implementadas en la rama local `fix/csv-export-formulas`, commiteado en local y sin push): el export pasa a `.xlsx` (el CSV es-AR falló en el Excel del usuario, §7.4); chequeo de número finito en las Server Actions numéricas y un nombre no puede empezar con `-` (§7.5).

## 10. Limitaciones

- **TastyIgniter**: el repo `tastyigniter/TastyIgniter` es solo el "shell" del proyecto; la lógica está en paquetes aparte. Se leyeron `tastyigniter/core` y `tastyigniter/ti-ext-cart`. No se revisaron extensiones de import/export ni otras. `tastyigniter/ti-ext-reports` no existe (404).
- **URY**: el clon no puede materializar `plans/` en Windows por un nombre de archivo con `:`. Se leyó el resto vía `git --work-tree` sobre el objeto ya descargado. URY delega compras y stock en ERPNext, que no está en su repo.
- **ERPNext**: clon parcial (`--filter=blob:none --sparse`) de `erpnext/stock`, `erpnext/buying`, `erpnext/setup` y `erpnext/manufacturing/doctype/bom_update_tool` y `bom_update_log`. No se leyó `accounts` (cuentas de gasto) ni **Stock Reconciliation** (relevante para E5), ni el framework Frappe (donde vive el export CSV y otras utilidades). Los temas ya cubiertos en pasadas anteriores (Analytics/pivot, UX) no se repiten.
- **NexoPOS**: lectura dirigida por búsqueda (stock bajo, COGS, export, contabilidad), no exhaustiva.
- **Frappe** (§7): clon parcial de `frappe/integrations`, `frappe/core/doctype/data_import`, `frappe/desk` y `frappe/utils`. El selector de Drive (`google_drive_picker.js`) se leyó de forma remota con la API de GitHub, no en el clon. La app `frappe/offsite_backups` se clonó completa pero solo se leyó el módulo de Google Drive; Dropbox y S3 quedaron sin leer.
- **Nada de §7 se ejecutó**: los defectos del backup (§7.2) salen de leer el código, no de correrlo. El `.xlsx` de motor2 se abrió bien en el Excel del usuario con un archivo de muestra, pero no se probó la descarga desde el botón en el navegador. Tampoco se probó el acceso a Google Drive ni a Sheets desde esta sesión.
- **Comprobantes (§7.6)**: es un diseño, no hay código. Los datos de Vercel, Google y Resend vienen de resúmenes de WebFetch de sus páginas oficiales. **Sin verificar** (las páginas consultadas no lo dicen): si un navegador puede usar un URI de sesión resumible abierto por el servidor (CORS/Origin), si el Picker da acceso para crear archivos dentro de una carpeta elegida, cómo se comporta una cuenta de servicio con la cuota de una carpeta de "Mi unidad", la retención de la Idempotency-Key de Resend, los requisitos de verificación de dominio y los límites del plan gratuito de Resend.
- **Suite con base de datos**: no se pudo correr al principio (la máquina no tenía Docker ni Postgres); se corrió después con un Postgres portátil y pasó completa (452/452, §7.7). Los tests e2e de Playwright no se corrieron. No hay CI: la suite no corre sola en cada push.
- Los ítems de §1.5 (UX) vienen de los documentos; no se verificaron contra el código.

## Fuentes

Código leído directamente en clones locales (`git clone --depth 1`; ERPNext con `--filter=blob:none --sparse`). Versión de cada uno:

- `tastyigniter/TastyIgniter` `035028b` (2026-09-14, solo shell); `tastyigniter/core` `82c9053` (2026-09-14); `tastyigniter/ti-ext-cart` `16c224c` (2026-09-14):
  - `src/Models/Stock.php` (líneas 142-160, 277-279, 291-309, 312-321) y `src/Extension.php:248` (plantilla de mail); `resources/views/mail/low_stock_alert.blade.php`.
  - `database/migrations/admin/2022_02_07_010000_add_low_stock_alerted_on_stocks_table.php` (columna `low_stock_alert_sent`).
- `blair2004/NexoPOS` `6061a93` (2026-08-25):
  - `app/Jobs/DetectLowStockProductsJob.php`, `routes/console.php:83`.
  - `app/Services/ProductService.php:823-871`, `:1800`.
  - `app/Services/TransactionService.php:1079`, `app/Accounting/AccountingEventCatalog.php:39`.
  - `app/Http/Controllers/Dashboard/CrudController.php:320-429`.
  - `app/Mail/` (solo 5 mails de cuenta: ninguno de stock).
- `ury-erp/ury` `58e1cb8` (2026-09-14):
  - `ury/ury/doctype/ury_daily_p_and_l/ury_daily_p_and_l.py` (`cogs_sold` `:61-272`, `before_submit` `:279` en adelante).
  - Doctypes `ury_fixed_expenses`, `ury_variable_expenses`, `ury_cost_of_goods`, `ury_materials`.
  - `ury/ury/report_api/financial.py`; `FEATURES.md`.
- `frappe/erpnext` `a2481e9` (2026-09-18):
  - `erpnext/stock/reorder_item.py`.
  - `erpnext/hooks.py:519-546`.
  - `erpnext/stock/doctype/stock_settings/stock_settings.json`, `erpnext/stock/doctype/item/item.json`, `erpnext/stock/doctype/item_reorder/item_reorder.json`.
  - `erpnext/setup/utils.py:62-157`.
  - `erpnext/setup/doctype/email_digest/email_digest.json`.
  - `erpnext/manufacturing/doctype/bom_update_tool/bom_update_tool.py:48`.
  - Búsqueda de código: `gh search code "inflation" --repo frappe/erpnext` (0 resultados) y `"IPC"`.

- `frappe/frappe` `fc408ba` (2026-09-18):
  - `frappe/integrations/google_oauth.py:10`, `:138`; `frappe/integrations/doctype/google_settings/google_settings.py:19-41`.
  - `frappe/utils/csvutils.py:14-21`, `:235-260`, `:272-280`.
  - `frappe/desk/reportview.py:438-470`; `frappe/desk/utils.py:75-116`, `:128-153`.
  - `frappe/core/doctype/data_import/data_import.py` (`google_sheets_url`).
  - `frappe/public/js/integrations/google_drive_picker.js:4` (lectura remota vía `gh api`).
  - Commit `422995cd4` (2025-04-15), "fix: seperate backup options into app" (consultado con `gh api`).
- `frappe/offsite_backups` `71b8674` (2026-08-25): `offsite_backups/offsite_backups/doctype/google_drive/google_drive.py`, `offsite_backups/offsite_backups/offsite_backup_utils.py`, `offsite_backups/hooks.py`.
- `resend/resend-node` `7743218` (2026-09-15), paquete `resend` 6.28.1: `src/emails/emails.ts` (`create(payload, options)`), `src/emails/interfaces/create-email-options.interface.ts` (adjuntos, `scheduledAt`, `IdempotentRequest`), `src/batch/batch.spec.ts` (header `Idempotency-Key`).
- Páginas de documentación leídas con WebFetch (el resultado es un resumen hecho por el propio tool, no el texto crudo):
  - `vercel.com/docs/functions/limitations` (actualizada 2026-08-24): tope de 4,5 MB del cuerpo de request/response de una Function.
  - `developers.google.com/workspace/drive/api/guides/api-specific-auth`: scopes `drive.file` y `drive`.
  - `developers.google.com/workspace/drive/api/guides/manage-uploads`: subida resumible.
  - `resend.com/docs/api-reference/introduction`: límite de 10 requests/segundo por equipo.

Motor2 (`origin/main` `c0d6c36`): `prisma/schema.prisma` (`IndicePrecio`, `costoUnitarioVenta`:895, `Account`), `src/lib/auth.ts`, `src/components/tabla-reporte.tsx:66-75`, `src/core/reportes/periodo.ts`, `src/core/reportes/indices-economicos.ts`, `src/core/stock/alertas.ts`, `src/core/permisos/acciones.ts:41`, `vercel.json`, y los documentos citados en §1.
