# Diseño: clasificación comercial (departamento → categoría) igual a Pedernal (2026-11-13)

> Diseño en papel (fases 1 de 2). **No se escribió código, ni migraciones, ni se tocó ninguna base.** Congelamiento de producción vigente.
>
> **Marcas.** **VERIFICADO** (archivo:línea): lo leí en el código real de Motor2 o en los documentos de `zuluhub-docs` (clonado al 2026-11-13, commit `7aa1a89`). **CONFIRMADA**: lo dijo el dueño, con cita. **PROPUESTA**: la propongo yo. **PENDIENTE**: espera al dueño. **NO VERIFICADO**: no pude comprobarlo.
>
> **Cómo se verificó Pedernal.** El agregado de `ZuluHub-ERP` a mi sesión fue denegado, así que **no leí su código yo**. El orquestador sí lo leyó (`ZuluHub-ERP` main `59e47a40`, 2026-11-13 10:15 -0300: migraciones 0045 y 0046, `arbol.ts`, `nombre-de-nodo.ts`, casos de uso) y dejó un resumen en `motor2-docs`, rama `alegp/stoic-davinci-185dm4`, `seguimiento-de-pedernal/referencia-clasificacion-comercial-0045-0046.md` (commit `d7fff0d`), que **leí**. Lo que apoyo en ese resumen va marcado **VERIFICADO (referencia del orquestador)**: es verificación de segunda mano, con fuente. **Sigue NO VERIFICADO** (el orquestador tampoco lo leyó): pantalla, textos exactos, consultas, repositorio, pruebas de Pedernal y si la 0047 está en alguna rama. Producción de Motor2: los conteos de filas son **NO VERIFICADO**. Hay que repetir el `git fetch` de `ZuluHub-ERP` y `ZuluHub-docs` antes de entregar (Pedernal cambia todo el día).

---

## 0. Resumen para el dueño (una página)

**Lo que pidió (13/11/2026).** Que Motor2 tenga la misma clasificación comercial que está haciendo Pedernal: **departamento → categoría** (hasta 4 niveles), con las mismas reglas.

**Hallazgos que cambian cómo se hace:**

1. **Motor2 no tiene «departamento» en ningún lado** (cero apariciones en `src/` y en `prisma/schema.prisma`). Tiene una **categoría plana** (`CategoriaProducto`, `prisma/schema.prisma:557`) y un árbol de **Grupos de insumos** (`schema.prisma:537`) que es otra cosa (agrupa insumos, no productos de venta).
2. **La categoría plana ya se usa en 4 lugares**: el food cost objetivo (`MargenObjetivo`, `schema.prisma:576`), el reporte «Por categoría», la ficha del producto y el atajo «tildar todos los de la categoría» de la carta. Hay que conservarlos.
3. **El descuento de clientes NO usa la categoría de producto** (`schema.prisma:749-752`: «`descuentoPorcentaje` por cliente, no varía por categoría de producto»). La premisa del pedido a la sesión («descuento de clientes por categoría») **no se cumple en Motor2**: no hay nada que romper ahí.
4. **Ya existía un diseño propio de Motor2 para esto** (`docs/diseno-categoria-unidad-y-rubro-2026-11-06.md`, dos niveles «unidad → rubro», solo en papel, nunca implementado). Este documento **lo reemplaza si el dueño confirma** (pregunta P1), porque Pedernal es más general (hasta 4 niveles) y decide distinto una cosa de fondo: **Pedernal copiará el camino a cada venta (0047, aún no construida)** (lo vendido no cambia si se mueve un nodo) y el diseño del 06/11 recomendaba **leer siempre el vigente**.

**Lo más barato (propuesta).** **Ampliar la tabla que ya existe** (`CategoriaProducto`) con `padreId`, `nombreClave` y `version` (la forma de Pedernal: padre único, nombre único entre hermanos, versión), en vez de crear una tabla nueva y dejar dos «categorías» conviviendo. Las categorías de hoy (en la base conocida, dos categorías planas sin productos) **pasan a ser departamentos de primer nivel** (confirmado por el dueño, P6) **sin escribir ningún dato** y conservando `id`, nombre y objetivo; `Producto.categoriaId` y `MargenObjetivo.categoriaId` siguen funcionando. **Migración aditiva y reversible**, que **requiere su autorización expresa** y un ensayo en copia.

**Etapas propuestas:** E1 el árbol (Pedernal 0045); E2 el vínculo producto→nodo de solo inserción (0046); E3 la copia del camino a la venta (Pedernal **0047, que ya existe desde el 14/11**). Una cuarta pieza de Pedernal, **0048** (departamento en la cuenta de venta), queda como **pregunta** (§7.5). Preguntas: §13. Tabla «campo/regla de Pedernal → equivalente en Motor2»: §2.1. **Ninguna migración queda autorizada.**


---

## 1. Nivel 1. Propósito, necesidad y alcance

| # | Necesidad | Quién la pidió y dónde está escrita | Estado |
|---|---|---|---|
| N-1 | Motor2 debe tener departamento y categoría con las mismas primitivas e invariantes que Pedernal | Dueño, 2026-11-13, chat con el orquestador: «Pedernal está haciendo cambios. Está agregando pantallas. Mientras nosotros estamos tratando de adaptarnos a lo que él está haciendo. Por ejemplo, él agregó departamento, la primitiva de departamento, la primitiva de categoría. Así que quiero que tengamos eso también.» | CONFIRMADA (cita transmitida por el orquestador; fuente: chat, no localizable por mí) |
| N-2 | Reglas de Pedernal que se quieren «igual»: departamento = unidad de negocio, categoría = nodo debajo, árbol sin ciclos, un padre, una empresa, no se borra (se desactiva), mover no cambia lo vendido | `zuluhub-docs/11-especificaciones/conceptos/clasificacion-comercial-y-seccion-de-la-carta.md` §2 y `decisiones-del-dueno-2026-11.md` filas del 12/11 y 13/11 (decisiones del dueño **sobre Pedernal**, no sobre Motor2) | CONFIRMADA para Pedernal; **PENDIENTE** que el dueño confirme que se aplican tal cual a Motor2 (P1) |
| N-3 | Nombres fijos: «Departamento» (nivel 1) y «Categoría» (niveles 2 a 4), no configurables | `decisiones-del-dueno-2026-11.md`, fila 13/11/2026 («todo lo que está debajo del departamento se llama Categoría») | CONFIRMADA para Pedernal; PENDIENTE para Motor2 |
| N-4 | El cambio de clasificación de un producto rige solo desde ahora (sin fecha futura) | `decisiones-del-dueno-2026-11.md`, fila 13/11/2026 | CONFIRMADA para Pedernal; PENDIENTE para Motor2 |

**Alcance.** Entra: el árbol de clasificación, su pantalla de administración, el selector en la ficha del producto, el historial de la clasificación del producto y (etapa 3) la copia del camino a la venta. **No entra** (todo esto está en Pedernal como «segunda tanda» o «después» y nadie lo pidió para Motor2): responsable del departamento, filtro de la lista de productos por clasificación, reportes por departamento nuevos, selector de contexto del menú, imputación económica repartida, creación automática de un departamento por defecto.

**Poda.** El diseño del 06/11 (dos niveles «unidad/rubro») queda **reemplazado** por este si se confirma P1; no se construyen los dos.

---

## 2. Estado real de Pedernal (lo que hay que igualar)

**Documentos (VERIFICADO, `zuluhub-docs` al 2026-11-13):**
- Ficha de concepto `conceptos/clasificacion-comercial-y-seccion-de-la-carta.md`: departamento = unidad de negocio, común a la empresa, cruzado con la sucursal; categoría = nodo debajo; padre único y una sola empresa; sin ciclos; no se borra; mover no cambia lo vendido (el camino completo se copia a la venta); no hereda la alícuota (decisión 33); primitivas previstas: **crear nodo, mover nodo (con versión), desactivar nodo** (`catalogo-y-niveles-maqueta.md`, «Nodo de clasificación»).
- Decisiones del dueño: 12/11 plan «aprobado tal cual» (2 niveles por defecto, tope 4 fijado por la plataforma y nunca reducible, «Sin elegir», historial en la auditoría, protección contra ciclos y movimientos simultáneos, copia a la venta en la primera entrega, permiso de las secciones = gerente y administrador); 12/11 maqueta aprobada (árbol, crear, renombrar, mover sin arrastrar, desactivar y reactivar; selector de un desplegable por nivel encadenados; filtro por clasificación en una segunda tanda); 13/11 nombres fijos, sin departamento por defecto, cambio de producto «solo desde ahora».
- Maqueta `clasificacion.html`: 19 estados (capturados, §12).

