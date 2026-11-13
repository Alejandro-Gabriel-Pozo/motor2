# Ensayo general — pantallas reales de `main` (a172974) con datos reales de la empresa — 2026-11-13

**Rama temporal, sin PR.** Se borra cuando el dueño termine de mirar. Todo lo hizo una sesión Sonnet (ningún código del producto se tocó: ni `src/`, ni `prisma/`, ni `test/`).

## Lo esencial (leer primero)
- **Producción no se tocó.** Se creó una rama COPIA de Neon, `ensayo-general-20261113` (hija de la principal, `br-plain-king-afb4r4t1`, endpoint `ep-broad-smoke-afn5g7h8`); la principal (`br-steep-wind-af8iop63`) solo se usó como padre al ramificar. No se desplegó, no se cambió ninguna variable de Vercel. Antes de cada escritura se verificó que el `branch_id` era el de la copia. **La rama de Neon NO se borró** (la borra el dueño/orquestador).
- **Migraciones aplicadas SOLO en la copia**, en orden: `20261112160000_checks_de_datos_basicos` y `20261112170000_nombre_unico_sin_mayusculas`. Antes: las 5 consultas de auditoría del checklist dieron **0 filas**, y las pendientes eran exactamente esas dos. Después: `pg_constraint` muestra los 3 CHECK (`Empresa_moneda_chk`, `CotizacionDolar_fuente_chk`, `Cliente_descuentoPorcentaje_chk`) con `convalidated = true`, y `pg_indexes` los 2 índices (`Cliente_empresaId_nombre_lower_key`, `SeccionCarta_empresaId_nombre_lower_key`).
  - **Cómo se aplicaron (desvío del método habitual):** desde este contenedor no hay salida TCP a Postgres (solo HTTPS por proxy), así que `prisma migrate deploy` no pudo correr. Se ejecutó el SQL exacto de cada `migration.sql` por la herramienta SQL de Neon (una transacción por migración, en orden) y se insertó la fila en `_prisma_migrations` con el SHA-256 real de cada archivo. Lo que queda SIN probar acá: `prisma migrate deploy` / `migrate status` contra la copia, y el `down.sql` (subir → bajar → subir). El resto del checklist (sección 3, pasos 4 a 6) sigue pendiente.
- **App:** `main` construido (`npm run build:e2e`, con `--max-old-space-size=10240`: con el heap por defecto el chequeo de tipos se queda sin memoria) y levantado con `next start` contra la copia, conectando como `motor2_app` (el rol de la app, con RLS, no el dueño). La consola de plataforma también (`npm run plataforma:build` OK).
- **Datos reales de la copia:** 72 productos, 14 secciones de carta, 6 sucursales, 1 proveedor (CORDECC), 1 promo («Menú ejecutivo», $ 55.000), 2 mesas de Huinganco. Producción NO tiene: recetas, clientes, operaciones (compras, tickets, traspasos). Por eso varias pantallas salen **vacías** (ver «Qué NO se pudo mostrar»).
- **Cambios hechos en la COPIA para poder entrar y mostrar** (nada de esto existe en producción):
  1. Se creó una sesión en `Session` para el único gerente real, y se le cambió el correo a `ensayo-admin@local.test` (y el nombre) para no mostrar el correo del dueño.
  2. Se reemplazaron los correos de las 2 personas de personal y de las 3 invitaciones pendientes por `ensayo-encargada1/2@local.test` y `ensayo-invitada@local.test`.
  3. Se reseteó la clave de los roles `motor2_app` y `motor2_plataforma` **de la copia** (los roles son por rama; la principal no se toca).
  4. La copia no tenía administradores de plataforma: se insertó uno de prueba (`ensayo-plataforma@local.test`) y su sesión, para poder abrir la consola.
  5. Se duplicaron productos (ver (a)): quedaron en la copia «Bife con chimichurri», «Bife a la pimienta» y «Bife con salsa de hongos».
