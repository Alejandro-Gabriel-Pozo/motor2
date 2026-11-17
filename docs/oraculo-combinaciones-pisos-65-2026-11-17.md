# Oráculo de combinaciones — las 65 acciones bajan a piso operario (PISOS-65)

Regla «Combinaciones» del dueño (AGENTS.md, 2026-10-28). Este archivo es la tabla de reglas esperadas, escrita APARTE del código. La leen:

- `test/permisos/combinaciones-pisos-65.test.ts`: recorre contra Postgres real (con `guardarPermisos` y el gate de verdad) las 40 combinaciones de «Guardar la matriz» y las 20 de «Acceso».
- `test/arquitectura/combinaciones-pisos-65-declaradas.test.ts`: falla si aparece una clase de acción, un piso o una propiedad de `AccionSemilla` nuevos sin declarar si afectan o no.

Diseño de origen: `docs/diseno-pisos-65-2026-11-17.md`. Pedido del dueño (2026-11-17): «Si bajamos las 65 acciones de piso administrador a operador, esas celdas dejan de estar cerradas y la empresa decide fila por fila. Quedan cerradas de verdad solo las 14 de gobierno y de gerente […] «esta acción es de gobierno de la empresa y no se delega»». Regla de quién otorga (DEC-0025), confirmada: «Así me refería a que se baje el piso y después el gerente edite.»

## Dimensiones que cambian el resultado

| Dimensión | Valores | De dónde sale |
|---|---|---|
| **R** rol sobre el que se guarda o con el que se accede | ADMIN, OPERARIO | Rol de clave `admin` (administrador de sistema frente al piso) u otro rol de nivel operario (el `operador` de fábrica o un rol propio) |
| **C** clase de la acción | L, O, D, GS, GG | L libre (piso operario, semilla admin y operador); O delegable por otros (piso operario, semilla solo admin, fuera de la lista del gerente); D las 65 (piso operario, semilla solo admin, en `ACCIONES_QUE_DA_SOLO_EL_GERENTE`); GS gobierno (piso administrador de sistema); GG gerente (piso gerente) |
| **Q** quien guarda | GERENTE, ADMINISTRADOR | `UsuarioEmpresa.rolEmpresa` de quien actúa: gerente, o administrador que no es el gerente (con `gestion_permisos`) |
| **M** movimiento | OTORGA, QUITA | El cambio da Ver o Editar que no estaban, o los saca |
| **F** fila en la base (solo acceso) | SI, NO | `PermisoRol` del rol para esa acción con Ver y Editar prendidos, o sin fila |

## Dimensiones que NO cambian el resultado

| Dimensión | Por qué no afecta |
|---|---|
| Módulo y contexto (sucursal o empresa) de la acción | Con el módulo encendido, el contexto cambia solo qué función del gate se llama, no el resultado de la regla. |
| `soloVer`, `reservada`, descripción | Son de pantalla: no entran a la decisión de guardar ni de acceder. |
| Nombre del rol | La regla mira la clave del rol, no su nombre. |
| Operador de fábrica frente a rol propio | Los dos son de nivel operario frente al piso: el resultado es el mismo. |
| Cuál de las 65 es | Las 65 comparten semilla y regla; los representantes de cada clase cubren el comportamiento. |

## Propiedades de una acción (AccionSemilla)

Cada propiedad del catálogo declara si cambia el resultado de las tablas de abajo. Una propiedad nueva en `AccionSemilla` pone en rojo `test/arquitectura/combinaciones-pisos-65-declaradas.test.ts` hasta que figure acá.

| Propiedad | ¿Cambia? | Por qué |
|---|---|---|
| clave | cambia | Identifica la acción; la lista `ACCIONES_QUE_DA_SOLO_EL_GERENTE` y la fila de la matriz se buscan por clave (dimensión C). |
| nivelMinimo | cambia | Separa las acciones de gobierno y de gerente (cerradas para un rol de nivel operario) de las demás (dimensión C). |
| rolesEditarSemilla | cambia | Separa lo libre de lo que nace cerrado (de fábrica solo `admin`); con la lista decide la clase O, D o L (dimensión C). |
| modulo | no cambia | Con el módulo encendido no entra a la decisión de guardar ni de acceder. |
| contexto | no cambia | Solo decide qué función del gate se llama (de sucursal o de empresa). |
| descripcion | no cambia | Texto de pantalla. |
| soloVer | no cambia | Oculta la casilla «Editar» de la pantalla; no toca la decisión. |
| reservada | no cambia | Oculta la fila en la pantalla; no toca la decisión. |

## Guardar la matriz (R × C × Q × M)

Orden de las razones (la primera que corresponda): una celda de gobierno o de gerente que se quiere DAR a un rol que no la alcanza → RECHAZA_GOBIERNO («Esta acción es de gobierno de la empresa y no se delega.»); la matriz del rol `admin` la edita solo el gerente → RECHAZA_MATRIZ_DEL_ADMIN; dar una de las 65 a un rol de nivel operario sin ser el gerente → RECHAZA_SOLO_EL_GERENTE_LA_DA (DEC-0025); si no, GUARDA. Quitar una fila de un rol de nivel operario siempre se puede (limpiar un dato viejo). Representantes: L `producto_disponibilidad`, O `caja_abrir_sesion`, D `caja_cerrar_sesion`, GS `ver_auditoria`, GG `traspasar_gerencia`.

