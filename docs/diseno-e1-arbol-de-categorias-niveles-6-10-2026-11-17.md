# Diseño E1 (el árbol de categorías) — niveles 6 a 10, con los hallazgos H1–H5 y las decisiones del dueño — 2026-11-17

Frente 2 · **Solo diseño: ninguna migración ni código hasta que el orquestador general revise este documento y lo confirme.** Complementa y **precisa** (no reemplaza) `docs/diseno-clasificacion-comercial-igual-a-pedernal-2026-11-13.md` (§7.1 persistencia, §8 permisos, §10 atomicidad, §11 pruebas) y `docs/diseno-unidades-y-clasificacion-paridad-pedernal-2026-11-16.md`, a la luz de `docs/inventario-lectores-clasificacion-e1-2026-11-17.md` (H1 a H5). Donde este documento y el diseño del 2026-11-13 difieren, **manda este** (cada diferencia está marcada).

Estados: **CONFIRMADA** (dicha por el dueño, con cita), **PROPUESTA**, **PENDIENTE**, **NO VERIFICADO**. Método: escalera de diseño de 10 niveles; primero la opción más barata; lo que el dueño no pidió no entra; todo nace cerrado.

## 0. En una frase

E1 convierte la lista plana de categorías en un árbol (departamento → categoría → …, tope 4 niveles) **igual que Pedernal**, sin tocar productos ni ventas. Las dos categorías planas que hay hoy pasan a ser departamentos. Esto precisa cómo se migra sin romper nada (H1, H2), cómo se evita borrar (H3) y cómo cambian los reportes y el alta (H5 y la regla «ya existe»).

## 1. Niveles 1 a 5 (CONFIRMADOS por el orquestador general, 2026-11-17)

Están en el diseño del 2026-11-13 (§1 a §6) y quedan como están, con **tres decisiones del dueño** que cierran lo que estaba abierto. Respuesta literal del dueño, 2026-11-17, chat con el orquestador general, registrada en `motor2-docs`: «1.- Hoy no hay recetas, igual. pero no habria problema con removerlas o cualquier solución barata. 2.- como pedernal. 3.- recomendado. 4.- recomendado. 5.- recomendado. 6.- si asi». El mapeo a las preguntas lo hizo el orquestador general; yo lo tomo así:

| # | Tema | Decisión | Estado |
|---|---|---|---|
| E1-D1 | Borrado de categorías (H3, «3b») | **Como Pedernal:** las categorías **no se borran** en producción, se **desactivan**. Los tests de limpieza usan un camino explícito y **solo local**; no se abre DELETE en producción | **CONFIRMADA** (cita: «2.- como pedernal.», mapeo del orquestador) |
| E1-D2 | Reportes por categoría (H5, pregunta 4) | **Agrupan por identificador** y muestran el **camino completo** («Bebidas > Gaseosas») | **CONFIRMADA** (cita: «recomendado», mapeo del orquestador) |
| E1-D3 | Crear una categoría con nombre repetido entre hermanas (pregunta 5) | **Error «ya existe entre hermanos»**; ya no se reusa en silencio | **CONFIRMADA** (cita: «recomendado», mapeo del orquestador) |

**NO VERIFICADO:** a qué pregunta corresponde el «6.- si asi» (el orquestador no me lo trasladó); no lo uso para nada de este documento.

## 2. Nivel 6 — Historia y persistencia

### 2.1 Cambio de modelo (E1; migración aditiva y reversible)

Lo de §7.1 del diseño del 2026-11-13 sigue (columnas `padreId`, `nombreClave`, `version`, `creadoEn`, `actualizadoEn` en `CategoriaProducto`; FK compuesta `(empresaId, padreId) → (empresaId, id)`; CHECK `padreId IS DISTINCT FROM id`; índice `(empresaId, padreId)`; CHECK de largos; disparadores y candado por empresa; las filas de hoy quedan como departamentos). **Precisiones y correcciones** (cada una con su motivo):

