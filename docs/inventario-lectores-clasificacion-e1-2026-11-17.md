# Inventario de lectores y guardianes de `CategoriaProducto` para la etapa E1 (el árbol) — 2026-11-17

Frente 2 · Para el turno de schema de E1 (`docs/diseno-clasificacion-comercial-igual-a-pedernal-2026-11-13.md`, `docs/diseno-unidades-y-clasificacion-paridad-pedernal-2026-11-16.md`). **Solo inventario: ninguna tabla, migración ni código.** Hecho sobre `main` del 2026-11-17 con un agente de exploración (lectura de `src/`, `test/`, `prisma/`, `scripts/`); lo que no se leyó de verdad está marcado **NO VERIFICADO**. Las tres afirmaciones de §0 las verifiqué yo en el código y en el diseño.

## 0. Lo que cambia el pedido de schema (leer primero)

| # | Hallazgo | Evidencia | Consecuencia |
|---|---|---|---|
| H1 | **`nombreClave` NOT NULL rompe unas 45 creaciones directas** de `CategoriaProducto` (~30 tests, ~12 specs e2e, un INSERT crudo) y la única escritura de producción (`src/server/persistencia/catalogo/categorias-producto.ts:13`, que crea solo con `nombre`) | Fixtures centrales: `test/setup/test-db.ts:314` (`sembrarCatalogoBase`), `test/aislamiento/denegacion/mundo.ts:245`, `test/reportes/caracterizacion/escenario-reportes.ts:159-161`, `test/caracterizacion-tramo-a/lecturas-tramo-a.test.ts:182`, `test/operaciones/informes-de-paridad-con-base.test.ts:189,199` | Fijar en el turno de schema: o los fixtures pasan por una función única que calcula la clave, o la base la llena con un disparador. Sin eso rompe en `tsc` y en ejecución |
| H2 | **La garantía de backfill del diseño («no rompe datos existentes: ya eran únicos en toda la empresa») no es cierta en general.** El diseño (E1, fila 5 y §7.1) dice que la unicidad actual alcanza. Hoy la unicidad es por `lower(nombre)` (índice `CategoriaProducto_nombre_lower_key`, `…multiempresa_estructura/migration.sql:287`), que **no pliega tildes**; la clave nueva sí (`claveDeNombreDeCarta`, `src/core/carta/nombre-en-carta.ts:7`: NFD, sin marcas, minúsculas, espacios colapsados) | «Café» y «Cafe» conviven hoy en una empresa y **chocarían** en el único nuevo `(empresaId, padreId, nombreClave)` | La migración necesita su `verificacion-previa.sql` que **cuente colisiones por clave en cada base** y aborte (no resuelva en silencio) si hay alguna. El caso conocido (2 categorías planas sin productos) sale del diseño: NO VERIFICADO |
| H3 | **«Sin DELETE ni TRUNCATE, ni para el dueño» (diseño §7.1, fila 10) rompe la limpieza de los tests**, no solo un privilegio | `test/setup/test-db.ts:246` (`limpiarBaseDeTest`: `prismaAdmin.categoriaProducto.deleteMany()`); casi todos los specs e2e hacen `prisma.categoriaProducto.deleteMany` en su cleanup con el rol `motor2_app` (hoy con DELETE): `movil-categorias.spec.ts:21`, `margen-objetivo.spec.ts:67`, `carta-admin.spec.ts:125`, `carta-items-agrupados.spec.ts:108`, `catalogo-sincronizar-precio-grupo.spec.ts:62`, `accesibilidad.spec.ts:119,147,1060,1111,1153`, `form-con-resultado-en-curso.spec.ts:61,89`, `resultado-de-accion-visible.spec.ts:173`; `test/permisos/migracion-margen-objetivo.test.ts:52`. Precedente de tabla «solo se agrega» en los tests: `test-db.ts:254-255` usa TRUNCATE para `Plan*` | Decidir con el orquestador: la regla de Pedernal contra la política de limpieza de tests (p. ej. disparador que permite borrar solo en bases de prueba, o `REVOKE` solo a `motor2_app` y dejar al dueño). **No** es solo un `REVOKE` |
| H4 | `columnas-de-significado` y `duplicar-producto-columnas` **no exigen nada** para `CategoriaProducto` (la tabla está fuera de `MODELOS_EN_ALCANCE`: «diccionarios sin efecto propio», `test/arquitectura/guardas/columnas-de-significado.ts:31`) | — | El guardián que sí falla es `test/arquitectura/clasificacion-comercial-dimensiones.test.ts` (§3) |
| H5 | **Los reportes agrupan por el TEXTO del nombre**: con nombre único por padre, dos categorías homónimas bajo distintos departamentos se fusionarían en una fila | `src/core/reportes/periodo-categorias.ts:27-36,43`, `src/server/consultas/reportes/periodo.ts:267`, `src/server/consultas/carta/ventas-por-seccion.ts:150`, `src/core/carta/reporte-secciones.ts` | Decisión de negocio (qué ve el dueño): §5, pregunta 4 |

