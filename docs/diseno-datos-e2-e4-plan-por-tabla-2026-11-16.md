# Diseño: E-2 (zona horaria de la empresa) y E-4(2) («Desactivado con rastro»), plan por tabla — solo documento

Frente 3 (datos). Complementa `docs/diseno-datos-paridad-pedernal-2026-11-16.md` (§4, etapas E-2 y E-4) y su anexo. **No se escribe código ni migración hasta que entren Planes M1 (`Empresa`) y los frentes dueños de cada tabla** (orden del orquestador general, 2026-11-16). Nada se aplica a ninguna base real. Lo no leído va como NO VERIFICADO.

## 0. Pedido y citas

- «el tema de datos» (2026-11-16) y «No dejes nada pendiente de lo que se puede trabajar en paralelo» (2026-11-16), `motor2-docs`, seguimiento-de-pedernal (tanda de decisiones del dueño).
- E-2: «Sí, Buenos Aires por defecto (Recomendada)» (dueño, 2026-11-16, «cuarta tanda»).
- E-4(2): «Desactivado con rastro (Recomendada)» (dueño, 2026-11-16, «tercera tanda»): lo que hoy se borra de verdad pasa a desactivado/anulado con quién y cuándo, como Pedernal; cambia lo que se ve al quitar.

## 1. E-2: zona horaria de la empresa

**Qué hay hoy (leído):** `Empresa.zonaHoraria TEXT NOT NULL` sin validación en la base (una sola mención en migraciones, la creación). El código la valida: `empresa.schema.ts:20` exige `esZonaHorariaValida` (de `core/tiempo/zona-horaria.ts`, rechaza vacío, espacios y desfases). La empresa se da de alta desde la consola de plataforma (`plataforma/src/app/instalaciones/[instalacion]/empresas/nueva/formulario.tsx` y `acciones.ts`), donde la zona es un campo que se carga. Existe `scripts/medir-zonas-horarias.ts` (solo lectura: lista empresas con zona inválida o distinta de Argentina).

**Qué hace Pedernal (leído):** `zona_horaria_valida(text)` = existe en `pg_timezone_names`; disparador `empresa_validar_zona_horaria` (CHECK `empresa_zona_horaria_ck`, error 23514); `DEFAULT 'America/Argentina/Buenos_Aires'` en la columna (`0001_base.sql`, líneas 257 a 297 y 468 a 475).

**Diseño (PROPUESTA, salvo lo citado):**

| # | Decisión | Estado |
|---|---|---|
| Z-1 | Una empresa nueva nace con `America/Argentina/Buenos_Aires`; solo la plataforma la cambia (consola). | CONFIRMADA (cita arriba) |
| Z-2 | La base rechaza una zona que `pg_timezone_names` no conoce: función `zona_horaria_valida(text)` (`STABLE`, `search_path` fijado) y disparador `BEFORE INSERT OR UPDATE OF "zonaHoraria"` en `Empresa`, como Pedernal. Sin columnas nuevas. | PROPUESTA |
| Z-3 | El default va **en la consola** (valor inicial del formulario, `ZONA_ARGENTINA` de `core/tiempo`) y **también** en la columna (`DEFAULT`): lo segundo es aditivo (`ALTER COLUMN … SET DEFAULT`, reversible) y deja de depender de que el formulario lo mande. | PROPUESTA |
| Z-4 | Antes de aplicar: correr `verificacion-previa.sql` (solo lectura) que cuenta empresas con zona inválida según `pg_timezone_names`; si hay alguna, la migración se detiene y se corrige a mano con el dueño (no se corrige sola). | PROPUESTA |
| Z-5 | La lista de `Intl` y la de `pg_timezone_names` pueden diferir (`Intl` acepta algunos alias que Postgres no, o al revés). La prueba de paridad compara ambas con las zonas de uso real (Argentina y vecinas) y declara el resto. | NO VERIFICADO |

**Archivos y dueños:** migración nueva en el bloque `20261117140000` en adelante (la reserva el orquestador general); `Empresa` es de la zona restringida y Planes M1 le suma `rolesPropiosMax` (cambia el golden `huella-de-gobierno`): E-2 va **después** de M1 y no agrega columnas, así que el golden no cambia por E-2. El formulario de la consola es del frente 4 (consola de plataforma): se le pide el cambio de una línea (valor inicial), no lo edito yo.

**«¿Qué pasa si…?» (E-2):**