| # | Precisión | Motivo | Estado |
|---|---|---|---|
| P1 | **Se corrige la «garantía de no romper nada».** El diseño decía que el nombre ya es único por empresa, así que el único nuevo no puede fallar. **No es cierto en general**: la unicidad de hoy es por `lower(nombre)` (índice `CategoriaProducto_nombre_lower_key`, `20260929100000_multiempresa_estructura`) y **no pliega tildes**; la clave nueva sí. «Café» y «Cafe» conviven hoy y **chocarían** | H2 | **CONFIRMADA** (verificado en el código) |
| P2 | La migración trae su **`verificacion-previa.sql`** que, por empresa, cuenta las filas que compartirían `(empresaId, padreId = NULL, nombreClave)` y **ABORTA** (con la lista de nombres) si hay alguna; también reporta nombres vacíos o de más de 80 caracteres. Una base con colisión **no se migra** hasta que alguien decida cómo resolverla (cambiar un nombre es un cambio de datos: lo decide el dueño) | H2; «ante la duda el sistema cierra» | **PROPUESTA** |
| P3 | **Una sola función de producción calcula la clave:** `claveDeNombreDeCarta` (`src/core/carta/nombre-en-carta.ts`: NFD, sin marcas `\p{M}`, minúsculas, espacios colapsados y recortados). El **backfill en SQL** replica esa función con `normalize(…, NFD)`, `regexp_replace` del rango de marcas U+0300 a U+036F, `lower`, colapso y recorte de espacios. **Diferencia declarada:** `\p{M}` de JavaScript abarca marcas que el rango no cubre (alfabetos no latinos); para nombres en español no hay diferencia. La verificación previa **reporta** cualquier nombre con marcas fuera de ese rango (debe ser 0 o revisado). Una **prueba de paridad SQL↔TS** (propiedades con `fast-check` sobre una grilla de nombres con tildes, eñes, diéresis, espacios dobles y mayúsculas) la sostiene | H1, H2; «misma forma» | **PROPUESTA** |
| P4 | `nombreClave` es NOT NULL con CHECK de largo 1 a 240. Los **fixtures** de tests (~45 sitios: `test/setup/test-db.ts:314`, `denegacion/mundo.ts:245`, `escenario-reportes.ts:159-161`, `lecturas-tramo-a.test.ts:182`, `informes-de-paridad-con-base.test.ts:189,199`, ~12 specs e2e y un INSERT crudo) pasan por **un ayudante único** que llama a la función de producción; ningún test escribe `nombreClave` a mano. Un guardián falla si un test crea `categoriaProducto` por fuera del ayudante | H1 | **PROPUESTA** |
| P5 | **Único entre hermanos.** `(empresaId, padreId, nombreClave)` con `NULLS NOT DISTINCT` si la versión de Postgres de cada base lo permite (PG 15 o más: **NO VERIFICADO** en Neon). Si no: **dos índices parciales** (uno `WHERE padreId IS NOT NULL` por `(empresaId, padreId, nombreClave)` y otro `WHERE padreId IS NULL` por `(empresaId, nombreClave)`): **misma garantía**, sin depender de la versión. Se reemplaza `@@unique([empresaId, nombre])` y el índice `lower(nombre)`. Prisma no declara esto: va a mano en el SQL, como ya se hace | Prisma/versión | **PROPUESTA** |
| P6 | **Sin borrar (E1-D1):** la migración hace `REVOKE DELETE ON "CategoriaProducto" FROM motor2_app` (molde: `20261115120000_ocultamiento_de_producto/migration.sql`: `REVOKE ALL` + `GRANT` de lo que sí) y el `down.sql` lo devuelve. **Antes de afirmar que quedó cerrado:** ver cómo `scripts/operaciones/crear-rol-motor2-app.sql` (que da `DELETE ON ALL TABLES`) deja de volver a abrirlo si se ejecuta de nuevo; y verificar en una base viva los privilegios reales (**NO VERIFICADO**) | H3, E1-D1 | **PROPUESTA** |
| P7 | **Camino de limpieza local para tests** (la otra cara de E1-D1): un ayudante `limpiarCategoriasDeTest` en `test/setup/` que borra el árbol de una empresa **con la conexión del dueño de la base** (la que ya usa `limpiarBaseDeTest`, no `motor2_app`), **de las hojas hacia arriba** (la FK autorreferente es RESTRICT; con tope 4 son a lo sumo 4 pasadas) y que **se niega a correr** si la base no es local (host `localhost`/`127.0.0.1`/socket) o `NODE_ENV` no es de prueba. Los ~14 specs e2e y `limpiarBaseDeTest` pasan a usarlo. Un guardián falla si aparece `categoriaProducto.delete(Many)` fuera del ayudante, y una prueba verifica que `motor2_app` **no** tiene DELETE sobre la tabla | H3 | **PROPUESTA** |
| P8 | `CategoriaProducto` **entra** a `ENTIDADES_AUDITABLES` y a sus columnas auditadas (crear, renombrar, mover, desactivar, reactivar): lo propone el diseño del 2026-11-13 y no es dato nuevo; se declara ahora para que la auditoría nazca con el árbol | inventario §5, decisión 6 | **PROPUESTA** (técnica) |
| P9 | `COLUMNAS_DE_CATEGORIA` de `test/arquitectura/clasificacion-comercial-dimensiones.test.ts` se amplía con `padreId`, `nombreClave`, `version`, `creadoEn`, `actualizadoEn` y los campos de relación (`padre`, `hijos`), cada una con su motivo: es el guardián que falla (H4). `columnas-de-significado` **no** obliga en E1 | H4 | **PROPUESTA** |