**Código de Pedernal (VERIFICADO, referencia del orquestador sobre `59e47a40`):**
- `0045`: tabla `nodo_de_clasificacion` (ver §7.1 para columnas, únicos, disparadores y seguridad), con tope 4 en una función fijada por la plataforma, candado advisory por empresa, sin borrado ni TRUNCATE; reversión aparte, destructiva si hay nodos.
- `0046`: tabla `clasificacion_de_producto`, de solo inserción, `nodo_id` nulo = «Sin elegir», rige desde ahora (ver §7.2).
- `arbol.ts` (reglas puras sobre una foto del árbol, `MAXIMO_DE_NIVELES_DE_CLASIFICACION = 4`, motivos de rechazo cerrados, todo nace cerrado) y `nombre-de-nodo.ts` (mismo nombre que una sección de carta: 1 a 80, lista de permitidos, único entre hermanos por `claveDeNombre`).
- Casos de uso: **crear nodo** (`id` de la app → `{ nodoId, yaExistia }`), **renombrar** (→ `{ version }`, la versión viene de la pantalla), **mover** (→ `{ version, yaEstaba }`), **desactivar** y **reactivar** (→ `{ yaEstaba }`). Paso común: permiso `productos.editar` con alcance de toda la empresa y **candado del árbol antes de leer**; **READ COMMITTED a propósito** (serializadas por el candado, cada lectura posterior ve lo último confirmado). Cada escritura deja auditoría con acciones `CLASIFICACION_NODO_CREADO`, `_RENOMBRADO`, `_MOVIDO` y las de desactivar/reactivar. **Los permisos no tienen clave propia.**
- **`0047_camino_en_el_renglon` EXISTE desde el 2026-11-14** (VERIFICADO por el orquestador, `ZuluHub-ERP` rama principal `2e71fd35`, 2026-11-14: cabeceras de las migraciones y mensajes de commit de los PR #291 y #297; **NO leídos por el orquestador ni por mí:** los diffs completos, consultas, pantallas y pruebas; informe: `motor2-docs/seguimiento-de-pedernal/2026-11-14-1100-cambios-de-pedernal-desde-el-13-11.md`): el renglón de venta (`linea_cuenta`) **congela el camino de clasificación (departamento y categoría, con id y nombre) al vender**; **dos columnas nullable**, solo se escriben al insertar; migración **aditiva** con **reversión destructiva si hay renglones con camino**; cambiar la clasificación de un producto o mover un nodo **no cambia lo vendido**. Además #291: el renglón de venta **toma lo vigente** (el último cambio guardado de la clasificación del producto). **0048 (`departamento_en_la_cuenta`)**: ver §7.5. El orden es alfabético (sin columna de orden). Pedernal no tenía categoría plana previa.

**Sigue sin verificar:** pantalla, textos exactos, consultas, repositorio, pruebas.

---

## 2.1 Criterio del dueño y tabla de equivalencias «Pedernal → Motor2»

**Regla permanente del dueño (2026-11-13, chat con el orquestador, literal):** «primero tenemos que ser iguales a Pedernal… quiero que estés suscritos, vean los cambios. Necesitamos ser iguales en todo. Por la salvedad de que nosotros usamos Prisma… no es que hay que copiar código, pero sí tiene que ser idéntico… El resultado tiene que ser el mismo y sobre todo de las mismas formas, salvo porque nosotros usamos Prisma. Ahí ya nuestro código o la escritura cambia.»

**Consecuencia para este diseño:** el criterio es **mismo resultado y misma forma** (tabla, campos, invariantes, reglas, pantallas, textos, permisos). Toda diferencia lleva su motivo y su marca: **igual** / **distinto por Prisma** / **distinto por datos existentes** (la categoría plana ya está en producción). Una diferencia sin ninguno de esos motivos **no entra**: en esta revisión se corrigieron mis apartamientos sin motivo (columnas `nivel`/`nivelDelPadre`, vínculo con `hasta`, nombre único de toda la empresa, copia a la venta adelantada).

**Lado Pedernal: VERIFICADO por el orquestador sobre `59e47a40` (referencia citada arriba); no por mí.** Antes de entregar hay que repetir el fetch y hacer `git fetch` de `ZuluHub-ERP` y `ZuluHub-docs` (Pedernal cambia todo el día; hay un vigía cada 4 h con informes en `motor2-docs/seguimiento-de-pedernal/`). Esta sesión clonó `zuluhub-docs` al 2026-11-13 (`7aa1a89`) y `motor2-docs` en la misma fecha; `motor2-docs/seguimiento-de-pedernal/` **no existe en mi clon** (hecho a las 14:3x UTC de hoy): revisarlo, con un fetch nuevo, es el primer paso de la fase 2.

| # | Campo / regla de Pedernal (VERIFICADO salvo nota) | Equivalente en Motor2 | Marca |
|---|---|---|---|
| 1 | Tabla `nodo_de_clasificacion` (nueva) | Ampliar `CategoriaProducto` (§7.1) | **Distinto por datos existentes**: ya tiene datos y consumidores. Alternativa idéntica: tabla nueva y migrar ids (**P7**) |
| 2 | Columnas `id`, `empresa_id`, `padre_id`, `nombre` (1–80), `nombre_clave` (1–240), `activo`, `creado_en`, `actualizado_en`, `version` | `id`, `empresaId`, `padreId`, `nombre`, `nombreClave`, `activo`, `creadoEn`, `actualizadoEn`, `version` | Igual (nombres en el estilo de Motor2) |
| 3 | `id` lo manda la app = idempotencia del alta | El caso de uso pasa el id del comando en lugar de `@default(cuid())` | **Distinto por Prisma** (la forma) |
| 4 | Un padre y una empresa por nodo: FK compuesta `(padre_id, empresa_id)`, CHECK `padre_id <> id` | FK compuesta `(empresaId, padreId)`, mismo CHECK | Igual |
| 5 | Nombre único entre hermanos **incluidos los departamentos**: `UNIQUE NULLS NOT DISTINCT (empresa, padre, nombre_clave)` | Mismo índice, escrito a mano en el SQL; reemplaza el único de toda la empresa | **Igual**; no rompe datos existentes (ya eran únicos en toda la empresa); PG ≥ 15 en Neon: NO VERIFICADO |
| 6 | Sin ciclos, tope 4 (función de la base fijada una vez por la plataforma, nunca reducible; prueba que la compara con la constante) | Función + constante + prueba equivalentes | Igual |
| 7 | Departamento no se mueve ni nodo pasa a primer nivel; no se reactiva con padre desactivado; no se desactiva con hijos activos; no se pone bajo desactivado | Disparadores a mano + primitiva pura con los mismos motivos cerrados | Igual (los disparadores en Prisma: SQL a mano en `migration.sql`, ya hay 11 migraciones así) |
| 8 | Candado `pg_advisory_xact_lock(hashtextextended('clasificacion:'‖empresa_id,0))` antes de leer; READ COMMITTED | Igual (molde de `pg_advisory_xact_lock` ya usado en Motor2) | Igual |
| 9 | `version` por disparador en cada UPDATE; la pantalla manda la versión al renombrar/mover | Igual | Igual |
| 10 | Sin DELETE ni TRUNCATE (disparador, aun para el dueño) | Igual + sin esos privilegios para `motor2_app` | Igual (grants actuales: NO VERIFICADO) |
| 11 | RLS forzada, política por comando, INSERT/UPDATE por columna, `empresa_operable()` | `app_empresa_actual()` + RLS del esquema; privilegios del rol | **Distinto por Prisma/Motor2** (la forma; mismo resultado) |
| 12 | Tabla `clasificacion_de_producto` (0046): solo inserción, `vigente_desde` = instante del guardado, `UNIQUE (empresa, producto, vigente_desde)`, vigente = última fila, `nodo_id` nulo = «Sin elegir», disparador `solo_insercion` | Tabla `ProductoClasificacion` igual (§7.2) | Igual |
| 13 | No hay otra columna de clasificación en el producto | `Producto.categoriaId` queda como copia de la vigente | **Distinto por datos existentes** |
| 14 | El nodo debe estar activo al asignar; desactivarlo después no altera el historial | Igual | Igual |
| 15 | Permisos: **sin clave propia**, reutiliza `productos.editar` (gerente y administrador, toda la empresa) | Sin clave propia: árbol = `categorias`, selector = `producto_editar`/`alta_producto` (pisos actuales) | **Distinto por permisos existentes**: igualar pisos es subirlos; no sin orden del dueño (**P6**) |
| 16 | Auditoría con acciones `CLASIFICACION_NODO_CREADO/RENOMBRADO/MOVIDO/DESACTIVADO/REACTIVADO` | `RegistroAuditoria` (una fila por campo, `entidad`, `campo`, antes/después): una fila por campo cambiado, con la acción en `descripcion` | **Distinto por datos existentes** (formato de la tabla ya construida); mismo contenido |
| 17 | Motivos de rechazo cerrados (`CICLO`, `TOPE_DE_NIVELES`, `DEPARTAMENTO_NO_SE_MUEVE`, `TIENE_HIJOS_ACTIVOS`, `PADRE_DESACTIVADO`, …) | El mismo tipo cerrado | Igual |
| 18 | Salidas `{ nodoId, yaExistia }`, `{ version }`, `{ version, yaEstaba }`, `{ yaEstaba }` | Iguales | Igual |
| 19 | Copia del camino a la venta (0047, **existe** desde el 14/11): dos columnas nullable en el renglón de venta, solo INSERT, ids y nombres | E3 (§7.3): dos columnas nullable en `CuentaItem`, solo al insertar, aditiva, **requiere autorización expresa**; la **forma exacta de las dos columnas NO VERIFICADA** | Igual en resultado; **distinto por Prisma** (la escritura) y por el nombre de la tabla (`CuentaItem`) |
| 20 | Orden alfabético, sin columna de orden | Igual | Igual |
| 21 | No hereda la alícuota (decisión 33) | Igual (en Motor2 la alícuota está en el producto) | Igual |
| 22 | Reversiones en `migraciones/reversiones/` | `down.sql` junto a cada migración | **Distinto por Prisma** |
| 23 | Primitivas `arbol.ts`, `nombre-de-nodo.ts`; casos de uso `clasificacion.ts` | Puro en `src/core/`, casos de uso en `src/server/actions/.../casos-de-uso/`, guards en `src/core/features/` | **Distinto por Prisma/estructura de Motor2** (no se copian rutas) |
| 24 | Nombres «Departamento» (1) y «Categoría» (2 a 4), fijos; «Clasificación comercial», «Crear», «Renombrar», «Mover», «Cambiar», «Primero desactivá lo que tiene adentro.» | Los mismos | Igual (de la maqueta aprobada; **textos exactos de la pantalla real de Pedernal: NO VERIFICADO**) |
| 25 | Selector de la ficha encadenado, «Vigente desde» solo lectura, «Cambiar» sin fecha; árbol, mover sin arrastrar | Igual | Igual (maqueta; pantalla real: NO VERIFICADO) |
| 26 | Sin departamento por defecto al crear la empresa | Igual; las categorías planas existentes ya son departamentos (`padreId` NULL) | **Distinto por datos existentes** (filas previas) |
| 27 | Barra con el nombre de la sucursal en la maqueta | La clasificación es de la empresa (panel de empresa, ADR-010) | Distinto por lo que Motor2 ya tiene |


## 3. Inventario de lo que Motor2 ya tiene con otro nombre (VERIFICADO contra el código)

| Qué | Dónde | Hoy | Decisión de este diseño |
|---|---|---|---|
| `CategoriaProducto` | `prisma/schema.prisma:557-569`: `id`, `empresaId` (default `app_empresa_actual()`), `nombre`, `activo`; únicos `(empresaId, nombre)` y `(empresaId, id)`; comentario «Sin jerarquía» | Categoría **plana** de la empresa. Índice único sin mayúsculas sobre `lower(nombre)` (`20260929100000_multiempresa_estructura/migration.sql:287`, según el diseño del 06/11) | **Se amplía** (§7): pasa a ser el nodo. Sus filas actuales quedan como nivel 1 |
| `Producto.categoriaId` | `schema.prisma:368-369` (FK compuesta `(empresaId, categoriaId)`), índice `:461` | Una categoría opcional, **mutable, sin historial** | Se conserva como «clasificación vigente» (etapa 1); etapa 2 le suma el historial |
| `MargenObjetivo` | `schema.prisma:576-584`; `src/core/reportes/margen-objetivo.ts`; `src/core/reportes/costos.ts:198` (`resolverObjetivoFoodCost(objetivos, info.categoriaId)`); `src/server/actions/reportes/casos-de-uso/guardar-margen-objetivo.ts`; permiso `margen_objetivo_editar` | **Food cost objetivo (INV-46)** por categoría o de toda la empresa; la categoría gana sobre la empresa | **No se toca.** Sigue apuntando al mismo `id`. **El objetivo por categoría sigue como hoy; el departamento no hereda nada (P5, CONFIRMADA); la paridad de food cost con Pedernal se trata aparte:** `docs/anexo-paridad-food-cost-pedernal-motor2-2026-11-13.md` |
| Descuento de clientes | `schema.prisma:749-762` («no varía por categoría de producto») | **No usa categoría** | Sin impacto. Se corrige la premisa del pedido |
| Reporte «Por categoría» | `src/core/reportes/periodo-categorias.ts`, `src/app/(app)/reportes/categorias/`, permiso `reporte_categorias`; mapa `src/core/reportes/comun.ts:26-28,56-58,105-106` | Agrupa por el nombre **vigente** de la categoría del producto | Sigue igual en la etapa 1. Con el árbol, agrupar por departamento es consulta nueva: **fuera de alcance** hasta que el dueño lo pida |
| Carta | `src/core/carta/armar-menu.ts:35-37,157-158,396` (campo informativo `categoria`); `src/core/carta/admin-tipos.ts:298-299` y `src/app/(app)/carta/agregar-entrada-de-lugar.tsx:109-110` (atajo «tildar todos los de la categoría») | Informativo + atajo | Siguen leyendo `Producto.categoriaId`: en etapa 1 ven la categoría directa del producto (si es un departamento, el nombre del departamento). Cuidado: el guardián `carta-publica-lista-cerrada` no debe leer el árbol |
| Duplicar producto | `src/core/catalogo/duplicar-producto.ts`, `src/server/persistencia/catalogo/duplicar-producto.ts` | Copia `categoriaId` | Etapa 2: el duplicado hereda la clasificación vigente (ídem) y escribe su propia fila de historial |
| Pantalla Catálogo › Maestros › Categorías | `src/app/(app)/catalogo/categorias/page.tsx` (lista plana, alta y activar/desactivar); acciones `src/server/actions/catalogo/categorias-producto.ts`; casos de uso `crear-categoria-producto.ts`, `actualizar-activa-categoria-producto.ts`; persistencia `src/server/persistencia/catalogo/categorias-producto.ts`; guard `src/core/features/catalogo/categorias-producto.guard.ts` | Alta con dedup sin mayúsculas **que reusa la existente** (`crearCategoriaProducto`); activar/desactivar sin reglas; sin renombrar; sin auditar («una categoría no es plata») | Se reemplaza por la pantalla de árbol (§9) |
| Permisos | `src/core/permisos/acciones.ts:63` `categorias` (empresa, piso administrador, semilla admin); `:234` `categoria_alta` (empresa, **piso operario**, semilla admin y operador); `producto_editar`/`alta_producto` (operario) | Ver §8 | **Sin claves nuevas** en la propuesta; los pisos **no se cambian por configuración** (ADR-008, ADR-027) |
| Árbol de Grupos de insumos | `schema.prisma:537-552` + `src/core/catalogo/cadena-de-grupos.ts` | Árbol sin tope, ciclos controlados en la aplicación | **No se usa** (agrupa insumos). Es antecedente de que ya hay un árbol en la casa |
| Secciones de la carta | `carta_secciones` (empresa, administrador), `SeccionCarta` | Presentación al cliente | No se toca; es la «sección» de Pedernal, otro concepto |
| Auditoría | `RegistroAuditoria` (`schema.prisma:297-325`): una fila por campo, `valorAnterior`/`valorNuevo`, `actorId`, sin FK a la entidad | Ya sirve para «antes y después» | Se reutiliza (§6) |
| Candados | `pg_advisory_xact_lock` ya usado en `src/server/persistencia/compras/comprobante-en-la-empresa.ts:25` y `src/server/persistencia/carta/contenido-producto.ts:76` | Molde existente | Se reutiliza para serializar movimientos por empresa |
| Control optimista | `GrupoDeOpciones.version` (`schema.prisma:3569`, CHECK ≥ 1) | Molde existente | Se reutiliza para «mover con versión» |
| Datos reales | Copia de producción (detalle en el repositorio privado de documentos) | — | **NO VERIFICADO**: no tengo herramienta ni credencial de la base en esta sesión. El diseño del 06/11 afirma (sin verificar) que en producción hay categorías planas sin productos asignados. Cuántas filas de `CategoriaProducto` y cuántos productos con categoría hay: hay que contarlo antes de migrar |
| Importaciones | Búsqueda en `scripts/` y `src/`: no hay importador de categorías (solo los seeds `scripts/seed-demo-*.ts`) | — | Sin impacto, salvo actualizar los seeds si se agregan columnas obligatorias (no se agregan) |
| Venta | `CuentaItem` (`schema.prisma:2388`): congela precio y nombre del ticket, **no** la categoría; `Operacion`/`MovimientoStock` tampoco | Los reportes leen la categoría **vigente** | Etapa 3 (§7.3) |

---

## 4. Niveles 2 y 3. Actores y casos de uso

**Actores (PROPUESTA; permisos en §8):** administración (arma y ordena el árbol); gerencia; quien edita productos (elige la clasificación en la ficha); quien solo mira (lee).

| Caso de uso | Qué pasa | Estado |
|---|---|---|
| CU1 Crear nodo | Se elige el padre (o ninguno = departamento) y un nombre; el nivel sale del padre | PROPUESTA (Pedernal: documentos) |
| CU2 Renombrar nodo | Cambia el nombre; no cambia ventas pasadas porque lo vendido guarda el camino (etapa 3) | PROPUESTA |
| CU3 Mover nodo (con versión) | Cambia de padre sin arrastrar; rechaza ciclos, más de 4 niveles y padres desactivados; el departamento no se mueve | PROPUESTA |
| CU4 Desactivar / reactivar nodo | Un nodo con hechos no se borra; no se desactiva con hijos activos | PROPUESTA |
| CU5 Clasificar un producto | Un desplegable por nivel, encadenados; «Sin elegir» es válido; rige desde ahora | PROPUESTA |
| CU6 Ver la clasificación vigente e histórica de un producto | «Vigente desde» solo lectura; historial conservado | PROPUESTA (etapa 2) |
| CU7 Copiar el camino a cada renglón de venta | Se escribe en la misma transacción de la venta | PENDIENTE (P3) |

**No hay «borrar nodo»** (igual que Pedernal: sin DELETE).

---

## 5. Nivel 4. Conceptos y ciclo de vida

- **Nodo de clasificación.** Pertenece a una empresa; tiene un padre o ninguno; **el nivel se calcula** recorriendo ancestros (no hay columna `nivel`, igual que Pedernal): 1 = Departamento; 2 a 4 = Categoría. Ciclo de vida: **activo ↔ inactivo**, nunca se borra. Nombres visibles fijos y no configurables (N-3).
- **Departamento.** Nodo de nivel 1. No se mueve ni se baja de nivel. Es la unidad de negocio; **no se crea ninguno por defecto**.
- **Tope de niveles.** 4, fijado **una vez** por la plataforma y nunca reducible: una función de la base y una constante del código, comparadas por una prueba (igual que Pedernal). Dónde vive en la consola de Motor2: no lo verifiqué.
- **Vínculo producto–nodo (E2).** Fila de solo inserción: «desde este instante el producto está en este nodo»; **la vigente es la última fila**; nodo nulo = «Sin elegir»; sin fecha futura; el departamento es la raíz del camino (un solo vínculo).
- **Camino copiado (E3, Pedernal 0047).** El camino (departamento, categoría, …) **con id y nombre** copiado a cada renglón de venta al vender; es un hecho y no se reescribe.
- **«Sin elegir».** El producto sin clasificación **se muestra «pendiente de completar»**, nunca se inventa un departamento.

---

## 6. Nivel 5. Invariantes y políticas (¿ya las cubre Motor2?)

| # | Invariante (Pedernal) | ¿Motor2 hoy? | Quién la va a cuidar | Estado |
|---|---|---|---|---|
| I1 | Un padre y una sola empresa por nodo | **Parcial**: la empresa sí (FK `(empresaId, id)` y RLS); no hay padre | La base (FK compuesta con `empresaId`) | PROPUESTA |
| I2 | Sin ciclos | **No** (en `Grupo` se controla en la aplicación) | Disparador a mano (recorrido de ancestros con corte) + primitiva pura `ARBOL_INCONSISTENTE`; candado por empresa | PROPUESTA; igual a Pedernal (VERIFICADO vía referencia) |
| I3 | Tope de 4 niveles, nunca reducible | **No** | Función de la base fijada una vez + constante + prueba que las compara; el movimiento cuenta nivel del nuevo padre + altura del subárbol | PROPUESTA; igual a Pedernal (VERIFICADO) |
| I4 | El departamento no se mueve ni nodo pasa a primer nivel | **No** | Disparador + motivo `DEPARTAMENTO_NO_SE_MUEVE` | PROPUESTA; igual a Pedernal (VERIFICADO) |
| I5 | No se borra, se desactiva | **Sí en la aplicación** (no hay borrado); en la base: **NO VERIFICADO** si `motor2_app` tiene DELETE sobre la tabla | Quitar DELETE al rol de la aplicación sobre la tabla (como se hizo con otras) o `RESTRICT` de las FK | PROPUESTA |
| I6 | No se desactiva con hijos activos | **No** | Caso de uso bajo candado | PROPUESTA |
| I7 | Nombre único entre hermanos, **incluidos los departamentos** (`NULLS NOT DISTINCT`) | **Distinto**: hoy único en toda la empresa (compatible: no rompe datos) | Índice `(empresaId, padreId, nombreClave)` NULLS NOT DISTINCT, a mano; reemplaza el actual | PROPUESTA; igual a Pedernal (VERIFICADO) |
| I8 | Renombrar y mover con versión (la pantalla manda la versión) | **No** | Columna `version` (disparador en cada UPDATE) | PROPUESTA; igual a Pedernal (VERIFICADO) |
| I9 | Movimientos simultáneos serializados | **No** | `pg_advisory_xact_lock` por empresa (molde existente) | PROPUESTA |
| I10 | Producto: la vigente es la última fila; «Sin elegir» válido; `UNIQUE (empresa, producto, vigente_desde)` | **Parcial** (una categoría, sin historial) | Tabla E2 | PROPUESTA; igual a Pedernal (VERIFICADO) |
| I11 | El vínculo es solo de inserción (disparador `solo_insercion`, aun al dueño de la base) | **No** | Disparador + solo SELECT/INSERT | PROPUESTA; igual a Pedernal (VERIFICADO) |
| I12 | Id lo manda la aplicación (idempotencia del alta del nodo y del vínculo) | **No** (`cuid()`) | Id del comando = clave; repetir devuelve `yaExistia` | PROPUESTA; igual en resultado (la forma, por Prisma) |
| I13 | Mover un nodo o cambiar la clasificación de un producto **no cambia lo vendido** (Pedernal 0047, VERIFICADO por el orquestador) | **No** (los reportes leen el vigente) | Copia del camino al insertar el renglón (E3) | PROPUESTA; **requiere autorización expresa** |
| I14 | Historial de cambios con antes y después, sin pantalla navegable | **No** para categorías (hoy «no se audita») | `RegistroAuditoria` (existe) | PROPUESTA |
| I15 | Una categoría desactivada no se ofrece para asignar a productos nuevos | **No** (hallazgo ya anotado el 06/11: `listarCategoriasProducto` devuelve todas, `src/server/actions/catalogo/categorias-producto.ts:19-22`) | El servidor y el selector | PROPUESTA |
| I16 | La clasificación no hereda alícuota ni define precio/stock | **Sí** (Motor2 tiene la alícuota en el producto) | Guardián: ningún cálculo de IVA lee el árbol | PROPUESTA |
| I17 | Todo nace cerrado: la validación del nombre declara lo permitido | **Sí** (`categorias-producto.guard.ts` usa el charset de catálogo) | Reutilizar el guard; cerco `cerco-lista-de-permitidos` | PROPUESTA |

**Política de «Sin elegir» (reportes):** un producto sin nodo aparece como «Pendiente de completar», no se reparte (regla del dueño, AGENTS.md).

---

## 7. Nivel 6. Historia y persistencia

### 7.0 Modelo completo (en papel) y etapas

| Etapa | Qué | Tablas/columnas | Migración | Estado |
|---|---|---|---|---|
| **E1** | El árbol | Columnas `padreId`, `nombreClave`, `version`, `creadoEn`, `actualizadoEn` + índice + disparadores en `CategoriaProducto` | **Sí, aditiva y reversible** (requiere autorización expresa) | PROPUESTA |
| **E2** | Vínculo con vigencia del producto + auditoría (Pedernal: 0046) | Tabla nueva `ProductoClasificacion` (solo inserción) | Sí, aditiva | PROPUESTA; igual a Pedernal 0046 (**P2**) |
| **E3** | Camino copiado a la venta (Pedernal 0047, existe) | Dos columnas nullable (append-only) en `CuentaItem` | Sí, aditiva (reversión destructiva si hay datos) | PROPUESTA; **requiere autorización expresa** |
| Después | Responsable del departamento, filtros, reportes por departamento | — | — | Fuera de alcance |

**Solo se migran las tablas de la etapa que se implementa.**

### 7.1 E1: el árbol, ampliando `CategoriaProducto` (PROPUESTA; igual a Pedernal 0045 salvo lo marcado)

**Forma de Pedernal (VERIFICADO vía referencia del orquestador, `59e47a40`):** `id` (lo manda la app), `empresa_id`, `padre_id` (nulo = departamento), `nombre` (1 a 80, lista de permitidos), `nombre_clave` (1 a 240), `activo`, `creado_en`, `actualizado_en`, `version`; único `(empresa_id, padre_id, nombre_clave)` **NULLS NOT DISTINCT**; FK compuesta `(padre_id, empresa_id) → (id, empresa_id)`; CHECK `padre_id <> id`; índice `(empresa_id, padre_id)`. **No hay columna `nivel`**: el nivel se calcula recorriendo ancestros.

**Motor2 (cambio respecto de mi versión anterior: se eliminan `nivel` y `nivelDelPadre`, que no existen en Pedernal y no tienen motivo de Prisma ni de datos):**

| Columna en `CategoriaProducto` | Regla | Marca |
|---|---|---|
| `padreId` (opcional) | FK compuesta `(empresaId, padreId) → (empresaId, id)`, CHECK `padreId IS DISTINCT FROM id`, índice `(empresaId, padreId)` | Igual |
| `nombreClave` (NOT NULL) | `claveDeNombre` (sin tildes, mayúsculas ni espacios dobles: la forma de `claveDeNombreDeCarta`, `src/core/carta/nombre-en-carta.ts:7`); CHECK largo 1 a 240; `nombre` 1 a 80 | Igual; el backfill de las filas actuales se calcula en la migración |
| `version` (NOT NULL, default 1, CHECK ≥ 1) | Optimistic locking; Pedernal la sube con un disparador en cada UPDATE | Igual en resultado; ya existe el molde `GrupoDeOpciones.version` (la incrementa la aplicación). **Decisión del implementador:** usar disparador como Pedernal (Motor2 ya tiene 11 migraciones con disparadores, p. ej. `RegistroAuditoria_inmutable_fila`) |
| `creadoEn`, `actualizadoEn` | Como Pedernal | Igual (hoy la tabla no los tiene) |
| Único `(empresaId, padreId, nombreClave)` **NULLS NOT DISTINCT** | **Reemplaza** `@@unique([empresaId, nombre])` y el índice sobre `lower(nombre)` | Igual. **Garantía de no romper nada:** hoy el nombre ya es único en toda la empresa, así que lo es también entre hermanos: la migración no puede fallar por datos existentes. `NULLS NOT DISTINCT` (PG 15+) debe confirmarse contra la versión de Neon (**NO VERIFICADO**; local 16, compose 17). Prisma no lo declara: va a mano en el SQL, como ya se hace con otros índices |

**Reglas que impone la base en Pedernal (defensa en profundidad) y su equivalente en Motor2 (disparadores escritos a mano en `migration.sql`, igual que Pedernal):** candado `pg_advisory_xact_lock(hashtextextended('clasificacion:' || empresaId, 0))` antes de leer; un nodo no cambia de empresa; un departamento no se mueve y ningún nodo pasa a primer nivel; no se reactiva un nodo con padre desactivado; no se desactiva un nodo con hijos activos; no se pone un nodo bajo uno desactivado; sin ciclos (recorrido de ancestros con corte); **tope de niveles = 4 en una función `tope_de_niveles_de_clasificacion()` fijada una vez por la plataforma y nunca reducible**, con una prueba que la compara con la constante `MAXIMO_DE_NIVELES_DE_CLASIFICACION` del código; un movimiento cuenta nivel del nuevo padre + altura del subárbol; **sin borrado ni TRUNCATE** (disparador, aun para el dueño de la base). La regla de negocio vive en una primitiva pura `arbol.ts` equivalente (en Motor2: `src/core/...`, **sin copiar rutas**), con el mismo **tipo cerrado de motivos de rechazo**: `NODO_INEXISTENTE`, `ARBOL_INCONSISTENTE`, `PADRE_INEXISTENTE`, `PADRE_DESACTIVADO`, `CICLO`, `TOPE_DE_NIVELES`, `DEPARTAMENTO_NO_SE_MUEVE`, `TIENE_HIJOS_ACTIVOS`; un árbol que no cumple **no se interpreta** (`ARBOL_INCONSISTENTE`, todo nace cerrado). Funciones equivalentes: camino del nodo, nivel, puede crear bajo, puede mover, destinos para mover, puede desactivar, puede reactivar.

**Seguridad (distinto por Prisma/Motor2 en la forma):** Pedernal usa RLS forzada con una política por comando, INSERT/UPDATE por columna y `empresa_operable()`. Motor2: `empresaId DEFAULT app_empresa_actual()` + RLS como el resto del esquema + privilegios del rol `motor2_app` sin DELETE ni TRUNCATE. Qué grants tiene hoy `CategoriaProducto`: **NO VERIFICADO**.

**Migración (aditiva y reversible; requiere autorización expresa):** columnas nuevas con default, backfill de `nombreClave`, cambio del índice único, disparadores. Las filas actuales **quedan como departamentos** (`padreId` NULL; P6 corregida: ver «Categorías planas de hoy» abajo). `down.sql`: quita disparadores, índice nuevo y columnas, y **recrea** el único `(empresaId, nombre)` (falla y aborta si hay nodos de nivel ≥ 2 con nombres repetidos entre hermanos distintos). **Se pierde** la jerarquía creada después. Antes: respaldo, ensayo en copia de Neon (nunca la rama principal): ida, `down.sql`, ida. Conteo real de `CategoriaProducto` y productos con categoría: NO VERIFICADO.

**Categorías planas de hoy (CONFIRMADA por el dueño, P6 corregida): pasan a ser departamentos de primer nivel.** **Datos reales (lectura en SOLO LECTURA del orquestador sobre una copia de producción reciente; NO leídos por mí; el detalle está en el repositorio privado de documentos):** una empresa con **dos categorías planas, ambas sin productos vinculados**; sin objetivos de food cost cargados; sin recetas. Solo se miró esa copia: **recontar en cada base antes de migrar**. **Consecuencia técnica:** como las categorías existentes ya tienen `padreId` NULL (columna nueva, sin valor), **ya son nivel 1 = departamentos sin escribir nada**: no hay que crear «El negocio» ni mover filas, y conservan `id`, `nombre`, `activo`, `Producto.categoriaId` y `MargenObjetivo.categoriaId`. La migración de esquema (columnas, índice único, disparadores) **no necesita una migración de datos** para el caso real conocido; solo hace falta **verificar, base por base, que se cumpla el caso** (ninguna categoría existente tiene productos vinculados, o el dueño decidió qué hacer con ellos). Para una base que no cumpla (categorías con productos o que son en realidad categorías de un departamento): **a decidir con el dueño antes de migrar**; la conversión (crear el departamento y mover esas categorías debajo, que está permitido entre departamentos) sería una migración de datos aparte, con su `down.sql`, respaldo y ensayo. **Diferencia con Pedernal:** ninguna de fondo (Pedernal tampoco crea departamentos por defecto); lo único distinto es que Motor2 trae dos departamentos ya existentes en la tabla. **Si E2 entra junto con E1 (P2):** como las categorías existentes no tienen productos vinculados, **no hay filas de vínculo que rellenar** en el caso conocido: el problema del actor de sistema (`cargado_por` obligatorio en Pedernal) **no se presenta**; solo aparecería en una base con productos clasificados.

### 7.2 E2: vínculo producto→nodo de solo inserción (PROPUESTA; igual a Pedernal 0046)

Tabla nueva `ProductoClasificacion` (nombre en el estilo de Motor2) con la forma de Pedernal (VERIFICADO): `id` (lo manda la app = clave de idempotencia del cambio), `empresaId`, `productoId`, `nodoId` (**nulo = «Sin elegir»**), `vigenteDesde` (el instante del guardado en el servidor; sin fecha futura ni cambios programados), `cargadoPor`, `creadoEn`. Únicos y claves: `(id, empresaId)`; FK compuestas a producto y nodo (misma empresa); **`UNIQUE (empresaId, productoId, vigenteDesde)`**; índices `(empresaId, productoId, vigenteDesde DESC)` y `(empresaId, nodoId) WHERE nodoId IS NOT NULL`. **La vigente es la última fila** (no hay `hasta` ni índice «una vigente»: corrijo mi versión anterior). Un producto sin fila está «Sin elegir». Al asignar, el nodo debe estar activo; un nodo desactivado después **no** altera el historial. **Un UPDATE o DELETE lo frena un disparador `solo_insercion`**, aun al dueño de la base. **El departamento es la raíz del camino del nodo: hay un solo vínculo**, no dos columnas que puedan contradecirse. Solo `SELECT` e `INSERT` para el rol de la aplicación. Reversión (`down.sql`): destructiva si hay vínculos: se avisa antes.

**Diferencia por datos existentes:** `Producto.categoriaId` (hoy la categoría mutable) **se conserva como copia de la vigente**, escrita en la misma transacción que la fila nueva, para que reportes, food cost, carta y duplicar producto no cambien de fuente en esta etapa; una prueba compara que coincidan. Es la única duplicación y se declara; la fila vigente de la tabla manda. Etapa posterior: retirar `Producto.categoriaId` (destructivo, con autorización aparte).

### 7.3 E3: camino copiado a la venta (Pedernal 0047: EXISTE; PROPUESTA, requiere autorización expresa)

**Pedernal (VERIFICADO por el orquestador, `ZuluHub-ERP` rama principal `2e71fd35`, 2026-11-14: cabeceras de las migraciones y mensajes de commit de los PR #291 y #297; **NO leídos por el orquestador ni por mí:** los diffs completos, consultas, pantallas y pruebas; informe: `motor2-docs/seguimiento-de-pedernal/2026-11-14-1100-cambios-de-pedernal-desde-el-13-11.md`):** `0047_camino_en_el_renglon`: el renglón de venta congela el camino (departamento y categoría, ids y nombres) al vender; **dos columnas nullable, solo INSERT**; migración **aditiva con reversión destructiva si hay renglones con camino**. Cambiar la clasificación o mover un nodo **no cambia lo vendido**. #291: el renglón toma **lo vigente** (el último cambio guardado).

**Motor2 (PROPUESTA, igual en resultado y en forma):** dos columnas **nullable** en `CuentaItem` (la línea de venta que ya congela precio y nombre del ticket, `schema.prisma:2397-2399`), una para el camino con ids y otra con los nombres (**la forma exacta de las dos columnas de Pedernal: NO VERIFICADA**; hay que leer su migración 0047 completa). Se escriben **solo al insertar** la línea y **en la misma transacción que la venta**: la lectura de la clasificación vigente del producto y la escritura del camino ocurren juntas (ni antes ni después). Sin `UPDATE`: lo vendido no se reescribe. **Migración aditiva y reversible con aviso:** el `down.sql` **destruye** el camino de lo vendido desde la activación (se avisa antes y se pide autorización aparte). **Ventas anteriores a la activación:** camino vacío («Pendiente de completar»): no hay historial de la categoría que tenían (no se reconstruye).

**Riesgos (VERIFICADOS en Motor2):** `CuentaItem` y `Operacion` son de las tablas más usadas y los escritores de venta son varios (mostrador, mesas, comprobantes): se cubre con pruebas de regresión de ventas (precio, descuento de stock y foto de la línea idénticos). **Orden:** E1 y E2 primero; E3 después, con su propia autorización.

**Pregunta nueva al dueño (aviso T7):** el aviso aprobado el 2026-11-14 («Esta categoría tiene productos. Los reportes de períodos anteriores van a mostrar la categoría nueva.») **deja de ser cierto** para lo vendido desde que exista E3. Opciones: **a.** mantenerlo mientras no exista la copia y **retirarlo al construirla** (recomendada: es cierto hasta entonces y falso después); **b.** mantenerlo siempre (engañoso para lo nuevo); **c.** reemplazarlo al construir E3 por un texto nuevo del estilo «Lo ya vendido no cambia.» (texto a aprobar) y dejar el aviso viejo solo para períodos sin camino. Si no se responde: se mantiene T7 hasta que exista E3 (opción a).

### 7.4 Historia y trazabilidad

Cada comando (crear, renombrar, mover, desactivar, reactivar, clasificar un producto) deja **una fila de `RegistroAuditoria` por campo cambiado** con antes y después, actor y fecha (hoy las categorías **no** se auditan: `src/server/persistencia/catalogo/categorias-producto.ts:5`, «no se audita»; se cambia, es parte del pedido de Pedernal: «historial de cambios en la auditoría»). Los nodos no se borran; se anulan desactivándolos.

### 7.5 Departamento en la cuenta de venta (Pedernal 0048) — pregunta, no se diseña tabla

**Pedernal (VERIFICADO por el orquestador, `ZuluHub-ERP` rama principal `2e71fd35`, 2026-11-14: cabeceras de las migraciones y mensajes de commit de los PR #291 y #297; **NO leídos por el orquestador ni por mí:** los diffs completos, consultas, pantallas y pruebas; informe: `motor2-docs/seguimiento-de-pedernal/2026-11-14-1100-cambios-de-pedernal-desde-el-13-11.md`):** `0048_departamento_en_la_cuenta`: **el departamento elegido en el selector de contexto se fija en la cuenta de venta al abrirla**; no cambia después; es **independiente del departamento de cada renglón** (el del producto); **vender un producto de otro departamento no se bloquea** (DEC-0365 de Pedernal). **Migración aditiva** (el detalle: NO leído).

**En Motor2 no existe** el selector de contexto (el menú lo dejó reservado; el dueño decidió el 13/11, para Pedernal, el rótulo «Departamento», oculto con 0 o 1 departamentos, sin exigir caja ni punto de venta propios). **No estaba en el pedido** del dueño para Motor2 («departamento… categoría»): por la regla «lo que el dueño no pidió no entra», **queda como pregunta y no se diseña ninguna tabla** hasta que lo pida:
- **a.** No hacerlo ahora (recomendada): el departamento queda solo en la clasificación del producto y en el camino de cada renglón (E3).
- **b.** Hacerlo después de E1 a E3: una columna nullable en la cuenta de venta (aditiva, **requiere autorización expresa**), sin bloquear la venta de un producto de otro departamento.
- **c.** Hacerlo ya, junto con E3: más riesgo en ventas.
Si no se responde: (a).

---

## 8. Nivel 8 (parte 1). Acceso y permisos

| Operación | Pedernal | Motor2 hoy | Propuesta (sin cambiar pisos) |
|---|---|---|---|
| Administrar el árbol (crear, renombrar, mover, desactivar, reactivar) | `productos.editar` (**sin clave propia**: VERIFICADO vía referencia), alcance de toda la empresa; el dueño lo definió «mismo permiso que las secciones: gerente y administrador» | `categorias`: empresa, **piso administrador**, semilla admin (`acciones.ts:63`); `categoria_alta`: empresa, **piso operario**, semilla admin y operador (`:234`) | **`categorias`** para mover, renombrar, desactivar, reactivar y crear **departamentos**; **`categoria_alta`** solo para crear categorías (niveles 2 a 4) **si el dueño lo confirma (P6)**. Equivale a «gerente y administrador» porque el piso `administrador` lo alcanzan administrador y gerente (ADR-027 §1) |
| Elegir la clasificación de un producto | `productos.editar` (gerente y administrador) | `producto_editar` / `alta_producto`: piso **operario** | Se mantiene el piso actual de Motor2; **diferencia declarada** con Pedernal (**P6**) |
| Ver el árbol | quien edita; el operador **ve la clasificación en la ficha pero no puede cambiarla** (maqueta, estados `f-permiso`/`e-permiso`) | `requerirVerAlguna(["categorias","alta_producto","producto_ver_catalogo"])` | Igual: lectura con las claves actuales |

Reglas: **toda** operación valida en el servidor quién la pide y con qué permiso (nunca el frontend); los pisos no se bajan por configuración (ADR-008/ADR-027); si cambia el permiso del usuario a mitad (§10, «cambio de permisos») la operación **falla cerrada** y no deja nada a medias.

---

## 9. Nivel 8 y 9. Interfaz y consultas (mobile first, 375 px)

- **Pantalla «Clasificación comercial»** (título aprobado en Pedernal; en Motor2 hoy la entrada se llama «Categorías» y el choque de nombres con «rubro» está anotado en el diseño del 06/11, S8): árbol plegable, «Crear» arriba, tocar una fila abre sus acciones (Crear dentro, Renombrar, Mover, Desactivar/Reactivar), **mover sin arrastrar** (se elige el nuevo padre de una lista que ya excluye al propio nodo y a sus descendientes), tope y desactivados avisan con texto («Primero desactivá lo que tiene adentro.» es el texto aprobado en Pedernal; los textos de Motor2 **requieren su aprobación**: son textos que ve el cliente). Estados a cubrir (los 19 de la maqueta): vacío, varios niveles, acciones, crear, renombrar, mover (tope, ciclos), desactivado, hijos activos, tope, ciclo por cambio simultáneo, versión desactualizada, sin permiso; y en la ficha: vacía, «Sin elegir», cambiar, vigente, nodo desactivado, sin permiso.
- **Ficha del producto:** un desplegable por nivel, encadenados (reemplaza el `Selector` único «Categoría» de `producto-form.tsx:229`), con «Vigente desde» solo lectura (etapa 2).
- **Consultas:** el árbol de la empresa (una lectura, ordenada por camino); la clasificación vigente de un producto; el camino de una venta (etapa 3). Todas filtran por empresa en el servidor y por RLS.
- **Diferencias de pantalla con Pedernal declaradas:** Pedernal muestra el nombre de la sucursal en la barra («Sucursal Centro»); en Motor2 la clasificación es **de la empresa**, no de la sucursal (ADR-010, dos paneles): va en el panel de empresa.

---

## 10. Nivel 7. Atomicidad y concurrencia: «¿qué pasa si…?» por comando

**Reglas comunes (igual a Pedernal, VERIFICADO vía referencia).** Todo comando que escribe: (1) valida permiso en el servidor; (2) toma el candado `pg_advisory_xact_lock(hashtextextended('clasificacion:' || empresaId, 0))` **antes de leer**, dentro de la transacción; (3) corre en **READ COMMITTED a propósito** (serializado por el candado, cada lectura posterior ve lo último confirmado; con una foto fija el segundo pedido decidiría sobre el árbol anterior); (4) lee, decide y escribe en la misma transacción; (5) escribe la auditoría en la misma transacción. Rechazos con el **tipo cerrado de motivos** de §7.1. **El id del nodo / del vínculo lo manda la aplicación** (idempotencia: repetir el mismo comando con el mismo id devuelve el resultado ya guardado, no crea otro).

### 10.1 Crear nodo

| ¿Qué pasa si…? | Resultado esperado |
|---|---|
| Repetición (doble clic, mismo id) | Una sola fila; el segundo intento devuelve `{ nodoId, yaExistia: true }` |
| Concurrencia (dos personas crean el mismo nombre entre hermanos) | Una gana; la otra recibe «ya existe» (índice único); nunca dos |
| Tiempo (padre desactivado entre que se abrió la pantalla y se guardó) | Rechaza: no se crean hijos bajo un nodo desactivado |
| Incertidumbre (la red se corta después de guardar) | El reintento con el mismo id confirma lo ya creado |
| Reintento automático | Seguro por la clave (id del comando) |
| Error parcial | No hay: nodo + auditoría en una sola transacción; o todo o nada |
| Datos faltantes (nombre vacío, largo, caracteres) | Rechaza con el guard de «lista de permitidos» |
| Cambio de permisos | Falla cerrada, no deja nada |
| Nivel resultante > 4 | Rechaza (CHECK + regla) |

### 10.2 Renombrar

| ¿Qué pasa si…? | Resultado |
|---|---|
| Repetición con el mismo nombre | No escribe (ya es ese), no audita |
| Concurrencia con otro renombre o mover | El candado serializa; versión vieja → «alguien lo cambió, recargá» |
| Nombre ya usado por un hermano | Rechaza |
| Error parcial | Nodo + auditoría juntos |
| Ventas pasadas | No cambian (etapa 3 guardó el nombre al vender) |

### 10.3 Mover nodo (con versión)

| ¿Qué pasa si…? | Resultado |
|---|---|
| Repetición (mismo destino, misma versión) | Segundo intento ve la versión nueva: «ya estaba movido», sin escribir otra vez |
| Concurrencia (dos mueven el mismo nodo, o A mueve X bajo Y mientras B mueve Y bajo X) | El candado por empresa serializa; el segundo valida de nuevo contra el estado ya movido → rechaza el ciclo (estado `e-ciclo` de la maqueta) |
| Tiempo (se miró la hoja, otra persona movió) | Versión desactualizada → rechaza sin cambiar nada |
| Destino = el mismo nodo o un descendiente | Rechaza (ciclo) |
| Resultado supera el tope de 4 niveles (cuenta el subárbol) | Rechaza (estado `mover-tope`) |
| Destino desactivado | Rechaza |
| El nodo es un departamento | Rechaza (no se mueve) |
| Error parcial (se cambia el nivel de hijos y falla el último) | Todo el subárbol o nada: una transacción |
| Cambio de permisos | Falla cerrada |
| Datos faltantes (versión ausente) | Rechaza |
| Productos con el nodo | Siguen apuntando al mismo nodo; sin cambio en lo vendido (etapa 3); **hoy, con lectura del vigente, los reportes viejos sí cambian** hasta que exista etapa 3 |

### 10.4 Desactivar / reactivar

| ¿Qué pasa si…? | Resultado |
|---|---|
| Repetición | Escribe el mismo estado (idempotente por estado) |
| Concurrencia (desactivar el padre mientras otro crea un hijo) | El candado: o se crea antes (y entonces el padre tiene un hijo activo y no se desactiva) o se rechaza el hijo |
| Tiene hijos activos | Rechaza («Primero desactivá lo que tiene adentro») |
| Tiene productos | **Permitido** y no los toca (lo ya asignado sigue contando); deja de ofrecerse (I15) |
| Reactivar con padre desactivado | Rechaza |
| Error parcial | Estado + auditoría juntos |

### 10.5 Clasificar un producto (etapa 2)

| ¿Qué pasa si…? | Resultado |
|---|---|
| Repetición (mismo nodo ya vigente) | **No se escribe** (como el precio igual al vigente en Pedernal) |
| Concurrencia (dos editan el mismo producto) | Candado por empresa + `UNIQUE (empresa, producto, vigente_desde)`: se insertan dos filas en orden y rige la última; ninguna se pisa (solo inserción) |
| Tiempo | Siempre «desde ahora» con hora del servidor; **no hay fecha elegible** |
| Nodo desactivado elegido | Rechaza (pero el producto que ya lo tiene lo conserva, apagado) |
| Reintento | Seguro por el id del vínculo |
| Error parcial | Fila nueva + `Producto.categoriaId` (copia) + auditoría: **una** transacción |
| «Sin elegir» | Válido: cierra la vigente y abre una con nodo nulo |
| Cambio de permisos | Falla cerrada |

### 10.6 Copia del camino a la venta (etapa 3, PENDIENTE)

| ¿Qué pasa si…? | Resultado |
|---|---|
| Se reintenta cerrar la cuenta | La cuenta ya tiene su idempotencia (`claveIdempotencia`); la copia va en la **misma** transacción: no se duplica |
| Se mueve un nodo en medio de la venta | La venta lee el camino dentro de su transacción: copia uno consistente (el de antes o el de después), nunca mezclado |
| Producto «Sin elegir» | Camino vacío («pendiente de completar»), nunca inventado |
| Error al leer el camino | **Falla la venta** o se guarda vacío: **decisión de riesgo (P3)**; propongo que no bloquee la venta y se marque vacío |

---

## 11. Nivel 10. Pruebas, oráculo de combinaciones y migración

**Dimensiones cuyas combinaciones cambian permisos, visibilidad o datos (declaradas):** D1 nivel del nodo (1, 2, 3, 4); D2 acción (crear, renombrar, mover, desactivar, reactivar, clasificar producto); D3 estado del nodo (activo/inactivo); D4 si tiene hijos activos; D5 si tiene productos; D6 destino del movimiento (mismo nodo / descendiente / otro padre con nivel resultante ≤ 4 / > 4 / desactivado / otro departamento); D7 piso del usuario (operario, administrador, administrador de sistema, gerente) × clave (`categorias`, `categoria_alta`, `producto_editar`); D8 versión (actual/vieja); D9 empresa del nodo (propia/ajena). **Oráculo:** tabla escrita aparte del código, p. ej. `docs/oraculo-combinaciones-clasificacion-AAAA-MM-DD.md`, y un test que recorre el producto cartesiano **exhaustivo** (4 × 6 × 2 × 2 × 2 × 6 × 4 × 2 × 2 = ~36 mil combinaciones, viable en una prueba pura) contra una función del dominio. Un **guardián** falla si aparece una columna, un nivel o una clave nueva sin declarar si afecta (regla de combinaciones del 2026-10-28).

**Filas del oráculo (muestra):**

| Acción | Condición | Resultado |
|---|---|---|
| Mover | nodo = departamento | RECHAZA |
| Mover | destino = sí mismo o descendiente | RECHAZA (ciclo) |
| Mover | nivel resultante del subárbol > 4 | RECHAZA (tope) |
| Mover | destino inactivo | RECHAZA |
| Mover | versión vieja | RECHAZA (desactualizada) |
| Desactivar | hijos activos > 0 | RECHAZA |
| Desactivar | sin hijos activos, con productos | PERMITE |
| Crear | padre inactivo o nivel resultante 5 | RECHAZA |
| Cualquiera | empresa distinta | NO ENCONTRADO (sin revelar existencia) |
| Cualquiera | piso por debajo del exigido | RECHAZA (falla cerrada) |
| Clasificar | mismo nodo ya vigente | NO ESCRIBE |
| Clasificar | nodo inactivo | RECHAZA |

**Pruebas obligatorias (cuando se implemente cada etapa):**
- **Concurrencia (dos a la vez, contra Postgres real):** dos «crear» del mismo nombre; «mover A bajo B» contra «mover B bajo A» (ningún ciclo); «desactivar padre» contra «crear hijo»; dos clasificaciones del mismo producto.
- **Idempotencia:** el mismo comando con el mismo id repetido 2 y 10 veces (una sola fila, una sola auditoría); reintento tras corte.
- **Aislamiento entre empresas:** una empresa no ve ni mueve nodos de otra (RLS y filtro del servidor).
- **Migración:** subir, bajar y volver a subir sobre una copia con datos reales; los reportes y el food cost dan **idénticos** antes y después de E1 (prueba de regresión sobre el escenario de `test/reportes/caracterizacion/escenario-reportes.ts`).
- **Guardianes:** ningún cálculo de IVA lee el árbol (I16); el vínculo es de solo inserción (I11); la carta pública no lee el árbol.
- **E2E (Playwright, 375 px):** crear departamento y categoría, mover, desactivar con hijos (rechazo), clasificar un producto.
- **Gate (AGENTS.md):** `npx tsc --noEmit`, `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto`, `npm test`, `npm run build`, `npm run plataforma:build`, `npm run test:e2e`, todos en la misma corrida y limpios.

**Migración y operación.** Separo lo que **no necesita** migración de lo que **sí**:

| No necesita migración | Necesita migración (**requiere autorización expresa del dueño**) |
|---|---|
| Texto de la pantalla, selector encadenado, auditoría de categorías (usa `RegistroAuditoria`), filtro de categorías activas (I15), candado y reglas en la aplicación, constantes y guardianes, oráculo | **E1** (4 columnas + índices en `CategoriaProducto`), cambio del índice de nombre único (si P4 = «entre hermanos»), **E2** (tabla nueva), **E3** (columnas en `CuentaItem` y quizá `Operacion`) |

Las **reversiones** de E1 y E2 son seguras con datos nuevos por la regla de abortar si el `down.sql` detecta pérdida; **la reversión de E3 destruye la copia del camino** de las ventas hechas desde la activación: **destructiva, se avisa antes y se pide autorización aparte**. Procedimiento: respaldo → ensayo en copia de Neon → aprobación del dueño → aplicación base por base, con el congelamiento levantado por quien corresponda. Hasta entonces **no se aplica nada**.

### Diferencias de infraestructura Pedernal → Motor2

| | Pedernal | Motor2 | Qué se adapta |
|---|---|---|---|
| Acceso a datos | SQL crudo, roles propios | Prisma + `prisma/migrations/*/migration.sql` y `down.sql` | Los CHECK, índices parciales y FK diferibles se escriben **a mano** en el SQL de la migración (el proyecto ya lo hace, p. ej. `MargenObjetivo`) |
| Aislamiento | RLS por empresa | RLS con `empresaId DEFAULT app_empresa_actual()` + FK compuestas `(empresaId, id)` | Mismo molde; la tabla nueva E2 lo copia |
| Id | lo manda la aplicación | `@default(cuid())` | El comando trae el id; el caso de uso lo usa en lugar del default |
| Reversiones | `migraciones/reversiones/` | `down.sql` junto a cada migración | Un `down.sql` por migración |
| Permisos | `productos.editar` | `categorias`, `categoria_alta`, `producto_editar` | §8 |
| Candado/versión | advisory por empresa | `pg_advisory_xact_lock` ya usado; `version` ya usada | Se reutilizan |
| Auditoría | antes y después | `RegistroAuditoria` (una fila por campo) | Se reutiliza |
| Estructura de código | `src/primitivas/clasificacion/*`, `src/modulos/catalogo/casos-de-uso/*` | `src/core/` (puro), `src/server/actions|persistencia|consultas|lecturas`, guards en `src/core/features/` | Se sigue la estructura de Motor2; **no se copian las rutas de Pedernal** |

---

## 12. Capturas (a 375 px, solo en el scratchpad de la sesión; no se suben al repositorio, que es público)

- Maqueta de Pedernal `clasificacion.html`, 19 estados (marco del celular, 2×): (en el scratchpad de la sesión de diseño; no se suben al repositorio) (`vacio`, `varios`, `acciones`, `crear`, `renombrar`, `mover-tope`, `mover-ciclo`, `desactivado`, `e-hijos`, `e-tope`, `e-ciclo`, `e-version`, `e-permiso`, `f-vacia`, `f-sin`, `f-cambiar`, `f-vigente`, `f-desactivado`, `f-permiso`).
- Pantalla actual de Categorías de Motor2 (`/catalogo/categorias`, app local con base descartable, servidor `next dev`; **datos de demostración que cargué yo**, no son datos reales): (en el scratchpad de la sesión de diseño; no se sube al repositorio). Se ve: título «Maestros · Categorías» con la leyenda «El rubro comercial de cada producto… Ordena los reportes y fija el margen objetivo por rubro», pestañas Insumos / Categorías / Unidades / Margen objetivo, lista plana con «Activa» y «Desactivar», y un alta de una sola línea. **Esa leyenda y la pestaña «Margen objetivo» confirman que la categoría ya está atada al food cost**; la leyenda habría que cambiarla (dice «rubro»).

---

## 13. Decisiones del dueño y preguntas abiertas

> Respuestas del dueño del 2026-11-13 (chat con el orquestador, transmitidas por él). Criterio rector: «iguales en todo, salvo por Prisma».

**CONFIRMADA (corregida) — P6/P6b, las categorías planas de hoy.** Respuesta del dueño (2026-11-13, chat con el orquestador, opciones): «Pasan a ser DEPARTAMENTOS (Recomendada)». Las dos categorías planas existentes quedan como **departamentos de primer nivel**; **no hace falta el departamento inicial «El negocio»** (como no tienen productos, no hay nada que mover). Esto **reemplaza** la respuesta anterior («bajo un departamento por defecto») y cierra P6b. Para una base con categorías que **sí tengan productos o sean de otro tipo**: **a decidir con el dueño antes de migrar** (recontar en cada base). **Datos reales (lectura en SOLO LECTURA del orquestador sobre una copia de producción reciente; NO leídos por mí; el detalle está en el repositorio privado de documentos):** una empresa con **dos categorías planas, ambas sin productos vinculados**; sin objetivos de food cost cargados; sin recetas. Solo se miró esa copia: **recontar en cada base antes de migrar**. Sigue siendo **solo con autorización expresa, respaldo y ensayo**.

**CONFIRMADA — P5, food cost.** El dueño eligió «No se hereda» y pidió que el food cost sea «un dato… en base a la receta» como en Pedernal. En este diseño: el departamento no hereda nada; **el objetivo por categoría sigue como hoy** (mismo `id`, sin herencia) y **la paridad de food cost se trata aparte**: ver `docs/anexo-paridad-food-cost-pedernal-motor2-2026-11-13.md` (tabla de 15 filas: lo igual, lo distinto y las candidatas a poda).

**Asumidas por el orquestador, declaradas (el dueño las corrige):**
- **P1** El diseño del 06/11 («unidad → rubro») queda reemplazado por este.
- **P2** El vínculo producto→nodo entra con historial de solo inserción, como Pedernal 0046.
- **P3 (actualizada 2026-11-14)** La 0047 de Pedernal **ya existe** y la copia del camino a la venta (E3) se diseña como etapa propia en §7.3; **ninguna migración autorizada**.
- **P7** Se amplía `CategoriaProducto` en vez de crear una tabla nueva (distinto por datos existentes).

**Abiertas:**
- **P6b. CERRADA** (el dueño eligió que pasen a ser departamentos). Queda solo: base distinta de la conocida → decidir antes de migrar.
- **P6c. Departamento inicial «El negocio»: ya no hace falta** para el caso conocido.
- **P6d. Permisos — CONFIRMADA (dueño, 2026-11-14, chat con el orquestador, opciones): «Árbol: administración y gerencia; clasificar en la ficha: como hoy (Recomendada)».** Árbol = `categorias` (piso administrador, que alcanzan administrador y gerente); elegir la clasificación en la ficha = permiso de hoy de quien edita productos. **Diferencia declarada** con Pedernal (que usa `productos.editar` de gerente y administrador para todo); no se sube ni baja ningún piso (ADR-008/ADR-027).
- **Textos y mover una categoría con productos — CONFIRMADAS (dueño, 2026-11-14, chat con el orquestador, opciones): «Mismos textos que Pedernal y retirar «rubro» (Recomendada)»** (los textos aprobados en Pedernal: «Clasificación comercial», «Departamento», «Categoría», «Crear», «Renombrar», «Mover», «Cambiar», «Primero desactivá lo que tiene adentro.»; se retira la palabra «rubro» de la leyenda actual de Categorías) **y «Sí, avisando que los reportes de períodos anteriores van a mostrar la categoría nueva (Recomendada)»**: al mover una categoría que ya tiene productos, el sistema **pide confirmación** con ese aviso. Texto exacto del aviso propuesto: «Esta categoría tiene productos. Los reportes de períodos anteriores van a mostrar la categoría nueva.» (**APROBADO**, dueño, 2026-11-14, chat con el orquestador: T7, «Aprobar los 2 como están»). Vale mientras no exista la copia del camino a la venta (etapa E3).
- **P5b. Lo que sale del anexo de food cost** (merma sobre bruto, base con o sin IVA, poda del objetivo): tres decisiones propias del dueño, tratadas aparte, **no** parte de la clasificación.

**Supuestos declarados:** S1 la clasificación es de la empresa, no de la sucursal. S2 **(corregido)** las categorías de hoy pasan a ser departamentos de primer nivel (P6 corregida). S3 el tope 4 vive en una función de la base y una constante, comparadas por una prueba. S4 en E1 la carta, los reportes y el food cost siguen leyendo `Producto.categoriaId` sin cambios (mismos ids). S5 **(corregido)** no se crea ningún departamento por defecto; las dos categorías existentes son los departamentos. S6 orden alfabético, sin columna de orden.

---

## 14. Riesgos y pendientes

- **No leí el código de Pedernal yo:** la referencia del orquestador (`59e47a40`) lo cubre; siguen sin verificar pantalla, textos, consultas y pruebas. Repetir el fetch antes de entregar.
- **Datos reales NO VERIFICADOS** (conteos y nombres de las categorías de producción).
- **Disparadores a mano en Motor2:** hay precedente (11 migraciones), pero los de árbol (ciclo, tope, altura del subárbol) hay que ensayarlos en una base descartable; `NULLS NOT DISTINCT` exige PG ≥ 15 en Neon (NO VERIFICADO).
- **Hasta que exista E3, mover o renombrar un nodo cambia los reportes del pasado** (y por eso rige el aviso T7); **cuando exista, T7 deja de ser cierto** (pregunta de §7.3).
- **Congelamiento de producción:** nada se aplica ni se despliega.
- **Sugerencias (no implementadas):** filtro de la lista de productos por clasificación (Pedernal lo dejó para una segunda tanda); reporte de ventas por departamento.