- **Entorno de la sesión:** para llegar a la copia se agregaron a la lista de hosts permitidos del entorno «Default» los dos hosts de la copia (`ep-broad-smoke-afn5g7h8[-pooler]…neon.tech`). Conviene sacarlos al terminar.
- Capturas: carpeta `capturas/`, sufijo `-m` = celular 375×844 (altura completa de la página), `-d` = escritorio 1366 de ancho (altura completa). `deviceScaleFactor 2`, navegador en es-AR y zona Buenos Aires. Sucursal activa: **Huinganco**.
- Se pasó **axe** (`@axe-core/playwright`, todas las reglas) y se midió desborde horizontal de la página y controles menores a 44 px a cada pantalla. Resultado resumido: **0 desbordes horizontales de página en la app**, **0 violaciones de axe en la app**, salvo el contraste de la carta pública (defecto 2).

## Índice por pantalla
| Pantalla | Capturas | Qué mirar |
|---|---|---|
| **(a) Duplicar producto** | `a1` ficha de BIFE- con el botón · `a2` diálogo vacío · `a3` con el nombre escrito (celular) · `a4b` **en curso** (celular, botón en espera) · `a4-…-exito` mensaje de resultado (m y d) · `a5` nombre repetido · `a6` repetido con otras mayúsculas · `a7` ficha del producto nuevo · `a8` lista | Ver **Resultados de (a)** abajo |
| (b) Carta › Hoy | `b-carta-hoy` | **Ya no aparece** la lista «Platos de la carta sin nombre de carta»: solo «En carta ahora 70 de 71», «Sin stock hoy 1» y las 14 secciones |
| (c) Contenido de un producto sin contenido | `c-en-la-carta-producto-nuevo` (producto duplicado, nunca puesto en la carta) | «Se muestra en la carta» y «Especial (★)» **sin tildar**; sección «— elegí una —»; resumen «sin sección de carta · $ 0,00 · sin contenido» |
| (d) Tablas con scroll en celular | `d01` usuarios · `d02` sucursales · `d03` roles · `d04` compras · `d05` rotación de mesas · `d06` tickets · `d07` traspasos · `d08` comparativa de proveedores · `d09` historial · `d10` ficha de receta · `d11` historial de receta | Usuarios y roles: la tabla scrollea dentro de su caja (ancho 576 en una caja de 343). Las demás están **vacías** |
| (e) Tarjeta de mesa del salón | `e-salon-mesas` | Mesa 01 «En pedido» (real: abierta hace más de 38 h, 0 productos, $ 0,00) |
| (f) Promociones y POS | `f1` Carta › Parametrización › Promociones (la promo «Menú ejecutivo», el alta de promo) · `f2` POS Mesa 01 · `f3` POS con la sección «Promociones» · `f4` **POS armando «Menú ejecutivo»** (cuadro «Entrada · 0/2 (opcional)» con +/−) | Los botones − / + miden ≥ 44 px |
| (g) Carta pública | `g1` portada de Huinganco · `g2` portal de la empresa · `g3-…-laminaNN` 15 láminas a 375 px (y 5 a escritorio) | La lámina 03 (= «02 / 13 Platos principales») muestra «Bife a criolla» y «Bife con chimichurri» como dos renglones a $ 30.000 (son las dos opciones de preparación de BIFE-) |
| (h) Consola de plataforma | `h1` login · `h2` inicio · `h3` empresas | Defecto 1 |
| Extra | `i-inicio` | Inicio de la app |

## Resultados de (a) — Duplicar
- **Nota de datos:** en la base real **no existe «Bife a criolla» como producto**: es una *opción* de preparación del producto **BIFE-**. Se duplicó `BIFE-` (producto de venta «Por opción») con el nombre «Bife con chimichurri».
- **Doble clic rápido** (clic doble sobre «Duplicar»): se creó **un solo** producto; verificado con SQL (un renglón por cada nombre). Tarda ~13 a 14 segundos en este entorno porque la base está remota detrás de un proxy (no es representativo de producción).
- **Mensaje de éxito:** «Producto "Bife con salsa de hongos" (PV_230b90) creado a partir de "BIFE-". Se vincularon 3 grupos con 7 opciones, 2 con precio (son los mismos de la biblioteca de opciones). Se vende por opción: su precio guardado no se cobra, el precio final de cada opción es el que se copió con ellas. «En la carta» queda pendiente de completar.» Con «Cerrar» y «Abrir «…»».
- **Nombre repetido:** «Ya existe un producto llamado "Bife con chimichurri". Elegí otro nombre.» — también con otras mayúsculas («BIFE CON CHIMICHURRI»). El diálogo sigue abierto con lo escrito.
- El producto nuevo nace **«Disponible en «Huinganco»»** (el usuario tiene el permiso de campos sensibles, DEC-0007 del registro), con «Receta: Pendiente» y «En la carta: Pendiente / Todavía no está en la carta».
- La receta no se pudo ejercitar: BIFE- no tiene receta («El producto no tiene receta: no hay nada que copiar»).