| Caso | Resultado esperado |
|---|---|
| Repetición: se da de alta dos veces la misma empresa | no cambia: la unicidad de la empresa ya manda; la zona es la misma |
| Concurrencia: dos altas a la vez con zonas distintas | cada alta es su fila; no hay estado compartido |
| Tiempo: zona nueva en la base de zonas del servidor | la base la acepta o no según su tabla; si Postgres no la conoce, el alta se rechaza con mensaje claro, nunca se guarda a medias |
| Incertidumbre: no sé si la zona de una empresa vieja es válida | `verificacion-previa.sql` lo dice antes de aplicar |
| Reintento: se vuelve a aplicar la migración | se detiene con «ya existe» (patrón de las migraciones actuales) |
| Error parcial | una sola transacción: función, disparador y default, todo o nada |
| Datos faltantes: alta sin zona | se usa Buenos Aires (Z-1), no se rechaza |
| Cambio de permisos: la app intenta cambiar la zona | `Empresa` ya es solo lectura para `motor2_app`; solo la plataforma la escribe |

## 2. E-4(2): lo que hoy se borra pasa a «desactivado con rastro»

**Qué dice la regla:** «Desactivado con rastro» = no hay DELETE: la fila queda, marcada como quitada, con quién y cuándo. Pedernal lo hace con una marca de estado (`linea_cuenta.estado` VIGENTE/ANULADA con `anulada_por`, `anulada_en`, `motivo_de_anulacion`, y UPDATE por columna). **NO VERIFICADO cómo lo hace Pedernal en cada una de las 13 de abajo** (se lee tabla por tabla antes de escribir; solo se verificó la línea de cuenta).

**Cómo se lee la tabla:** «marca» = columna que hoy ya existe para esto; «columnas nuevas» = lo mínimo aditivo (`quitadoEn`, `quitadoPorId`, y `motivo` si Pedernal lo pide). «Dueño del módulo» = el frente o corriente que hoy escribe esa tabla; **no se toca sin su turno**. Las pantallas las adapta el frente 6 («Quitar» → lo que el dueño decida), que ya lo aceptó.

| # | Tabla (dónde borra hoy) | Para qué se borra hoy | Marca hoy | Propuesta de «desactivar» | Dueño del módulo | Tocar esquema |
|---|---|---|---|---|---|---|
| 1 | `CuentaItem` (`persistencia/pos/pedido.ts:137,148,149`) | quitar un ítem y sus adicionales que NO salieron a cocina; la condición `numeroEnvio: null` vive en el mismo borrado | ninguna (`numeroEnvio`, `anulaAItemId`) | estado «quitada» con quién y cuándo; los listados y el total de la cuenta la ignoran; la condición «no salió a cocina» sigue en el mismo UPDATE | salón/mostrador (frente 6 pantallas; el 2 y el 1 ya suman columnas a `CuentaItem`) | SÍ, columnas en tabla compartida: por turno |
| 2 | `PromoCuenta` (`pedido.ts:160`) | quitar una promo sin enviar junto con sus ítems | ninguna | igual que el ítem: «quitada» con quién y cuándo; los ítems de la promo se quitan juntos | salón/mostrador | SÍ |
| 3 | `StockMinimoProducto` (`persistencia/stock/stock-minimo.ts:53`) | dejar sin mínimo a un producto | ninguna | desactivar la fila; «sin fila vigente» = sin mínimo (la lectura filtra) | stock | SÍ |
| 4 | `SeccionHabitualProducto` (`seccion-habitual.ts:22`) | sacar la sección habitual de conteo | ninguna | idem | stock | SÍ |
| 5 | `FrecuenciaConteoProducto` (`frecuencia-conteo.ts:22`) | sacar la frecuencia de conteo | ninguna | idem | stock | SÍ |
| 6 | `DescuentoProductoSucursal` (`persistencia/carta/descuento-producto.ts:14`) | sacar el descuento de un producto en una sucursal | ninguna | idem | carta | SÍ |
| 7 | `MargenObjetivo` (`persistencia/reportes/margen-objetivo.ts:13`) | volver al objetivo de la empresa o al de por defecto | ninguna | idem; el índice único debe pasar a parcial para volver a crear uno vigente | reportes | SÍ (índice único cambia) |
| 8 | `ContenidoCartaProducto` (`carta/contenido-producto.ts:64`) | quitar el contenido de carta de un producto | `actualizadoEn` | idem | carta | SÍ |
| 9 | `OpcionItemAgrupadoCarta` (`carta/items-agrupados.ts:51` y `copiar-carta.ts:99`) | sacar una opción de un ítem agrupado | `creadoEn` | idem | carta | SÍ |
| 10 | `ItemAgrupadoCarta` (`copiar-carta.ts:101`) | reemplazar la carta de una sucursal | **`activo`** | usar `activo = false` + rastro (ya existe la marca) | carta | solo rastro (`quitadoEn`, `quitadoPorId`) |
| 11 | `GeneroCarta` (`copiar-carta.ts:102`) | reemplazar la carta de una sucursal | **`activo`** | idem | carta | solo rastro |
| 12 | `Insumo` (`persistencia/catalogo/insumos.ts:58`) | fusión: se borra el insumo de origen tras mover productos y sustitutos | **`activo`** | `activo = false` + a qué insumo se fusionó (`fusionadoEn`/`fusionadoConId`) | catálogo | solo rastro |
| 13 | `SustitutoRecetaIngrediente` (`insumos.ts:93,98`) | quitar un sustituto duplicado o redundante tras una fusión | ninguna | idem a las configuraciones | catálogo/recetas | SÍ |

