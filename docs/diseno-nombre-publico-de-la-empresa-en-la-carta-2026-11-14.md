# Nombre público de la empresa en la carta pública (diseño)

> **Estado:** DISEÑO, nada construido. Escalera de diseño de 10 niveles (`AGENTS.md`). Etiquetas: **CONFIRMADA** (dicha por el dueño, con su cita) · **PROPUESTA** (mía, a confirmar) · **PENDIENTE** (decide el dueño) · **NO VERIFICADO** (no pude respaldarlo). Sin datos reales: se usa «Empresa B» donde hace falta un ejemplo.
> Compuerta: no se migra nada hasta confirmar los niveles 1 a 5. Este documento propone y el dueño confirmó **una opción sin migración** (el administrador carga el valor al desplegar); una carga automática sería una migración de DATOS y **requiere autorización expresa** (descartada, nivel 10).

## 1. Propósito y alcance

- **Necesidad (quién la pidió y dónde está escrita):** el nombre que la carta pública muestra en los títulos de página, las descripciones y la vista previa al compartir hoy es un texto fijo en el código (`MARCA_PUBLICA`, `src/core/carta/marca.ts`) y es el mismo para todas las empresas. Decisión del dueño, 2026-11-14, chat con el orquestador (pregunta con opciones; cita literal): **«Configurable por empresa, como Pedernal (Recomendada)»** — **CONFIRMADA**. Alcance acordado: el nombre sale de un dato de cada empresa; la carta de hoy debe seguir diciendo exactamente lo mismo (se carga el valor actual).
- **Dentro:** el nombre público en `<title>`, `description`, `og:title`, `og:description` y `og:site_name` del portal de la empresa (`/carta-publica/<empresa>`) y de la carta de cada sucursal (`/carta-publica/<empresa>/<sucursal>`).
- **Fuera:** los nombres de las sucursales, sus etiquetas y subtítulos (siguen saliendo de los datos); el logo y los colores (la marca de la carta y del portal ya están hechas); el nombre de la empresa en la administración interna; el dominio.
- **Por qué importa:** una segunda empresa en la misma instalación hoy mostraría el nombre de la primera en sus títulos (es un texto fijo): es un defecto de aislamiento de identidad, además de un dato real en el código público.

## 2. Actores y contexto

| Actor | Qué hace |
|---|---|
| Administrador de la empresa (permiso `carta_portal`) | Carga y cambia el nombre público desde «Apariencia del portal» (`/carta/portal`). |
| Persona anónima (la que abre la carta) | Ve el nombre en el título de la pestaña, en resultados de buscadores y al compartir el enlace. Nunca puede leer el dato de otra empresa. |
| Buscadores y vistas previas (WhatsApp, redes) | Leen `title`, `description` y las etiquetas `og:*`. |
| Plataforma | No interviene en el uso diario (no hay consola nueva). |

## 3. Casos de uso

1. **Cargar o cambiar el nombre público** (administrador, `carta_portal`).
2. **Quitar el nombre público** (dejar vacío): la carta pasa a títulos neutros.
3. **Ver el portal** y **ver la carta de una sucursal** (anónimo): los metadatos usan el nombre público de ESA empresa.
4. **Compartir el enlace**: la vista previa usa el mismo nombre.

## 4. Conceptos y ciclo de vida

- **Nombre público de la empresa** (`nombre_visible` en Pedernal): un texto corto de una línea. Ciclo: *sin cargar* → *cargado* → *cambiado* → *quitado* (vuelve a *sin cargar*). No hay borrador ni versiones (guardar = aplicar, como el resto de la apariencia del portal).
- **Neutro:** lo que se muestra cuando no hay nombre cargado (nivel 5, F1).
- Es un dato de **presentación**, no fiscal ni de identidad interna: no reemplaza a `Empresa.nombre` (nombre interno único) ni a la razón social.

## 5. Invariantes y políticas