### 2.2 Migración y marcha atrás

- **Aditiva y reversible**; requiere la autorización expresa del dueño (diseño del 2026-11-13 §11) y **no se aplica en ninguna base real** desde este frente.
- `up`: columnas con default → backfill de `nombreClave` (P3) → CHECKs → índice único nuevo (P5) → disparadores y candado → `REVOKE DELETE` (P6). El orden hace que **nada falle a mitad** (todo en una transacción).
- `down.sql`: quita disparadores, índice nuevo y columnas; **recrea** el único `(empresaId, nombre)` y el índice `lower(nombre)`; devuelve DELETE. **Aborta** (con mensaje claro) si hay nodos de nivel 2 o más con nombres repetidos entre hermanos distintos (no se puede volver a una lista plana sin perder información); la jerarquía creada después se pierde y **se avisa antes**.
- **Datos reales conocidos** (lectura previa del orquestador sobre una copia reciente de producción; yo no los leí): una empresa, dos categorías planas, **sin productos vinculados**, sin objetivos de food cost, sin recetas. **Recontar en cada base antes de migrar.**
- **Ensayo:** copia de la base en una rama descartable (nunca la principal): verificación previa → migrar → comparar conteos y los reportes con las sumas de control de antes → `down` → volver a subir.

## 3. Nivel 7 — Atomicidad y concurrencia

Las reglas comunes y las tablas «¿qué pasa si…?» de crear, renombrar, mover y desactivar/reactivar **siguen como están** en §10 del diseño del 2026-11-13 (candado `pg_advisory_xact_lock` por empresa antes de leer, READ COMMITTED a propósito, nodo y auditoría en una transacción, versión para mover y renombrar). Lo que agregan las decisiones de hoy:

| Comando / situación | Resultado | Estado |
|---|---|---|
| **Crear** con un nombre que ya existe **entre hermanos** (misma clave) | **Error «ya existe entre hermanos»**; no reusa, no escribe, no audita (E1-D3). Si el nombre existe bajo **otro** padre, se crea sin problema | **CONFIRMADA** |
| **Crear** el mismo comando dos veces (clic doble, reintento tras corte) | Una sola fila: la repetición del **mismo comando** devuelve lo ya creado (`yaExistia`), distinto del caso de arriba (otro comando, mismo nombre) que da error. El mecanismo exacto (id mandado por la app, como Pedernal, o la clave de idempotencia que ya usan las altas de Motor2) lo fija el implementador y lo declara en el PR | **PROPUESTA** (diferencia con Pedernal a declarar si hace falta) |
| **Crear** dos personas el mismo nombre a la vez | El candado serializa; la segunda recibe «ya existe entre hermanos»; el único de la base es la red de seguridad | **CONFIRMADA** (dueño + diseño) |
| **Renombrar** a un nombre que ya usa un hermano | Rechaza con el mismo error | **CONFIRMADA** (E1-D3, por coherencia) |
| **Desactivar** una categoría | Nunca se borra (E1-D1); con hijos activos rechaza; con productos **permite** y no los toca | **CONFIRMADA** (diseño del 2026-11-13, I15) |
| **Un intento de DELETE** desde la aplicación | Lo rechaza la base (sin privilegio); no hay camino de borrado en la aplicación | **PROPUESTA** (P6) |
| **Migrar con colisión de claves** («Café»/«Cafe») | La verificación previa **aborta** y no se cambia nada | **PROPUESTA** (P2) |
| **Migrar con la aplicación funcionando** | La migración corre en una transacción; el cambio de índice toma un candado corto sobre una tabla de decenas de filas. Se aplica en ventana de mantenimiento igual (`ALTER TABLE` bloquea escrituras mientras dura) | **PROPUESTA** |
| **Repetir la migración** (reintento del despliegue) | Falla ordenadamente si ya está aplicada (control de migraciones); nunca a medias | **CONFIRMADA** (infraestructura existente) |

