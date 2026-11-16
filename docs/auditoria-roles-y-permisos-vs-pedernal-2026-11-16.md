# Auditoría de paridad: roles y permisos, Motor2 contra Pedernal (2026-11-16)

> Documento de auditoría y diseño en papel. **No cambia código, pruebas, migraciones, permisos ni textos.** Base: Motor2 `main` e1a83d03. Pedernal: `ZuluHub-ERP` `main` 93ad001 (16/11, clon superficial, sin historial) y `ZuluHub-docs` dec9f6a (leído directo del repo; el orquestador ofreció copias en `motor2-docs`, no hizo falta).
> **Pedido del dueño (2026-11-16, palabras literales):** «De lo que ya tenemos y que ya esta en pedernal también, ahora mismo estan haciendo el tema de roles... Y permisos...». Regla de paridad del 2026-11-13: «Necesitamos ser iguales [a Pedernal] en todo… El resultado tiene que ser el mismo y sobre todo de las mismas formas, salvo porque nosotros usamos Prisma».
> Estados: CONFIRMADA (cita del dueño) · PROPUESTA · PENDIENTE · NO VERIFICADA. Existencia: YA EXISTE · DISEÑADO · NO EXISTE.

## 0. Resumen para el dueño

1. **Las dos empresas arrancan de puntos opuestos.** Pedernal tenía 3 roles fijos escritos en el código y los está pasando a datos (roles propios, pisos, plantillas). Motor2 **ya tiene los roles como datos por empresa** (tabla de roles, matriz «Ver / Editar» por rol, pantalla para editarla) y un interruptor de la plataforma (`permisosEditables`) que lo habilita o no. Lo que hace Pedernal «nuevo» en gran parte ya está en Motor2, con otra forma.
2. **Hoy Motor2 es más permisivo que Pedernal por defecto.** Una empresa nueva de Motor2 nace «completa»: su gerente puede crear cuantos roles quiera y cambiar lo que puede el operador. En Pedernal, el rol propio es un extra del plan que **nace en 0**, y los 3 roles base **no los edita la empresa** (sigue la plantilla de la plataforma). El dueño dijo «A» a eso el 14/11 (Q2) y «la perilla nace en 0» el 16/11.
3. **Pedernal tiene 20 acciones «solo gerente» y 4 «de todos» (pisos que fija la plataforma desde pantalla).** Motor2 tiene pisos, pero son otra cosa: 4 niveles escritos en el código (operario, administrador, administrador de sistema, gerente), no editables por la plataforma, y solo 2 acciones son de gerente.
4. **La diferencia de resultado más importante es el «Encargado».** En Pedernal una empresa puede armar un rol propio con casi cualquier acción (menos los 20 pisos de gerente). En Motor2 un rol creado a mano es de rango «operario» y **no puede recibir ninguna de las 61 acciones de nivel administrador** hasta que exista `Rol.nivel` (ADR-027 F3, DISEÑADO, no construido).
5. **Lo más barato para parecerse a Pedernal no es código:** poner `permisosEditables = false` en una empresa se comporta como la perilla en 0 (sin roles propios, sin editar). Todo lo demás es etapa posterior con nombre, y **ninguna tiene una necesidad escrita hoy** (el cliente actual cargó solo productos y carta).
6. **Una contradicción en los registros de Pedernal** (filas del 16/11): una dice «roles propios por plan: 1» y otra, posterior en el archivo, «la perilla nace en 0 para cualquier plan y yo la subo». Hay que resolverla antes de copiar un valor. Ver la pregunta de §9.

## 1. Fuentes y límites de la lectura

| Fuente | Leído | Límite |
|---|---|---|
| `ZuluHub-docs` `11-especificaciones/h4-permisos.md`, `h4b-permisos-configurables.md`, `02-arquitectura-y-fronteras/referencias/permisos-dimensiones.md`, `08-adr/ADR-008-…md`, `decisiones-del-dueno-2026-11.md` (filas 163 a 205) | Completos | Son la fuente del «por qué» |
| `conceptos/rol-de-la-parte.md` | Solo el encabezado y la línea 23 | **No es de permisos:** trata de «cliente, proveedor o ambos» (el rol de una ficha). Se cruza con permisos solo en las acciones `partes.*` (§4, fila 14) |
| `ZuluHub-ERP` `src/capacidades/permisos/{roles,guard,exigir,alcance,empresa}.ts` | Leídos | Clon superficial: no hay historial de qué se mergeó hoy |
| Migración **0061** de Pedernal | **NO está en `main`.** La última del clon es la 0057 y la 0058 está aprobada pero «no se aplica desde el código» (decisión 23A). La 0061 está **aprobada por el dueño** (fila 193, «1A») y aún sin integrar | Estado de su PR: NO VERIFICADO (no tengo acceso a los PR de `ZuluHub-ERP`) |
| PR #317 de Motor2 (Ocultar c4) | No lo pude leer | El resultado de «Ocultar» se toma del código de `main` y del diseño (`docs/diseno-ocultar-como-pedernal-2026-11-15.md`) y de lo que relata el orquestador; sin cita literal del dueño para la decisión de hoy |
| Motor2 | Código real con archivo y línea (§3) | No corrí pruebas ni la base: es solo lectura |