**Copiar/reemplazar carta de una sucursal (`copiar-carta.ts`, filas 8, 9, 10 y 11):** hoy «reemplazar» borra todo lo de esa sucursal y lo vuelve a crear. Con «desactivado» se desactiva lo vigente y se crea lo nuevo en el mismo UPDATE+INSERT; el historial crece con cada reemplazo. Decisión de diseño que NO se toma acá: si «volver a una carta anterior» pasa a ser posible (sería una función nueva que nadie pidió).

**Reglas comunes (PROPUESTA):**
1. Una columna `quitadoEn timestamptz` y `quitadoPorId` en cada tabla (nunca borra; `UPDATE` por columna para la app, sin `DELETE`). Lo ya cubierto por `activo` en 10, 11 y 12 usa esa marca y suma solo el rastro.
2. **Unicidad:** donde hoy un único impide repetir (7, 3, 4, 5, 6) pasa a índice único parcial «solo vigentes» (`WHERE quitadoEn IS NULL`): se puede volver a poner un valor después de quitarlo. Es el cambio más delicado: se mide primero que no haya duplicados vivos.
3. **Lecturas:** toda consulta filtra «no quitado»; el cerco `cerco-anuladas-en-consultas` (ya existe en `test/arquitectura`) se extiende a las marcas nuevas y falla si una lectura no filtra.
4. **Auditoría:** el caso de uso audita quién y cuándo en `RegistroAuditoria` (ya lo hacen); el rastro en la fila es adicional.
5. **El REVOKE de DELETE** (E-4(1)) y el cambio de código (E-4(2)) van en el **mismo despliegue por tabla**: si se revoca antes de cambiar el código, el «quitar» da 42501; si se cambia el código antes de revocar, queda DELETE abierto sin uso. Orden por tabla: (a) migración aditiva con la marca, (b) código que desactiva, (c) `REVOKE DELETE`, (d) test del molde la cuenta como lista de tablas sin DELETE.

**«¿Qué pasa si…?» (E-4(2), para cada fila):**

| Caso | Resultado esperado |
|---|---|
| Repetición: doble clic en «Quitar» | la segunda vez no hay nada vigente que quitar: «ya estaba quitado», sin error ni segundo rastro (el UPDATE lleva `quitadoEn IS NULL` en el `WHERE`) |
| Concurrencia: dos mozos, uno quita y otro envía a cocina (fila 1) | la condición «no salió a cocina» vive en el mismo UPDATE: gana uno; el otro recibe «ya salió a cocina» (igual que hoy con el borrado) |
| Concurrencia: dos personas ponen y quitan el mismo valor a la vez (filas 3 a 7) | el índice único parcial deja una sola vigente; la otra recibe el rechazo |
| Tiempo: se quita hoy y se vuelve a poner mañana | se crea una fila vigente nueva; la vieja queda con su rastro |
| Incertidumbre: no sé si se quitó | se ve en la fila (`quitadoEn`) y en la auditoría |
| Reintento automático | idempotente: «ya estaba quitado» |
| Error parcial: se quita la línea pero falla quitar sus adicionales (fila 1) | una sola transacción: todo o nada; se conserva el error explícito que ya existe |
| Datos faltantes: filas viejas sin `quitadoEn` | `NULL` = vigente (nada cambia para lo ya guardado) |
| Cambio de permisos: quien quita ya no tiene permiso | rechazo del servidor; la app no tiene DELETE para esquivarlo |

## 3. Dependencias y orden

1. Planes M1 (`Empresa.rolesPropiosMax`) → E-2 (no cambia columnas; golden intacto).
2. Frente 1/2 sobre `CuentaItem` (columnas de camino y departamento) → fila 1 de E-4(2) por turno, una sola migración por vez sobre esa tabla.
3. Stock, carta, reportes y catálogo: un turno por tabla con el frente dueño; cada uno con el orden (a) a (d) de las reglas comunes.
4. Timestamps de migración: bloque `20261117140000` en adelante (reservado por el orquestador general).

## 4. NO VERIFICADO

- Cómo resuelve Pedernal cada una de las 13 (solo la línea de cuenta, leída).
- Que `pg_timezone_names` de Neon traiga las mismas zonas que `Intl` de Node (se prueba en el ensayo).
- Que no haya otros `DELETE` hechos con SQL crudo (la búsqueda cubrió `.delete(` y `deleteMany(`).
- Privilegios reales de producción (ver el documento principal §8).