**Dinero, fechas y stock:** E1 **no** toca ninguno (los productos siguen apuntando a su categoría por la misma FK; ningún cálculo de IVA ni de costo lee el árbol: invariante I16 del diseño del 2026-11-13). `creadoEn` y `actualizadoEn` son `timestamptz` en UTC; la zona de Argentina se aplica **al mostrar**, como en el resto del sistema.

## 4. Nivel 8 — Acceso e interfaces

- **Permisos:** sin claves nuevas. Administrar el árbol (crear, renombrar, mover, desactivar, reactivar) usa `categorias` (piso administrador), y el alta rápida `categoria_alta` mantiene su piso, como en §8 del diseño del 2026-11-13; se valida **siempre en el servidor**. Una operación con el permiso retirado a mitad **falla cerrada**.
- **Aislamiento:** RLS por empresa como hoy (`aislamiento_empresa`); toda lectura y escritura filtra por empresa en el servidor; un nodo ajeno da «no encontrado» sin revelar que existe.
- **Acciones (nuevas o adaptadas), cada una con su guard, permiso y ficha `@contract`:** crear nodo (adapta `crearCategoriaProducto`, que **deja de reusar**), renombrar, mover (con versión), desactivar y reactivar (adapta `actualizarActivaCategoriaProducto`). Los guardianes de acciones declaradas (`tramo-c-envoltorio-y-clave`, `acciones-migradas-con-guard`, `consumidores-de-lecturas-declarados`) y el catálogo de textos se actualizan en el mismo PR.
- **El caso de uso de alta** deja de buscar «el mismo nombre en toda la empresa» (`crear-categoria-producto.ts:28-32`) y pasa a buscar **por (padre, clave)**; el mensaje «Ya existía la categoría "X" — se reusa.» **desaparece**. La caracterización congelada `test/catalogo/caracterizacion/catalogo-sin-test-unitario.test.ts:52` se **redeclara** con el guardián `caracterizaciones-congeladas` (blob + commit padre + motivo: «decisión del dueño 2026-11-17: ya existe entre hermanos, sin reuso»).
- **Seeds y scripts** (`scripts/seed-demo-pizzeria.ts`, `seed-demo-pizzeria-6-meses.ts`) dependían de «reusar por nombre»: pasan a **buscar primero por clave y crear solo si falta**, con el ayudante; no cambia lo que siembran.
- **Texto del error (verificado contra Pedernal el 2026-11-17, `ZuluHub-ERP` `origin/main` `0fd7b50`):** Pedernal **no tiene todavía un texto en español** para este caso: su caso de uso devuelve el **código** `NODO_DUPLICADO` (`src/modulos/catalogo/casos-de-uso/errores.ts:30`; lo produce el único `nodo_de_clasificacion_nombre_uk`, `src/modulos/catalogo/persistencia/esquema-de-clasificacion.ts:69`; probado en `test/integracion/clasificacion-casos-de-uso.test.ts:796-810`: «dos altas con el mismo nombre entre hermanos: una gana y la otra recibe NODO_DUPLICADO»). Lo mismo para renombrar. Por eso **la paridad es el código y el comportamiento** (mismo motivo de rechazo, mismo momento), y el texto lo define Motor2. **Texto CONFIRMADO por el dueño** (2026-11-17, chat con el orquestador, registrado en `motor2-docs` d335641): «ya existe una categoria con ese nombre en este mismo lugar» → el error dice exactamente **«Ya existe una categoría con ese nombre en este mismo lugar»**. **PROPUESTA (no confirmada, no se pone como definitiva):** el agregado «Elegí otro nombre o usá la que ya existe.» y la variante para un departamento («Ya existe un departamento con ese nombre. Elegí otro nombre o usá el que ya existe.»). El motivo interno del esquema (`NOMBRE_REPETIDO_ENTRE_HERMANOS` del inventario) se mapea a ese texto; el código de Motor2 se declara como equivalente de `NODO_DUPLICADO`.
- **Idempotencia de la alta (verificado en Pedernal):** crear **con el mismo id** devuelve lo existente (con otro contenido, el código `ID_REUTILIZADO`); es decir, el id lo manda la app. Es lo que §3 deja como decisión del implementador; la forma «como Pedernal» es el id mandado por la app.