## 1. Esquema, única y migraciones

| Qué | Dónde | Hoy | Con árbol |
|---|---|---|---|
| Modelo | `prisma/schema.prisma:622-634` (comentario «Sin jerarquía») | `id`, `empresaId` (default `app_empresa_actual()`), `empresa`, `nombre`, `activo`, `productos`, `margenesObjetivo`; únicos `[empresaId,nombre]` y `[empresaId,id]` | Autorreferencia `@relation(fields:[empresaId,padreId], references:[empresaId,id])` con `padre`/`hijos`; precedente `Grupo.grupoPadre` (`schema.prisma:608-610`). `padreId` e `id` siguen TEXT |
| Única `(empresaId,nombre)` | `…multiempresa_estructura/migration.sql:221` | único por empresa | Se **reemplaza** por `(empresaId,padreId,nombreClave)` NULLS NOT DISTINCT (a mano; Prisma no lo declara) y se saca `@@unique([empresaId, nombre])`. PG ≥ 15: NO VERIFICADO en Neon |
| Índice `lower(nombre)` | misma migración, línea 287 | impide «Pepe»/«pepe» en la empresa; es la red contra la carrera de nombres | Quitarlo o cambiarlo |
| `[empresaId,id]` | línea 222 | destino de todas las FK compuestas | Se queda (destino de la autorreferencia) |
| FK entrantes | `Producto_empresaId_categoriaId_fkey` (RESTRICT, línea 463), `MargenObjetivo_empresaId_categoriaId_fkey` (`20261001220000_margen_objetivo`:29) | — | Igual |
| RLS | `20260929120000_multiempresa_rls/migration.sql:19-20` | `ENABLE RLS` (sin FORCE) y política `aislamiento_empresa` FOR ALL | Sigue valiendo; empresa-nivel, sin política de sucursal |
| Privilegios `motor2_app` | `scripts/operaciones/crear-rol-motor2-app.sql:100,116,203,217` | `SELECT, INSERT, UPDATE, DELETE ON ALL TABLES` y default privileges; sin TRUNCATE; sin GRANT/REVOKE propio de la tabla | Quitar DELETE exige `REVOKE` en la migración (molde: `20261115120000_ocultamiento_de_producto/migration.sql:74-76`); ver H3. **Privilegios reales en una base viva: NO VERIFICADO** |
| `motor2_plataforma` | `crear-rol-motor2-plataforma.sql:68-97` | ningún GRANT sobre la tabla | Igual; `plataforma/` no la usa |
| Molde de tabla nueva | guardián `datos-molde-de-tabla-nueva` (solo mira `CREATE TABLE` desde `20261115000000`) | — | Un `ALTER TABLE ADD COLUMN` no lo dispara |

## 2. Lectores y escritores (`src/`, `scripts/`)

Efecto del árbol: **ROMPE** (cambia lo que dice o hace), **ADAPTA** (hay que tocarlo), **IGUAL**.

