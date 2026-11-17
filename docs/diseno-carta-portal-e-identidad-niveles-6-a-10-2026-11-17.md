# Carta: portal de la empresa e identidad de la carta («Migrar todo ya»), niveles 6 a 10

> **Estado:** Fase 1, Frente 7 (CARTA), 2026-11-17. Solo documento. Continúa `docs/diseno-carta-familias-orden-identidad-portal-2026-11-17.md` (§4 niveles 1 a 5).
> **Decisión del dueño que rige (2026-11-17, `AskUserQuestion`, literal):** «Migrar todo ya» (modelo completo de Pedernal de una vez, no la opción barata); y «Gerente y administrador, como Pedernal (Recomendada)». Fuente: `motor2-docs/seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, sección «Carta como Pedernal: respuestas del Frente 7 (2026-11-17)». **Mitigación confirmada por el orquestador general:** tablas nuevas primero, lectura dual, backfill idempotente ensayado en copia de solo lectura, y el enlace actual (slug de la empresa) sigue resolviendo hasta que el dueño decida cortarlo.
> **Estados:** CONFIRMADA (dicha por el dueño) · PROPUESTA · PENDIENTE · NO VERIFICADO (†).
> **Pedernal no tiene el portal en código** (`ZuluHub-ERP` main #370): solo especificación y SQL 0077/0078/0083 propuestos. Se reproduce el diseño, no código probado.

## Respuestas del dueño a la pregunta única (2026-11-17, literales, registradas en `motor2-docs`)

| Punto | Respuesta | Efecto |
|---|---|---|
| Recuadro al borde del mapa | «Recortar al borde y mostrarte la lista» | **CONFIRMADA.** Se recorta y se muestra la lista de recuadros recortados, con capturas antes y después, **antes de tocar nada real** (no se frena la migración) |
| QR impreso | «Las dos funcionan; la vieja la cortás vos» | **CONFIRMADA.** El slug actual NO se corta hasta decisión del dueño; el código nuevo convive |

## 0. Hallazgos que cambian el diseño (verificados en el código real)

1. **«El portal se oculta si la empresa baja de plan» (fila 235) YA existe en Motor2.** `src/server/carta-publica/sin-sesion.ts` pregunta `modulosEfectivosDeEmpresa(...).has("carta")` antes de publicar nada «ni la carta de una sucursal, ni el portal, ni la apariencia del portal» (T9 del endurecimiento, decisión S-23/D2 del dueño). **Etapa C1 del documento anterior: cerrada, sin trabajo.** Queda solo una prueba que lo fije con el nombre «portal» (†: puede existir ya; buscar antes de escribirla).
2. **Motor2 no usa un rol de base «público».** Lee con el mismo rol de la aplicación y con alcance de solo lectura de UNA sucursal (`lecturaDeUnaSolaSucursal`, `dbDeEmpresa`), y la empresa sale del slug (`resolverEmpresaCarta`, solo `ACTIVE`). Por eso las políticas por código del portal de Pedernal (0078, 0083, `app.codigo_de_portal`, `pedernal_publico`) **no se copian**: la forma equivalente es la lectura del servidor con el alcance mínimo. **Diferencia declarada** (motivo: arquitectura de lectura pública ya existente en Motor2, ADR-006/007).
3. **«El portal público lee solo las cartas con tarjeta o zona visible» (fila 243)** equivale a lo que Motor2 hace hoy con `SucursalPublica.publicada && sucursal.activo` (`resolverPortalCarta`). Se mantiene y se extiende: pasa a leer de las tarjetas/zonas nuevas cuando existan.
4. **Modelo geométrico distinto:** `SucursalPublica.posX/posY/posW/posH` es **el centro** del recuadro en % (comentario del esquema); la zona de Pedernal guarda **esquina superior izquierda + tamaño** con `x + ancho ≤ 100`. El backfill convierte `x = posX − posW/2`; **un recuadro pegado al borde puede dar un valor fuera de rango**. Riesgo concreto de la migración, ver §6 (se recorta y se informa, nunca se pierde en silencio).
5. **El portal real de la empresa** (`docs/diseno-marca-del-portal-2026-11-13.md` §1): mapa con imagen de fondo, `portal_header_bg=#e5dfdf`, siete claves `card_*` en `transparent`, resto vacío. Equivale a **variante B** de Pedernal (imagen con zonas tocables sin pintar tarjetas).

## 6. Historia y persistencia

### 6.1 Tablas nuevas (todas aditivas; una sentencia SQL por tabla; id `UUID` generado por la app; `timestamptz`; sin DELETE/TRUNCATE para `motor2_app`; RLS por empresa)