## 5. Nivel 9 — Consultas y experiencia

- **Reportes por categoría (E1-D2, H5):** agrupan por **`categoriaId`** y rotulan con el **camino completo** («Bebidas > Gaseosas»). Sitios: `src/core/reportes/periodo-categorias.ts:27-43`, `src/server/consultas/reportes/periodo.ts:267`, `src/server/consultas/carta/ventas-por-seccion.ts:150` y `src/core/carta/reporte-secciones.ts` (verificar en la implementación cuáles agrupan de verdad por categoría y cuáles por sección de carta: **NO VERIFICADO** el segundo). La clave de React y el nombre del archivo exportado pasan a salir del **id** y del camino (sin colisiones con homónimos). Las categorías **desactivadas siguen contando** en los reportes de lo ya vendido (I15). Un producto sin categoría se muestra como hoy.
- **Regresión obligatoria:** con categorías **planas** (el estado de hoy) el camino es el propio nombre, así que los goldens `lecturas-tramo-a`, `reportes-c0` y `dinero-tramo-c` y el escenario de `escenario-reportes.ts` dan **idéntico** antes y después de E1.
- **Selectores y pantallas:** el selector plano del formulario de producto (`producto-form.tsx`, `opciones-formulario.ts`, `datos-de-edicion.ts`, `nuevo/page.tsx`) y la lista de `catalogo/categorias/page.tsx` pasan a mostrar el **camino** y a ofrecer solo nodos activos (I15); el alta rápida del formulario elige padre. Margen objetivo (`margen-objetivo/page.tsx`, `core/reportes/margen-objetivo.ts`) muestra el camino y **sigue por id exacto** («el departamento no hereda nada»): heredar a los hijos sería una función nueva y **no entra** (nadie lo pidió).
- **Mobile primero (375 px):** capturas de la pantalla real con datos reales de ejemplo (regla de maquetas); diseño de pantallas en §9 del diseño del 2026-11-13.
- **Carta pública:** no cambia (lee solo `nombre` del nodo, lista cerrada `carta-publica-lista-cerrada`); un guardián impide que lea el árbol.

## 6. Nivel 10 — Pruebas, migración y operación

**Dimensiones declaradas** (cuyas combinaciones cambian permisos, visibilidad o datos): las del diseño del 2026-11-13 §11 (D1 nivel 1 a 4, D2 acción, D3 estado activo/inactivo, D4 hijos activos, D5 productos, D6 destino del movimiento, D7 actor/piso, D8 empresa) **más**: D9 **relación del nombre con sus hermanos** (libre / repetido entre hermanos / repetido bajo otro padre / repetido solo en tildes o mayúsculas) y D10 **agrupación del reporte** (por id con camino / nombres homónimos bajo distintos padres). **Guardián:** falla si aparece una columna nueva en `CategoriaProducto` sin declarar (`COLUMNAS_DE_CATEGORIA`) o un lector nuevo del árbol sin clasificar.

**Oráculo (tabla escrita aparte del código), filas nuevas de hoy:**

| Acción | Condición | Resultado |
|---|---|---|
| Crear | mismo nombre (incl. «Café» vs «cafe») que un hermano | RECHAZA «ya existe entre hermanos» |
| Crear | mismo nombre bajo otro padre | PERMITE |
| Renombrar | a la clave de un hermano | RECHAZA |
| Borrar | desde `motor2_app` | SIN PRIVILEGIO (la base lo niega) |
| Reporte | «Gaseosas» bajo «Bebidas» y «Gaseosas» bajo «Almacén» | DOS filas: «Bebidas > Gaseosas» y «Almacén > Gaseosas» |
| Reporte | categorías planas de hoy | IDÉNTICO a antes (golden) |
| Migrar | «Café» y «Cafe» en la misma empresa | ABORTA con la lista; no cambia nada |