- **F1 (fallar cerrado, todo nace cerrado).** Sin nombre cargado, o con un valor guardado que ya no pasa la validación, la carta usa **texto neutro**: nunca el nombre de otra empresa, nunca un valor por defecto escrito en el código. Neutro = el título es solo el nombre de la carta o del portal (sin el « · {nombre}» del final), la descripción omite «de {nombre}» y **no se emite `og:site_name`**. *(Reglas ya usadas en Pedernal: unknown/no disponible = sin marca.)* — PROPUESTA
- **F2 (aislamiento).** El nombre sale de la fila de la empresa que la URL resuelve (`resolverEmpresaCarta` → `dbDeEmpresa(empresa.id)`, RLS por empresa). Una prueba con dos empresas confirma que ninguna lee el nombre de la otra. — PROPUESTA
- **F3 (validación, lista de permitidos).** Texto de una línea, NFC, 1 a 60 caracteres, sin caracteres de control ni invisibles (incluidas las marcas de dirección y los de ancho cero), sin `<` ni `>` (misma regla que `nombre_visible` de Pedernal; en Motor2 la dan `esTextoDeUnaLinea` y `validarTextoLibreCarta` del catálogo de la carta, con tope 60). Se valida al guardar (servidor) y **otra vez al leer** (un valor cargado por fuera del formulario no pasa). — PROPUESTA
- **F4 (misma respuesta).** Una carta o portal que no resuelve (404) no cambia: ni nombre ni metadatos (los mismos bytes que hoy). — CONFIRMADA por el estado actual del código (S-24); se conserva.
- **F5 (trazabilidad).** Quién y cuándo: la apariencia del portal no es plata y hoy no se audita (`guardarPortalEmpresa`, ficha `auditoria=DOCUMENTO_PROPIO`). No se agrega auditoría nueva (poda: no la pidió nadie). — PROPUESTA
- **F6 (nada se borra).** Quitar el nombre lo vuelve «sin cargar»; no se borra historia (no hay).

### Tabla «¿qué pasa si…?» (comando «guardar el nombre público», dentro de `guardarPortalEmpresa`)

| Situación | Resultado esperado |
|---|---|
| Repetición (clic doble / reenvío) | Mismo estado: es un `upsert` atómico por empresa (`INSERT … ON CONFLICT`); una sola fila. |
| Concurrencia (dos administradores a la vez) | Gana el último (reemplaza todo lo guardado, como hoy); nunca un estado mezclado ni un error de la base. El riesgo de pisarse sigue anotado como pendiente (versión del portal = migración). |
| Tiempo (la carta está cacheada) | Portal: se ve a los 60 s como máximo (`s-maxage=60`). Carta de sucursal: se invalida con la etiqueta de la empresa al guardar (ver nivel 7). |
| Incertidumbre (nombre ilegible o con invisibles) | Se rechaza al guardar con un mensaje que dice qué corregir; no se escribe nada. |
| Reintento tras corte de red | Seguro: idempotente por estado. |
| Error parcial | No hay: una sola escritura. |
| Datos faltantes (empresa sin portal guardado) | Neutro (F1); no se inventa un nombre. |
| Cambio de permisos (se le quita `carta_portal` a quien guardaba) | El servidor rechaza antes de escribir; lo ya guardado no cambia. |

## 6. Historia y persistencia

- **Opciones de dónde vive el dato (inventario validado contra el código):**

| Opción | Qué es | Migración | Contra |
|---|---|---|---|
| **A. `Empresa.nombre`** | Ya existe, único, obligatorio. | Ninguna. | Es el nombre INTERNO (lo ve toda la administración); acoplar los títulos públicos a él cambia lo que ven los clientes cuando alguien renombra la empresa por motivos internos. No se puede ser «neutro» (siempre existe). Su valor actual **no está verificado** contra el texto que hoy muestra la carta (lectura de producción: requiere autorización). |
| **B. Clave nueva del portal `portal_nombre_publico`** (PROPUESTA, recomendada) | Una clave más en el catálogo cerrado de `PortalCartaEmpresa.valores` (Json, hoy 24 claves → 25), zona «Encabezado y títulos». | **Ninguna** (el Json ya existe; sin la clave el portal se lee igual que hoy). | Hay que cargar el valor una vez por empresa (nivel 10). |
| C. Columna nueva en `Empresa` (`nombrePublico`) | Dato propio y separado. | Aditiva y reversible, pero **migración: requiere autorización expresa**. | Más cambio y más superficie por un dato de una línea. |