## 2. Pedernal en términos de resultado

**Quién es quién.** Cada persona tiene **un solo rol por empresa** (H4b S1; el rol es de la empresa, no de la sucursal, S4). Roles base: `GERENTE`, `ADMINISTRADOR`, `OPERADOR`; el dueño los dejó en 3 (16/11, «A») y pidió que el nombre visible de «Operador» cambie (16/11, «Más C», propuesta «Empleado», **sin confirmar**). El gerente es único por empresa, no es editable y tiene «todo lo que el plan habilita» (S2).

| Concepto | Qué es, en resultado |
|---|---|
| **Rol base** | Los 3 de arriba. Siguen a la **plantilla** de la plataforma: si la plataforma la cambia, todas las empresas lo ven. La empresa **no** los edita (Q2-A, CONFIRMADA 14/11, «recomendada») |
| **Rol propio** | Lo crea el gerente de la empresa copiando una plantilla (o vacío) y desde ahí es independiente. Nace con solo los pisos «de todos». No se borra, se archiva, y solo si no tiene personas activas |
| **Plantilla** | Lista de acciones de `ADMINISTRADOR` y de `OPERADOR`, versionada (versión inmutable por cada cambio). La edita solo la plataforma, con segundo factor |
| **Piso** | Por acción, lo fija solo la plataforma: `SOLO_GERENTE` (20 acciones hoy, anexo A de H4b) o `TODOS_LOS_ROLES` (4). La empresa no puede bajarlos. Sin piso, la acción se puede asignar dentro del plan |
| **Cómo se decide un permiso** | En el servidor, en cada operación: módulo en desarrollo, módulo no activo, módulo en solo lectura (baja de plan), capacidad de sucursal, y por último «¿está la acción en el conjunto del actor?». Sin caché entre transacciones: un cambio vale desde la operación siguiente |
| **Por plan** | Techo de módulos (una acción de un módulo fuera del plan no se otorga y, si el plan baja, queda sin efecto) y la perilla `roles_propios_por_empresa` (cantidad de roles propios) |
| **Qué cambia el dueño de la empresa (gerente)** | Crear, editar, archivar y asignar roles propios, dentro del plan y los pisos. Asignar roles es solo del gerente por defecto (S6) |
| **Qué cambia solo la plataforma** | Pisos, plantillas, el valor de la perilla de roles propios |
| **Decisiones del 16/11** | Perilla nace en 0 (fila 203, CONFIRMADA); roles base se quedan en 3 (204); nombre visible de «Operador» cambia, elegido **pendiente** (205); «roles propios por plan: 1» (191, **contradice la 203**); SQL 0061 aprobado, tramo T1 (193); ocultar en toda la empresa es acción propia `vidrieras.ocultar_en_empresa` de gerente y administrador (22A, 15/11) |
| **Estado de construcción** | Diseño H4b completo (8 tramos). T1 = migración 0061 aprobada, sin integrar. Hasta T3 el permiso lo decide la tabla del código (`PERMISOS_DE_EMPRESA`, 157 acciones: 63 los tres roles, 74 gerente y administrador, 20 solo gerente) |

## 3. Motor2 verificado contra el código