| Tabla | Qué guarda | Restricciones que impone la base |
|---|---|---|
| `PortalDeEmpresa` | Una fila por empresa: `codigo` (llave del QR: 22 a 64 caracteres de `[A-Za-z0-9_-]`, **único en toda la plataforma**, inmutable, lo genera la app con 128 bits de azar), `variante` (`A` tarjetas \| `B` imagen con zonas; nace `A`), `lineaSuperior` (1 a 40), `titulo` (1 a 60), `colorEncabezado`, `colorPagina`, `colorDetras` (`#rrggbb` minúsculas), `logoVisible bool default true`, imagen de fondo **por partes** (proveedor, cuenta, id, versión, extensión: todas o ninguna), `version`, fechas | `UNIQUE (empresaId)`; `UNIQUE (codigo)`; CHECK de formato y largos; `codigo` inmutable (trigger); CHECK «todas o ninguna» de la imagen |
| `PortalTarjeta` | Variante A: una fila por (portal, sucursal): `orden ≥ 0`, `visible`, `nombre` (1 a 80, opcional), `telefono` (1 a 40, una línea), foto por partes | PK `(portalId, sucursalId)`; FK compuestas con `empresaId`; CHECK de formas |
| `PortalZona` | Variante B: `id` (lo manda la app), `sucursalId` (única por portal), `x`,`y`,`ancho`,`alto` `numeric(5,2)` en %, `visible` | `x ≥ 0, y ≥ 0, ancho > 0, alto > 0, x+ancho ≤ 100, y+alto ≤ 100`; `UNIQUE (portalId, sucursalId)` |
| `IdentidadDeCartaEmpresa` | Una fila por empresa: `colorPrincipal` (`#rrggbb`) | `UNIQUE (empresaId)` |
| `IdentidadDeCartaSucursal` | Una fila por sucursal: `modelo` (`LISTA`\|`CUADRICULA`\|`LIBRO`, default `LISTA`), `cara` (`DIA`\|`BOLICHE`\|`NOCHE`, opcional), `colorPropio` (opcional), logo por partes (todas o ninguna) | `UNIQUE (sucursalId)`; CHECK de listas cerradas |

- **Por qué tabla aparte y no columnas en `SucursalPublica` o `TemaCartaSucursal`:** `SucursalPublica` mezcla slug, posición y publicación; Pedernal separa tarjeta y zona para que cambiar de variante **no pierda** lo cargado en la otra (fila 242). `TemaCartaSucursal.valores` es JSON validado por catálogo; la identidad de Pedernal es de columnas con CHECK. **El campo `modelo` es solo de esta migración** (el Libro, Frente 6, lo lee; no crea otro).
- **Nada se borra ni se renombra:** el JSON `PortalCartaEmpresa.valores`, `SucursalPublica` y `TemaCartaSucursal` **no se tocan**; quedan como respaldo mientras haya lectura dual.
- **Imágenes (fila 232):** por dirección externa, sin subir archivos; se guardan las **partes**; proveedor de lista cerrada (`CLOUDINARY`). †: la primitiva de Motor2 hoy acepta una URL `https://` entera (`extraerUrlImagen`, `portal.ts:92`); **no existe** en Motor2 un `direccion-externa.ts` equivalente al de Pedernal (verificar con búsqueda antes de implementar). Se escriben solo partes; se leen las dos formas.
- **Historia:** cada cambio en `RegistroAuditoria` (antes/después, quién, cuándo), una entrada por entidad cambiada, en la misma transacción. Tarjeta/zona ocultas no se borran (`visible=false`).

### 6.2 Migraciones (bloque `20261117160000–169999`, después de O1 y F1)
Cuatro migraciones aditivas, cada una con `down.sql` y `verificacion-previa.sql`, entrada al final de la lista `m1`, nada aplicado a ninguna base real:
1. `…_portal_e_identidad_tablas`: las cinco tablas con sus CHECK y triggers.
2. `…_rls_portal_e_identidad`: políticas de aislamiento por empresa (y de alcance de sucursal para `IdentidadDeCartaSucursal`, con el generador `test/setup/politicas-de-alcance-de-sucursal.ts`).
3. `…_backfill_portal` (**solo datos, idempotente**, `INSERT … ON CONFLICT DO NOTHING`): lee `PortalCartaEmpresa` + `SucursalPublica`; ensayo en copia de solo lectura (ver §10).
4. `down` de cada una; la reversa de (1) **frena si hay filas editadas a mano** (`verificacion-previa.sql` las cuenta).

