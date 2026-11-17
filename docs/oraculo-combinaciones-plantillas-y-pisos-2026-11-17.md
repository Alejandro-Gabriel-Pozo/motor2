# Oráculo de combinaciones de plantillas y pisos (2026-11-17)

Regla del dueño del 2026-10-28 (AGENTS.md, «Combinaciones»): cada módulo declara las DIMENSIONES cuyas combinaciones cambian dinero, permisos, visibilidad o stock, con una tabla de reglas esperadas escrita APARTE del código. Este es el oráculo de EB-1
(plantillas de rol, versiones y pisos de plataforma; diseño: `docs/diseno-roles-propios-versiones-plantillas-pisos-2026-11-17.md`). Lo parsea `test/setup/oraculo-plantillas-y-pisos.ts`; lo recorre completo
`test/core/combinaciones-plantillas-y-pisos.test.ts` contra `incumplimientosDeLaPlantilla` (y, para la parte P×F, `test/persistencia/plantillas-y-pisos.test.ts` contra el trigger de la base). Si aparece una dimensión nueva sin declarar,
falla `test/arquitectura/combinaciones-plantillas-y-pisos-declaradas.test.ts`.

El resultado de cada fila es la PRIMERA regla que se incumple, en este orden: nivel, SOLO_GERENTE, TODOS_LOS_ROLES, administrador siempre. La plantilla GERENTE se rechaza siempre (no lleva versiones) y por eso no es una dimensión.

## Dimensiones que cambian el resultado

| Dimensión | Valores | Qué cambia |
|---|---|---|
| **P** plantilla | ADMINISTRADOR, OPERADOR | Qué rol de fábrica la usa hoy: el administrador no recibe las de gerente; el operador, nada por encima de operario. SOLO_GERENTE solo se controla en OPERADOR (D-E). Solo ADMINISTRADOR conserva las acciones de «administrador siempre». |
| **N** nivel mínimo de hoy | operario, administrador, administrador_sistema, gerente | Regla transitoria de nivel (hasta que el guard lea las plantillas, T5): la acción tiene que ser alcanzable por el rol de fábrica de la plantilla. |
| **F** piso | SIN_PISO, SOLO_GERENTE, TODOS_LOS_ROLES | SOLO_GERENTE no puede estar en OPERADOR; TODOS_LOS_ROLES no puede faltar de Ver en ninguna. |
| **A** conservada por el administrador | SI, NO | La acción está en `ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE`: ADMINISTRADOR no puede quedarse sin su Ver y Editar. |

## Dimensiones que NO cambian el resultado (con motivo)

| Dimensión | Motivo |
|---|---|
| módulo de la acción | Las reglas miran nivel, piso y la lista de «administrador siempre»; el módulo no entra en ninguna. |
| contexto (empresa o sucursal) | Idem: no entra en ninguna regla de plantillas. |
| soloVer | Define si la matriz ofrece la casilla Editar; la plantilla guarda Ver y Editar aparte y no lo mira. |
| reservada | Idem: las acciones reservadas igual figuran en el catálogo y en la semilla. |
| descripción | Es texto de pantalla. |
| empresa | Las tablas son globales de plataforma: no hay empresa. |

## Agregar a Ver (24 filas: P × N × F; A no cambia agregar)

| P | N | F | Resultado |
|---|---|---|---|
| ADMINISTRADOR | operario | SIN_PISO | PUBLICA |
| ADMINISTRADOR | operario | SOLO_GERENTE | PUBLICA |
| ADMINISTRADOR | operario | TODOS_LOS_ROLES | PUBLICA |
| ADMINISTRADOR | administrador | SIN_PISO | PUBLICA |
| ADMINISTRADOR | administrador | SOLO_GERENTE | PUBLICA |
| ADMINISTRADOR | administrador | TODOS_LOS_ROLES | PUBLICA |
| ADMINISTRADOR | administrador_sistema | SIN_PISO | PUBLICA |
| ADMINISTRADOR | administrador_sistema | SOLO_GERENTE | PUBLICA |
| ADMINISTRADOR | administrador_sistema | TODOS_LOS_ROLES | PUBLICA |
| ADMINISTRADOR | gerente | SIN_PISO | RECHAZA_NIVEL |
| ADMINISTRADOR | gerente | SOLO_GERENTE | RECHAZA_NIVEL |
| ADMINISTRADOR | gerente | TODOS_LOS_ROLES | RECHAZA_NIVEL |
| OPERADOR | operario | SIN_PISO | PUBLICA |
| OPERADOR | operario | SOLO_GERENTE | RECHAZA_SOLO_GERENTE |
| OPERADOR | operario | TODOS_LOS_ROLES | PUBLICA |
| OPERADOR | administrador | SIN_PISO | RECHAZA_NIVEL |
| OPERADOR | administrador | SOLO_GERENTE | RECHAZA_NIVEL |
| OPERADOR | administrador | TODOS_LOS_ROLES | RECHAZA_NIVEL |
| OPERADOR | administrador_sistema | SIN_PISO | RECHAZA_NIVEL |
| OPERADOR | administrador_sistema | SOLO_GERENTE | RECHAZA_NIVEL |
| OPERADOR | administrador_sistema | TODOS_LOS_ROLES | RECHAZA_NIVEL |
| OPERADOR | gerente | SIN_PISO | RECHAZA_NIVEL |
| OPERADOR | gerente | SOLO_GERENTE | RECHAZA_NIVEL |
| OPERADOR | gerente | TODOS_LOS_ROLES | RECHAZA_NIVEL |

## Quitar de Ver y Editar (48 filas: P × N × F × A; N no cambia quitar)