- **Catálogo de acciones:** `src/core/permisos/acciones.ts:55` (`ACCIONES`). Por piso: 58 operario, 61 administrador, 12 administrador de sistema, 2 gerente (`ver_auditoria_empresa` :157, `traspasar_gerencia` :159). Cada acción lleva módulo, contexto (empresa o sucursal), piso, semilla y marcas `soloVer` y `reservada` (:32-48).
- **Niveles y pisos (ADR-027):** `NivelDeAccion` en `acciones.ts:30`; los rangos y quién alcanza qué, en `jerarquia.ts:19-27` (`RANGO_DE_PISO`, `nivelAlcanzaElPiso`). El rol de clave `admin` es el «administrador de sistema»; **cualquier otro rol es operario** (`jerarquia.ts:68`, `nivelDelRolFrenteAlPiso`). Nadie tiene rango 2 «hasta que exista `Rol.nivel`» (`jerarquia.ts:64-67`).
- **Roles como datos:** `Rol` (`prisma/schema.prisma:189`: nombre, `clave` nullable para roles de sistema, activo, única por empresa), `Accion` (:237), `PermisoRol` (:250, `puedeVer`/`puedeEditar` por rol y acción, regla «Ver ⊇ Editar»), `CapacidadSucursal` (:~270, habilitar una acción por sucursal).
- **Rol por sucursal:** `UsuarioSucursal.rolId` (:215): una persona puede tener roles distintos en cada sucursal. **Gerente = `UsuarioEmpresa.rolEmpresa`** (:3182-3189; `rol-empresa.ts:5`), uno por empresa; no es un rol de la tabla de roles (`nombres-de-rol.ts`: «gerente» es nombre reservado que ningún rol lleva).
- **Roles de fábrica:** `admin` y `operador` (`roles-de-fabrica.ts:8-11`), **copiados a cada empresa en el alta** (`plataforma/src/servidor/sembrar-empresa.ts`, citado en `roles-de-fabrica.ts:4`). Si el catálogo gana una acción, se agrega con **migración de datos** (ejemplo reciente: `prisma/migrations/20261115152000_permisos_partes/migration.sql`, semilla solo `admin`, `ON CONFLICT DO NOTHING`, reversa `down.sql` que aborta si alguien tocó algo).
- **Decisión de acceso (pura):** `decision-de-acceso.ts:59-185`. Orden: membresía vigente, módulo de la empresa, capacidad de la sucursal, fila del rol, con el **piso por encima de la fila** (:46-48). Acción de piso gerente: solo quien tiene `rolEmpresa = gerente`, sin matriz (:147-151). Motivos tipados: `motivos.ts:10-18` (`MODULO_EN_DESARROLLO`, `MODULO_NO_ACTIVO`, `SIN_CAPACIDAD`, `SIN_PERMISO` con casos). **No existe `MODULO_EN_SOLO_LECTURA`** (Pedernal sí lo tiene).
- **Quién edita qué:** `matriz.ts:59-61` (la matriz de un rol de nivel administrador la edita **solo el gerente**; la de roles operario, quien tenga `gestion_permisos`), `matriz.ts:84-86` (capacidades por sucursal: solo gerente), `matriz.ts:31-33` (celdas fijas: `admin` conserva Editar en las 6 acciones de gobierno de accesos, `acciones.ts:321-328`). Asignar rol: `jerarquia.ts:95-102` (se asigna un rol de nivel igual o menor al propio).
- **Interruptor de plataforma:** `Empresa.permisosEditables` y `dosPaneles`, **por defecto `true`** (`schema.prisma:2607-2608`); perfiles `completo` y `lite` (`politica-de-empresa.ts:23-26`); solo los cambia la plataforma por script (`politica-de-empresa.ts:4-10`). Sin cantidad de roles ni valor por plan.
- **Plan:** no hay plan con techo de módulos. Hay `ModuloEmpresa` (:2729, activo o no por empresa) y el guard lo mira al usar (`modulo-de-la-accion.ts`). Que el techo se aplique **al otorgar** una acción en la matriz: NO VERIFICADO.
- **Invariantes de gobierno:** `invariantes.ts:7-17` y :35-71: siempre un administrador efectivo, el gerente conserva sucursal activa y es admin efectivo, un rol de sistema no se desactiva, un rol con usuarios activos no se desactiva. Se miden antes y después dentro de la transacción (`conInvariantesDeGobierno`).
- **Guardado de la matriz:** `src/server/actions/permisos/casos-de-uso/guardar-permisos.ts:73` (serializable con reintento, rechazo por conflicto de edición comparando contra lo que la persona vio, :118). Auditoría: `RegistroAuditoria` (:300), una fila por cambio escalar, solo inserción. **No hay versiones inmutables por rol.**
- **Nombres de rol:** `nombres-de-rol.ts:11-17`: «admin», «administrador», «operador», «operario» reservados para el rol con esa clave; «gerente» para ninguno. El nombre se puede cambiar (`renombrar_rol`), la clave no.
- **Parte (P1):** `acciones.ts:238-240` `partes_ver` (piso operario, solo ver), `partes_editar` (operario), `partes_desactivar` (administrador); semilla solo `admin`.
- **Ocultar:** el permiso del alcance «empresa» sale de `puedeEnLaEmpresa` (`src/server/actions/catalogo/casos-de-uso/ocultar-producto.ts:21,83`) y `core/catalogo/ocultar-producto.ts:120,197`; el de «local» es `producto_disponibilidad` Editar. La definición de «alcance total» está marcada **pendiente de confirmar por el dueño** (`ocultar-producto.ts:197`). Sin acción propia.
- **Pruebas:** `test/permisos/` (97 archivos: matriz de caracterización `caracterizacion-del-acceso.test.ts`, `matriz-esperada.ts` como oráculo, `piso-de-gobierno.test.ts`, `invariantes-de-gobierno.test.ts`, `guardar-permisos*.test.ts` de concurrencia y reintentos, una `migracion-permiso-*.test.ts` por cada migración de permiso, `paridad-catalogo-migraciones.test.ts`) y `test/modulos/` (`golden-visibilidad.test.ts`, `clausura.test.ts`).

## 4. Cuadro de paridad