| R | C | Q | M | Resultado |
|---|---|---|---|---|
| ADMIN | L | GERENTE | OTORGA | GUARDA |
| ADMIN | L | GERENTE | QUITA | GUARDA |
| ADMIN | L | ADMINISTRADOR | OTORGA | RECHAZA_MATRIZ_DEL_ADMIN |
| ADMIN | L | ADMINISTRADOR | QUITA | RECHAZA_MATRIZ_DEL_ADMIN |
| ADMIN | O | GERENTE | OTORGA | GUARDA |
| ADMIN | O | GERENTE | QUITA | GUARDA |
| ADMIN | O | ADMINISTRADOR | OTORGA | RECHAZA_MATRIZ_DEL_ADMIN |
| ADMIN | O | ADMINISTRADOR | QUITA | RECHAZA_MATRIZ_DEL_ADMIN |
| ADMIN | D | GERENTE | OTORGA | GUARDA |
| ADMIN | D | GERENTE | QUITA | GUARDA |
| ADMIN | D | ADMINISTRADOR | OTORGA | RECHAZA_MATRIZ_DEL_ADMIN |
| ADMIN | D | ADMINISTRADOR | QUITA | RECHAZA_MATRIZ_DEL_ADMIN |
| ADMIN | GS | GERENTE | OTORGA | GUARDA |
| ADMIN | GS | GERENTE | QUITA | GUARDA |
| ADMIN | GS | ADMINISTRADOR | OTORGA | RECHAZA_MATRIZ_DEL_ADMIN |
| ADMIN | GS | ADMINISTRADOR | QUITA | RECHAZA_MATRIZ_DEL_ADMIN |
| ADMIN | GG | GERENTE | OTORGA | RECHAZA_GOBIERNO |
| ADMIN | GG | GERENTE | QUITA | GUARDA |
| ADMIN | GG | ADMINISTRADOR | OTORGA | RECHAZA_GOBIERNO |
| ADMIN | GG | ADMINISTRADOR | QUITA | RECHAZA_MATRIZ_DEL_ADMIN |
| OPERARIO | L | GERENTE | OTORGA | GUARDA |
| OPERARIO | L | GERENTE | QUITA | GUARDA |
| OPERARIO | L | ADMINISTRADOR | OTORGA | GUARDA |
| OPERARIO | L | ADMINISTRADOR | QUITA | GUARDA |
| OPERARIO | O | GERENTE | OTORGA | GUARDA |
| OPERARIO | O | GERENTE | QUITA | GUARDA |
| OPERARIO | O | ADMINISTRADOR | OTORGA | GUARDA |
| OPERARIO | O | ADMINISTRADOR | QUITA | GUARDA |
| OPERARIO | D | GERENTE | OTORGA | GUARDA |
| OPERARIO | D | GERENTE | QUITA | GUARDA |
| OPERARIO | D | ADMINISTRADOR | OTORGA | RECHAZA_SOLO_EL_GERENTE_LA_DA |
| OPERARIO | D | ADMINISTRADOR | QUITA | GUARDA |
| OPERARIO | GS | GERENTE | OTORGA | RECHAZA_GOBIERNO |
| OPERARIO | GS | GERENTE | QUITA | GUARDA |
| OPERARIO | GS | ADMINISTRADOR | OTORGA | RECHAZA_GOBIERNO |
| OPERARIO | GS | ADMINISTRADOR | QUITA | GUARDA |
| OPERARIO | GG | GERENTE | OTORGA | RECHAZA_GOBIERNO |
| OPERARIO | GG | GERENTE | QUITA | GUARDA |
| OPERARIO | GG | ADMINISTRADOR | OTORGA | RECHAZA_GOBIERNO |
| OPERARIO | GG | ADMINISTRADOR | QUITA | GUARDA |

## Acceso (R × C × F)

Decisión del gate de quien actúa con ese rol (sin ser el gerente): sin fila no hay acceso; con fila, lo que el piso permite. Una acción de piso gerente la tiene solo quien es gerente por `rolEmpresa`, nunca por un rol.

| R | C | F | Resultado |
|---|---|---|---|
| ADMIN | L | SI | PERMITE |
| ADMIN | L | NO | DENIEGA |
| ADMIN | O | SI | PERMITE |
| ADMIN | O | NO | DENIEGA |
| ADMIN | D | SI | PERMITE |
| ADMIN | D | NO | DENIEGA |
| ADMIN | GS | SI | PERMITE |
| ADMIN | GS | NO | DENIEGA |
| ADMIN | GG | SI | DENIEGA |
| ADMIN | GG | NO | DENIEGA |
| OPERARIO | L | SI | PERMITE |
| OPERARIO | L | NO | DENIEGA |
| OPERARIO | O | SI | PERMITE |
| OPERARIO | O | NO | DENIEGA |
| OPERARIO | D | SI | PERMITE |
| OPERARIO | D | NO | DENIEGA |
| OPERARIO | GS | SI | DENIEGA |
| OPERARIO | GS | NO | DENIEGA |
| OPERARIO | GG | SI | DENIEGA |
| OPERARIO | GG | NO | DENIEGA |
