# Diseño: forma de los datos como Pedernal (frente 3, «el tema de datos») — Fase 1, solo documento

Estado: SOLO DOCUMENTO. No hay código, migración ni DEC. Nada se aplicó a ninguna base. La tabla «¿qué pasa si…?», los niveles 6 a 10 en borrador y el oráculo están en el anexo `docs/diseno-datos-paridad-pedernal-anexo-2026-11-16.md`.

## 0. Pedido y fuentes

- **Pedido del dueño (2026-11-16, chat con el orquestador, relatado en `motor2-docs`, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, «Paridad con Pedernal: qué falta y cómo se trabaja»):** «Las unidades de clasificación, el tema de datos, planes y perillas.» Y: «Sí, las migraciones van a estar aprobadas cuando ya tengamos todo el código igual.» Esto último NO autoriza ninguna migración hoy.
- **Regla de paridad (2026-11-13, `AGENTS.md`):** «Necesitamos ser iguales en todo… El resultado tiene que ser el mismo y sobre todo de las mismas formas, salvo porque nosotros usamos Prisma.»
- **Ratificación del plan (2026-11-15, relatada, `motor2-docs/_planes/plan-de-paridad-con-pedernal-2026-11-14.md`):** «Sí, copiar a Pedernal en esas cinco» (E1 primitivas, E3, E4, E5 forma de lo nuevo, E6): «CONFIRMADA en dirección… Ninguna migración autorizada». Y, relatado por el orquestador (lectura suya, «a corregir por el dueño»): migraciones aditivas y reversibles con `down.sql` de etapas ratificadas, sin aplicar en bases reales.
- **Qué leí (todo código real, no documentos):** Motor2 `origin/main` `903c0f6d` (2026-11-16): `prisma/schema.prisma` (4090 líneas, 114 modelos), las 167 carpetas de `prisma/migrations`, `scripts/operaciones/crear-rol-motor2-app.sql`, `src/core/datos/**`, `src/core/tiempo/**`, `src/core/texto.ts`, `src/server/persistencia/**` (borrados). Pedernal: `ZuluHub-ERP` `ad4a9a4a` (migraciones 0001 a 0058, `src/primitivas/**`), `ZuluHub-docs` `125e09e4` (`08-adr/ADR-012`, `11-especificaciones/novedades-para-motor2.md`).
- **Qué NO leí (NO VERIFICADO):** ninguna base viva (ni el rol de conexión real ni los privilegios efectivos); las migraciones de Pedernal línea por línea (solo `0001`, `0007`, `0028` y búsquedas); no corrí ni tests ni el gate.
- **Aviso:** la auditoría del 2026-11-14 (`paridad-primitivas-configuracion-y-datos-2026-11-14.md`) quedó vieja en varios puntos de este frente; abajo va qué cambió.

## 1. Qué cambió desde la auditoría del 14/11 (verificado en el código)

1. **Lista de caracteres y largos:** ya está en `main` como código puro igual a Pedernal (`src/core/datos/texto-de-catalogo.ts`, `fichas-de-texto.ts`: PRODUCTO 120, ELECCION 80, NOMBRE_DE_COCINA 80, RAZON_SOCIAL 200; mismas constantes `LETRAS`, `SIGNOS`, `SIGNOS_DEL_CATALOGO` que `ZuluHub-ERP/src/primitivas/texto/texto-de-una-linea.ts`) y está conectada en 9 archivos por `nombreDeFicha` (guards de productos, insumos, proveedores, clientes, opciones, categorías, secciones, duplicar). Oráculo: `test/core/oraculo-texto-de-catalogo.ts`.
2. **CUIT estricto** (`src/core/fiscal/cuit-estricto.ts`, sin lista de prefijos, como Pedernal) y funciones de base `cuit_valido(text)` y `texto_de_ficha_valido(text, int)` (migración `20261115140000_parte_ficha_unica_p1`). La auditoría decía que la base no tenía ninguna.
3. **Dos tablas nuevas ya nacieron con la forma de Pedernal:** `OcultamientoProducto` (migración `20261115120000`: id que manda la app, `TIMESTAMPTZ(3)`, `version`, sin DELETE, UPDATE por columna) y `Parte` (`20261115140000`: id `uuid`, `idempotenciaAlta` único por empresa, `timestamptz`, trigger `Parte_proteger`, sin DELETE).
4. **`fechaParaMostrar`** (`src/core/tiempo/fecha-para-mostrar.ts`): DD/MM/AAAA, falla cerrada.
5. Pedernal avanzó de la migración 0048 a la 0058; lo que toca datos: 0053 (costo nunca cero), 0054 (precio de línea de factura > 0), 0056 (receta sin insumos). NO VERIFICADO el detalle de cada una.