Leyenda de motivo: **PRISMA/RLS** = lo impone la tecnología; **DATOS** = ya hay datos o diseño previo en Motor2; **DUEÑO** = decisión citada; **SIN MOTIVO** = defecto a resolver (§9, §10).

| # | Concepto | Pedernal | Motor2 | ¿Igual? | Motivo / estado |
|---|---|---|---|---|---|
| 1 | Roles base | `GERENTE`, `ADMINISTRADOR`, `OPERADOR` (`roles.ts`) | gerente = `rolEmpresa`; `admin` y `operador` = filas de `Rol` con clave (`roles-de-fabrica.ts:8`) | Distinto en forma, parecido en resultado | DATOS (el gerente nunca fue un rol de la tabla). YA EXISTE. Equivalencia Pedernal→Motor2: GERENTE ≈ gerente; ADMINISTRADOR ≈ `admin`; OPERADOR ≈ `operador` |
| 2 | Alcance del rol | Un rol por persona **por empresa** (S4) | Un rol por persona **por sucursal** (`schema.prisma:215`) | **Distinto** | DATOS (modelo heredado de Apps Script, comentario en `schema.prisma:~205`). Sin cita del dueño que lo justifique ni lo rechace → SIN MOTIVO documentado. Ver §10 H-1 |
| 3 | Plantilla | Tabla versionada; los roles base siguen a la plantilla | No existe; la fábrica se **copia** en el alta y cada empresa queda con su fila | **Distinto** | DATOS/PRISMA. NO EXISTE. Cambiar la fábrica no toca empresas ya creadas (se arregla con migración, como Parte) |
| 4 | ¿La empresa edita los roles base? | **No** (Q2-A, CONFIRMADA 14/11) | **Sí**: la matriz de `operador` la edita quien tenga `gestion_permisos` (`matriz.ts:59-61`); la de `admin`, solo el gerente | **Distinto, y Motor2 más abierto** | SIN MOTIVO. Es lo que más separa el resultado. PENDIENTE (§9) |
| 5 | Rol propio | Perilla `roles_propios_por_empresa`; nace en 0 (fila 203, CONFIRMADA); 191 dice 1 | Se crean sin tope con `gestion_roles` si `permisosEditables = true` (por defecto) | **Distinto** | SIN MOTIVO. NO EXISTE la perilla. PENDIENTE |
| 6 | Interruptor de plataforma | La perilla en 0 impide crear | `permisosEditables` (todo o nada: no edita ni crea) | Parecido solo en el caso 0 | YA EXISTE; `lite` ≈ perilla 0 |
| 7 | Piso | Tabla por acción, 2 tipos, lo edita la plataforma (20 + 4) | 4 niveles por acción **en el código** (`acciones.ts:30`), no editables por la plataforma; solo 2 son de gerente | **Distinto** | DATOS/DUEÑO (ADR-027, decisión del 2026-10-08 citada en `matriz.ts:57-58`). NO EXISTE pantalla ni tabla de pisos |
| 8 | Roles de rango intermedio («Encargado») | Un rol propio recibe casi cualquier acción | Un rol a mano es operario y **no alcanza las 61 acciones de administrador** (`jerarquia.ts:68-76`) | **Distinto** | DISEÑADO: `Rol.nivel` (F3, ADR-027). NO EXISTE |
| 9 | Cómo se decide | Conjunto de acciones del actor, 5 motivos | Fila `PermisoRol` + piso + módulo + capacidad, 4 motivos (`decision-de-acceso.ts`) | Igual en el orden; falta el motivo de solo lectura | PRISMA/DATOS. Falta `MODULO_EN_SOLO_LECTURA` (depende de planes que Motor2 no tiene). NO EXISTE |
| 10 | Techo del plan | Al otorgar y al usar | Al usar (módulo activo por empresa). Al otorgar: NO VERIFICADO | Parcial | NO EXISTE el plan; `ModuloEmpresa` hace de techo |
| 11 | Auditoría de cambios de rol | Versión inmutable por rol + `auditoria_empresa` antes/después | `RegistroAuditoria` por cambio escalar, solo inserción | Distinto en forma, mismo resultado («quién, cuándo, qué») | PRISMA/DATOS. YA EXISTE |
| 12 | Concurrencia al editar | Control optimista por `version` | Comparación contra lo que la persona vio + serializable con reintento (`guardar-permisos.ts:73,118`) | Igual en resultado | YA EXISTE |
| 13 | Invariantes de gobierno | Un gerente, nunca sin quien gestione usuarios | Equivalentes (`invariantes.ts`), más estrictas (gerente admin efectivo) | Igual en resultado | YA EXISTE |
| 14 | Acciones de «partes» | 8: ver, crear, editar, cambiar_roles, vincular y desvincular contacto (los 3 roles); desactivar y reactivar (G y A) (`empresa.ts:204-211`) | 3: `partes_ver`, `partes_editar`, `partes_desactivar` (`acciones.ts:238-240`); semilla **solo `admin`** | **Distinto** en granularidad y en quién la tiene al nacer | La granularidad es una decisión de diseño de Parte P1 (no la encontré con cita); la semilla cerrada es DUEÑO («todo nace cerrado», 2026-11-11) contra «el operador busca, da de alta y edita» (D10, 2026-11-12). **PENDIENTE** (§9, H-3) |
| 15 | Ocultar en toda la empresa | Acción propia `vidrieras.ocultar_en_empresa`, G y A (22A, CONFIRMADA 15/11) | Sin acción: «alcance total» calculado desde el rol `admin` en todas las sucursales (`ocultar-producto.ts:83`); decisión de hoy relatada: gerente y administrador | Igual en resultado esperado, distinto en forma | DATOS (rol por sucursal). Definición de «alcance total» pendiente de confirmar (`ocultar-producto.ts:197`) |
| 16 | Ocultar en un local | Los tres roles | `producto_disponibilidad` Editar en la sucursal activa (:65) | Igual si el operador tiene esa fila | YA EXISTE; NO VERIFICADO si la semilla del operador la trae |
| 17 | Nombre visible «Operador» | «Empleado» propuesto, **sin confirmar** (205) | «operador» y «operario» reservados (`nombres-de-rol.ts:11-17`); nombre editable por empresa | Distinto | PROPUESTA. Es solo texto en Pedernal; en Motor2 toca datos (§5 E1) |
| 18 | Asignar roles | Solo gerente por defecto (S6); G y A gestionan usuarios | `jerarquia.ts:95-102`: se asigna rol de nivel igual o menor (un admin asigna `admin`) | Parecido para los roles base | YA EXISTE; para roles propios, SIN MOTIVO |
| 19 | Nuevas acciones a roles existentes | Paso idempotente que solo agrega; nada se repone | Migración de datos por acción, con `ON CONFLICT DO NOTHING` y reversa | Igual en resultado | PRISMA/DATOS. YA EXISTE (97 archivos de prueba lo cuidan) |
| 20 | Capacidades por sucursal | `SIN_CAPACIDAD`, ninguna real todavía | `CapacidadSucursal` en uso; cambiarla es solo del gerente (`matriz.ts:84`) | Motor2 más avanzado | YA EXISTE |