| Archivo:línea | Qué hace con la categoría | Efecto |
|---|---|---|
| `src/server/persistencia/catalogo/categorias-producto.ts:13` | única escritura de alta: `create({ data:{ nombre } })`, sin `padreId`, `nombreClave` ni auditoría | ADAPTA: recibir padre y clave; transacción con candado por empresa |
| `…/categorias-producto.ts:24` | `updateMany({where:{id}, data:{activo}})`; `count` decide «No se encontró la categoría.» | ADAPTA: desactivar se rechaza con hijos activos; reactivar con padre desactivado |
| `src/server/actions/catalogo/casos-de-uso/crear-categoria-producto.ts:28-32` | `findFirst({ nombre equals, mode:"insensitive" })`: si existe la **reusa** («Ya existía la categoría "X" — se reusa.»); sin transacción | **ROMPE** la semántica: la búsqueda es global por empresa; con árbol «Bebidas» puede existir bajo dos padres. Hay que buscar por (padre, clave). Lo fija `test/catalogo/caracterizacion/catalogo-sin-test-unitario.test.ts:52` |
| `…/actualizar-activa-categoria-producto.ts:29` | llama `fijarActivaDeCategoria` | ADAPTA (reglas de desactivar y reactivar) |
| `src/server/actions/catalogo/categorias-producto.ts:20-22,35-56` | `listarCategoriasProducto` (`findMany` sin `select`, por nombre), `crearCategoriaProducto` (`categoria_alta`), `actualizarActivaCategoriaProducto` (`categorias`) | ADAPTA: la lista plana pierde sentido; mover/renombrar/crear bajo padre son acciones nuevas con guard y permiso |
| `src/core/features/catalogo/categorias-producto.guard.ts:18-22`, `.schema.ts` | nombre 1 a 80 con lista de permitidos | guard IGUAL; schema ADAPTA (motivos nuevos: `PADRE_INEXISTENTE`, `TOPE_DE_NIVELES`, `NOMBRE_REPETIDO_ENTRE_HERMANOS`) |
| `src/core/catalogo/clasificacion-comercial.ts` | núcleo puro ya escrito (nivel, camino, `puedeCrearBajo`, `puedeMover`; tope 4), «todavía no conectado» | Es el lector que falta cablear |
| `src/app/(app)/catalogo/categorias/page.tsx:29-95` | lista plana, Activar/Desactivar, alta con un campo | ADAPTA: la pantalla que el diseño reemplaza por árbol (baseline `pantallas-con-estructura.json:61-63`) |
| `src/app/(app)/catalogo/productos/producto-form.tsx:108,114,163,231-251`, `opciones-formulario.ts:3,13`, `datos-de-edicion.ts:40-70`, `nuevo/page.tsx:25,42` | `<select>` plano de nombres + QuickCrear de un campo | ADAPTA: nombres ambiguos; falta camino; el QuickCrear no elige padre |
| `src/app/(app)/catalogo/productos/[id]/page.tsx:158`, `src/server/consultas/catalogo/productos.ts:36` | ficha: `p.categoria?.nombre`; `include:{categoria:true}` | ADAPTA (solo la hoja) / IGUAL |
| `datos-de-producto.ts:86`, `productos.schema.ts:23`, `persistencia/catalogo/productos.ts:23`, `actions/catalogo/productos.ts:297`, `completar-edicion-de-producto.ts`, `referencias-de-producto.ts:10`, `errores-de-base.ts:62-85`, `actualizar-producto.ts:86`, `dar-de-alta-producto.ts:131` | `categoriaId` del Producto y sus errores de FK | IGUAL (la FK compuesta sigue) |
| `duplicar-producto.ts` (`casos-de-uso:190`, `persistencia:21,65,90`, `core:30`) | copia `categoriaId` (`SE_COPIA`) | IGUAL en E1; no valida que el nodo esté activo (mirar en E2) |
| `guardar-margen-objetivo.ts:35-60`, `margen-objetivo*.ts` (acciones, guard, schema, persistencia, consulta), `src/core/reportes/margen-objetivo.ts:24-26` | objetivo por categoría; `resolverObjetivoFoodCost` busca solo el **id exacto**; texto «la categoría «nombre»» | IGUAL (por id) / texto ambiguo con homónimos. Pregunta de negocio: ¿un departamento hereda a sus hijos? Hoy «el departamento no hereda nada» |
| `src/server/consultas/catalogo/categorias.ts:12`, `margen-objetivo/page.tsx:79-120` | `listarCategoriasActivas` por nombre; tabla una fila por categoría | ADAPTA: sin camino, nombres ambiguos |
| `src/core/reportes/comun.ts:26-106`, `src/server/lecturas/reportes/comun.ts:27` | `categoriaNombre` y `categoriaId` por producto | ADAPTA (solo el nombre de la hoja) / IGUAL |
| `src/core/reportes/periodo-categorias.ts:27-43`, `periodo.ts:267`, `ventas-por-seccion.ts:150`, `reporte-secciones.ts` | **agrupan ventas por el TEXTO del nombre** | **ROMPE** (H5) |
| `reportes/categorias/page.tsx:37-41`, `ventas-por-seccion/tabla-seccion.tsx`, `page.tsx:46` | `key` y nombre de archivo exportado por nombre | ROMPE/ADAPTA: colisión de keys con homónimos |
| `reportes/periodo/tabla-periodo.tsx:136,207` | columna «Categoría» = `f.grupo` | IGUAL: es el `Grupo` de insumos, otro árbol |
| `src/server/lecturas/carta/menu.ts:66,163`, `armar-menu.ts:157-158,396`, `carta-publica.ts:26,124` | la carta lee `categoria:{select:{nombre}}` (solo informativo) | ADAPTA/IGUAL: el cliente vería solo el nombre del nodo |
| `carta/combos.ts:38,83`, `admin-tipos.ts:298-299`, `armar-lugar-de-lista.ts:90-96`, `agregar-entrada-de-lugar.tsx:109-192` | atajo «tildar todos los de la categoría»: agrupa por `categoria.id`, rotula con el nombre | ADAPTA (solo rótulos) |
| `src/core/permisos/acciones.ts:63,65,167,234`, `auditoria.ts:54` | permisos `categorias`, `margen_objetivo_editar`, `reporte_categorias`, `categoria_alta`; `CategoriaProducto` **no** está en `ENTIDADES_AUDITABLES` | ADAPTA si hay claves nuevas; el diseño propone auditar |
| `src/core/features/empresa/siembra-de-empresa.ts`, `prisma/seed.ts` | no siembran categorías | IGUAL |
| `scripts/seed-demo-pizzeria.ts:163-295`, `seed-demo-pizzeria-6-meses.ts:110-217` | `Map<nombre,id>` y `crearCategoriaProducto(nombre)` por cada una que falta | IGUAL si siguen en nivel 1; dependen de «reusar por nombre» |

