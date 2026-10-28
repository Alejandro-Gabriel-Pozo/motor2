# Diseño: módulo Catálogo de la Fase 7 «pantallas por módulo» (Ola PM), 2026-10-28

Origen: DEC-13 ratificada por el dueño el 2026-10-20 (`docs/decisiones-cerradas-ola-precio-y-carta-2026-10-19.md`, sección «Fase 7»): Catálogo tiene **5 entradas** de menú: Productos, Biblioteca de opciones, Maestros (con pestañas), Proveedores y Clientes con descuento. Aplican también DEC-33 (ver ≠ escribir con NIVELES de la misma clave, sin claves nuevas ni migración), el glosario DEC-26/DEC-30 y la decisión «Precio por sucursal: en el PRODUCTO (paso 2) + lista "Precios por sucursal"; dueño Catálogo». Molde: los módulos Movimientos (#131) y Stock (`docs/diseno-modulo-stock-2026-10-27.md`) ya terminados.

Escrito contra el código real del carril (`alegp/carril-cat`, base `2b994fb6`, la integración #132 con E1, E2, E3a y Stock) y contra la emulación ratificada (artefacto `N9vFwuyYsQD7RkwjNzTsxf`, `project/Main.dc.html`: menú `MP`, pestañas `TABS.p_productos` = Productos · Precios por sucursal, `TABS.p_maestros` = Insumos · Categorías · Unidades · Margen objetivo, `p_biblio` = Biblioteca de opciones). Se revisó `motor2-docs` (`_planes/`, decisiones del dueño): no hay un plan aprobado del menú de Catálogo más allá de DEC-13 y la emulación; sí la investigación del vínculo proveedor↔producto (`_planes/investigacion-vinculo-proveedor-producto-2026-10-06.md`) y la decisión `modoDeConteo` del Insumo (2026-10-08, no implementada), que no se tocan acá.

**Restricción de esta ola: SIN MIGRACIÓN.** Menú, rutas, pantallas, vocabulario y lecturas. Lo que pediría una migración, una clave nueva o tocar dinero queda PENDIENTE (sección 11).

## 0. Inventario de lo que ya existe (verificado en el código)

**Menú hoy** (`src/core/navegacion/estructura.ts`, grupo `catalogo`): 10 ítems sueltos — Productos, Precio local (`/movimientos/precio-local`, mudado desde Movimientos por DEC-25), Proveedores, Clientes con descuento, Recetas, Opciones de venta, Insumos / Grupos, Categorías, Unidades, Margen objetivo. Fuera del menú: `/catalogo/productos/nuevo` (`alta_producto`) y `/catalogo/proveedores/comparativa` (`comparar_precios`). Ruta hija con acción propia: `/catalogo/productos/[id]/en-la-carta` (`carta_ver`).

**Rutas y pantallas** (`src/app/(app)`):

| Ruta | Qué es | Guarda de la página | Escrituras que dispara (clave del servidor) |
|---|---|---|---|
| `/catalogo/productos` (+ `/nuevo`, `/[id]`, `/[id]/datos`, `/[id]/opciones`, `/[id]/en-la-carta`) | Lista con filtros y el espacio del producto en 4 pasos | `producto_ver_catalogo` (empresa) | alta (`alta_producto`), editar (`producto_editar`, campos sensibles), disponibilidad (`producto_disponibilidad`), opciones admitidas, precio de la sucursal activa en el paso 2 (`precio_local`) |
| `/movimientos/precio-local` | Precio de venta propio de la sucursal activa y precios por tamaño | `precio_local` (sucursal) | `setPrecioLocalProducto` (SERIALIZABLE, valor visto), `fijarPrecioLocalDeOpcion` |
| `/catalogo/recetas` (+ `/[productoId]`, `/historial`) | Lista de recetas armadas; el editor es el paso 3 del espacio del producto (`rutaDelPaso(id, "receta")`) | `guardar_receta` (empresa) | `guardarVersionDeReceta` (SERIALIZABLE, optimista) y las de receta propia de sucursal |
| `/catalogo/opciones` (+ `/[grupoId]`, `/limpiar`) | Grupos de opciones de venta de la empresa | `opciones_definir` (empresa) | crear/editar grupo y opción, precio, reordenar, archivar (todas SERIALIZABLE) |
| `/catalogo/insumos-grupos` | Insumos y árbol de grupos | `grupos_familia` (empresa) | `crearInsumo` (`insumo_alta`), `renombrarOFusionarInsumo` (`insumo_renombrar_fusionar`), grupo del insumo y activar (`grupos_familia`), `crearOActualizarGrupo`, `actualizarActivoGrupo` (`grupos_familia`) |
| `/catalogo/categorias` | Rubro comercial | `categorias` | `crearCategoriaProducto` (`categoria_alta`), activar (`categorias`) |
| `/catalogo/unidades` | Unidades de medida | `unidades` | crear, decimales, activar (`unidades`) |
| `/catalogo/margen-objetivo` | Food cost objetivo de la empresa y por categoría | `margen_objetivo_editar` | `guardarMargenObjetivo` |
| `/catalogo/proveedores` (+ `/nuevo`, `/[id]`, `/[id]/editar`, `/comparativa`) | Lista, ficha («Lo que se le compra», con «Cómo lo llama»), edición y comparativa | `proveedores` (`comparar_precios` la comparativa) | alta (`proveedor_alta`), editar y activar (`proveedores`) |
| `/catalogo/clientes` | Clientes con % fijo | `clientes` | alta, editar, activar (`clientes`, auditadas) |

**Claves** (`src/core/permisos/acciones.ts`): todas las de arriba ya existen; los pisos de `guardar_receta`, `grupos_familia`, `categorias`, `unidades`, `margen_objetivo_editar`, `opciones_definir`, `proveedores`, `clientes` y `precio_local` son de administrador; `producto_ver_catalogo`, `insumo_alta`, `categoria_alta`, `proveedor_alta` y `producto_asignar_insumo` llegan al operario. Ningún rol sembrado tiene `precio_local` o `guardar_receta` sin `producto_ver_catalogo` (verificado en `rolesEditarSemilla`).

**Mecanismo del menú ya construido (reutilizable tal cual):** `ItemNav` con `accion` o `algunaDe`; `RUTAS_DE_UNA_ENTRADA` (rutas que se abren desde una entrada y la resaltan); `PestanasDeRuta`; la guarda `requierePermisoVerDeAlgunaDelMenu` (claves de los dos contextos); el filtro de pestañas en el servidor (`accionesDelMenuQueElUsuarioPuedeVer` + `puedeVerItem`); el aviso de solo lectura de Stock.

**Ver ≠ escribir hoy:** Biblioteca de opciones y la lista de Productos ya muestran el alta/edición solo con «Editar»; Proveedores (lista y ficha), Clientes, Insumos, Categorías, Unidades, Margen objetivo, Precio local y la lista de Recetas dibujan los formularios y botones a cualquiera que pueda VER (el servidor los rechaza igual con `conPermiso`/`conPermisoDeEmpresa`).

**Vínculo proveedor↔producto:** la tabla `ProveedorPorProducto` (unidad de compra, `referenciaProveedor` = cómo lo llama ese proveedor) se escribe SOLO al cargar una compra con proveedor (`registrarVinculoDeCompraEnTx`); precio y fecha se derivan del Kardex vigente (`cargarOfertasDeProveedores`). No hay búsqueda de producto por la referencia del proveedor (confirmado: `buscarProductosSelector` y la lista de Productos buscan por nombre y código). Existe el comando `asignarInsumoAProducto` (clave `producto_asignar_insumo`, sin transacción ni auditoría) que usa el asistente «hermanar» del formulario del producto.

**Specs e2e que tocan estas pantallas:** `accesibilidad`, `menu-paneles`, `menu-item-activo`, `movil-menu`, `movil-sin-desborde`, `movil-acciones-de-texto`, `movil-precio-local`, `catalogo-*` (20), `margen-objetivo`, `recetas-*`, `compras-nombre-de-factura-del-proveedor`, `resultado-de-accion-visible`, `refresco-sin-recargar`, `rutas-sin-parametros`, entre otros.

## 1. Propósito y alcance

- **Propósito:** que quien arma el catálogo encuentre en CINCO lugares lo que hoy está en diez: qué vendo y compro (Productos, con su precio local y sus recetas), las opciones reutilizables (Biblioteca de opciones), las tablas de base (Maestros), a quién le compro (Proveedores) y a quién le hago descuento (Clientes con descuento). — CONFIRMADA (DEC-13).
- **Dentro:** menú de 5 entradas y pestañas de ruta; ver ≠ escribir en las pantallas de escritura del módulo; vocabulario (Insumo, Producto, Presentación; sin siglas MP/PV ni «override» en los títulos); arreglos visuales a 375 y 1280 px; mejoras chicas de lectura sobre el vínculo proveedor↔producto (sección 9). — CONFIRMADA (pedido de la ola).
- **Fuera:** mudar URL; la lista nueva «Precios por sucursal» que compara las sucursales (P-2); dar de alta el vínculo proveedor↔producto sin compra (P-4); asignar productos a un Insumo desde Insumos (P-5); conteo por Insumo / `modoDeConteo` (otra etapa, decisión 2026-10-08). — PROPUESTA.

## 2. Actores y contexto

- Administrador (rol `admin`): ve y edita todo el catálogo. — CONFIRMADA (pisos).
- Operador: ve productos, da de alta productos, insumos, categorías y proveedores (`*_alta`), no administra Maestros ni Biblioteca. — CONFIRMADA.
- Encargado de la sucursal con `precio_local` delegado. — CONFIRMADA (ACCIONES).
- Roles que existen hoy en producción — VERIFICADO el 2026-10-28 contra producción (lectura): `admin` (ve el catálogo y tiene `precio_local` y `guardar_receta`), `operador` (ve el catálogo) y `mozo` (sin ninguna de las tres). NO existe hoy un rol con `precio_local` o `guardar_receta` sin `producto_ver_catalogo`, así que la pérdida de la entrada «Productos» para ese caso (P-1) es un límite conocido sin efecto actual.
- Un rol puede tener «Ver» sin «Editar» de una clave (DEC-33). — CONFIRMADA.
- Contexto: todo el catálogo es de la EMPRESA, salvo el precio local (de la sucursal ACTIVA). Aislamiento por RLS (`ctx.db` con la empresa y el alcance). — CONFIRMADA (código).

## 3. Casos de uso

| Id | Caso | Quién | Comando / lectura (existente salvo marca) |
|---|---|---|---|
| CU1 | Buscar un producto y abrir su espacio | `producto_ver_catalogo` | `listarProductosPagina` (+ NUEVO: también por cómo lo llama un proveedor, ver I9) |
| CU2 | Fijar el precio de venta propio de la sucursal | `precio_local` | `setPrecioLocalProducto`, `fijarPrecioLocalDeOpcion` |
| CU3 | Ver qué recetas están armadas y abrir una | `guardar_receta` | `listarProductosConReceta` |
| CU4 | Armar los grupos de opciones | `opciones_definir` | comandos de opciones de venta |
| CU5 | Administrar insumos y su árbol de grupos | `grupos_familia`, `insumo_alta`, `insumo_renombrar_fusionar` | comandos de insumos |
| CU6 | Administrar categorías, unidades y margen objetivo | `categorias`/`categoria_alta`, `unidades`, `margen_objetivo_editar` | comandos de cada maestro |
| CU7 | Ver un proveedor, lo que se le compra y cómo llama a cada producto | `proveedores` (precio: `comparar_precios`) | `obtenerFichaProveedor`, `listarProductosQueLeCompran` |
| CU8 | Alta, edición y activación de proveedores | `proveedor_alta`, `proveedores` | `altaProveedor`, `actualizarProveedor`, `actualizarActivaProveedor` |
| CU9 | Clientes con descuento | `clientes` | `altaCliente`, `actualizarCliente`, `actualizarActivoCliente` |
| CU10 | En una compra, encontrar el producto escribiendo lo que dice la factura | `proceso_compra` | `buscarProductosSelector` (NUEVO: también por la referencia del proveedor, ver I9) |

## 4. Conceptos y ciclo de vida

- **Producto** = lo que se compra, se cuenta y se vende (`Producto`, tipo materia prima o de venta). Activo ↔ inactivo; nunca se borra. — CONFIRMADA.
- **Insumo** = la agrupación de negocio de varios productos que son «lo mismo» aunque cada proveedor lo nombre distinto (`Insumo`; comparten unidad de stock). Activo ↔ inactivo; renombrar puede FUSIONAR (con confirmación y auditoría). — CONFIRMADA (código y aclaración del dueño 2026-10-27).
- **Presentación** = la unidad en que se compra un producto (unidad de compra y factor de conversión; presentaciones alternativas). No abre filas de conteo. — CONFIRMADA (código).
- **Cómo lo llama el proveedor** (`ProveedorPorProducto.referenciaProveedor`) = el nombre que ese proveedor pone en su factura para el producto; informativo, lo escribe la compra. — CONFIRMADA (esquema y E1).
- **Maestros** = tablas de base de la empresa: Insumos (con su árbol de grupos), Categorías, Unidades y Margen objetivo. Nunca se borran: se desactivan. — CONFIRMADA (DEC-13 / emulación).
- **Biblioteca de opciones** = el nombre de menú de «Opciones de venta» (grupos de tamaños, variantes, incluidas y adicionales reutilizables). — CONFIRMADA (DEC-13).

## 5. Invariantes y políticas

| Id | Regla | Estado |
|---|---|---|
| I1 | Menú = página: un ítem se ve solo si el rol puede abrir su página (misma clave o misma lista `algunaDe`). | CONFIRMADA (test `menu-con-permiso`) |
| I2 | Ver ≠ escribir con niveles de la MISMA clave: quien solo ve recibe la pantalla con el aviso «Solo lectura» y sin formularios ni botones de cambio; el servidor rechaza igual (`conPermiso*`). Sin claves nuevas. | CONFIRMADA (DEC-33) |
| I3 | Cada botón de escritura se muestra con el «Editar» de LA clave que exige su comando (p. ej. «Crear insumo» con `insumo_alta`, no con `grupos_familia`). | PROPUESTA (ingeniero; es lo que ya hace el servidor) |
| I4 | Las URL no cambian; las pantallas que dejan de ser ítem cuelgan de su entrada (`RUTAS_DE_UNA_ENTRADA`) con su clave de siempre. | PROPUESTA (igual que Movimientos y Stock) |
| I5 | La entrada «Productos» se ve con `producto_ver_catalogo` (la lista y el espacio del producto conservan su clave exacta para los enlaces); sus pestañas «Precio local» y «Recetas» se ven cada una con su clave. | PROPUESTA (ver P-1) |
| I6 | La entrada «Maestros» se ve con el «Ver» de ALGUNA de sus cuatro claves (todas de empresa); cada pestaña con la suya. | PROPUESTA (molde de Stock › Configuración) |
| I7 | Todo se lee y escribe en la empresa activa (y la sucursal activa para el precio local); otra empresa no ve ni escribe nada (RLS + chequeo del caso de uso). | CONFIRMADA |
| I8 | Lo que no está cargado se muestra «Sin cargar» / «pendiente de completar», nunca inventado. | CONFIRMADA (regla del dueño) |
| I9 | Buscar por cómo lo llama un proveedor solo lo puede quien ya ve ese dato en otra pantalla: el «Ver» de `proveedores` (ficha del proveedor) o de `proceso_compra` (la compra lo precarga). Sin ese «Ver», la búsqueda sigue siendo por nombre y código: un filtro por algo que no se ve revelaría justo eso. | PROPUESTA (ingeniero; misma regla que los filtros «le falta» de Productos) |

## 6. Historia y persistencia

**Sin tablas, columnas ni claves nuevas.** La búsqueda por referencia lee `ProveedorPorProducto.referenciaProveedor` (ya existe; RLS por empresa). Ningún comando de escritura cambia; las pantallas solo dejan de ofrecer lo que el rol no puede hacer. El historial de los comandos sigue como está (`@ficha` de cada caso de uso: auditoría en `RegistroAuditoria` para fusión de insumos, decimales de unidad, clientes, margen, precio local, recetas y opciones; el resto, solo la fila).

## 7. Atomicidad y concurrencia

Esta ola no agrega escrituras. Las existentes conservan su control (tabla de la sección 10). La búsqueda nueva es una lectura de una sola consulta (`EXISTS` sobre `ProveedorPorProducto` dentro del mismo `findMany`): no hay estado intermedio.

## 8. Acceso e interfaces

- **Menú (DEC-13):** grupo Catálogo con cinco ítems, en este orden:
  1. «Productos» → `/catalogo/productos`, `accion: "producto_ver_catalogo"`, panel «ambos». Pestañas: Productos · Precio local (`/movimientos/precio-local`, `precio_local`, Sucursal) · Recetas (`/catalogo/recetas`, `guardar_receta`, Empresa). El editor de receta (`/catalogo/recetas/[id]`) y el historial cuelgan de la pestaña Recetas y resaltan «Productos».
  2. «Biblioteca de opciones» → `/catalogo/opciones`, `opciones_definir`, Empresa.
  3. «Maestros» → `/catalogo/insumos-grupos` (pestaña «Insumos»), `algunaDe: [grupos_familia, categorias, unidades, margen_objetivo_editar]`, Empresa. Pestañas: Insumos · Categorías · Unidades · Margen objetivo.
  4. «Proveedores» → `/catalogo/proveedores`, `proveedores`, Empresa (la comparativa sigue fuera del menú con `comparar_precios`).
  5. «Clientes con descuento» → `/catalogo/clientes`, `clientes`, Empresa.
- **Fuente única:** `src/core/catalogo/ui-config.ts` (puro): el grupo del menú, las dos filas de pestañas y las rutas que cuelgan de cada entrada; `estructura.ts` las toma de ahí (como `core/stock/ui-config.ts`).
- **Guarda de la entrada Maestros:** `/catalogo/insumos-grupos` pasa a `requierePermisoVerDeAlgunaDelMenu(…, ["grupos_familia", "categorias", "unidades", "margen_objetivo_editar"], …)`; la tabla de insumos se dibuja solo con el «Ver» de `grupos_familia` (sin él: la fila de pestañas y «Elegí arriba qué maestro»). Las otras pestañas siguen con su guarda de siempre.
- **Pestañas:** `PestanasDeRuta` filtradas en el servidor (componente `FilaDeCatalogo`): una pestaña que el rol no puede abrir no se dibuja.
- **Ver ≠ escribir (I2, I3):** aviso «Solo lectura: tu rol puede ver … pero no hacer cambios» arriba de cada pantalla de escritura del módulo, y los formularios y botones de cambio se dibujan solo con el «Editar» de la clave de su comando. En las tablas con formularios por fila (insumos, unidades, margen por categoría, clientes) quien solo ve lee los valores como texto.

## 9. Consultas y experiencia

- **Vocabulario:** «Insumos» (no «Insumos / Grupos»); «Biblioteca de opciones» (antes «Opciones de venta»); títulos sin siglas ni anglicismos: «Categorías» (con una línea que dice que es el rubro comercial de cada producto, de compra o de venta), «Precio local en «{sucursal}»» (no «override»), Recetas sin «(PV)». Las claves, las tablas y las descripciones de `ACCIONES` (viven en la base) no cambian.
- **Mejoras chicas elegidas (regla «primero lo más barato»):**
  - **M1 — «Cómo lo llama» más destacado** en la ficha del proveedor: la columna pasa a ser la primera de «Lo que se le compra», con el título «En su factura dice», y lo que no está cargado dice «Sin cargar» (se completa en la próxima compra). Solo pantalla. — CONFIRMADA (el dueño las ratificó el 2026-10-28: «M1 y M2 son chicos»).
  - **M2 — Buscar el producto por cómo lo llama un proveedor**, en la lista de Productos y en el buscador de producto de la compra (y de toda pantalla que usa el selector), con la regla I9. Solo lectura. — CONFIRMADA (el dueño las ratificó el 2026-10-28: «M1 y M2 son chicos»).
  - M3 (alta del vínculo sin compra) y M4 (asignar productos a un Insumo desde Insumos): PENDIENTES (P-4, P-5).
- **375 px:** las tablas anchas (insumos, unidades, proveedores, clientes, margen) se desplazan dentro de su caja; la fila de pestañas se envuelve completa; nada empuja la página a scroll lateral.

## 10. Tabla «¿qué pasa si…?» por comando de escritura del módulo (auditada contra la `@ficha` de cada caso de uso; esta ola no cambia ninguno)

| Comando | Repetición (doble clic) | Concurrencia | Tiempo / incertidumbre | Reintento | Error parcial | Datos faltantes | Cambio de permisos | Otra empresa |
|---|---|---|---|---|---|---|---|---|
| Alta de producto (`alta_producto`) | Por estado (código/nombre) | Sin transacción; choque de código → reintento | — | Igual | Una escritura | Validación del guard | `conPermisoDeEmpresa` en cada pedido | RLS |
| Editar producto (`producto_editar`) | Optimista (versión vista) | SERIALIZABLE: gana uno, el otro «cambió» | — | Igual | Una transacción con auditoría | Guard | Igual | RLS |
| Precio local (`precio_local`) | Optimista (valor visto) | SERIALIZABLE | — | Igual | Una transacción con auditoría | Guard (notación argentina) | `conPermiso` (sucursal) | RLS + sucursal |
| Receta (`guardar_receta`) | Optimista | SERIALIZABLE | — | Igual | Una transacción | Guard | Igual | RLS |
| Opciones (crear/editar/precio/archivar) | Por estado / optimista | SERIALIZABLE | — | Igual | Una transacción con auditoría | Guard | Igual | RLS |
| Crear insumo / categoría / unidad | Por estado: el 2.º reusa el existente (mismo nombre sin distinguir mayúsculas) | Dos altas a la vez del mismo nombre: sin índice único por nombre, pueden quedar dos (brecha anotada en P-6) | — | Igual | Una escritura | Nombre vacío → validación | `conPermisoDeEmpresa` | RLS |
| Renombrar o fusionar insumo | Por estado | Transacción simple con auditoría | — | Igual | Fusión todo o nada | Confirmación explícita para fusionar | Igual | RLS |
| Grupo de insumo / activar insumo, grupo, categoría, unidad, proveedor | Escribe el valor pedido | Último gana | — | Igual | Una escritura | Id inexistente → «No se encontró» | Igual | RLS |
| Decimales de unidad | Escribe el valor pedido | Último gana; auditado | — | Igual | Transacción simple | Validación 0 a 6 | Igual | RLS |
| Margen objetivo | Por estado | Último gana; auditado | — | Igual | Transacción simple | Vacío = volver al que corresponde | Igual | RLS |
| Alta de proveedor | Por estado (nombre, CUIT) | Choque de CUIT o código → índice único y mensaje | — | Igual | Sin transacción a propósito (reintento del código) | Guard | Igual | RLS |
| Editar proveedor | Escribe el valor pedido | Último gana; CUIT repetido → índice único | — | Igual | Una escritura | Guard | Igual | RLS |
| Clientes (alta, editar, activar) | Alta por estado; resto escribe el valor | Último gana; auditado | — | Igual | Transacción simple | Guard (0 ≤ % < 100) | Igual | RLS |

## 11. Decisiones PENDIENTES para el dueño (no se inventan; se avanza con lo no bloqueado)

- **P-1 (menú):** la emulación muestra «Productos» a quien ve ALGUNA de sus pestañas. Se dejó con la clave de la lista (`producto_ver_catalogo`) para no perder la precisión de los enlaces al espacio del producto (con una lista, cada enlace a un producto se mostraría aunque el rol no pueda abrirlo). Hoy ningún rol sembrado tiene «Precio local» o «Recetas» sin ver productos; un rol armado a mano así encuentra esas pantallas por el buscador del menú de celular. Recomendación: dejarlo así; si aparece ese rol, se pasa a `algunaDe` con las rutas hijas declaradas. PROPUESTA.
- **P-2 (Precios por sucursal):** la decisión del 2026-10-20 pide una lista «Precios por sucursal» para comparar todas las sucursales (de solo lectura salvo la activa). Hoy la pestaña es la pantalla de siempre, el precio de la sucursal ACTIVA, rotulada «Precio local». Recomendación: hacer la comparación como etapa propia (una lectura nueva por sucursal visible, sin migración). PENDIENTE.
- **P-3 (Recetas):** la emulación saca la lista de recetas del menú (la receta vive en el paso 3 del producto). Se dejó como pestaña de Productos porque es el único lugar que lista las recetas armadas y abre «Nueva receta» para una materia prima que se produce. Recomendación: mantenerla hasta que el espacio del producto tenga ese listado. PROPUESTA.
- **P-4 (vínculo proveedor↔producto sin compra, M3):** hoy el vínculo y «cómo lo llama» solo se escriben al cargar una compra. Darlo de alta a mano es un comando nuevo sobre una tabla que guarda precio (aunque el precio se deriva del Kardex) y exige elegir su clave (¿`proveedores` o `producto_editar`?). Recomendación: la opción más barata ya existe (la primera compra lo crea y la siguiente lo precarga); si se quiere cargar antes, un comando «Cómo lo llama este proveedor» con la clave `proveedores`, que escriba SOLO la referencia y la unidad (nunca precio), con su tabla «¿qué pasa si…?». PENDIENTE.
- **P-5 (asignar productos a un Insumo desde Insumos, M4):** el comando existe (`asignarInsumoAProducto`, clave `producto_asignar_insumo`, descripta como «asistente de hermanar»), pero sin transacción: dos asignaciones simultáneas de productos con distinta unidad al mismo Insumo pasan las dos el chequeo de unidad. Recomendación: primero endurecer ese comando (SERIALIZABLE + auditoría, sin migración) y después ofrecerlo en Maestros › Insumos con la misma clave. PENDIENTE (toca permisos: confirmar que la clave del asistente vale también para esta pantalla).
- **P-6 (concurrencia):** crear insumo, categoría o unidad con el mismo nombre a la vez puede dejar dos filas (no hay índice único por nombre). Recomendación: índice único por (empresa, nombre normalizado) en la próxima migración autorizada, previo diagnóstico de duplicados. PENDIENTE (migración).
- **P-7 (datos):** las descripciones de `ACCIONES` («Administrar los Grupos de insumos…», «Fijar Precio Local por sucursal») viven en la base: cambiarlas es una migración de datos. Recomendación: junto con la próxima migración autorizada. PENDIENTE.
- **P-8 (URL):** mudar `/movimientos/precio-local` a `/catalogo/…` con 307. Recomendación: no por ahora (igual que Movimientos y Stock). PROPUESTA.
- **P-9 (vocabulario de mensajes compartidos):** los rechazos del servidor «armala en Catálogo → Recetas…» (`core/movimientos/origen-de-stock.ts`, `core/pos/componente-de-combo.ts`, `server/consultas/catalogo/espacio-del-producto.ts`) siguen nombrando el camino viejo; desde DEC-13 es «Catálogo → Productos → Recetas» (la pestaña se sigue llamando «Recetas» y el buscador del menú la encuentra). Fijan caracterizaciones congeladas de la venta y del POS. Recomendación: pasarlos en un paso propio con su regeneración declarada, junto con P-2b de Stock. PROPUESTA.
- **P-10 (rótulo del campo en la compra):** la compra (módulo Movimientos) rotula el dato «Código/nombre del proveedor» y la ficha del proveedor «Cómo lo llama (en su factura)». Recomendación: unificar a «Cómo lo llama (en su factura)» en el paso de Movimientos, y destacarlo al cargar la compra (la idea del dueño del 2026-10-27). PROPUESTA.

## 12. Escalera de producto (lo que ve el cliente), N0 a N5

| Nivel | Productos | Maestros / Biblioteca | Proveedores |
|---|---|---|---|
| N0 | Diez pantallas sueltas (hoy) | Cada maestro suelto (hoy) | Lista y ficha (hoy) |
| N1 (esta ola) | Una entrada con pestañas Productos · Precio local · Recetas; se encuentra un producto por cómo lo llama su proveedor | Una entrada «Maestros» con pestañas; «Biblioteca de opciones»; quien solo ve, ve sin poder tocar | «En su factura dice» destacado; quien solo ve no recibe «Editar»/«Desactivar» |
| N2 | «Precios por sucursal» para comparar (P-2) | Asignar productos al Insumo desde Insumos (P-5) | Cargar «cómo lo llama» sin compra (P-4) |
| N3 | Pendientes del catálogo en el inicio | `modoDeConteo` del Insumo (decisión 2026-10-08) | Precio esperado por proveedor y aviso de desvío |
| N4 | Catálogo compartido entre empresas del grupo | Maestros importables desde planilla | Lista de precios del proveedor |
| N5 | Sugerencia de producto por la factura escaneada | — | Pedido sugerido al proveedor |

Lo que falta en un nivel se muestra «Sin cargar» / «pendiente de completar», nunca un valor inventado. La escalera de diseño y la de producto se cruzan en el nivel 5 (I2, I9).

## 13. Pruebas, migración y operación

- **Migración:** ninguna. Despliegue: solo código; reversible con `git revert`.
- **Unitarias/integración:** configuración del menú (5 entradas, pestañas, rutas de cada entrada, resaltado, panel, buscador, cambio de sucursal); guarda de Maestros; búsqueda por referencia con base real: con permiso la encuentra, sin el «Ver» de `proveedores` ni de `proceso_compra` no, la referencia de otra empresa no aparece, comodines `%`/`_` literales; con mutación (mutar ⇒ rojo ⇒ revertir ⇒ verde).
- **Arquitectura:** `menu-con-permiso`, `enlaces-con-permiso`, golden de visibilidad (`GOLDEN_ACTUALIZAR=1 npx vitest run test/modulos`, diff revisado en el commit).
- **e2e (Playwright):** el menú de Catálogo con sus 5 entradas; Maestros con sus pestañas; Productos con la pestaña Precio local; un rol que solo ve (aviso, sin formularios); búsqueda por «cómo lo llama»; axe (`@axe-core/playwright`) en las pantallas nuevas; 375 px sin desborde.
- **Capturas** a 375 y 1280 px para la aprobación del dueño (fuera del repositorio).

## 14. Pasos (un commit cada uno)

1. Este documento.
2. Fuente del módulo (`core/catalogo/ui-config.ts`) y menú de cinco entradas con sus rutas; tests del menú, golden regenerado.
3. Filas de pestañas en Productos, Precio local, Recetas y Maestros; guarda «alguna de» en la entrada Maestros.
4. Ver ≠ escribir en Maestros (insumos, categorías, unidades, margen), Proveedores, Clientes, Precio local y Recetas.
5. Vocabulario.
6. Arreglos a 375 px.
7. M2: búsqueda por cómo lo llama el proveedor (lista de Productos y selector), con sus pruebas de permiso, empresa y mutación.
8. M1: «En su factura dice» destacado en la ficha del proveedor.
9. e2e del flujo principal, accesibilidad y capturas.
10. Cierre: los 8 comandos del gate.

## 15. Estado de la implementación (2026-10-28, carril `alegp/carril-cat`)

- Hechos, sin migración: pasos 1 a 9 de la sección 14 (diseño; menú de cinco entradas con `core/catalogo/ui-config.ts`; pestañas de Productos y Maestros con `FilaDeCatalogo`; guarda «alguna de» en la entrada Maestros con la guarda propia de la tabla de insumos adentro; ver ≠ escribir en Maestros, Proveedores, Clientes, Precio local y Recetas; vocabulario; tablas en `CajaDesplazable` a 375 px; M2 búsqueda por cómo lo llama el proveedor; M1 «Cómo lo llama (en su factura)» destacado; e2e `catalogo-menu-y-pestanas.spec.ts`).
- Regeneraciones declaradas: golden de visibilidad del menú (`GOLDEN_ACTUALIZAR=1`) y `linea-de-base-precio-y-carta.golden.txt` (4 líneas: «Biblioteca de opciones»), con su entrada en `caracterizaciones-congeladas.test.ts`.
- Decisión de ingeniería tomada al implementar (PROPUESTA): una fila de pestañas con una sola pestaña visible, que es la pantalla abierta, no se dibuja.