## 5. Diseño de la alineación

### Nivel 1. Propósito y alcance
Que una empresa de Motor2 **obtenga el mismo resultado que en Pedernal** al decidir quién puede qué, y que un cambio de Pedernal en roles y permisos tenga su equivalente declarado. **No** es duplicar el modelo de Pedernal: las diferencias de forma (rol por sucursal, tabla `Rol`, matriz Ver/Editar) están justificadas por los datos existentes. NECESIDAD: el pedido del dueño del 16/11 (cita arriba) y la regla de paridad del 13/11. **No hay una necesidad escrita de «roles propios» para el cliente actual** (solo productos y carta): todo lo que sigue es preparación, y lo que no tiene necesidad va a «etapa posterior».

### Nivel 2. Actores y contexto
Dueño (Alejandro): decide. Plataforma: fija `permisosEditables`, hoy por script. Gerente de empresa: único por empresa (`rolEmpresa`). Administrador (`admin`): gobierno de la empresa. Operador y roles a mano: rango operario. Contexto: Motor2 en producción con datos reales; RLS por empresa; ya hay empresa(s) con filas de `Rol` y `PermisoRol` que no se pueden reescribir sin autorización por base.

### Nivel 3. Casos de uso (resultado esperado)
| Caso | Pedernal | Motor2 hoy | Motor2 alineado (propuesta) |
|---|---|---|---|
| Empresa nueva no puede crear roles | perilla 0 | `permisosEditables=true` por defecto: **puede** | `lite` o perilla 0 |
| Gerente crea «Encargado» | si la perilla ≥ 1 | puede, pero solo de rango operario | tope + `Rol.nivel` |
| Operador sin permiso de ver precios | rol propio sin la acción | posible si la fila existe | sin cambio |
| Plataforma endurece un piso | pantalla con impacto, quita lo afectado (Q3-A) | requiere cambiar `acciones.ts` y desplegar | etapa posterior |
| Ocultar en toda la empresa | G y A | admin con alcance total | decisión de hoy, sin cambio de forma |

### Nivel 4. Conceptos y ciclo de vida
- **Rol base de sistema:** nace en el alta, clave estable, no se desactiva ni cambia de clave (`invariantes.ts:63`). PROPUESTA: sin cambio.
- **Rol propio (a mano, `clave = null`):** crear, renombrar, activar y desactivar (si no tiene personas activas, `invariantes.ts:71`). Ya existe. La falta es el **tope** y el **nivel**.
- **Piso:** hoy una propiedad de la acción en el código. Se mantiene así (E4 posterior).