| P | N | F | A | Resultado |
|---|---|---|---|---|
| ADMINISTRADOR | operario | SIN_PISO | SI | RECHAZA_ADMIN_SIEMPRE |
| ADMINISTRADOR | operario | SIN_PISO | NO | PUBLICA |
| ADMINISTRADOR | operario | SOLO_GERENTE | SI | RECHAZA_ADMIN_SIEMPRE |
| ADMINISTRADOR | operario | SOLO_GERENTE | NO | PUBLICA |
| ADMINISTRADOR | operario | TODOS_LOS_ROLES | SI | RECHAZA_TODOS_LOS_ROLES |
| ADMINISTRADOR | operario | TODOS_LOS_ROLES | NO | RECHAZA_TODOS_LOS_ROLES |
| ADMINISTRADOR | administrador | SIN_PISO | SI | RECHAZA_ADMIN_SIEMPRE |
| ADMINISTRADOR | administrador | SIN_PISO | NO | PUBLICA |
| ADMINISTRADOR | administrador | SOLO_GERENTE | SI | RECHAZA_ADMIN_SIEMPRE |
| ADMINISTRADOR | administrador | SOLO_GERENTE | NO | PUBLICA |
| ADMINISTRADOR | administrador | TODOS_LOS_ROLES | SI | RECHAZA_TODOS_LOS_ROLES |
| ADMINISTRADOR | administrador | TODOS_LOS_ROLES | NO | RECHAZA_TODOS_LOS_ROLES |
| ADMINISTRADOR | administrador_sistema | SIN_PISO | SI | RECHAZA_ADMIN_SIEMPRE |
| ADMINISTRADOR | administrador_sistema | SIN_PISO | NO | PUBLICA |
| ADMINISTRADOR | administrador_sistema | SOLO_GERENTE | SI | RECHAZA_ADMIN_SIEMPRE |
| ADMINISTRADOR | administrador_sistema | SOLO_GERENTE | NO | PUBLICA |
| ADMINISTRADOR | administrador_sistema | TODOS_LOS_ROLES | SI | RECHAZA_TODOS_LOS_ROLES |
| ADMINISTRADOR | administrador_sistema | TODOS_LOS_ROLES | NO | RECHAZA_TODOS_LOS_ROLES |
| ADMINISTRADOR | gerente | SIN_PISO | SI | RECHAZA_ADMIN_SIEMPRE |
| ADMINISTRADOR | gerente | SIN_PISO | NO | PUBLICA |
| ADMINISTRADOR | gerente | SOLO_GERENTE | SI | RECHAZA_ADMIN_SIEMPRE |
| ADMINISTRADOR | gerente | SOLO_GERENTE | NO | PUBLICA |
| ADMINISTRADOR | gerente | TODOS_LOS_ROLES | SI | RECHAZA_TODOS_LOS_ROLES |
| ADMINISTRADOR | gerente | TODOS_LOS_ROLES | NO | RECHAZA_TODOS_LOS_ROLES |
| OPERADOR | operario | SIN_PISO | SI | PUBLICA |
| OPERADOR | operario | SIN_PISO | NO | PUBLICA |
| OPERADOR | operario | SOLO_GERENTE | SI | PUBLICA |
| OPERADOR | operario | SOLO_GERENTE | NO | PUBLICA |
| OPERADOR | operario | TODOS_LOS_ROLES | SI | RECHAZA_TODOS_LOS_ROLES |
| OPERADOR | operario | TODOS_LOS_ROLES | NO | RECHAZA_TODOS_LOS_ROLES |
| OPERADOR | administrador | SIN_PISO | SI | PUBLICA |
| OPERADOR | administrador | SIN_PISO | NO | PUBLICA |
| OPERADOR | administrador | SOLO_GERENTE | SI | PUBLICA |
| OPERADOR | administrador | SOLO_GERENTE | NO | PUBLICA |
| OPERADOR | administrador | TODOS_LOS_ROLES | SI | RECHAZA_TODOS_LOS_ROLES |
| OPERADOR | administrador | TODOS_LOS_ROLES | NO | RECHAZA_TODOS_LOS_ROLES |
| OPERADOR | administrador_sistema | SIN_PISO | SI | PUBLICA |
| OPERADOR | administrador_sistema | SIN_PISO | NO | PUBLICA |
| OPERADOR | administrador_sistema | SOLO_GERENTE | SI | PUBLICA |
| OPERADOR | administrador_sistema | SOLO_GERENTE | NO | PUBLICA |
| OPERADOR | administrador_sistema | TODOS_LOS_ROLES | SI | RECHAZA_TODOS_LOS_ROLES |
| OPERADOR | administrador_sistema | TODOS_LOS_ROLES | NO | RECHAZA_TODOS_LOS_ROLES |
| OPERADOR | gerente | SIN_PISO | SI | PUBLICA |
| OPERADOR | gerente | SIN_PISO | NO | PUBLICA |
| OPERADOR | gerente | SOLO_GERENTE | SI | PUBLICA |
| OPERADOR | gerente | SOLO_GERENTE | NO | PUBLICA |
| OPERADOR | gerente | TODOS_LOS_ROLES | SI | RECHAZA_TODOS_LOS_ROLES |
| OPERADOR | gerente | TODOS_LOS_ROLES | NO | RECHAZA_TODOS_LOS_ROLES |

## Piso inicial por nivel (4 filas)

| N | Piso inicial |
|---|---|
| operario | SIN_PISO |
| administrador | SIN_PISO |
| administrador_sistema | SOLO_GERENTE |
| gerente | SOLO_GERENTE |