**Pruebas obligatorias (contra Postgres real):**
- **Migración subir / bajar / subir** sobre una copia con datos (E1 necesita **su** prueba: hoy ninguna cubre `CategoriaProducto`; la lista de migraciones del test de M1 y las huellas se regeneran declarándolo): filas iguales, reportes iguales, `down` que aborta ante duplicados entre hermanos, `verificacion-previa.sql` que aborta con la colisión sembrada.
- **Paridad SQL↔TS** de la clave (P3), con propiedades.
- **Concurrencia (dos a la vez):** dos «crear» del mismo nombre entre hermanos (una gana, la otra error); «mover A bajo B» contra «mover B bajo A» (ningún ciclo); «desactivar padre» contra «crear hijo»; renombre contra creación del mismo nombre.
- **Idempotencia:** el mismo comando repetido 2 y 10 veces (una sola fila, una sola auditoría); reintento tras corte.
- **Aislamiento:** una empresa no ve ni mueve nodos de otra (RLS y filtro del servidor); la matriz de denegación (`test/aislamiento/denegacion/*`) con las acciones nuevas inventariadas.
- **Atomicidad:** corte a mitad de mover un subárbol: nada a medias.
- **Guardianes:** sin `categoriaProducto.delete(Many)` fuera del ayudante local; sin DELETE para `motor2_app`; el ayudante se niega en una base no local; ningún test crea categorías por fuera del ayudante de fixtures; IVA y costo no leen el árbol; vínculo de solo inserción (E2).
- **E2E (Playwright, 375 px):** crear departamento y categoría, mover, desactivar con hijos (rechazo), error «ya existe entre hermanos», producto con camino en el selector.
- **Compuerta:** el **CI de GitHub** (tipos, lint, arquitectura, knip, pruebas, build, plataforma:build y e2e, todo limpio en la misma corrida); local, solo pruebas acotadas.

**Pasos chicos propuestos (cada uno un PR, uno a la vez):**
1. **E1-0 (sin schema):** ayudante de fixtures + función única de clave ya existente + ayudante de limpieza local + guardianes de «sin DELETE directo» y «sin crear por fuera del ayudante». Se puede hacer **antes** del turno de schema y no cambia ningún comportamiento.
2. **E1-1 (schema, con turno):** la migración de §2 con su `down.sql`, `verificacion-previa.sql`, ensayo y guardianes de columnas.
3. **E1-2:** casos de uso del árbol (crear sin reuso, renombrar, mover, desactivar, reactivar) con auditoría.
4. **E1-3:** reportes por id con camino, selectores y pantallas (con capturas reales).

**Marcha atrás:** E1-0 no necesita; E1-1 con `down.sql` (aborta si perdería información); E1-2 y E1-3 se revierten con el PR. No hay datos de producción que perder hoy (dos categorías planas sin productos), **pero se recuenta antes de cada base**.

**Orden con otras etapas:** E2 (vínculo producto→nodo) y E3 (camino copiado a la venta) **no entran** acá. Coordinar con el frente 6 antes de tocar `catalogo/productos/[id]/**` (ficha de producto).

## 7. Preguntas abiertas, decisiones propuestas y supuestos

- **Preguntas abiertas para el dueño:** ninguna nueva.
- **Pendientes de verificar o de OK antes de construir:** el agregado y la variante de departamento del texto del error (el texto base ya está CONFIRMADO; Pedernal solo tiene el código `NODO_DUPLICADO`); la versión de Postgres de cada base (`NULLS NOT DISTINCT` o índices parciales); los privilegios reales de `motor2_app` sobre la tabla y el comportamiento del script del rol (P6); qué reportes agrupan por categoría y cuáles por sección de carta.
- **Supuestos declarados (el dueño los corrige si no son así):** el mapeo de las respuestas del dueño a las preguntas lo hizo el orquestador general; las dos categorías planas de hoy pasan a departamentos (decisión P6 del diseño del 2026-11-13, CONFIRMADA por el dueño).
- **Sugerencias (no implementadas):** que un departamento herede el objetivo de food cost a sus hijos; que se pueda reubicar un nodo entre departamentos con sus productos. Nadie lo pidió.

## 8. Resumen para quien no programa

- Las categorías pasan a ser un árbol («Bebidas > Gaseosas»); las dos que hay hoy quedan como primer nivel y no pasa nada con los productos.
- **No se van a poder borrar categorías** (solo desactivar); para limpiar las pruebas hay un camino aparte que solo funciona en la computadora de desarrollo.
- Si dos categorías de la **misma** rama se llaman igual, el sistema avisa «ya existe entre hermanos» en vez de reusar la anterior sin avisar; en ramas distintas pueden llamarse igual.
- Los reportes por categoría muestran el camino completo, así «Gaseosas» de Bebidas y «Gaseosas» de Almacén no se mezclan.
- Antes de migrar cualquier base se revisa si hay nombres que chocarían (por ejemplo «Café» y «Cafe»); si los hay, la migración se detiene sin cambiar nada y se decide qué hacer.