### Nivel 5. Invariantes y políticas (propuestas, cada una con su violación inyectada en pruebas)
| # | Invariante | Estado |
|---|---|---|
| IP1 | Nada se habilita por omisión: un rol propio nuevo nace sin ninguna fila de permiso | YA EXISTE para las pantallas de matriz; NO VERIFICADO al crear (revisar `gestion_roles`) |
| IP2 | La cantidad de roles propios **activos** de una empresa no supera su tope; archivar libera cupo; bajar el tope no desactiva ninguno (S13 de Pedernal) | PROPUESTA (solo si el dueño elige tope) |
| IP3 | El tope lo cambia solo la plataforma, nunca la empresa (mismo guardián que `permisosEditables`: `politica-de-empresa-solo-plataforma`) | PROPUESTA |
| IP4 | Los roles de sistema (`admin`, `operador`) no los edita la empresa (Q2-A de Pedernal) | **PENDIENTE** de decisión: hoy se editan |
| IP5 | Una acción nueva nace sin llegar a ningún rol propio ni a los roles de sistema fuera de la semilla declarada | YA EXISTE (migración con semilla explícita) |
| IP6 | Un rol propio nunca supera el piso de la acción (el piso manda sobre la fila) | YA EXISTE (`decision-de-acceso.ts:46`) |
| IP7 | El gerente no es editable | YA EXISTE |

### Etapas, de la más barata a la más grande
| Etapa | Qué | Costo | Riesgo | Migración | Necesidad | Estado |
|---|---|---|---|---|---|---|
| **E0** | Equivalente a «perilla 0»: poner `permisosEditables=false` (perfil `lite`) en la empresa que el dueño quiera que se parezca a Pedernal. **Sin código.** | Nulo | Bajo: bloquea editar la matriz y crear roles | Ninguna (es un dato; reversible) | Ninguna escrita; es la opción «más barata» de la regla del 2026-10-27 | PROPUESTA. No se aplica sin el dueño |
| **E1** | Cambiar el nombre visible de «operador» (y su reserva en `nombres-de-rol.ts`). Cuando el dueño elija el nombre (fila 205 sin confirmar) | S | Medio: toca `Rol.nombre` de filas existentes y mensajes | Datos: `UPDATE` **solo donde clave = `operador` y el nombre siga siendo el de fábrica** (respeta lo que la empresa ya renombró). **Reescribe datos: autorización expresa por base** | Fila 205 (16/11, «Más C») | PENDIENTE (nombre) |
| **E2** | Cerrar la definición de «alcance total» de Ocultar y, si el dueño lo pide, dar acción propia como `vidrieras.ocultar_en_empresa` | S | Bajo si queda dentro de #317 | Si hay acción nueva: migración de datos con semilla `admin` (patrón Parte) | Fila 180 (22A) y `ocultar-producto.ts:197` | PENDIENTE (lo resuelve #317) |
| **E3** | **Tope de roles propios por empresa** (entero, nace en 0, lo cambia solo la plataforma) y validación al crear o reactivar un rol. Sustituye al todo-o-nada en la parte de «crear» | M | Medio: cambia qué puede hacer una empresa «completa» ya existente | Aditiva: columna entera en `Empresa` con `DEFAULT` **igual al número de roles propios activos hoy** para no quitar nada (S13) | Filas 203 y 191 (contradictorias) | PENDIENTE (§9) |
| **E4** | Rol de rango intermedio: `Rol.nivel` (ADR-027 F3) para que un «Encargado» alcance acciones de administrador | L | **Alto**: toca el guard y las 61 acciones de piso administrador; la matriz de caracterización y el golden de módulos tienen que probar que **nadie gana ni pierde nada** | Aditiva (columna con `DEFAULT` que reproduce hoy), sin reescribir datos | «Encargado» dicho por el dueño en Pedernal el 16/11; para Motor2, NINGUNA | Etapa posterior con nombre |
| **E5** | Roles base que **siguen a una plantilla** de la plataforma | XL | Alto | Reescribe `PermisoRol` de todas las empresas | Ninguna | **No recomendada**: choca con el modelo (copia en el alta). Declarar como diferencia permanente |
| **E6** | Pisos en tabla editable por la plataforma con pantalla e impacto | XL | Alto | Tablas nuevas + semilla desde `acciones.ts` | Ninguna | Etapa posterior con nombre; solo si aparece la necesidad |
| **E7** | Rol por empresa (no por sucursal) | XL | Muy alto | Reescribe `UsuarioSucursal` | Ninguna | **No hacer**: sin cita del dueño y rompe datos reales. Declarar diferencia permanente (§9) |

**Lo que no se construye:** plan con techo de módulos y `MODULO_EN_SOLO_LECTURA` (depende de planes que Motor2 no tiene), versiones inmutables de rol, y la pantalla de plataforma de plantillas.