## Defectos encontrados (lista numerada)
1. **Consola de plataforma a 375 px — desborda 86 px a la derecha** (`h3-consola-empresas-m`): la tarjeta «Empresas · principal» queda cortada contra el borde derecho; la tabla se aprieta (CUIT partido en 3 renglones, «Ver Hoteles del Neuquén» en 4) y los enlaces salen en azul por defecto, sin el estilo de la app. En escritorio está bien. (La página de login y el inicio de la consola no desbordan.)
2. **Carta pública — contraste insuficiente (axe, 4,16:1; mínimo 4,5:1)**: texto de nombre y precio en `#797d62` sobre `#181818` en 3 platos de la lámina «02 / 13 Platos principales» (**Chivo del norte Neuquino, Estofado de chivo, Chivo al disco**) y en 2 nodos de la lámina «10 / 13 Postres» (`g3-carta-publica-lamina03-m`, `lamina11-m`). Los platos vecinos se ven en blanco. **No verifiqué el motivo del color** (por el atributo `--carta-primario` del tema, podría ser el color de acento del tema para platos «especiales»).
3. **Traspasos › Historial a 375 px — encabezados pegados** (`d07-traspasos-m`): «FechaProductoCantidad Otra sucursal EstadoDetalle», sin separación entre columnas (la tabla mide 343 de 343 px y no scrollea). Con datos reales probablemente no se vea así, pero hoy la pantalla vacía ya lo muestra.
4. **Encabezado general en celular** (todas las pantallas del shell): el correo largo se parte en dos renglones, queda un punto «·» huérfano arriba a la derecha del selector de sucursal y «Salir» cae solo en un tercer renglón. En el salón (`e-`, `f2-`) el encabezado es distinto y más prolijo.
5. **Botón «Continuar pedido» de la tarjeta de mesa** (`e-salon-mesas-m`): el ícono de lápiz toca el borde izquierdo del botón (sin margen) y el texto se parte en dos renglones; además la tarjeta ocupa solo la mitad del ancho (grilla de 2 columnas con 1 sola mesa).
6. **Tablas que scrollean no avisan que hay más** (usuarios, roles, invitaciones, disponibilidad por sucursal): scrollean dentro de su caja (`overflow-x: auto`, medido) pero no hay sombra ni flecha: se ven columnas cortadas («Cue…», «Vinc…», «Acti…»).
7. **Controles menores a 44 px en celular** (medido por script; el criterio de 44 es del dueño). Ancho o alto < 44: **«Salir» (30×44)** y «Editar» comensales (39×44) en casi todas; **enlaces de texto** «← Productos» (82×18), «← Volver a la receta» (127×18), «Limpiar» (47×20), «Editar opciones» (99×20), «Opciones agotadas» (337×35), «Carta › Hoy › Visibilidad» (336×38); **casillas de 20×20** («Se muestra en la carta», «Especial», «Solo salón» y las `incluir_…` de la promo, 17 controles en Promociones); en la carta pública «← PORTAL» (116×24), «Imprimir carta» (32×32) y los botones del índice (327×42). Los botones principales (Duplicar, Guardar, Filtrar, +/−) cumplen.
8. **«Duplicar» sin indicador de progreso visible** (`a4b-duplicando-en-curso-m`): durante los ~13 s el botón queda gris/en espera, pero el diálogo no dice «Duplicando…». En producción (base cercana) seguramente dura una fracción de segundo; lo anoto porque en una red lenta el dueño vería el botón apagado sin explicación.

