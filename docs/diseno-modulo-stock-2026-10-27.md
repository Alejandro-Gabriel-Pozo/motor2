# Diseño: módulo Stock de la Fase 7 «pantallas por módulo» (Ola PM-2), 2026-10-27

Origen: DEC-27 ratificada por el dueño el 2026-10-20 (`docs/decisiones-cerradas-ola-precio-y-carta-2026-10-19.md`, sección «Fase 7»): Stock tiene **2 entradas** de menú, «Existencias» (pestañas Consolidado · Por familia · Alertas, con el atajo «Cambiar mínimo») y «Configuración» (depósitos, motivos de merma, destinos de consumo y la tabla «Parámetros por insumo»). Aplican también el glosario DEC-26/DEC-30 (Depósito, Traslado, Traspaso, Cambio de gerencia) y DEC-33 (ver ≠ escribir con NIVELES de la misma clave, sin claves nuevas ni migración). Molde de arquitectura: el módulo Movimientos ya terminado (#131).

Escrito contra el código real del carril (`alegp/carril-t`, base `5cb1e52d`) y contra la emulación ratificada (artefacto `N9vFwuyYsQD7RkwjNzTsxf`, `project/Main.dc.html`: vistas `p_exist`, `p_config`, `paramIns` y la ventana «Parámetros de …»). Se revisó también `motor2-docs` (`_planes/`, decisiones del dueño): no hay un plan aprobado del módulo Stock más allá de DEC-27 y la emulación.

**Restricción de esta ola: SIN MIGRACIÓN.** Todo lo de abajo son pantallas, menú, vocabulario, lecturas y un control de concurrencia que no necesita columnas nuevas. Lo que pediría una migración queda PENDIENTE (sección 11).

## 0. Inventario de lo que ya existe (verificado en el código)

**Rutas y pantallas** (`src/app/(app)`):

| Ruta | Qué es | Guarda de la página | Escritura que dispara |
|---|---|---|---|
| `/stock/consolidado` | Teórico vs. último conteo, más el stock en tránsito | `requierePermisoVer("ver_stock")` | — |
| `/stock/por-familia` | Saldo agrupado por insumo (familia) y sección | `ver_stock` | — |
| `/stock/alertas` | Bajo mínimo (crítico/bajo) por producto y sección | `ver_stock` | — |
| `/stock/minimo` | Tabla + formulario de alta/edición/borrado del mínimo (global o por sección) | `stock_minimo` | `setStockMinimoProducto`, `eliminarStockMinimo` |
| `/stock/seccion-habitual` | De qué sección sale primero cada producto al cerrar una cuenta | `stock_seccion_habitual` | `setSeccionHabitual`, `eliminarSeccionHabitual` |
| `/stock/conteo-frecuencia` | Agenda de conteo por producto + sugerencias clase A | `conteo_frecuencia` | `setFrecuenciaConteo`, `eliminarFrecuenciaConteo` |
| `/stock/reclasificar` | Proceso (se abre desde «Registrar movimiento») | `stock_reclasificar` | `reclasificarStock` (SERIALIZABLE + I3) |
| `/movimientos/secciones` | Depósitos: alta, renombrar, activar/desactivar, respaldo en ventas | `secciones` | `crearSeccion`, `renombrarSeccion`, `actualizarActivaSeccion`, `actualizarRespaldoSeccion` |
| `/movimientos/motivos-merma` | Catálogo de motivos de merma (empresa) | `requierePermisoVerDeEmpresa("motivos_merma")` | `crearMotivoMerma`, `actualizarActivoMotivoMerma` |
| `/movimientos/destinos-consumo` | Catálogo de destinos de consumo (empresa) | `motivos_destino_consumo` (empresa) | `crearDestinoConsumo`, `actualizarActivoDestinoConsumo` |

**Menú hoy** (`src/core/navegacion/estructura.ts`, grupo `stock`): 9 ítems sueltos (Consolidado, Por familia, Alertas, Stock mínimo, Sección habitual, Frecuencia de conteo, Depósitos, Motivos de Merma, Destinos de Consumo).

**Claves** (`src/core/permisos/acciones.ts`, módulo `stock`): `ver_stock` (sucursal, piso operario), `stock_minimo`, `stock_seccion_habitual`, `secciones` (sucursal, piso administrador), `conteo_frecuencia`, `stock_reclasificar` (sucursal, piso operario), `motivos_merma`, `motivos_destino_consumo` (EMPRESA, piso administrador). El piso vale para Ver y para Editar.

**Mecanismo del menú ya construido por Movimientos** (reutilizable tal cual): `ItemNav` con `accion` o `algunaDe`; `RUTAS_DE_UNA_ENTRADA` (rutas que se abren desde una entrada y resaltan esa entrada; las resuelven `itemDeRuta`, `accionDeRuta`, `panelDeRuta`, `hrefActivoDelMenu`, `pantallaTrasCambiarSucursal` y el buscador del cajón de celular); `PestanasDeRuta` (`src/ui/componentes/navegacion/pestanas-de-ruta.tsx`); la fila de servidor `FilaDeMovimientos` filtrada por permiso (`procesosVisiblesDelSelector`); la guarda `requierePermisoVerDeAlguna` (solo claves de SUCURSAL).

**Lo que falta para Stock:** (a) una guarda de página «alguna de» que acepte claves de los DOS contextos (Configuración junta `secciones`, de sucursal, con `motivos_merma`, de empresa); hoy existe ese cálculo para lecturas (`requerirVerAlguna`, `accionesDelMenuQueElUsuarioPuedeVer`) pero no como guarda de página; (b) `RUTAS_DE_UNA_ENTRADA` hoy se arma solo desde el selector de Movimientos.

**Specs e2e que tocan estas pantallas:** `accesibilidad.spec.ts` (sección habitual, motivos), `stock-seccion-habitual.spec.ts`, `movil-secciones-y-conteo.spec.ts`, `menu-paneles.spec.ts`, `menu-item-activo.spec.ts`, `inicio.spec.ts`, `lecturas-por-rol.spec.ts`, `csp-sin-violaciones.spec.ts`, `stock-reclasificar-decimales.spec.ts`, `movimientos-registrar.spec.ts`.

## 1. Propósito y alcance

- **Propósito:** que el encargado y el administrador encuentren en DOS lugares todo lo de Stock: «¿qué hay y qué falta?» (Existencias) y «¿cómo está configurado?» (Configuración), con el vocabulario del dueño. — CONFIRMADA (DEC-27).
- **Dentro:** menú (2 entradas), pestañas de ruta, página «Parámetros por insumo» (lectura), atajo «Cambiar mínimo», vocabulario «Depósito», niveles ver ≠ escribir en las pantallas de configuración, arreglos visuales a 375 y 1280 px. — CONFIRMADA (pedido de la ola).
- **Fuera:** registrar movimientos (es Movimientos), traspasos (DEC-29, otro módulo), costo y valuación (Reportes / circuito de abastecimiento), editar los tres parámetros en UNA ventana (ver P-1), mudar las URL. — PROPUESTA.

## 2. Actores y contexto

- Administrador de la sucursal (rol de clave `admin`): ve y edita todo. — CONFIRMADA (pisos del catálogo).
- Operador / encargado y roles armados desde la matriz (mozo, cajero…): `ver_stock`, `conteo_frecuencia`, `stock_reclasificar` (piso operario); NO alcanzan mínimo, depósito habitual, depósitos ni motivos (piso administrador). — CONFIRMADA.
- Un rol puede tener «Ver» sin «Editar» de una clave (DEC-33). — CONFIRMADA.
- Contexto: todo es de la sucursal ACTIVA, salvo motivos de merma y destinos de consumo, que son de la EMPRESA. Aislamiento por RLS (`ctx.db` con la empresa y el alcance de sucursal). — CONFIRMADA (código).

## 3. Casos de uso

| Id | Caso | Quién | Comando / lectura (existente salvo marca) |
|---|---|---|---|
| CU1 | Ver existencias consolidadas | `ver_stock` | `calcularStockConsolidado`, `calcularStockEnTransito` |
| CU2 | Ver existencias por familia | `ver_stock` | `calcularStockPorFamilia` |
| CU3 | Ver alertas (bajo mínimo) | `ver_stock` | `calcularAlertasStock` |
| CU4 | **Cambiar mínimo** desde una alerta | Editar `stock_minimo` | `setStockMinimoProducto` con el mínimo que se vio (NUEVO: control de concurrencia) |
| CU5 | Ver parámetros por insumo | Ver de alguna de `stock_minimo`, `stock_seccion_habitual`, `conteo_frecuencia` | NUEVA lectura (arma las tres listas existentes; cada columna solo con su «Ver») |
| CU6 | Fijar, cambiar o eliminar el mínimo | `stock_minimo` | `setStockMinimoProducto`, `eliminarStockMinimo` |
| CU7 | Fijar o quitar el depósito habitual | `stock_seccion_habitual` | `setSeccionHabitual`, `eliminarSeccionHabitual` |
| CU8 | Fijar o quitar la frecuencia de conteo | `conteo_frecuencia` | `setFrecuenciaConteo`, `eliminarFrecuenciaConteo` |
| CU9 | Alta, renombre, activar/desactivar y respaldo de depósitos | `secciones` | `crearSeccion`, `renombrarSeccion`, `actualizarActivaSeccion`, `actualizarRespaldoSeccion` |
| CU10 | Motivos de merma | `motivos_merma` (empresa) | `crearMotivoMerma`, `actualizarActivoMotivoMerma` |
| CU11 | Destinos de consumo | `motivos_destino_consumo` (empresa) | `crearDestinoConsumo`, `actualizarActivoDestinoConsumo` |

Conteo físico y Reclasificar son procesos de Movimientos (DEC-25); acá solo se arregla la grilla del conteo en celular.

## 4. Conceptos y ciclo de vida

- **Depósito** = el lugar de stock dentro de una sucursal (tabla `Seccion`; el nombre de la tabla NO cambia). Ciclo: activo ↔ inactivo; nunca se borra (lo referencian los movimientos). Uno inactivo solo admite sacar mercadería (P17). — CONFIRMADA (glosario y código).
- **Existencia** = saldo DERIVADO del libro mayor (`MovimientoStock`); no se edita nunca: se corrige con un movimiento nuevo (ajuste, conteo). Un movimiento de stock nunca se borra; se anula con un registro nuevo. — CONFIRMADA (dueño).
- **Stock mínimo** (`StockMinimoProducto`): por producto y sucursal, GLOBAL (sin depósito) o de UN depósito (gana el del depósito). Ciclo: sin cargar → cargado → cambiado → eliminado (configuración, no movimiento: se borra la fila, el historial queda en la auditoría). «Sin mínimo» y «mínimo 0» son distintos. — CONFIRMADA (código, H4C-22).
- **Depósito habitual** (`SeccionHabitual`): de dónde sale primero un producto al cerrar una cuenta del salón. — CONFIRMADA.
- **Frecuencia de conteo** (`FrecuenciaConteo`): cada cuántos días se cuenta; 0 = agenda desactivada sin borrar la fila. — CONFIRMADA.
- **Parámetros por insumo** = vista de LECTURA que junta, por producto, mínimo global, mínimos por depósito, depósito habitual y frecuencia de la sucursal activa. No es una tabla nueva. — PROPUESTA (forma de la emulación, sin la ventana compuesta).

## 5. Invariantes y políticas

| Id | Regla | Estado |
|---|---|---|
| I1 | La existencia se deriva del libro mayor; ninguna pantalla de Stock la escribe. | CONFIRMADA |
| I2 | Un movimiento de stock nunca se borra: se anula con un registro nuevo. | CONFIRMADA (dueño) |
| I3 | El mínimo es ≥ 0, número estricto, ≤ `STOCK_MINIMO_MAXIMO`; los decimales que admite una cantidad los da su UNIDAD (Catálogo › Unidades; no se cambia acá). | CONFIRMADA |
| I4 | Una sola fila de mínimo GLOBAL por producto y sucursal (índice único parcial) y una por producto y depósito (`@@unique`). | CONFIRMADA (base) |
| I5 | Ver ≠ escribir con niveles de la MISMA clave; quien solo ve recibe la pantalla con el formulario deshabilitado y el aviso, y el servidor rechaza igual (`conPermiso`). Sin claves nuevas. | CONFIRMADA (DEC-33) |
| I6 | Menú = página: un ítem se muestra solo a quien puede abrir su página (misma clave o misma lista `algunaDe`, con el mismo cálculo). | CONFIRMADA (regla del proyecto, test `menu-con-permiso`) |
| I7 | Todo se lee y se escribe en la sucursal activa (o la empresa activa para motivos/destinos); otra empresa no ve ni escribe nada (RLS + chequeo de sucursal en el caso de uso). | CONFIRMADA |
| I8 | «Cambiar mínimo» no pisa en silencio un cambio ajeno: guarda solo si el mínimo sigue siendo el que la persona vio; si otra persona lo cambió, no guarda y lo dice. El mismo pedido repetido (doble clic) es éxito sin cambio. | PROPUESTA (ingeniero; misma regla que «solo salón») |
| I9 | Un depósito se desactiva, nunca se borra. | CONFIRMADA |

## 6. Historia y persistencia

**Sin tablas ni columnas nuevas.** El control de I8 usa el VALOR del mínimo como versión (`UPDATE … WHERE id = ? AND minimo = <el que se vio>`), así que no necesita una columna `version`. El historial de cambios del mínimo ya queda en `RegistroAuditoria` (entidad `StockMinimoProducto`, H4C-22). Depósito habitual, frecuencia y depósitos se registran en su propia fila (`auditoria=DOCUMENTO_PROPIO`): sin historial de quién cambió qué (brecha anotada en P-4).

## 7. Atomicidad y concurrencia

- Cambiar mínimo con el valor visto (CU4 y la edición de `/stock/minimo`): transacción simple; dentro, (1) se lee la fila de ese producto y depósito; si ya tiene el valor pedido → éxito sin escribir ni auditar (doble clic); (2) si su valor no es el que se vio → `MINIMO_CAMBIO` («cambió mientras lo editabas: ahora es X»), sin escribir; (3) `updateMany WHERE {id, minimo: visto}`; 0 filas (otro ganó entre la lectura y la escritura) → `MINIMO_CAMBIO`; (4) la auditoría en la MISMA transacción. En READ COMMITTED el segundo `UPDATE` espera al primero y reevalúa el `WHERE` sobre la fila nueva: gana uno solo.
- El alta (sin fila previa) sigue como hoy: upsert por la clave única. Dos altas simultáneas del mínimo GLOBAL pueden chocar con el índice parcial (P2002): hoy eso sale como error genérico (brecha anotada en P-5; no la abre esta ola).
- Las demás escrituras del módulo NO se tocan (ver tabla de la sección 10).

## 8. Acceso e interfaces

- **Menú (DEC-27):** grupo Stock con dos ítems:
  - «Existencias» → `/stock/consolidado`, `accion: "ver_stock"`, panel Sucursal. Las pestañas Por familia (`/stock/por-familia`) y Alertas (`/stock/alertas`) son rutas de esa entrada.
  - «Configuración» → `/stock/configuracion` (la pestaña «Parámetros por insumo»), `algunaDe: [stock_minimo, stock_seccion_habitual, conteo_frecuencia, secciones, motivos_merma, motivos_destino_consumo]`, panel «ambos» (tiene pestañas de los dos contextos). Las pestañas Depósitos (`/movimientos/secciones`), Motivos de merma y Destinos de consumo (panel Empresa), y los editores Stock mínimo, Depósito habitual y Frecuencia de conteo son rutas de esa entrada.
  - Las URL NO cambian (igual que Movimientos: se mudan las entradas, no las pantallas). — PROPUESTA (P-3).
- **Guarda nueva (sin claves nuevas):** `requierePermisoVerDeAlgunaDelMenu(usuarioId, empresaId, sucursalId, [claves…], db)`: el mismo cálculo del menú (`accionesDelMenuQueElUsuarioPuedeVer`, cada clave en su contexto); falla cerrado con el motivo de la primera clave. La usa solo `/stock/configuracion`.
- **Pestañas:** `PestanasDeRuta`, filtradas en el servidor (como `FilaDeMovimientos`): una pestaña que el rol no puede abrir no se dibuja.
- **Ver ≠ escribir (I5):** con «Ver» y sin «Editar», cada pantalla de configuración muestra la tabla, el formulario con `fieldset disabled` y el aviso «Solo lectura: tu rol puede ver … pero no cambiarlo», sin los botones de editar/eliminar/activar. En las pantallas cuyos formularios van DENTRO de cada fila (Depósitos, Motivos, Destinos) no hay un formulario que deshabilitar: se muestran los valores como texto, con el mismo aviso. — PROPUESTA (ingeniero). En Alertas, quien no puede editar el mínimo no ve el botón «Cambiar mínimo» y lee una línea que lo explica.

## 9. Consultas y experiencia

- Existencias: un encabezado «Existencias» con la fila de pestañas Consolidado · Por familia · Alertas; cada pestaña conserva su consulta.
- Alertas: columna «Acción» con «Cambiar mínimo» (enlace a `/stock/minimo?editar=<fila que rige>`), solo para quien edita `stock_minimo`. La fila que rige se elige con la misma regla que la alerta (gana la del depósito, si no la global): función pura en `core/stock`.
- Parámetros por insumo: una fila por producto con algún parámetro en la sucursal activa; columnas Stock mínimo (global), Mínimo por depósito, Depósito habitual, Frecuencia de conteo; una columna solo aparece si el rol tiene su «Ver»; lo que no está cargado se muestra «Sin cargar»; cada celda con enlace «Cambiar» a su editor solo si el rol tiene el «Editar».
- Vocabulario: «Depósito» en lugar de «Sección» en los textos de pantalla de Stock y del cierre de cuenta del salón; las claves, tablas y descripciones de `ACCIONES` (viven en la base) no cambian (P-2).
- 375 px: las tablas anchas se desplazan dentro de su caja (región con nombre y foco), el texto «Insumo» no se corta, la grilla del conteo físico se puede recorrer.

## 10. Tabla «¿qué pasa si…?» por comando de escritura del módulo

| Comando | Repetición (doble clic) | Concurrencia | Tiempo / incertidumbre | Reintento | Error parcial | Datos faltantes | Cambio de permisos | Otra empresa |
|---|---|---|---|---|---|---|---|---|
| Cambiar mínimo con el valor visto (CU4, edición) — NUEVO | El 2.º encuentra el valor pedido: éxito sin cambio ni auditoría | `updateMany WHERE minimo = visto`: gana uno; el otro recibe «cambió mientras lo editabas: ahora es X» | Sin reloj | Igual que repetición | Escritura y auditoría en una transacción: o las dos o ninguna | Producto o depósito inexistente → rechazo; fila borrada mientras tanto → «cambió» | `conPermiso("stock_minimo")` en cada pedido | RLS + depósito de la sucursal activa → «No se encontró» |
| Fijar mínimo (alta) | Upsert: no duplica; repetir el mismo valor no audita | Último gana; dos altas globales a la vez → P2002 (P-5) | — | Igual | Una transacción | Igual | Igual | Igual |
| Eliminar mínimo | Por estado: el 2.º «No se encontró esa fila» | Uno borra, el otro no encuentra | — | Igual | Una transacción con la auditoría | — | Igual | Fila de otra sucursal → «No se encontró» |
| Depósito: crear | Por estado: nombre repetido se rechaza | Doble alta: el índice único rechaza la 2.ª | — | Igual | Una escritura | Nombre vacío → validación | `conPermiso("secciones")` | RLS |
| Depósito: renombrar / activar / respaldo | Escribe el valor pedido (idempotente por estado) | Último gana (sin versión; P-6) | — | Igual | Una escritura | — | Igual | RLS + sucursal |
| Depósito habitual: fijar / quitar | Upsert / por estado | Último gana | — | Igual | Una escritura | Depósito inactivo o de otra sucursal → rechazo | `conPermiso("stock_seccion_habitual")` | RLS |
| Frecuencia: fijar / eliminar | Upsert / por estado | Último gana | — | Igual | Una escritura | — | `conPermiso("conteo_frecuencia")` | RLS |
| Motivo de merma / destino de consumo: crear / activar | Por estado / valor pedido | Último gana | — | Igual | Una escritura | Nombre vacío → validación | `conPermisoDeEmpresa(...)` | RLS de empresa |
| Conteo físico (Movimientos) | I3 (clave + huella) | SERIALIZABLE + reintento | Fecha inyectada | I3 | Una transacción | — | `proceso_control` | RLS |
| Reclasificar (Movimientos) | I3 | SERIALIZABLE, saldo leído dentro | — | I3 | Una transacción | — | `stock_reclasificar` | RLS |

Esta ola solo agrega el primer renglón; los demás se documentan como están (auditados contra el código, `@ficha` de cada caso de uso).

## 11. Decisiones PENDIENTES para el dueño (no se inventan; se avanza con lo no bloqueado)

- **P-1 (experiencia, N2):** la emulación edita mínimo, mínimos por depósito, depósito habitual y frecuencia en UNA ventana. Hacerlo bien exige un comando compuesto (las tres claves, todo o nada, con control de concurrencia de las tres filas). Recomendación: esta ola deja la tabla de lectura con un enlace a cada editor (sin tocar lógica de negocio) y la ventana compuesta va en una etapa propia. PENDIENTE.
- **P-2b (vocabulario de mensajes compartidos):** esta ola pasa a «depósito» los textos de pantalla de Stock, el diálogo «Cerrar cuenta» del salón y los mensajes del servidor de los comandos de ESTE módulo (depósitos, depósito habitual, stock mínimo). Quedan con «sección» los mensajes de los procesos de Movimientos y del cierre de cuenta en el servidor («No se encontró la sección.», «Elegí una sección.», «Esta sucursal no tiene ninguna sección activa…»), que fijan dos caracterizaciones congeladas (`venta-matriz-ampliada`, `dinero-tramo-c`). Recomendación: pasarlos en un paso propio de Movimientos con su regeneración declarada. PROPUESTA.
- **P-2 (datos):** las descripciones de `ACCIONES` («Administrar el catálogo de Secciones», «Fijar la Sección habitual…») viven en la base: cambiarlas a «Depósito» es una actualización de datos (migración de datos). Recomendación: hacerlo junto con la próxima migración autorizada. PENDIENTE.
- **P-3 (URL):** mudar `/movimientos/secciones`, `/movimientos/motivos-merma` y `/movimientos/destinos-consumo` a `/stock/…` con redirección 307. Recomendación: no por ahora (Movimientos tampoco mudó URL; los marcadores y los e2e siguen andando). PROPUESTA.
- **P-4 (trazabilidad):** depósito habitual, frecuencia de conteo y depósitos no dejan quién cambió qué (solo la fila). Recomendación: auditarlos como el mínimo (sin migración: `registrarCambioAuditado`) en un paso aparte. PENDIENTE.
- **P-5 (concurrencia):** dos altas simultáneas del mínimo global chocan con el índice parcial y salen como error genérico. Recomendación: traducir P2002 a «otra persona acaba de cargar ese mínimo» en un paso aparte. PROPUESTA.
- **P-6 (concurrencia):** renombrar/activar depósitos y fijar depósito habitual o frecuencia son «último gana». Recomendación: dejarlo (es configuración de baja frecuencia) salvo que el dueño vea un caso real. PROPUESTA.

## 12. Escalera de producto (lo que ve el cliente), N0 a N5

| Nivel | Existencias | Configuración |
|---|---|---|
| N0 | Saldos por producto y depósito (hoy) | Cada parámetro en su pantalla suelta (hoy) |
| N1 (esta ola) | Una entrada con pestañas; alertas con «Cambiar mínimo» que no pisa cambios ajenos | Una entrada con pestañas; tabla «Parámetros por insumo» de lectura; quien solo ve, ve sin poder tocar |
| N2 | Filtros por depósito/familia; exportar | Ventana compuesta de parámetros (P-1); auditoría de todos los parámetros (P-4) |
| N3 | Sugerencia de pedido desde las alertas (mínimo − saldo) | Mínimos sugeridos por consumo |
| N4 | Existencias de todas mis sucursales (con el alcance por sucursal) | Parámetros copiados entre sucursales |
| N5 | Punto de pedido y compra sugerida al proveedor | Políticas por familia |

Lo que falta en un nivel se muestra «Sin cargar» / «pendiente de completar», nunca un valor inventado. La escalera de diseño y la de producto se cruzan en el nivel 5 (I5 e I8).

## 13. Pruebas, migración y operación

- **Migración:** ninguna. Despliegue: solo código; reversible con `git revert`.
- **Pruebas unitarias/integración:** configuración del menú (dos entradas, rutas de cada entrada, resaltado, panel, buscador, cambio de sucursal); la guarda nueva (permiso de sucursal, de empresa, ninguno, otra empresa); la regla pura «qué fila de mínimo rige»; el armado de «Parámetros por insumo» (columnas por permiso, «Sin cargar»); el cambio de mínimo con valor visto: permiso, otra empresa/sucursal, repetición, concurrencia real (`Promise.all`), auditoría; todo con mutación (mutar ⇒ rojo ⇒ revertir ⇒ verde).
- **Arquitectura:** los guardianes del menú, de guardas de página, de cupo de lecturas y de uso de claves se extienden a la guarda nueva; el golden de visibilidad del menú (`test/modulos/__golden__/empresa-principal.json`) se regenera con `GOLDEN_ACTUALIZAR=1` y el diff se revisa en el commit.
- **e2e (Playwright):** flujo Existencias → Alertas → «Cambiar mínimo» → guardar; Configuración con sus pestañas; quien solo ve (formulario deshabilitado); axe (`@axe-core/playwright`) en las pantallas nuevas; 375 px sin desborde.
- **Capturas** a 375 y 1280 px para la aprobación del dueño (fuera del repositorio).

## 14. Pasos (un commit cada uno)

1. Este documento.
2. Fuente de las pestañas de Stock (`core/stock/ui-config.ts`) y menú de dos entradas con sus rutas de una entrada; tests del menú.
3. Guarda de página `requierePermisoVerDeAlgunaDelMenu` + guardianes; página `/stock/configuracion` (Parámetros por insumo) con la fila de pestañas; tests.
4. Fila de pestañas en Existencias (Consolidado, Por familia, Alertas) y en las pantallas de Configuración.
5. «Cambiar mínimo»: regla pura de la fila que rige + control de concurrencia por valor visto (caso de uso) + botón en Alertas + edición en `/stock/minimo`; tests de permiso, otra empresa, repetición, concurrencia, con mutación.
6. Ver ≠ escribir: formulario deshabilitado con aviso en mínimo, depósito habitual, frecuencia y depósitos.
7. Vocabulario «Depósito» en Stock y en el cierre de cuenta del salón.
8. Arreglos a 375 px (tablas, «Insumo», grilla del conteo).
9. e2e del flujo principal, accesibilidad y capturas.
10. Cierre: los 8 comandos del gate.