### Niveles 6 a 10 (esbozo, para cuando una etapa se apruebe)
- **6. Historia y persistencia:** E3 agrega una sola columna entera a `Empresa`; cada cambio del tope se registra en `RegistroAuditoria` (solo inserción). Sin tablas nuevas.
- **7. Atomicidad y concurrencia:** crear un rol y chequear el tope dentro de la misma transacción serializable con reintento (hoy `conTransaccionSerializable`); dos creaciones simultáneas con cupo 1 → una falla. Idempotencia: la unicidad `(empresaId, nombre)` ya existe.
- **8. Acceso e interfaces:** el tope se muestra en la pantalla de roles; el mensaje de rechazo reutiliza un texto aprobado (hoy: `MENSAJE_PERMISOS_DE_PLATAFORMA`), **sin texto nuevo hasta que el dueño lo apruebe**.
- **9. Consultas y experiencia:** la pantalla de roles muestra «usás N de M»; sin cambios en la matriz.
- **10. Pruebas, migración, operación:** dimensiones que cambian permisos (Combinaciones, 2026-10-28): `permisosEditables` × tope × rol de sistema o propio × alcance de empresa o sucursal. Oráculo escrito aparte; un test que recorre todas las combinaciones y un guardián que falla si aparece una dimensión nueva. Migración de E3 con `down.sql` y `verificacion-previa.sql` (patrón de Parte).

## 6. Tabla «¿qué pasa si…?» (comandos de permisos, resultado esperado en Motor2)

| Situación | Comando | Qué pasa hoy (verificado) | Qué debería pasar (propuesta) |
|---|---|---|---|
| Repetición | Guardar la misma matriz dos veces | El segundo guardado ve «sin cambios» (`mismoEstado`, `matriz.ts:94`) | Igual |
| Concurrencia | Dos personas editan el mismo rol | Se rechaza el que vio un valor viejo («Otra persona cambió estos permisos», `matriz.ts:111`); si choca con otro en curso agota reintentos (`matriz.ts:118`) | Igual |
| Concurrencia | Dos gerentes crean un rol propio con cupo 1 (E3) | NO EXISTE el tope | Una de las dos falla con el mensaje de tope |
| Baja de un rol con personas | Desactivar un rol con usuarios activos | Rechazo (`invariantes.ts:71`) | Igual; la pantalla lista a las personas para reasignar |
| Baja del tope (E3) | Bajar el tope por debajo de los roles activos | NO EXISTE | No se desactiva ninguno; solo se bloquea crear (S13) |
| Permiso nuevo sin declarar | Acción en el código sin fila en la base | `paridad-catalogo-migraciones.test.ts` y `toda-accion-se-usa.test.ts` fallan | Igual |
| Cambio de plan | Plan inexistente en Motor2 | NO EXISTE | Fuera de alcance |
| Cambio de rol en medio de una sesión | La persona ya está operando | No hay caché: el guard relee la membresía en cada operación (`gate.ts:44,85`) | Igual: vale desde la operación siguiente |
| Tiempo | Rol desactivado a mitad de una operación | La membresía deja de ser vigente (`membresiaVigente`, `decision-de-acceso.ts:39`) | Igual |
| Reintento | Reenviar el guardado tras un corte | Seguro por la comparación contra lo visto | Igual |
| Error parcial | Falla la auditoría | Todo o nada: la auditoría va en la misma transacción | Igual |
| Datos faltantes | Rol sin fila de permiso para una acción | Sin fila = sin permiso (`matriz.ts:20`) | Igual (nace cerrado) |
| Datos faltantes | Rol de fábrica borrado a mano | Protegido (`invariantes.ts:63`) | Igual |
| Cambio de permisos | Se quita `gestion_permisos` al `admin` | La celda es fija (`matriz.ts:31`) | Igual |
| Cambio de permisos (E4) | Rol de rango intermedio con acción de gobierno | NO EXISTE | El piso `administrador_sistema` lo impide siempre |
| Plataforma | Cambiar `permisosEditables` en una empresa | Solo por script, con auditoría (`cambio-de-politica.ts`) | Igual; una pantalla es etapa posterior |

## 7. Qué NO hacer todavía y qué esperar