- **Recomendación (PROPUESTA): B.** Reutiliza lo que ya existe (el portal ya guarda `portal_titulo`, `empresa_logo_url`, `footer_texto_derechos`; su editor, su permiso `carta_portal`, su validación y su aislamiento por empresa) y respeta «primero la opción más barata»: sin tabla ni columna.
- **Compatibilidad hacia atrás:** sin la clave el portal y la carta se leen como hoy en todo lo demás; el único cambio es F1 (neutro) hasta cargar el nombre. Las claves viejas no se tocan.
- **Lo que mira Pedernal:** el nombre visible de la marca es un campo de la definición de la marca (NFC, 1–60, sin caracteres de control/formato, sin `<` `>`), el título es «{pagina} · {sitio}», `og:site_name` = {sitio} y, sin marca (host desconocido o carta no disponible), la página es neutra y sin Open Graph (`docs` de Pedernal: `10-ux-ui/02-marca-iconos-metadatos-y-seo.md` §5.2 y `11-especificaciones/marcas-productos-y-planes.md` §B.3). Diferencias a declarar: en Pedernal lo carga la plataforma (marca nivel 0) y vive en una versión de marca; en Motor2 lo carga la propia empresa y vive en el portal (no hay marcas por host ni versiones). **NO VERIFICADO** contra el código de Pedernal (no hay acceso al repositorio de código desde esta sesión).

## 7. Atomicidad y concurrencia

- Una sola escritura (`guardarValoresDelPortal`, `upsert` atómico por `empresaId`, ya con `INSERT … ON CONFLICT`): todo o nada, idempotente. Dos guardados simultáneos: gana el último, sin error.
- **Caché:** la página del portal sale siempre fresca de la base (la CDN la guarda 60 s). La página de la carta de una sucursal se cachea con la etiqueta de la empresa (`revalidarCartasPublicas(slug)`): hoy `guardarPortalEmpresa` **no** la invalida (porque el portal no se cacheaba); al guardar el nombre público hay que invalidarla, o el título de la carta de sucursal seguiría mostrando el valor anterior hasta 60 s. — PROPUESTA (parte del PR de código).
- La carta de la sucursal hoy **no lee** la configuración del portal (solo la del tema de la sucursal): leerla agrega UNA consulta acotada a la empresa (la misma que ya hace el portal), dentro del contexto RLS de la empresa.

## 8. Acceso e interfaces

- **Quién edita:** el mismo permiso que el resto de la apariencia del portal, **`carta_portal`**, verificado en el servidor (`conPermisoDeEmpresa("carta_portal")` en `guardarPortalEmpresa`); sin acción nueva. Quien solo ve (DEC-33) recibe el campo deshabilitado.
- **Pantalla:** un campo de texto «Nombre público de la empresa (títulos y vista previa al compartir)» en la zona «Encabezado y títulos» de `/carta/portal`, con su ayuda («Es lo que aparece junto al nombre de la carta en la pestaña del navegador y en Google. Vacío = sin nombre»).
- **Lectura pública:** `generateMetadata` de las dos páginas pasa el nombre a las funciones puras de `metadatos.ts` (que dejan de importar una constante y reciben el nombre como parámetro, con F1 cuando es vacío).
- Lo que el cliente manda no se confía: validación y permiso en el servidor; el formulario solo ayuda.

## 9. Consultas y experiencia

- Portal: `configPortalPublica` ya trae `valores`; se toma `portal_nombre_publico` de ahí (sin consulta nueva).
- Carta de sucursal: una lectura más del portal de la empresa (mismo `configPortalPublica`, que ya respeta el módulo Carta).
- Experiencia: sin nombre cargado, el título de la pestaña muestra solo el nombre de la carta; con nombre cargado, «{carta} · {nombre}» como hoy. Nada cambia en el cuerpo de la página.
- **Escalera de producto:** N0 = neutro (sin nombre); N1 = nombre público cargado. Lo que falta se muestra como «sin nombre público cargado» en la pantalla, no se inventa.

## 10. Pruebas, migración y operación

### Dimensiones (regla de combinaciones, 2026-10-28)

Dimensiones cuyas combinaciones cambian lo que ve el cliente: **dato** (sin cargar · válido · guardado pero inválido al leer) × **pantalla** (portal · carta de sucursal) × **superficie SEO** (`title` · `description` · `og:title` · `og:description` · `og:site_name`) × **empresa** (la propia · otra empresa con otro nombre).

### Oráculo (tabla de lo esperado, escrita aparte del código)

