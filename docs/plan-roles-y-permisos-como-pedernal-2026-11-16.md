# Plan: roles y permisos «como Pedernal» (3 decisiones del dueño, 2026-11-16)

> **Solo un plan por escrito.** No cambia código, pruebas, migraciones, permisos ni textos. Base: Motor2 `main` 387452f9 (incluye #317, #318). Pedernal leído de `main` hoy: `ZuluHub-ERP` 20c1a2c y `ZuluHub-docs` 53ffa39 (`git fetch` hecho). Antecedente: `docs/auditoria-roles-y-permisos-vs-pedernal-2026-11-16.md` (#318).
> **Pedido y decisión del dueño (2026-11-16, literal, relatado por el orquestador; el registro `motor2-docs`, «Roles y permisos: respuesta del dueño», no lo leí yo):** «como pedernal,» a las tres preguntas de la auditoría. Lo que eso significa, según el orquestador: (a) empresa nueva sin roles propios, perilla en 0 que sube el dueño; (b) el operador tiene los permisos de Parte al nacer, como Pedernal; (c) el nombre visible de «Operador» pasa a «Empleado» (solo texto; la clave interna no cambia). El «Empleado» está confirmado también en Pedernal: fila 206, «1 si empleado».
> Estados: CONFIRMADA (cita del dueño) · PROPUESTA · PENDIENTE · NO VERIFICADA.

## 0. Resumen

1. **Parte (b):** Pedernal da al operador las 6 acciones de ficha de uso diario (ver, crear, editar, cambiar roles, vincular y desvincular contacto) y reserva a gerente y administrador las 2 de cerrar y reabrir (desactivar, reactivar). Motor2 junta esas 8 en 3 claves cuya partición coincide exactamente con esa frontera, así que el resultado se iguala dándole al operador `partes_ver` y `partes_editar`; `partes_desactivar` (piso administrador) no se le da ni se le puede dar. **Es una migración de datos nueva, aditiva, idempotente y reversible.** No se edita la `20261115152000` (ya mergeada, aún sin aplicar a ninguna base real, según el orquestador).
2. **«Empleado» (c):** hoy «Operador» **no está escrito como texto en ninguna pantalla**: lo que se ve es el nombre del rol guardado en la base (`Rol.nombre = 'operador'`, en minúscula). Cambiarlo es **un cambio de datos más una constante de la siembra**, no un cambio de textos; **no hace falta ningún texto nuevo** en el catálogo T1. Eso evita el límite de «un texto de permisos no es delegable».
3. **Perilla de roles propios (a):** la forma más barata es **una perilla más en la política de plataforma que Motor2 ya tiene** (`permisosEditables`, `dosPaneles`): una columna entera `rolesPropiosMax` en `Empresa`, `DEFAULT 0`, que cambia solo la plataforma por el mismo script y con la misma auditoría. Hay **un riesgo de concurrencia real** en el alta de rol (hoy corre en READ COMMITTED) que el plan corrige.
4. **Qué requiere autorización expresa por base:** la migración del nombre «Empleado» (reescribe datos) y las otras dos al aplicarse. Orden: partes, perilla, nombre.
5. **Qué queda para después, con nombre:** los roles base que la empresa no puede editar (E-A), pisos y plantillas editables por la plataforma (E-B), rol de rango intermedio `Rol.nivel` (E-C), y alinear el nombre «admin» con «Administrador» (pregunta de §9).

## 1. Qué da Pedernal al operador en Parte (vigente, `main` de hoy)

Fuente: `ZuluHub-ERP/src/capacidades/permisos/empresa.ts:204-211`; efectos en `src/capacidades/modulos/catalogo.test.ts:262-269`; decisión F1 de `clientes-y-proveedores.md` («el operador busca, da de alta y edita, también roles y contactos; no desactiva ni anonimiza»).

| Acción de Pedernal | GERENTE | ADMINISTRADOR | OPERADOR | Efecto | Clave de Motor2 que la cubre | Piso en Motor2 |
|---|---|---|---|---|---|---|
| `partes.ver` | sí | sí | **sí** | LECTURA | `partes_ver` | operario |
| `partes.crear` | sí | sí | **sí** | CREA_AMPLIA | `partes_editar` | operario |
| `partes.editar` | sí | sí | **sí** | CREA_AMPLIA | `partes_editar` | operario |
| `partes.cambiar_roles` | sí | sí | **sí** | CREA_AMPLIA | `partes_editar` | operario |
| `partes.vincular_contacto` | sí | sí | **sí** | CREA_AMPLIA | `partes_editar` | operario |
| `partes.desvincular_contacto` | sí | sí | **sí** | CREA_AMPLIA | `partes_editar` | operario |
| `partes.desactivar` | sí | sí | no | COMPLETA_CIERRA | `partes_desactivar` | **administrador** |
| `partes.reactivar` | sí | sí | no | CREA_AMPLIA | `partes_desactivar` | **administrador** |

Las 3 claves de Motor2 están en `src/core/permisos/acciones.ts:238-240` y su semilla hoy es solo `admin` (migración `20261115152000_permisos_partes`).

**Diferencias declaradas con motivo:**
| # | Diferencia | Motivo | Estado |
|---|---|---|---|
| D-1 | Motor2 tiene 3 claves; Pedernal 8 | La partición de Parte P1 de Motor2 (`docs/diseno-parte-ficha-unica-2026-11-15.md`) agrupa por la misma frontera de roles: el **resultado** es idéntico para los tres roles. Partir `partes_editar` en 5 y `partes_desactivar` en 2 no cambia ningún resultado y sumaría claves que nadie pidió | PROPUESTA (no partir) |
| D-2 | En Pedernal, «reactivar» tiene efecto distinto a «desactivar» (cierra/abre); en Motor2 comparten clave | Igual: mismos roles. Si el dueño quisiera permisos distintos para reactivar, se parte entonces | PROPUESTA |
| D-3 | En Pedernal el operador puede recibir cualquier acción por rol propio; en Motor2 un rol de rango operario no alcanza las claves de piso administrador | ADR-027 (piso por nivel) y `Rol.nivel` aún no existe (auditoría fila 8). No afecta a Parte: las 2 claves del operador son de piso operario | Etapa E-C |

## 2. Cambiar la semilla de Parte de forma segura

### 2.1 Qué se cambia (cuando se apruebe)

| Pieza | Cambio | Dónde (hoy) |
|---|---|---|
| Migración **nueva** `<AAAAMMDDHHMMSS>_permisos_partes_operador` (`migration.sql`, `down.sql`, `verificacion-previa.sql`) | Inserta `PermisoRol` para el rol `clave='operador'` de cada empresa: `partes_ver` y `partes_editar` con Ver y Editar en `true` (igual que las filas del admin en `…152000`, porque `matrizDeFabrica` hace Ver = Editar); `partes_desactivar` **no** | modelo en `prisma/migrations/20261115152000_permisos_partes/migration.sql` |
| Semilla del código | `rolesEditarSemilla` de `partes_ver` y `partes_editar`: `["admin", "operador"]`; `partes_desactivar` no cambia | `acciones.ts:238-240` |
| Prueba de la migración vieja | La prueba `test/permisos/migracion-permisos-partes.test.ts` afirma «NINGÚN otro rol» y «coincide con la semilla del código» (líneas 47 y 51): al cambiar la semilla esas dos afirmaciones quedan falsas **sin que la migración vieja haya cambiado**. Hay que reescribirlas: la semilla del código = lo que dejan **las dos migraciones juntas** | `test/permisos/migracion-permisos-partes.test.ts` |
| Prueba nueva | `test/permisos/migracion-permisos-partes-operador.test.ts` (patrón del test viejo: `aplicarAntesDe`, dos empresas, idempotencia, no pisa, `down.sql`) | nuevo |
| Oráculos | `test/permisos/matriz-esperada.ts`, `test/arquitectura/caracterizaciones-congeladas.test.ts`, `clases-de-claves.test.ts`, `piso-de-gobierno.test.ts` y `matriz-poda.test.ts` nombran `partes_*`: revisar cuáles recorren la semilla del operador | existentes |

Todo el código y las pruebas los escribe **Sonnet** (regla del dueño, 2026-11-04). Este plan no lo hace.

### 2.2 Reglas de la migración (patrón de Parte P1)
- **Aditiva y de datos**: no cambia el esquema. Fase EXPANDIR: el código anterior ignora filas de más.
- **Por clave estable**, nunca por nombre: `WHERE r."clave" = 'operador'` (importa porque se va a renombrar a «empleado»).
- `empresaId` tomado de la fila del rol (la migración corre como dueño y `app_empresa_actual()` da NULL).
- `ON CONFLICT ("rolId","accionClave") DO NOTHING`: **no pisa** lo que el gerente ya configuró, ni reactiva lo que apagó.
- No copia `CapacidadSucursal` (sin fila, la acción está habilitada en toda sucursal).
- Idempotente.
- `down.sql`: borra **solo** las filas del operador para esas 2 claves que sigan iguales a la semilla (Ver y Editar en `true`); **aborta sin tocar nada** si hay una fila del operador con otra configuración o una capacidad por sucursal sobre esas claves. Límite honesto: no distingue una fila que el gerente configuró y quedó igual a la semilla.
- **Orden de reversa:** el `down.sql` de `…152000` aborta si existe «una fila de un rol que no es la semilla» (hoy: cualquier fila que no sea del `admin`). Con esta migración aplicada, **hay que bajar primero la nueva** y después la vieja. Va escrito en el encabezado de ambos.
- `verificacion-previa.sql` (solo lectura, cuentas, sin nombres ni emails): empresas; roles `operador`; empresas **sin** rol `operador` (no recibirían nada); filas ya existentes del operador para esas claves (tiene que dar 0 o se mira quién); y, después, filas por clave igual a roles `operador`.

### 2.3 Qué pasa con empresas que ya tengan filas (tabla de casos)

| Caso | Resultado |
|---|---|
| Base que **nunca aplicó** `…152000` | Prisma aplica en orden: primero admin, después operador. Resultado final igual |
| Base que ya la aplicó (admin con las 3 claves) | Se suman las 2 filas del operador. El admin no se toca |
| El gerente ya le dio `partes_ver` al operador a mano | `ON CONFLICT DO NOTHING`: queda como está |
| El gerente le **apagó** `partes_editar` al operador a mano | La fila existe: no se reactiva (respeta lo decidido) |
| Empresa **sin** rol `operador` de sistema (sin clave tras el backfill) | No recibe nada; la lista `verificacion-previa.sql` |
| Rol propio (clave `null`) | No recibe nada (todo nace cerrado) |
| Empresa con `permisosEditables = false` | Recibe igual: la perilla bloquea **editar** la matriz, no la semilla |
| Empresa creada **después** (alta nueva) | Recibe por la semilla del código (`matrizDeFabrica`), no por la migración |

### 2.4 «¿Qué pasa si…?» (Parte)

| Situación | Qué pasa | Cubierto por |
|---|---|---|
| Repetición | Segunda corrida sin cambios | prueba de idempotencia |
| Concurrencia | La migración corre sin tráfico de matriz; si un gerente guarda a la vez, `ON CONFLICT` evita duplicar y el guardado ve el conflicto de edición (`matriz.ts:111`) | prueba y `guardar-permisos*.test.ts` |
| Tiempo | Un operador con sesión abierta ve la ficha **en la operación siguiente** (el guard relee la membresía) | sin caché |
| Incertidumbre | No se sabe si una base ya tiene configuración a mano | `verificacion-previa.sql` antes |
| Reintento | Aplicar de nuevo no cambia nada | idempotencia |
| Error parcial | Una transacción por migración | Prisma |
| Datos faltantes | Empresa sin rol operador | lista previa |
| Cambio de permisos | El gerente le saca después `partes_editar` | `matriz` normal; la migración no vuelve a ponerla |
| Piso | Alguien intenta darle `partes_desactivar` al operador | rechazo por piso (`guardarPermisos`) |

## 3. Dónde aparece «Operador» como nombre visible (inventario del código real)

Búsqueda sobre `src/`, `plataforma/src/`, `prisma/seed.ts` y `scripts/` (sin tests). **Resultado: no hay ningún texto de pantalla «Operador»** en `.tsx` ni en el catálogo de textos (`src/core/textos/catalogo.ts` tiene hoy solo la familia de Presentaciones; en Pedernal sí existe `rol.operador.nombre` en su vocabulario, `capacidades/vocabulario/catalogo.ts:61`, otro mecanismo).

| Dónde | Qué es | Es nombre visible? | Qué hacer |
|---|---|---|---|
| `src/core/permisos/roles-de-fabrica.ts:10` | `{ nombre: "operador", clave: "operador" }`: el nombre con el que se crea el rol en el alta | **Sí** (la pantalla de roles y de permisos muestra `Rol.nombre` tal cual) | Cambiar el nombre **inicial** a «empleado». Ojo: `NombreDeRolDeFabrica` (línea 13) usa ese `nombre` como **clave de un objeto** (`{ admin, operador }` en `plataforma/src/servidor/sembrar-empresa.ts:22` y en `matrizDeFabrica`); el cambio mínimo es agregar un campo aparte (`nombreInicial`) y dejar `nombre` como identificador de código, para no tocar las ~100 pruebas que lo usan |
| `prisma/seed.ts:50` (y `:61`) | `create: { nombre: "operador", clave: "operador" }` | Sí (siembra de desarrollo) | Mismo nombre inicial |
| `src/core/permisos/nombres-de-rol.ts:14-15` | Nombres reservados `operador` y `operario` → clave `operador` | Es una regla, no un texto | **Sumar `empleado`** → clave `operador`. Se **mantienen** «operador» y «operario» reservados (no es retroactivo y evita que alguien cree un rol con el nombre viejo y se confunda) |
| Filas existentes `Rol.nombre = 'operador'` | Dato por empresa | **Sí** | Migración de datos (§3.2) |
| Mensajes de denegación «Tu rol ("operador") no tiene…» (`motivos.ts`) | Armados con `Rol.nombre` | Sí, **se actualizan solos** al cambiar el dato | Nada |
| `jerarquia.ts:9`, `acciones.ts` (`rolesEditarSemilla`), pruebas, `QUIENES` de Ocultar (`operador_de_este_local`) | Identificadores internos | No | **No se tocan** (la clave interna no cambia, como pide el dueño) |
| `permisos-matriz.tsx:223,274` | Habla de «piso» y de «operario» | **Otro concepto** (nivel mínimo de una acción), no el nombre del rol | No se toca. Queda anotado para que nadie confunda «operario» (nivel) con el nombre del rol |

### 3.1 La forma más barata
Cambiar el nombre **como dato**, sin tocar la clave ni ningún permiso: nombre inicial en la siembra + una migración que renombra donde el nombre sigue siendo el de fábrica. **Cero textos nuevos en T1**, por eso no hay nada que delegar ni que preguntar por el límite de «permisos».

### 3.2 Migración del nombre (reescribe datos → autorización expresa por base)
- `UPDATE "Rol" SET "nombre" = 'empleado' WHERE "clave" = 'operador' AND "nombre" = 'operador'` y **solo si** la empresa no tiene ya otro rol llamado `empleado` (la unicidad `(empresaId, nombre)` lo frenaría). Si la empresa lo renombró a mano (por ejemplo «cajero»), **no se toca**.
- `down.sql`: devuelve a `operador` solo donde la clave es `operador` y el nombre es `empleado`, y no haya otro rol `operador`. Aborta si hay conflicto.
- `verificacion-previa.sql`: cuántos roles `operador` hay con el nombre de fábrica, cuántos renombrados a mano, y cuántas empresas ya tienen un rol llamado `empleado` (esas se saltean y se listan).
- **Trazabilidad:** `RegistroAuditoria` exige un `actorId` que sea un `User` (`schema.prisma:300-315`) y una migración no tiene usuario. Propuesta: **no** escribir filas de auditoría desde SQL; dejar el antes/después en el comentario de la migración y en la salida guardada de `verificacion-previa.sql` en el PR. Es un compromiso contra la regla «todo cambio deja registro»; **PENDIENTE** de aceptar (alternativa más cara: un script de plataforma que renombre empresa por empresa con `AuditoriaPlataforma`).
- **Mayúscula:** todos los roles se guardan en minúscula (`normalizarNombreDeRol`, `nombres-de-rol.ts:20`; hoy se ve «admin» y «operador»). «Empleado» quedaría «empleado». Si el dueño quiere «Empleado» con mayúscula, es otro cambio de presentación (NO VERIFICADO cómo la pantalla lo muestra).

## 4. La perilla «roles propios por empresa», nacida en 0

### 4.1 Qué es un «rol propio» hoy
Un `Rol` con `clave = null` (los de sistema tienen clave: `schema.prisma:194-196`). Se crean con `crearRolCasoDeUso` (`src/server/actions/permisos/casos-de-uso/crear-rol.ts:31`) y se **reactivan** con `actualizarActivoRolCasoDeUso` (`actualizar-activo-rol.ts:31`). Hoy, con `permisosEditables = true` (valor por defecto), una empresa los crea **sin tope**.

### 4.2 La forma MÁS BARATA
Usar el mecanismo que ya existe para lo que decide la plataforma: `PoliticaDeEmpresa` (`src/core/permisos/politica-de-empresa.ts:13`) + `cambiarPoliticaDeEmpresa` (`src/server/operaciones-de-plataforma/cambiar-politica-de-empresa.ts`) + `scripts/politica-empresa.ts`, con su auditoría `AuditoriaPlataforma` y su `FOR UPDATE` de la empresa. **No hace falta ninguna tabla nueva.**

| Pieza | Cambio | Dónde |
|---|---|---|
| Columna | `Empresa.rolesPropiosMax INTEGER NOT NULL DEFAULT 0 CHECK (>= 0)` (migración aditiva; `down.sql` que **aborta** si alguna empresa tiene un valor distinto de 0) | `schema.prisma:2607` (junto a `permisosEditables`) |
| Política | `PoliticaDeEmpresa.rolesPropiosMax: number` (los perfiles `completo` y `lite` fijan un valor; ver supuesto S-3) | `politica-de-empresa.ts:13-26` |
| Cambio por plataforma | El script recibe `--roles-propios-max N`; el cálculo puro es `planDeCambioDePolitica` | `cambio-de-politica.ts` |
| Regla | Crear un rol propio, o reactivar uno archivado, exige `rolesPropiosActivos < rolesPropiosMax`; si no, rechazo con el texto **ya existente** «Esta acción no está permitida» (`capacidades/vocabulario/catalogo-catalogo.ts:104`) | un helper puro en `core/permisos/` + los 2 casos de uso |
| Guardián | La perilla solo la cambia la plataforma (ampliar `politica-de-empresa-solo-plataforma.test.ts`) | existente |

### 4.3 Reglas
| # | Regla | Estado |
|---|---|---|
| R-1 | Cuentan los roles propios **activos**; archivar libera cupo y reactivar vuelve a contar. Los de sistema (`admin`, `operador`) no cuentan | PROPUESTA (igual a S14 de Pedernal) |
| R-2 | **Bajar el tope o nacer en 0 no desactiva ni edita ningún rol existente:** solo se bloquea crear y reactivar (S13 de Pedernal). Una empresa que hoy tiene roles propios los conserva | PROPUESTA |
| R-3 | El tope lo cambia solo la plataforma; la empresa no | CONFIRMADA («la sube el dueño», fila 203 de Pedernal) |
| R-4 | `permisosEditables = false` sigue bloqueando editar la matriz y gestionar roles, **aunque el tope sea mayor que 0** | PROPUESTA (las dos perillas se suman, no se reemplazan) |

### 4.4 Riesgo de concurrencia que hay que cerrar (existe hoy)
`crearRolCasoDeUso` corre en **READ COMMITTED** y chequea el nombre **fuera** de la transacción (`crear-rol.ts:36-41`). Con un tope, dos gerentes creando a la vez con cupo 1 **pasarían los dos**. Solución propuesta: dentro de la transacción, tomar la fila de la empresa (`SELECT … FOR UPDATE`, como ya hace `cambiarPoliticaDeEmpresa`) y recién ahí contar y decidir; lo mismo en la reactivación. Prueba de concurrencia: dos altas simultáneas con cupo 1 → una sola crea. Prueba de idempotencia: repetir el alta devuelve «Ya existe el rol» y no gasta cupo.

### 4.5 «¿Qué pasa si…?» (perilla)
| Situación | Qué pasa |
|---|---|
| Empresa nueva | `rolesPropiosMax = 0`: no crea ni reactiva roles propios (con `permisosEditables` en cualquier valor) |
| Empresa existente con roles propios | Los conserva y los edita (`permisosEditables` aparte); **no puede crear otros** hasta que la plataforma suba el tope |
| Plataforma sube el tope a 1 | La empresa crea 1; el siguiente falla; archivar el primero libera el cupo |
| Plataforma baja el tope con 3 activos | No se toca ninguno; no se crean más |
| Dos altas a la vez, cupo 1 | Una crea, la otra recibe el rechazo (§4.4) |
| Reintento del mismo alta | «Ya existe el rol»; sin gasto de cupo |
| Permisos cambian a mitad | El gerente pierde `gestion_roles`: el guard lo corta en la operación siguiente |
| Datos faltantes | Empresa sin la columna (no puede pasar: tiene `NOT NULL DEFAULT 0`) |

### 4.6 Qué queda como etapa posterior (con nombre)
- **E-A. Roles base no editables por la empresa** (Q2-A de Pedernal). Hoy la matriz de `operador` la edita quien tenga `gestion_permisos` (`matriz.ts:59-61`). «Como Pedernal» lo exigiría, pero **no está en lo que el orquestador me pasó como (a)** y quita una capacidad que hoy existe: **PENDIENTE** (§9).
- **E-B. Pisos y plantillas editables por la plataforma** (las 6 tablas de la 0061 de Pedernal, T1 y los 7 tramos siguientes): sin necesidad escrita para Motor2.
- **E-C. `Rol.nivel` (ADR-027 F3)** para un «Encargado» de rango intermedio. Pedernal lo resuelve con un rol propio sin piso; en Motor2 hace falta el nivel.
- **E-D.** Pedernal 0061 (2 PR) = tablas de roles, plantillas y pisos, **ninguna se lee todavía**; en Motor2 las equivalencias están en la auditoría. No se construye nada de eso ahora.

## 5. Diferencias con Pedernal, declaradas con motivo
| # | Tema | Pedernal | Motor2 (propuesta) | Motivo |
|---|---|---|---|---|
| 1 | Cantidad de claves de Parte | 8 | 3 | Misma partición de roles (§1, D-1) |
| 2 | Rol de la persona | por empresa | por sucursal | DATOS existentes (auditoría fila 2); **sin motivo del dueño** |
| 3 | Dónde vive el nombre «Empleado» | vocabulario por clave (derivado) | dato guardado por empresa y editable | `Rol.nombre` es dato editable por la empresa (`renombrar_rol`): se migra donde sigue siendo el de fábrica |
| 4 | Dónde vive la perilla | `roles_propios_por_empresa` del plan (por plan) | columna en `Empresa` (por empresa) | Motor2 no tiene planes con perillas; la política de plataforma por empresa **ya existe**. Cuando haya planes, el valor se deriva de ahí |
| 5 | Roles propios del dueño de la empresa | tras la perilla, el gerente los gestiona | tras la perilla y `permisosEditables`, quien tenga `gestion_roles` | Modelo de permisos distinto; E-A lo acercaría |
| 6 | Valor inicial de la perilla | 0; la fila 191 dice «1 por plan» | 0 | Se toma la fila 203 (la posterior; «nace en 0 para cualquier plan»). La contradicción 191/203 sigue sin resolverse en Pedernal |

## 6. Pasos chicos, en orden

| Paso | Qué | Quién | Autorización | Verificación |
|---|---|---|---|---|
| P0 | Este plan (documento) | hecho | — | PR en borrador |
| P1 | Parte: migración `…permisos_partes_operador` + semilla + pruebas (§2) | Sonnet | **Expresa por cada base real** (migración de datos) | gate de §7 y `verificacion-previa.sql` antes y después |
| P2 | Perilla: columna `rolesPropiosMax` + política + script + helper puro + regla en crear y reactivar con `FOR UPDATE` + pruebas de concurrencia e idempotencia (§4) | Sonnet | Expresa por base (la columna es aditiva y reversible, pero cambia lo que puede hacer una empresa existente: no puede crear roles hasta que se suba) | gate |
| P3 | «Empleado»: nombre inicial en la siembra y en `seed.ts`, nombre reservado `empleado`, migración de datos del nombre (§3) | Sonnet | **Expresa por base** (reescribe datos) y aceptación del compromiso de auditoría | gate |
| P4 | (Posterior) E-A, E-B, E-C | — | cada una con su diseño | — |

**Orden:** P1 → P2 → P3, **un PR de código en vuelo** a la vez; P3 no depende de P1 ni de P2, pero se deja último por tocar datos que la empresa puede haber editado. Cada etapa se diseña con la escalera de 10 niveles: los niveles 1 a 5 de cada una están resueltos arriba (propósito = las 3 decisiones; actores = plataforma, gerente, operador; casos = tablas de «qué pasa si…»; conceptos = rol propio = `clave null`; invariantes = R-1 a R-4 y «todo nace cerrado»).

**Dimensiones que cambian permisos** (para el oráculo de combinaciones, 2026-10-28): rol de sistema o propio × `permisosEditables` × `rolesPropiosMax` (0, igual al uso, mayor) × piso de la acción. Tabla de reglas esperada escrita aparte del código y un test que recorre las combinaciones; un guardián que falle si aparece una dimensión nueva.

## 7. Verificación final (obligatoria en cada paso de código, en la misma corrida y todos limpios)
1. `npx tsc --noEmit`
2. `npm run lint`
3. `npm run arquitectura`
4. `npm run analizar:muerto` (0 hallazgos)
5. `npm test`
6. `npm run build`
7. `npm run plataforma:build`
8. `npm run test:e2e`

Criterio de éxito: los 8 en cero errores. Además, para cada migración, aplicar y revertir sobre una base temporal (el patrón `crearBaseTemporalMigrada`) y ensayar en Neon antes de cualquier base real, **solo por el workflow manual aprobado por el dueño**.

## 8. Qué choca con lo que está en vuelo
- **Parte, segunda rama:** si escribe más filas para el operador, hay que coordinar con P1 para no duplicar la semilla. Esperar a P1.
- **Pantalla de Ocultar:** no cambia (#317 ya está en `main`: gerente y administrador).
- **`…152000`:** no se edita; su `down.sql` queda condicionado al orden de §2.2.
- **Pedernal T1/T3:** si Pedernal integra la 0061 y empieza a leer de tablas, volver a mirar `PLANTILLAS_SEMILLA` y repetir este cuadro.

## 9. Preguntas pendientes (una por vez, solo las que cambian permisos o datos)

**Primera (la que cambia permisos):** hoy el gerente de una empresa puede editar la matriz del rol «operador» (en Pedernal los roles base no los edita la empresa: Q2-A del 14/11). ¿«Como Pedernal» incluye sacarle esa capacidad a la empresa de Motor2 (E-A), o por ahora se mantiene?

Otras dos quedan **abiertas, no como supuesto**, para cuando toque: (i) «Gerente, Administrador y Empleado» (fila 206) implica que el rol que hoy se ve como «admin» pase a «administrador»: no lo toqué porque no lo pidió el orquestador; (ii) aceptar que la migración del nombre no deje fila de auditoría (§3.2).

## 10. Supuestos declarados (si no se corrigen, quedan; costo de revertir)
| # | Supuesto | Costo de revertir |
|---|---|---|
| S-1 | «Como Pedernal» para Parte = solo `partes_ver` y `partes_editar` al operador; `partes_desactivar` queda en administrador | Una migración más |
| S-2 | La perilla vale 0 para **todas** las empresas existentes, incluida la que ya tenga roles propios (conservan los suyos) | Subir el valor por script |
| S-3 | Los perfiles `completo` y `lite` de la política siguen igual en `permisosEditables`; el valor de `rolesPropiosMax` por perfil lo fija el dueño al subirlo (por defecto 0 en ambos) | Cambio de una constante |
| S-4 | El nombre «Empleado» se guarda en minúscula como todos los roles | Cambio de presentación |
| S-5 | La `20261115152000` no está aplicada a ninguna base real (me lo dijo el orquestador; no lo verifiqué) | Si ya está aplicada, el plan sigue valiendo (§2.3) |

## 11. Qué verifiqué y qué no
- **Verifiqué:** las 8 acciones y sus roles en Pedernal de hoy (`empresa.ts:204-211`); las claves de Motor2 (`acciones.ts:238-240`); la migración `…152000` con su `down.sql` y `verificacion-previa.sql`; `crear-rol.ts`, `actualizar-activo-rol.ts`, `politica-de-empresa.ts`, `cambiar-politica-de-empresa.ts`; `nombres-de-rol.ts`, `roles-de-fabrica.ts`, `seed.ts`; que no hay «Operador» como texto en `.tsx`; el texto genérico «Esta acción no está permitida».
- **No verifiqué:** que las pruebas de §2.1 se rompan o no (no las corrí; lo deduzco de su texto); si `guardarPermisos` aplica algo especial al operador; cómo muestra la pantalla el nombre de un rol (mayúscula); si hay `plataforma/` con textos de «operador»; cuántos tests dependen del nombre literal (cuento ~100 archivos con la palabra, no cuántos dependen del **nombre**); el registro `motor2-docs` con la respuesta del dueño; el estado real de las bases.
- **Prueba para el dueño, sin leer código** (cuando se construya P1): entrar como operador a una empresa de prueba y abrir la ficha de personas y empresas: debería poder **buscar, dar de alta y editar**, y **no** ver «desactivar».