1. **No tocar `PermisoRol`, `Rol` ni las semillas por «paridad»** mientras el dueño no resuelva la pregunta de §9: es la regla «lo que el dueño no pidió no entra».
2. **PR #317 (Ocultar c4): seguir como está.** Lo único que choca es la definición de «alcance total» (`ocultar-producto.ts:197`): conviene que el dueño la confirme **antes** de la pantalla de Ocultar, porque si después se quiere una acción propia (como Pedernal) hay una migración de datos con autorización por base. Mantener el cálculo en un solo lugar (ya está) y **no** agregar una acción nueva dentro de #317.
3. **Segunda rama de Parte:** conviene esperar la respuesta del punto 14 del cuadro (¿el operador nace con `partes_ver`/`partes_editar` como en Pedernal?). Si se cambia la semilla después de aplicada la migración `20261115152000`, es otra migración de datos. **No** partir `partes_editar` en las acciones finas de Pedernal sin decisión.
4. **No esperar a Pedernal para nada de esto:** su 0061 todavía no está integrada y puede cambiar. Cuando entre T3 de Pedernal, volver a leer `PLANTILLAS_SEMILLA` y `piso_de_plataforma` y reabrir este cuadro (`motor2-docs/seguimiento-de-pedernal/`).
5. **Pruebas que no se deben romper:** `caracterizacion-del-acceso.test.ts` (matriz entera), `piso-de-gobierno.test.ts`, el golden de `test/modulos/__golden__`, y `paridad-catalogo-migraciones.test.ts`. Toda etapa de arriba empieza con una prueba que demuestre que, con los valores de hoy, **nadie gana ni pierde una acción** (como la I14 de Pedernal).

## 8. Hallazgos aparte (fuera de alcance, no se tocaron)

- **H-1.** El rol por sucursal de Motor2 y el rol por empresa de Pedernal producen resultados distintos cuando una persona está en varias sucursales (en Motor2 puede ser admin en una y operador en otra). No encontré cita del dueño que lo elija. Es una divergencia sin motivo documentado.
- **H-2.** `permisosEditables` nace en `true`. Para una empresa nueva eso es «abierto por defecto», en contra de «todo nace cerrado» (2026-11-11). No lo cambio: afecta a la empresa actual.
- **H-3.** El mapa de las contradicciones de Pedernal (fila 191 contra 203, y fila 204 «A» contra 205 «Más C» sobre los nombres) puede reaparecer en Motor2 si se copia un valor sin consultar.
- **H-4.** Falta en Motor2 un motivo `MODULO_EN_SOLO_LECTURA`; hoy una baja de módulo corta todo, no solo escritura. Depende de planes (no existen).
- **H-5.** NO VERIFICADO: si `gestion_roles` crea el rol sin ninguna fila de permiso (IP1) y si el techo de módulos se aplica al otorgar una acción en la matriz.

## 9. Pregunta pendiente (una sola, la que cambia permisos)

**¿Querés que una empresa nueva de Motor2 se comporte como Pedernal (no puede crear roles propios hasta que vos subas un tope, y los roles base los controla la plataforma), o preferís que siga como hoy (la empresa «completa» edita sus roles libremente) hasta que haya un cliente que lo pida?**

- Si respondés «como Pedernal»: se hace E3 (tope) y se define IP4. La contradicción de Pedernal sobre el valor (0 contra 1) se resuelve con tu respuesta.
- Si respondés «como hoy»: no se construye nada y las diferencias 4 y 5 del cuadro se declaran con tu cita como decisión del dueño.
- Mientras no respondas, esta es una **pregunta abierta, no un supuesto**.

## 10. Supuestos declarados (si no se corrigen, quedan; costo de revertir)

| # | Supuesto | Costo de revertir |
|---|---|---|
| S1 | La equivalencia de roles del cuadro (fila 1): ADMINISTRADOR de Pedernal ≈ rol `admin` de Motor2 | Nulo (es una lectura) |
| S2 | `lite` equivale a «perilla en 0» (E0) | Nulo; si no es lo que el dueño quiere, no se aplica |
| S3 | `conceptos/rol-de-la-parte.md` no es de permisos (trata del rol cliente/proveedor) | Nulo |
| S4 | La decisión de hoy de Ocultar (gerente y administrador con alcance total) es la que me relató el orquestador; no tengo cita literal | Nulo hasta que se use como cita |
| S5 | El estado de la 0061 y de los PR de Pedernal de hoy queda NO VERIFICADO (sin acceso a sus PR) | Releer cuando el orquestador dé acceso |

## 11. Qué verifiqué y qué no

- **Verifiqué (lectura de código y documentos):** los documentos de Pedernal citados, `src/capacidades/permisos/*` de `ZuluHub-ERP`, y en Motor2 los archivos de `src/core/permisos/`, los modelos de `schema.prisma` citados, la migración `20261115152000_permisos_partes`, `ocultar-producto.ts` y los nombres de las pruebas.
- **No verifiqué:** que las pruebas pasen (no las corrí); el estado de los PR #317, #360 y la 0061; el contenido de la base real; si `guardarPermisos` aplica el techo de módulos al otorgar; la semilla exacta del rol `operador` (fila 16 del cuadro); la cantidad exacta de acciones (conté por piso: 133, el catálogo declara más líneas por marcas y comentarios).
- **Prueba para vos, sin leer código:** en una empresa de prueba, entrá como gerente a la pantalla de permisos y fijate si podés cambiarle algo al rol «operador». Hoy debería dejarte (Motor2 más abierto que Pedernal). Con `permisosEditables = false` debería avisarte «Los permisos de tu empresa los administra la plataforma».