Dependencias de la única `(empresaId, nombre)` y de «ya existe»: ningún `upsert` ni `where: { empresaId_nombre }` sobre esta tabla; **nadie captura `P2002`**; la unicidad la garantizan hoy la búsqueda `insensitive` más el índice `lower(nombre)`; el único «ya existe» es el mensaje de reuso; **renombrar no existe hoy**; ningún test cita los nombres de los índices (a diferencia de Cliente, SeccionCarta, GrupoDeOpciones y PlanDeCostos). Importadores/exportadores de categorías: ninguno en `src/` (los reportes exportan «Categoría» como texto y lo usan en nombres de archivo); paridad con un importador de productos de producción: NO VERIFICADO.

## 3. Guardianes, oráculos y pruebas que E1 toca

| Test | Qué fija | ¿Obliga a declarar algo? |
|---|---|---|
| `test/arquitectura/clasificacion-comercial-dimensiones.test.ts:61-101` (`COLUMNAS_DE_CATEGORIA`) | compara el modelo contra la lista, en ambas direcciones, cada una con motivo | **SÍ, es el que falla**: sumar `padreId`, `nombreClave`, `version`, `creadoEn`, `actualizadoEn` y los campos de relación (`padre`, `hijos`) |
| `test/persistencia/multiempresa-estructura.test.ts:~95-130` | las FK de la base contra las del esquema; toda FK entre tablas por empresa es compuesta con `empresaId` | La FK de `padreId` debe ser `(empresaId,padreId)` y declararse en los dos lados |
| `test/aislamiento/denegacion/mundo.ts:245-318`, `argumentos.ts:79`, `generadores.ts` | matriz de denegación entre empresas | Rompe por H1; las acciones nuevas necesitan su inventario |
| `test/core/errores-de-base.test.ts:109-128`, `test/casos-de-uso/referencias-de-otra-empresa.test.ts:53,64` | FK y mensaje «No se encontró la categoría elegida.» | IGUAL (crean con `nombre` solo: rompen por H1) |
| `test/catalogo/caracterizacion/catalogo-sin-test-unitario.test.ts:41-64` | caracteriza crear, «se reusa», activar y desactivar | Fija la semántica de reuso (:52); cambiarla exige redeclarar |
| `test/arquitectura/carta-publica-lista-cerrada.test.ts:38,53` | la carta pública lee `CategoriaProducto: ["nombre"]` | Solo si la carta pasa a leer padre o camino |
| `test/arquitectura/sin-filas-enteras.test.ts:90` | `listarCategoriasProducto` sin `select` | Mover o quitar si la lista se reescribe |
| `tramo-c-envoltorio-y-clave.test.ts:60-62,185`, `acciones-migradas-con-guard.test.ts:77`, `consumidores-de-lecturas-declarados.test.ts:189-192` | declaraciones de acciones, guard y consumidores | Acciones nuevas se declaran ahí; la exención de `actualizarActivaCategoriaProducto` cae si recibe más que id y booleano |
| `auditoria-por-columna`, `escrituras-auditadas`, `server-auditoria`, `escrituras-solo-en-persistencia`, `ficha-de-caso-de-uso`, `catalogo-de-textos` | auditoría, persistencia, ficha `@contract`, catálogo de textos | Se activan al agregar acciones y mensajes |
| `test/permisos/*` y `matriz-de-acceso.txt` | claves y matriz congelada | Solo si E1 agrega claves; la matriz exige regeneración declarada |
| `test/activar-id-inexistente.test.ts`, `tramo-c-rechaza-sin-permiso.test.ts` | fotos completas de la fila antes y después | IGUAL mientras un no-op no toque `actualizadoEn` o `version` |
| goldens `lecturas-tramo-a`, `reportes-c0`, `dinero-tramo-c` | muestran `categoriaId`/`categoriaNombre`, nunca la fila de la tabla | No fallan por columnas nuevas; sí si cambia el agrupado por nombre (H5) |
| `test/arquitectura/guardas/columnas-de-significado.ts:31`, `duplicar-producto-columnas.test.ts` | — | **No** obligan (H4) |
| Tests de migración subir/bajar/subir | ninguno cubre `CategoriaProducto` | **E1 necesita el suyo** (ida, `down.sql`, ida) |