### 6.3 Backfill (diseño)
- `PortalDeEmpresa`: una por empresa que **hoy tiene portal publicado** (al menos una `SucursalPublica.publicada`); `codigo` nuevo con azar; `variante = 'B'` si `PortalCartaEmpresa` tiene imagen de fondo y todas las posiciones están completas, si no `'A'`; `colorEncabezado` ← `portal_header_bg` solo si es `#rrggbb` (los valores `transparent` o no hex **no se copian**: quedan en el JSON); `lineaSuperior`/`titulo` ← las claves de textos si caben en 40/60, si no vacío y se informa.
- `PortalTarjeta` ← cada `SucursalPublica`: `orden`, `visible = publicada`, `nombre = etiqueta`, `telefono = NULL`. `PortalZona` ← las que tienen posición completa, con `x = posX − posW/2`, `y = posY − posH/2`, `ancho = posW`, `alto = posH` **recortados a [0,100]**; cada recorte se lista en el informe de ensayo.
- Todo con claves determinísticas por `(empresaId, sucursalId)`: correrlo dos veces no duplica ni cambia lo ya editado (`DO NOTHING`).

## 7. Atomicidad y concurrencia

| Comando | Repetición | Concurrencia | Error parcial | Datos faltantes | Cambio de permisos |
|---|---|---|---|---|---|
| **Guardar el portal** (variante, textos, colores, logo, tarjetas, zonas) | Mismo contenido → éxito sin escribir ni versionar | `versionEsperada` del portal; vieja → rechaza todo | **Una transacción SERIALIZABLE**: portal + tarjetas + zonas + auditoría, o nada | Color no `#rrggbb` → `DATO_INVALIDO`; zona fuera de rango → `DATO_INVALIDO` | `carta_portal` al guardar |
| **Cambiar de variante** | Estado deseado | Idem | Lo cargado en la otra variante **no se toca** | Cambiar a B sin imagen → permitido (sin zonas todavía) | Idem |
| **Alta del portal** (primer guardado) | El `id` lo manda la app; repetir → `yaExistia` | `UNIQUE (empresaId)`: dos altas, gana una | Todo o nada | — | Idem |
| **Identidad de una carta / color de la empresa** | Estado deseado | `version` | Todo o nada | Logo con partes incompletas → rechazo | `carta_tema` (carta de la sucursal; PROPUESTA) / `carta_portal` (color de la empresa) |
| **Ver el portal (anónimo)** | — | Lectura | — | Sin tarjeta/zona visible → no aparece; empresa sin módulo `carta` → `null` (ya existe) | — |

El `codigo` del portal **no se regenera**: lo asigna el alta (único e inmutable). **Cortar el enlace viejo** (slug) es una decisión del dueño, no de este diseño.

## 8. Acceso e interfaces
- **Servidor** en `src/server/actions/carta/` (extiende `portal-empresa.ts` y suma `identidad-de-carta.ts`), esquemas en `src/core/features/carta/`, persistencia en `src/server/persistencia/carta/`. Autorización: `carta_portal` (empresa, piso administrador: **gerente y administrador ya**, ver el doc de permiso §A) para portal y color de la empresa; **`carta_tema`** (sucursal) para la identidad de una carta. Sin permiso nuevo.
- **Lectura pública dual:** `resolverPortalCarta`/`resolverConfigPortal` leen primero las tablas nuevas; si no hay fila de `PortalDeEmpresa`, leen `SucursalPublica`/JSON **exactamente como hoy** (golden del portal real y del portal sin configurar: **sin cambios**).
- **Ruta del QR por `codigo`:** una ruta pública nueva fuera de `src/app/(carta-publica)/carta-publica/[empresa]` está **fuera del carril de este frente** (pantallas): la pide el Frente 6 o el orquestador general. Hasta entonces el QR sigue usando el slug.
- **Contraste 7:1 (fila 235):** constante nueva `CONTRASTE_MINIMO_DE_LA_CARTA = 7` en `src/core/carta/` **reusando** `razonDeContraste` de `color-css.ts` (una regla, un lugar; hoy hay un mínimo 4,5 en `color-css.ts:208`). Se guarda el color **elegido**; el contraste se calcula **al mostrar** (el lector aclara/oscurece conservando el tono y la pantalla avisa). No hay CHECK de contraste en la base.
- **Frase final** (fila 235): se guarda siempre y se muestra solo con el Libro: Motor2 ya tiene `mensajeDePortada` †; **no se agrega campo**; mostrarla solo con Libro es del Frente 6.

## 9. Consultas y experiencia
- Gestión: portal con variante activa y lo cargado en la otra; tarjetas con `nombre`/`telefono`/foto/orden/visible; zonas; color de la empresa y de cada carta. Faltante = «pendiente de completar», nunca inventado.
- Público: el comensal ve las tarjetas o la imagen con zonas según la variante; los colores se aclaran/oscurecen al mostrar para llegar a 7:1; **nunca** aparece una carta sin tarjeta o zona visible, ni una sucursal inactiva, ni de otra empresa.
- **Escalera de producto:** N0 = hoy (sin cambios); N1 = contraste 7:1 y color de la empresa; N2 = identidad por carta (modelo/cara/logo); N3 = variante A/B con tarjetas y zonas separadas; N4 = código propio del QR. Cada peldaño es aditivo y no rompe lo cargado.