Observación de datos (no es defecto del sistema): la **Mesa 01 de Huinganco figura «En pedido», abierta hace más de 38 horas, sin productos**. Es un dato de producción; quizá convenga liberarla antes de mostrar la carta.

## Qué NO se pudo mostrar y por qué
- **Tablas con datos** en compras, rotación de mesas, tickets, traspasos, comparativa de proveedores, historial de movimientos, ficha e historial de receta: **producción no tiene** compras, ventas cerradas, tickets, traspasos ni recetas (0 filas), y no se inventaron datos de prueba (regla del 2026-11-05). Se ven los estados vacíos y los filtros, **no** el scroll horizontal de esas tablas con filas. Para verlo hace falta cargar compras, una venta cerrada y una receta en la copia (decisión del dueño).
- **«Bife a criolla» como producto**: no existe (ver (a)).
- **Imágenes de la carta pública** (logos, fotos de platos, mapa del portal, fondo): salen como imagen rota porque este contenedor no sale a los hosts de esas imágenes (red limitada). No es una evidencia de defecto del sistema.
- **Ingreso real por Google / por código de correo + TOTP**: no se probó; se entró con una sesión creada en la base de la copia.
- **Migraciones con `prisma migrate deploy`, `down.sql` y la prueba subir→bajar→subir** sobre la copia (ver arriba).
- **Prueba de dos pestañas** (clientes y secciones con «Pepe»/«pepe», sección 6 del checklist) y el `UPDATE … descuentoPorcentaje = 100` que debe fallar: no se corrieron.
- **No existe todavía en `main`** (no se buscó): marca por sucursal/empresa, ficha de parte, pantalla del mozo de «Toda la sección con opciones» (solo existe el servidor), alícuota de IVA del producto (#255) y poda de promos: son diseños o PR abiertos.
- No se corrió el gate de 8 comandos (tsc, lint, arquitectura, knip, test, build, plataforma:build, e2e): solo `build:e2e` y `plataforma:build`, que pasaron.

## Privacidad
Las capturas usan correos de prueba (`@local.test`). **Aparece el CUIT de la empresa (30-70863714-5)** en `h3-consola-empresas`. No hay contraseñas ni cadenas de conexión en la rama (`herramientas-ensayo/copia.env.EJEMPLO` es una plantilla sin secretos).

## Cómo repetirlo
Todo en `herramientas-ensayo/` (scripts de Playwright; rutas absolutas del contenedor, ajustarlas).
1. Rama copia de Neon hija de la principal; auditoría (5 consultas del checklist, deben dar 0 filas); aplicar las 2 migraciones **solo en la copia**.
2. `copia.env` a partir de `copia.env.EJEMPLO`. `npm ci`; `NODE_OPTIONS=--max-old-space-size=10240 npm run build:e2e` (sin `NODE_USE_ENV_PROXY`); `NODE_USE_ENV_PROXY=1 npx next start -p 3100`. Consola: `npm run plataforma:build` y `next start -p 3200` desde `plataforma/`.
3. Sesión: fila en `Session` (token opaco) para el gerente; cookie `authjs.session-token`; cookie `sucursalActivaId` = id de Huinganco. Consola: `AdminPlataforma` + `SesionPlataforma` con `hashToken = sha256(token)` y cookie `plataforma.sesion`.
4. `node herramientas-ensayo/tanda.cjs m` y `… d` (pantallas b a i), `duplicar*.cjs`/`dup3.cjs` (a), `pos2.cjs` (f), `carta-pub.cjs` (g), `plat.cjs`/`plat2.cjs` (h), `contraste.cjs`, `tablas.cjs`.

## Prueba que puede hacer el dueño sin leer código
Abrí **Catálogo › Productos › BIFE- › Duplicar**, escribí un nombre nuevo y hacé **doble clic** en «Duplicar»: tiene que aparecer **un solo** producto nuevo y el mensaje verde de «creado». Repetí con el mismo nombre (aunque cambies mayúsculas): tiene que decir «Ya existe un producto llamado…».