`lectores-de-*` y los `cerco-*` no nombran `CategoriaProducto`; los cercos genéricos por esquema (`cerco-dueno-unico-por-modelo`, `alcance-de-sucursal`, `semantica-sin-fila`) no se abrieron: **NO VERIFICADO** su comportamiento ante columnas nuevas.

## 4. Lo que queda IGUAL

FK de `Producto` y `MargenObjetivo` y su manejo de errores; el permiso de ver y las claves actuales; `Producto.categoriaId` en duplicar; los reportes de la carta que agrupan por `categoria.id`; los goldens; `plataforma/`.

## 5. Decisiones para el turno de schema

Técnicas (las resuelve el ingeniero, declarándolo en el PR de E1):

| # | Decisión | Recomendada |
|---|---|---|
| 1 | `nombreClave` NOT NULL: ¿valor por defecto, disparador o fixtures? (H1) | La clave la calcula **una sola función** de producción y los fixtures pasan por un ayudante (mecánico, ~45 sitios); la base la exige NOT NULL con CHECK de largo 1 a 240 como en Pedernal |
| 2 | Backfill con el mismo pliegue que `claveDeNombreDeCarta` (H2) | Sí, con `verificacion-previa.sql` que cuente colisiones por empresa y **aborte** si hay alguna |
| 3 | `CategoriaProducto` dentro de `MODELOS_EN_ALCANCE` de columnas de significado | Sí, apenas `activo` y `padreId` decidan visibilidad (E2/E3); en E1 no hace falta |
| 6 | Auditar categorías (`ENTIDADES_AUDITABLES` + `COLUMNAS_AUDITADAS`) | Sí (lo propone el diseño); nace con el árbol |

De negocio o de política (se las paso al orquestador, que decide si las lleva al dueño):

| # | Pregunta | Recomendada |
|---|---|---|
| 3b | «Sin borrar nunca» contra la limpieza de los tests (H3) | Mantener la regla de Pedernal para `motor2_app` y resolver la limpieza de tests con un camino explícito y local (no abrir DELETE en producción) |
| 4 | Los reportes por categoría: ¿agrupan por id (y muestran el camino) o por nombre? (H5) | Por id, mostrando el camino completo, para no fusionar ventas de nodos distintos |
| 5 | «Crear categoría» con un nombre que ya existe: hoy la reusa en silencio; en el árbol, ¿se reusa entre hermanos o da error «ya existe»? | Error claro «ya existe entre hermanos» (como Pedernal); la semántica de reuso actual queda solo para los seeds |

## 6. NO VERIFICADO (resumen)

Datos reales de cualquier base; privilegios reales de `motor2_app` sobre la tabla; comportamiento de `deleteMany` con hijos bajo FK autorreferente RESTRICT (precedente `Grupo`); `NULLS NOT DISTINCT` en la versión de Neon; contenido completo de los specs e2e, de `test/aislamiento/denegacion-por-defecto-catalogo.test.ts`, de `test/navegacion/*` y de `test/textos/oraculo-de-*.ts` (solo se vio que mencionan «categor»); los cercos genéricos por esquema; la existencia de un importador de productos fuera de `src/` y `scripts/`.