## 2. Auditoría: forma de los datos (Motor2 real vs Pedernal vigente)

Estados: igual / difiere en resultado / difiere en forma / falta en Motor2 / falta en Pedernal / NO VERIFICADO. «¿Reescribe datos?» = requiere autorización expresa por base, con respaldo y ensayo.

### 2.1 Fechas y horas con zona horaria

| Punto | Pedernal | Motor2 | Estado | ¿Reescribe datos? |
|---|---|---|---|---|
| Tipo de columna de instante | `timestamptz` (301 usos en 0001–0058; 1 línea sin zona) | `TIMESTAMP(3)` sin zona en 122 usos de migraciones; `TIMESTAMPTZ` solo en las 2 tablas nuevas (5+1 usos); en `schema.prisma` 138 líneas `DateTime`, solo 4 con `@db.Timestamptz(3)` | difiere en forma (no lo impone Prisma: admite `@db.Timestamptz`) | SÍ en las ~110 tablas viejas: `ALTER COLUMN … TYPE timestamptz USING col AT TIME ZONE 'UTC'` reescribe la tabla (bloqueo) y conserva el instante si todo se guardó en UTC (NO VERIFICADO columna por columna; hay comentarios «UTC» como en `Venta.fecha`) |
| Zona de la empresa validada por la base | `zona_horaria_valida()` + disparador `empresa_validar_zona_horaria` (CHECK `empresa_zona_horaria_ck`) | `Empresa.zonaHoraria TEXT NOT NULL` sin validación en la base (una sola mención en migraciones: la creación). `esZonaHorariaValida` solo en código | falta en Motor2 | NO (función + disparador aditivos; falla si hay una zona inválida guardada: se mide antes con `scripts/medir-zonas-horarias.ts`, ya existe) |
| Hora de corte de la jornada | `sucursal.hora_de_corte time` (0007, CHECK < 24:00) y `fechaDeNegocio` puro con la misma fórmula SQL | no existe (`diaDeCalendario` usa el día calendario de la zona) | falta en Motor2; **cambia resultado de la caja** | NO (columna aditiva con default `00:00`). Pertenece al frente 1 (caja): ver contratos §5 |
| Fecha civil (`@db.Date`) | `FechaCivil` estricta | 14 `@db.Date`; `esDiaISOReal`, `sumarDias` | NO VERIFICADO casos borde | NO |
| Fecha para mostrar | formateador único DD/MM/AAAA (#348) | `fechaParaMostrar` ya existe; sin conectar a pantallas (NO VERIFICADO) | igual en intención | NO |

### 2.2 Identificadores que genera la aplicación

| Punto | Pedernal | Motor2 | Estado | ¿Reescribe datos? |
|---|---|---|---|---|
| Clave primaria | `uuid` con `DEFAULT gen_random_uuid()`; en las altas **lo manda la app** («es la idempotencia del alta», 0025, 0028, 0045) | 110 de 114 modelos con `@default(cuid())` (lo genera Prisma al insertar). Nuevas: `Parte.id @db.Uuid` (nativo) y `OcultamientoProducto.id` TEXT con CHECK de forma uuid | difiere en forma; **las dos tablas nuevas difieren entre sí** (nativo vs TEXT+CHECK) | cambiar el tipo de las claves viejas es DESTRUCTIVO (todas las FK compuestas `[empresaId, id]`); el plan ya lo puso en poda (2026-11-14, «Decisión expresa del dueño») |
| Idempotencia de las altas viejas | el id mismo | `claveIdempotencia` en ~25 lugares del esquema; varias nullable («rollout gradual», p. ej. líneas 801, 1595, 2903), otras `String @unique` (2808, 3091…) | difiere en forma, **mismo resultado donde la clave es obligatoria** | NO para volver obligatoria una clave: sí si hay filas viejas sin clave (diseño `diseno-idempotencia-obligatoria-movimientos-2026-10-27.md`) |
| Generación | `uuidV5` determinista y marcas por tipo | `azar.uuid()` en `src/lib/azar.ts` (puerto de azar, `randomUUID`); `esIdentificador` = string no vacío, tope 64 | difiere en forma | NO |

### 2.3 «No se borra» hecho cumplir desde la base

| Punto | Pedernal | Motor2 | Estado | ¿Reescribe datos? |
|---|---|---|---|---|
| Privilegios | `REVOKE ALL … FROM PUBLIC`; «ningún rol tiene DELETE» (0001); INSERT y UPDATE por columna | `scripts/operaciones/crear-rol-motor2-app.sql` da `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES` y `ALTER DEFAULT PRIVILEGES … DELETE` a `motor2_app`. Cada migración nueva hace `REVOKE ALL … FROM motor2_app` y vuelve a dar lo mínimo: **53 tablas recortadas; 61 modelos conservan DELETE** (lista en el anexo §A) | difiere en resultado | NO (REVOKE es reversible y no toca datos) pero rompe el código que borra (abajo) |
| Disparador que frena hasta al dueño | `sin_borrado()` en 150 sitios (fila y TRUNCATE), también en `linea_cuenta` y `cuenta_consumo` (0028) | solo en `RegistroAuditoria`, `AuditoriaPlataforma`, `ModuloEmpresa`, y protecciones puntuales (`Parte_proteger`, `Invitacion*`, `Operacion_padre_inmutable_chk`) | difiere en cobertura | NO |
| Quitar una línea de una cuenta | `linea_cuenta.estado` VIGENTE/ANULADA con `anulada_por`, `anulada_en`, `motivo_de_anulacion`: se anula, no se borra | `cuentaItem.deleteMany` (borrador sin enviar, `src/server/persistencia/pos/pedido.ts:137,148,149`) | difiere en resultado | NO, pero cambia el comportamiento del salón |
| Borrados físicos que hace el código hoy (verificado con grep) | — | `margenObjetivo`, `descuentoProductoSucursal`, `contenidoCartaProducto`, `opcionItemAgrupadoCarta`, `itemAgrupadoCarta`, `generoCarta` (`copiar-carta.ts:99-102`), `insumo` (fusión, `insumos.ts:58`), `sustitutoRecetaIngrediente`, `stockMinimoProducto`, `seccionHabitualProducto`, `frecuenciaConteoProducto`, `cuentaItem`, `promoCuenta` (`pedido.ts:160`) | **13 sitios que dejarían de andar** con REVOKE | — |
| Versión de fila | `version` + disparador `fijar_version_y_fecha()` (81 sitios) | `version` en `OcultamientoProducto`, `Parte` y 3 modelos de contenido; el resto confía en transacciones/bloqueos | difiere en cobertura | SÍ (columna y disparador por tabla; aditivo con default 1) |

### 2.4 Lista exacta de caracteres permitidos

| Punto | Pedernal | Motor2 | Estado |
|---|---|---|---|
| Regla de una línea | `textoDeUnaLineaDesdeTexto` | `src/core/datos/texto-de-catalogo.ts`, misma lista (letras latinas con tilde y ñ, dígitos, `. , & - ' / ( ) ° + : ; " # º ª ’ “ ” – — « » ® ™`; de catálogo suma `¿ ¡ ? ! % $`), mismo orden de motivos | igual |
| Largos por ficha | producto 120, elección 80, cocina 80, razón social 200 | idem en `FICHAS_DE_TEXTO` | igual |
| Dónde se aplica | todo el catálogo y los datos fiscales | **conectada** en 9 archivos. **Siguen con la regla vieja** (`RE_TEXTO_CATALOGO` Unicode, acepta cirílico, árabe y `_`; 80): `core/permisos/nombres-de-rol.ts`, `features/sucursales/sucursal.guard.ts`, `features/carta/contenido-producto.guard.ts`, `features/catalogo/opciones-de-venta.guard.ts`, `features/catalogo/nombre-de-catalogo.ts`, `features/movimientos/motivos.guard.ts`, `core/carta/validaciones.ts`, `datos/nombre-catalogo.ts` | difiere en resultado en esos puntos |
| Regla amplia | no existe | `RE_TEXTO_DE_UNA_LINEA` (`\p{L}\p{M}\p{N}\p{P}\p{S}`: **acepta emojis y símbolos**) en `core/seguridad/ruta-servible.ts`, `core/carta/tema.ts`, `core/texto.ts` | falta en Pedernal; cada uso se revisa (NO VERIFICADO si algún uso es visible o imprimible) |
| Defensa en la base | `texto_de_catalogo_valido` (0043), `texto_fiscal_valido` | solo `texto_de_ficha_valido` (para `Parte`); ninguna columna vieja tiene CHECK de lista | falta en Motor2 |
| Otras fichas de texto de Pedernal | código de producto, descripción de carta 300, detalle de stock 300, motivo de orden 200, pasos de receta 2000, cupón, últimos cuatro, término de búsqueda | NO VERIFICADO una por una (hay topes parecidos en `datos/limites.ts`: notas 500, detalle 200, contacto 120, receta 2000) | NO VERIFICADO |

### 2.5 Tipos «marcados» de primitivas vs validadores sueltos

| Punto | Pedernal | Motor2 | Estado |
|---|---|---|---|
| Importe, Cantidad, Cuit, Email | tipos marcados que solo nacen de texto validado; `Resultado` ok/err | validadores sueltos con `number` (`validarImporte`, `validarCantidad`…) y `ResultadoDato`; nuevo `ResultadoDeRegla` (`valido`/`invalido`) ya usado por las reglas nuevas | difiere en forma. Dinero en `bigint`/escala 6/tope 10^18: **podado** el 2026-11-14 (plan §3), no se reabre |
| Catálogo de primitivas | `src/primitivas/contratos.json` | `docs/catalogo-de-primitivas-motor2.md` + guardián `catalogo-de-primitivas.test.ts` | forma propia |

## 3. Diseño (escalera de 10 niveles; niveles 1 a 5)

Estados: CONFIRMADA (dicha por el dueño, con cita y fecha), PROPUESTA, PENDIENTE, NO VERIFICADA.

### Nivel 1 — Propósito y alcance
| # | Decisión | Estado |
|---|---|---|
| N1-1 | Motor2 guarda los datos con la misma forma que Pedernal: instante con zona, id que manda la aplicación (el reintento no duplica), «no se borra» impuesto por la base, lista exacta de caracteres también en la base. Necesidad: «Necesitamos ser iguales en todo… sobre todo de las mismas formas» (2026-11-13); «el tema de datos» (2026-11-16) | CONFIRMADA (en dirección) |
| N1-2 | Toda tabla NUEVA nace con la forma (id de la app, `timestamptz`, versión si se edita, sin DELETE, textos con función de base). Cita: «Sí, copiar a Pedernal en esas cinco» (2026-11-15, relatada, E5) | CONFIRMADA (en dirección) |
| N1-3 | Las tablas EXISTENTES se convierten solo por etapas, cada una aditiva y reversible; las que reescriben datos piden autorización por base. Cita: «las migraciones van a estar aprobadas cuando ya tengamos todo el código igual» (2026-11-16) | CONFIRMADA (el momento); el orden y el alcance son PROPUESTA |
| N1-4 | Fuera de alcance: dinero en `bigint` (poda 2026-11-14), unidades (frente 2), clasificación (frente 2), planes (frente 4) | CONFIRMADA (poda, relatada) |

### Nivel 2 — Actores y contexto
| # | Decisión | Estado |
|---|---|---|
| N2-1 | Quien se beneficia: el dueño (resultado idéntico a Pedernal), el orquestador y los otros cinco frentes (un solo molde para tablas nuevas) | PROPUESTA |
| N2-2 | Quien aplica migraciones: solo el dueño, base por base, con respaldo y ensayo en una rama (`migrar.yml` y `docs/deploy-con-migraciones.md`) | CONFIRMADA (congelamiento vigente) |
| N2-3 | Rol de conexión de la app: `motor2_app` sin BYPASSRLS (el script lo crea `NOSUPERUSER NOBYPASSRLS` solo para el rol de pruebas; el de producción NO VERIFICADO) | NO VERIFICADA |

### Nivel 3 — Casos de uso (de este frente)
C1 alta con id de la aplicación; C2 guardar un texto; C3 intento de borrar; C4 derivar la fecha de negocio de un instante; C5 convertir una columna vieja; C6 alta de empresa con zona. Cada una con su «¿qué pasa si…?» en el anexo §B. Estado: PROPUESTA.

### Nivel 4 — Conceptos y ciclo de vida
| # | Decisión | Estado |
|---|---|---|
| N4-1 | «Anular» = fila nueva o estado con quién, cuándo y motivo; nunca DELETE. Una configuración que hoy se borra (p. ej. stock mínimo) pasa a «desactivar» o a poner el valor en vacío con rastro | PROPUESTA (NO VERIFICADO cómo lo resuelve Pedernal para cada una de las 13) |
| N4-2 | Un instante es un `timestamptz`; un día es `date`; una fecha de negocio es `((instante AT TIME ZONE zona) - corte)::date` | PROPUESTA (igual a Pedernal `fecha-de-negocio.ts`) |
| N4-3 | El id de un alta lo genera la aplicación con `azar.uuid()`; la base lo valida por tipo `uuid` (no TEXT+CHECK) | PROPUESTA: hay que elegir UNA forma, ver §6 D-ID |

### Nivel 5 — Invariantes y políticas
| # | Invariante | Estado |
|---|---|---|
| N5-1 | Ningún rol de la app tiene DELETE ni TRUNCATE sobre una tabla de negocio (tabla nueva: desde el alta; vieja: cuando su código deje de borrar) | PROPUESTA |
| N5-2 | Repetir un alta con la misma clave devuelve la fila existente; con otro contenido, error (ya así en `Parte`: `payloadHash`) | PROPUESTA (igual a lo ya construido) |
| N5-3 | Una zona horaria inválida no entra a `Empresa` | PROPUESTA |
| N5-4 | Un texto con carácter fuera de la lista no entra: rechazado en el código y en la base. En la EDICIÓN, un nombre viejo que no cumple no bloquea cambiar otro campo (decisión ya tomada en `nombre-de-ficha.ts`: «edición estricta solo si el nombre cambia») | CONFIRMADA en el código (citas en `nombre-de-ficha.ts`); la base no puede exigir más que eso: ver §4 E-3 |
| N5-5 | Lo que el dueño no pidió no entra: ningún dato extra ni opción nueva sale de este frente | CONFIRMADA (2026-11-11) |

## 4. Etapa mínima y etapas con nombre

«Primero la opción más barata» (2026-10-27). La etapa mínima es la que **no toca ninguna tabla ni columna de otro frente**.

| Etapa | Qué | ¿Migración? | ¿Reescribe datos? |
|---|---|---|---|
| **E-0 (MÍNIMA) «El molde»** | (a) Este documento aceptado. (b) Un guardián que mira las migraciones posteriores a una fecha de corte y exige, para cada tabla nueva: id por tipo `uuid` o declarado, instantes `TIMESTAMPTZ`, sin `GRANT … DELETE`, textos con función de base, con una lista corta de excepciones con motivo. (c) Un anexo de una página para los otros cinco frentes. Solo documento y un test. | no | no |
| E-1 | Pasar a la regla de Pedernal los 8 archivos que usan la regla vieja de nombres (§2.4), con el oráculo y el guardián `texto-de-catalogo-declarado` que ya existen. Cambia lo que se acepta (deja de aceptar cirílico y `_`): pide el recuento E1 de datos reales (`docs/e1-recuento-de-textos-y-cuit-2026-11-15.md`) antes. | no | no |
| E-2 | Funciones de base: `zona_horaria_valida` + disparador en `Empresa`; `texto_de_catalogo_valido`; `sin_borrado()` (solo la función, sin engancharla). Aditivas, con `down.sql`. | sí, aditiva | no |
| E-3 | CHECK de lista en columnas de texto viejas. **No va hasta limpiar los datos:** un CHECK, aunque sea `NOT VALID`, también se evalúa al actualizar otra columna de la fila, y chocaría con la decisión de no bloquear la edición de un nombre viejo (N5-4). | sí | **SÍ** (limpiar nombres) |
| E-4 | «No se borra» tabla por tabla: (1) `REVOKE DELETE` en las tablas cuyo código no borra (de las 61, quedan 13 con borrado real, §2.3); (2) cambiar esos 13 borrados a anular/desactivar (cambia comportamiento de salón, carta, stock: lo pide el dueño por pantalla, es de otros frentes); (3) enganchar `sin_borrado()`. | sí, aditiva | no |
| E-5 | `version` + disparador en tablas editables viejas. | sí, aditiva | no |
| E-6 | Convertir los ~122 instantes viejos a `timestamptz` (una sola migración, un solo turno sobre `schema.prisma`, **al final**, cuando nadie más tenga una migración abierta). | sí | **SÍ** (reescribe tablas; autorización por base con respaldo y ensayo) |
| E-7 | Primitivas «marcadas» (Importe, Cantidad…): solo como forma de código, sin cambiar columnas; no antes de que el dueño lo pida. | no | no |
| NO se propone | cuid → uuid en tablas viejas (destructivo; poda). Cambiar dinero a `bigint` (poda). | — | — |

## 5. Orden respecto de los otros cinco frentes y contratos que se ofrecen

**Orden propuesto:** E-0 primero y ya, porque los frentes 1 (caja), 2 (unidades/clasificación), 4 (planes) y 5 (compras) van a crear tablas nuevas y es mucho más barato que nazcan bien que convertirlas después. E-1 y E-2 en paralelo con ellos (no pisan tablas). E-4 y E-5 de a una tabla cuando el frente dueño de esa tabla la esté tocando. E-6 último.

**Contratos que se ofrecen (sin que nadie rehaga nada):**
- A todos: el molde de tabla nueva (§4 E-0) y `azar.uuid()` como único generador de ids; `ResultadoDeRegla` como forma de regla nueva; `FICHAS_DE_TEXTO` + `nombreDeFicha` para cualquier nombre (un dato nuevo se declara en la tabla y en el oráculo).
- Frente 1 (caja): `sucursal.hora_de_corte` y `fechaDeNegocio` (puro + fórmula SQL) **los diseña y construye el frente 1**; este frente solo da el molde y la validación de zona. Pendiente de acuerdo.
- Frente 2: un nombre de unidad o clasificación usa `ELECCION` (80, ya acordado en `fichas-de-texto.ts`).
- Frente 4: el nombre visible usa la misma lista; ninguna columna de plan guarda texto sin ficha.
- Frente 5: las tablas de recepción, orden de compra y nota de crédito nacen con el molde; `claveIdempotencia` obligatoria desde el alta.
- Frente 6: la fecha que se muestra sale de `fechaParaMostrar`; ningún texto que se imprime usa `RE_TEXTO_DE_UNA_LINEA`.

**Migraciones que REESCRIBEN datos («requiere autorización expresa por base, con respaldo y ensayo»):** E-3 (limpiar nombres) y E-6 (tipo de columna de ~122 instantes). El resto es aditivo o solo quita privilegios.

## 6. Carril de escritura (declaración) y dependencias

**Rutas donde este frente puede escribir en Fase 2 (exclusivas):**
- `src/core/datos/**` (solo `texto-de-catalogo.ts`, `fichas-de-texto.ts`, `nombre-de-ficha.ts`, `resultado-de-regla.ts`, `identificador.ts`, `clave-idempotencia.ts`, `limites.ts`; las reglas de otros frentes las toca su dueño)
- `src/core/tiempo/**`, `src/core/texto.ts`, `src/lib/azar.ts`
- `test/core/oraculo-texto-de-catalogo.ts`, `test/core/texto-de-catalogo*`, `test/tiempo/**`, y guardianes nuevos con prefijo `test/arquitectura/datos-*`
- `docs/diseno-datos-paridad-pedernal-*`
- `prisma/migrations/<timestamps reservados al pasar a Fase 2>` solo para E-2, E-4(1), E-5 y E-6
- **Modelos de `schema.prisma`: ninguno propio.** E-2 no cambia el esquema; E-5 y E-6 cambian columnas de modelos de otros: **zona restringida, por turno del orquestador general**, un modelo por vez, avisando al frente dueño.

**Choques posibles a resolver por mensaje:** `src/core/features/**/*guard.ts` que usan la regla vieja (los edita este frente solo para cambiar la ficha); `src/server/persistencia/**` y `pos/pedido.ts` (los 13 borrados son de los frentes dueños del módulo); `src/core/textos/*` (catálogo T1, zona restringida: el mensaje genérico «Esta acción no está permitida» ya es el de Pedernal).

**Dependencias con corrientes en curso:**
- **Ocultar:** la PR abierta #320 (disparador en `MovimientoStock`) agrega otra protección puntual en la base; E-0 la cuenta como precedente, no la pisa. `OcultamientoProducto` y `Parte` quedan como las dos referencias de «tabla nueva»; hay que igualar su `id` (D-ID).
- **Roles P1 / Parte:** `Parte` ya está; nada de este frente le cambia columnas.
- **Textos T2:** `docs/diseno-textos-en-codigo-2026-11-16.md` y `src/core/textos/*`; este frente no agrega textos nuevos (la regla de nombre usa el mensaje genérico ya aprobado el 2026-11-15, relatado).

## 7. Preguntas al dueño (una por vez)

Solo la primera se hace ahora; las demás quedan encoladas para cuando haga falta.

1. **(ahora) Ids de las tablas que ya existen.** Pedernal manda el id desde la aplicación y usa `uuid`. En Motor2 lo hacen así las tablas nuevas (Parte y Ocultar). Las ~110 anteriores tienen ids que genera Prisma y se protegen del doble clic con una «clave de reintento». Convertirlas es destructivo (hay que reescribir todas las claves y relaciones) y no mejora nada que se vea. ¿Alcanza con que las nuevas nazcan con id de la aplicación y las viejas sigan con clave de reintento (recomendada), o querés que también las viejas pasen a `uuid`?
2. (encolada) Cuando un dato hoy se borra de verdad (stock mínimo, descuento por producto, ítems de la carta, líneas de una cuenta sin enviar, etc.), ¿pasa a «desactivar» con rastro como en Pedernal? Cambia lo que ve el usuario al quitarlo.
3. (encolada) Zona horaria: ¿las empresas nuevas nacen con Buenos Aires como Pedernal y solo se cambia desde la consola?
4. (encolada, frente 1) Hora de corte de la jornada por sucursal: la pregunta es del frente de caja.

## 8. Riesgos y pendientes

- NO VERIFICADO: que todas las columnas `TIMESTAMP(3)` hayan guardado UTC (E-6 depende de eso; se mide antes con una consulta de solo lectura que el dueño autorice).
- NO VERIFICADO: los privilegios reales de `motor2_app` en producción (el script de rol más las migraciones dicen 61 tablas con DELETE, la base viva puede diferir).
- NO VERIFICADO: cómo resuelve Pedernal cada uno de los 13 borrados; hay que leerlos antes de E-4(2).
- Riesgo de ordenar mal: convertir `schema.prisma` (E-6) con otro frente editándolo causa conflictos en 138 líneas: por eso va último y en un turno.