| Dato | Pantalla | Título | Descripción | `og:site_name` |
|---|---|---|---|---|
| válido «Empresa B» | carta de «Sucursal 1» | «Sucursal 1 · Carta · Empresa B» | «Carta de Sucursal 1 — Empresa B. {secciones}» | «Empresa B» |
| válido «Empresa B» | portal sin título propio | «Empresa B · Cartas» | «Cartas de Empresa B: {sucursales}.» | «Empresa B» |
| sin cargar | carta de «Sucursal 1» | «Sucursal 1 · Carta» | «Carta de Sucursal 1. {secciones}» | **ausente** |
| sin cargar | portal | «Cartas» | «Cartas: {sucursales}.» | **ausente** |
| inválido al leer | cualquiera | igual que «sin cargar» | igual | **ausente** |
| la otra empresa tiene «Empresa C» | portal/carta de la primera | solo el de la primera | solo el de la primera | solo el de la primera |

Un guardián falla si aparece una dimensión nueva (otra superficie `og:*`, otra página pública) sin declararla. Los tests actuales de `metadatos.ts` y el e2e `carta-publica-seo.spec.ts` se reescriben contra esta tabla: la constante `MARCA_PUBLICA` desaparece y los textos esperados salen del dato de prueba.

### Pruebas de las reglas

- F1: sin dato / dato inválido → neutro y sin `og:site_name`.
- F2: dos empresas con nombres distintos (y una sin nombre): cada una ve solo el suyo; ninguna página de una empresa contiene el de la otra.
- F3: la validación rechaza control, invisibles, bidireccionales, `<`/`>`, vacío tras recortar y más de 60; acepta acentos y la «ñ».
- Concurrencia / idempotencia (`guardarPortalEmpresa`): dos guardados simultáneos y repetidos, una fila.
- Permisos: sin `carta_portal` no se escribe (servidor); aislamiento entre empresas.
- Caché: guardar el nombre invalida la carta de sucursal de ESA empresa (y solo de esa).

### Migración y operación

- **Código: sin migración** (opción B). El orden de los PR es: (1) la clave, su validación y el campo del editor; (2) las funciones de metadatos reciben el nombre, las dos páginas lo leen, se invalida la caché y desaparece `MARCA_PUBLICA`.
- **Cargar el valor actual («la carta de hoy debe seguir diciendo exactamente lo mismo») — CONFIRMADA.** Decisión del dueño, 2026-11-14, chat con el orquestador (pregunta con opciones; cita literal): **«Lo carga el administrador al desplegar (Recomendada)»** (sin migración; unos 60 s con títulos neutros hasta que se actualiza la caché). Como la producción está congelada hasta el despliegue único y el campo no existe antes de desplegar, el valor se carga **justo después** de desplegar, desde `/carta/portal`; hasta que se guarda (y pasan los 60 s de la caché) los títulos salen **neutros** (nunca rotos ni con el nombre de otra empresa). Paso de despliegue: `docs/checklist-previo-al-deploy-2026-11-13.md` §10.
  - *Descartada: migración de DATOS que cargue la clave al desplegar (cero ventana).* Motivo: requiere autorización expresa de migrar, pondría el nombre real dentro de una migración del repositorio público (o lo copiaría de `Empresa.nombre`, cuyo valor actual habría que verificar con una lectura de producción autorizada) y no hace falta para un dato que se carga en un minuto.
  - *Descartada: respaldo transitorio a `Empresa.nombre`.* Motivo: solo serviría si ese valor coincide hoy con el texto de la carta (sin verificar) y mantiene el acoplamiento entre lo público y el nombre interno que la opción B quiere evitar; además deja de ser «fallar cerrado».
- **Operación:** sin variables nuevas, sin cambios en Vercel ni en el CI. La instalación de una sola empresa por dominio (`CARTA_EMPRESA_UNICA`) no cambia: el nombre sale de la empresa que resuelve el dominio.

## Preguntas abiertas

Ninguna: la carga del valor actual quedó CONFIRMADA (nivel 10). Lo que sigue pendiente es solo el OK del dueño para construir (los dos PR del nivel 10).

## Necesidad, poda y alcance

- La necesidad está escrita arriba (decisión del dueño, 2026-11-14). Se hace **solo** el nombre público (no se suman logo, colores ni textos nuevos), con la forma más barata (una clave del portal); lo grande (versión del portal, auditoría del cambio) queda como etapa posterior con nombre y no entra.