## 10. Pruebas, migración y operación

**Dimensiones del oráculo** (cambian lo que ve el comensal): fila nueva del portal (existe / no) × variante (A / B) × tarjeta o zona (visible / oculta / sin fila) × sucursal (`publicada`, `activo`) × módulo `carta` (sí / no) × color (cumple 7:1 / no) × logo (partes completas / vacío / ninguno). **Oráculo escrito aparte** (tabla de ~20 filas), test exhaustivo y guardián que falle si aparece una clave o columna nueva sin declarar.

**Pruebas obligatorias:** (1) **Sin regresión:** sin fila nueva, el portal y las cartas salen idénticos (goldens existentes sin tocar). (2) **Concurrencia:** dos «guardar portal» con la misma versión → gana uno; dos altas del portal → una fila. (3) **Idempotencia:** guardar lo mismo no versiona; backfill dos veces no duplica ni pisa lo editado. (4) **Atomicidad:** fallo a mitad no deja portal sin tarjetas ni zona huérfana. (5) **Aislamiento:** una empresa no ve ni cambia el portal de otra; una zona no puede apuntar a una sucursal de otra empresa (FK compuesta). (6) **Permisos:** gerente y administrador guardan; operador rechazado. (7) **Seguridad pública:** el `codigo` no se enumera (largo mínimo y forma validados antes de consultar, como `esSlugPublicoValido`); sin módulo `carta` responde igual que «no existe». (8) **Base:** CHECK de zona fuera de rango, de color, de imagen incompleta, inmutabilidad del `codigo`.

**Ensayo del backfill (obligatorio antes de cualquier base real):** copia descartable de la base de ensayo, **solo lectura sobre producción** (la regla de maquetas del dueño: nunca escribir en producción); informe con: portales a migrar, variante elegida, recortes de zonas, claves no copiadas (`transparent`, textos largos), y comparación de pantalla del portal real **antes y después** (captura a 375 px y escritorio).

**Riesgos concretos de «Migrar todo ya» (para el dueño):**
1. **Pérdida visual no recuperable si se corta el JSON:** las 22 claves se reducen a 3 colores + 2 textos + logo + imagen; lo demás deja de leerse. Por eso el JSON **no se borra** y hay lectura dual; borrarlo es una decisión aparte.
2. **Zonas al borde:** el centro→esquina puede salir de [0,100]; se recorta e informa.
3. **Enlace del QR impreso:** el código nuevo requiere una ruta nueva; mientras tanto no cambia nada; cortar el slug rompería QR ya impresos.
4. **Teléfono por tarjeta** no existe hoy (`NULL` en el backfill; se carga a mano).
5. **Rendimiento:** la lectura pública hace una consulta más por empresa (dual): con caché de 60 s existente no cambia.

## 11. Etapas internas (cada una aditiva; las dos primeras no tocan datos)
| Etapa | Contenido | Datos | Depende de |
|---|---|---|---|
| **P0** | Constante de contraste 7:1 y validación al guardar el color libre (reusa `marca-derivada.ts`/`color-css.ts`); prueba «sin módulo carta no hay portal» | No | — |
| **P1** | Migraciones 1 y 2: las cinco tablas + RLS (vacías, nadie las lee) | No | Turno `schema.prisma` |
| **P2** | Casos de uso de escritura (portal, tarjetas, zonas, identidad, color de la empresa) + lectura dual | No (sin backfill todavía) | P1 |
| **P3** | Backfill idempotente + ensayo en copia + informe | **Sí, ensayado en copia** | P2 y OK del dueño al informe |
| **P4** | Ruta del QR por `codigo` (Frente 6) y decisión sobre cortar el slug | No | P3 |

## 12. Turnos a pedir y lo que no verifiqué (†)
- **Turnos (tras revisión del orquestador):** cinco modelos en `prisma/schema.prisma`, timestamps dentro de `20261117160000–169999`, lista `m1`, textos T1 (avisos de contraste, «Descargar QR», textos del portal: el inventario de textos es zona restringida). Ningún cambio en `acciones.ts` ni DEC.
- †: dónde se declara hoy el proveedor `CLOUDINARY` y si existe `direccion-externa.ts` en Motor2; `mensajeDePortada` en `SucursalPublica`/carta; si hay ya una prueba «sin módulo carta no hay portal»; valores reales de `PortalCartaEmpresa.valores` de la empresa real (se leen en el ensayo, no acá).
