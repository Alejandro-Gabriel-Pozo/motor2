# Caja y cobro, etapa B: Server Actions, lecturas y permisos de cuentas de cobro y medios de pago (diseño, 2026-11-17)

Documento de DISEÑO (sin código, sin migración, sin tocar `acciones.ts`). Escalera de diseño de 10 niveles (AGENTS.md). Estado de cada decisión: CONFIRMADA = dicha por el dueño; PROPUESTA = criterio del ingeniero; PENDIENTE; NO VERIFICADA.
Fuente de Pedernal leída del repositorio real y vigente: `ZuluHub-ERP` `origin/main` en `0fd7b50` (fetch del 2026-11-17): `src/capacidades/permisos/empresa.ts`, `src/modulos/caja/casos-de-uso/declaraciones.ts`, `src/modulos/caja/consultas/declaraciones.ts`.

## 1. Propósito y alcance (nivel 1)

**Necesidad (quién la pidió y dónde está escrita):** el dueño, 2026-11-17, chat con el orquestador general: «quiero que construyas lo que falta, ya. ahora.» y «Todo lo que se pueda hacer en paralelo, ya. Y todo lo que se pueda estar reutilizando, tenerlo en cuenta.»; y «Caja: cierre del día y cuenta de cobro» «como las decidió Pedernal» (2026-11-16). Hoy los casos de uso de C3 (crear, editar, desactivar y reactivar cuentas de cobro; crear, editar —con qué datos pide cada uno— desactivar y reactivar medios de pago) existen y están probados, pero **nadie puede llamarlos desde la aplicación**: no hay Server Actions, ni permisos, ni lecturas de administración (la lectura `leerMediosDeCobro` de PR-B devuelve solo los medios ACTIVOS, para cobrar).
**Qué entra:** 8 Server Actions finas, 3 lecturas de administración y 8 permisos nuevos. **Qué NO entra:** pantallas (Frente 6), reglas nuevas (están en C3 y C3b), la regla del cobro sin cuenta (P-C3, otro PR), la administración de la lista de marcas de tarjeta (la lista es global y la administra la plataforma: C3, Q-C3-3).

## 2. Inventario de lo que ya existe (reutilizar antes de crear)

| Ya existe | Dónde | Cómo se reutiliza |
|---|---|---|
| Casos de uso de cuentas de cobro: `crearCuentaDeCobroCasoDeUso`, `editarCuentaDeCobroCasoDeUso`, `cambiarEstadoDeCuentaDeCobro` (desactivar/reactivar) | `src/server/actions/caja/casos-de-uso/` | tal cual, sin cambios |
| Casos de uso de medios: `crearMedioDePagoCasoDeUso`, `editarMedioDePagoCasoDeUso` (incluye el conjunto de datos que pide), `cambiarEstadoDeMedioDePago` | ídem | tal cual |
| Comandos y resultados con códigos cerrados (`ComandoCrearCuentaDeCobro`… `ResultadoReactivarMedioDePago`) | `src/core/features/caja/caja.schema.ts` | tal cual |
| Molde de acciones finas y guard de formato | `src/server/actions/caja/caja.ts`, `src/core/features/caja/caja.guard.ts` (PR-B) | se copia la forma |
| Lectura de lo cobrado con datos del cobro | `leerCobranzasDeSesion` (PR-B) bajo `caja_ver` | **no se crea permiso nuevo** para leer DNI/últimos 4 (ver §4) |
| Lista de marcas de tarjeta (global) | tabla `ValorDeLista` (C3) | lectura de solo lectura para armar el formulario de medios |
| Oráculos de combinaciones de cuenta y medio | `test/caja/oraculo-de-combinaciones-del-cobro.ts` | se reutilizan en las pruebas de las acciones |

## 3. Los permisos de Pedernal (lo leído)

| Clave en Pedernal (`empresa.ts`) | Roles | Qué hace |
|---|---|---|
| `medios_de_pago.crear` / `.editar` / `.reactivar` / `.desactivar` | gerente, administrador | alta, edición (incluye elegir qué datos opcionales pide el medio: «`medios_de_pago.editar` cubre elegir qué datos opcionales pide cada medio», decisión 129), reactivar, desactivar |
| `cuentas_de_cobro.crear` / `.editar` / `.reactivar` / `.desactivar` | gerente, administrador | ídem para cuentas de cobro |
| `cajas.ver` | gerente, administrador, operador | TODAS las lecturas de caja: `listarMediosDePago`, `listarCuentasDeCobro`, resumen de sesión, cobros de la jornada (con sus datos) |

Efecto de cada una en el catálogo de módulos de Pedernal: crear/editar/reactivar «CREA_AMPLIA», desactivar «COMPLETA_CIERRA»; sin capacidad de plan.

## 4. Permisos nuevos propuestos para Motor2 (nivel 5, PROPUESTA)

Reglas de Motor2 (leídas del código): pisos `operario < administrador < administrador_sistema < gerente`; el piso manda sobre la fila de la matriz; semilla solo en el rol `admin` («todo nace cerrado», 2026-11-11); el gerente delega. **Piso propuesto: operario**, porque el dueño decidió (2026-11-17, «que la empresa pueda editar los permisos libremente y que a un operario, si la empresa quiere darle algo que es importante, se lo pueda dar», y bajar a operario los pisos de administrador existentes) que los pisos «se habían quedado cortos»; Pedernal da estas ocho a «gerente y administrador», que en Motor2 es la **semilla** (solo `admin`, y el gerente que tiene ese rol), no el piso.

| Clave propuesta | Contexto | Piso | Semilla | Solo ver | Qué hace | Equivalente en Pedernal |
|---|---|---|---|---|---|---|
| `caja_medio_de_pago_crear` | sucursal | operario | admin | no | dar de alta un medio de pago | `medios_de_pago.crear` |
| `caja_medio_de_pago_editar` | sucursal | operario | admin | no | editar un medio (nombre y qué datos pide) | `medios_de_pago.editar` |
| `caja_medio_de_pago_reactivar` | sucursal | operario | admin | no | reactivar un medio | `medios_de_pago.reactivar` |
| `caja_medio_de_pago_desactivar` | sucursal | operario | admin | no | desactivar un medio (el efectivo no se desactiva) | `medios_de_pago.desactivar` |
| `caja_cuenta_de_cobro_crear` | sucursal | operario | admin | no | dar de alta una cuenta de cobro | `cuentas_de_cobro.crear` |
| `caja_cuenta_de_cobro_editar` | sucursal | operario | admin | no | editar una cuenta de cobro | `cuentas_de_cobro.editar` |
| `caja_cuenta_de_cobro_reactivar` | sucursal | operario | admin | no | reactivar una cuenta | `cuentas_de_cobro.reactivar` |
| `caja_cuenta_de_cobro_desactivar` | sucursal | operario | admin | no | desactivar una cuenta | `cuentas_de_cobro.desactivar` |

Módulo provisorio `salon`, igual que las claves de caja ya existentes. **Lecturas: sin permiso nuevo**, bajo `caja_ver` (como `cajas.ver` en Pedernal): incluye ver los datos del cobro (DNI y últimos 4), lo que cumple la decisión del dueño «también quien cobra» (Q-C3-7) sin una clave aparte. Descripciones de los permisos: las fija la sesión de Textos.

### Diferencias con Pedernal (declaradas con su motivo)

1. **Piso operario, semilla solo `admin`:** Pedernal da las ocho a gerente y administrador con roles fijos; Motor2 tiene roles editables y «todo nace cerrado». Motivo: regla del 2026-11-11 y decisión del dueño del 2026-11-17 sobre los pisos. **PENDIENTE de confirmar por el dueño** (ver Q-B1).
2. **Ocho claves, como Pedernal** (granularidad igual: la empresa puede darle «crear» sin «desactivar»). Alternativa más barata si el dueño la prefiere: DOS claves (una por medios, una por cuentas) que cubren las cuatro acciones; se descarta porque pierde esa granularidad de paridad.
3. **Lecturas bajo `caja_ver`**, no bajo una clave aparte (igual que Pedernal con `cajas.ver`).
4. **Módulo `salon` provisorio** (el catálogo de módulos es del Frente 4).

## 5. Casos de uso y acciones (nivel 3 y 8)

Cada acción es un adaptador fino, igual que las de caja de PR-B: `conPermiso(<clave>)` → formato por lista de permitidos en el guard (DENTRO del envoltorio) → caso de uso existente → resultado cerrado. Sin lógica nueva. La sucursal de una cuenta de cobro es una entrada explícita (como en `ComandoCrearCuentaDeCobro`): se valida contra el alcance del usuario (`SUCURSAL_FUERA_DE_ALCANCE`) y nunca se confía en el frontend.

| Acción propuesta | Caso de uso | Clave | Entrada |
|---|---|---|---|
| `crearCuentaDeCobroDeCaja` | `crearCuentaDeCobro` | `caja_cuenta_de_cobro_crear` | `{ tipo, nombre, identificadorExterno, sucursalId }` |
| `editarCuentaDeCobroDeCaja` | `editarCuentaDeCobro` | `caja_cuenta_de_cobro_editar` | `{ cuentaDeCobroId, versionEsperada, nombre, identificadorExterno, sucursalId }` |
| `desactivarCuentaDeCobroDeCaja` | `cambiarEstadoDeCuentaDeCobro` | `caja_cuenta_de_cobro_desactivar` | `{ cuentaDeCobroId }` |
| `reactivarCuentaDeCobroDeCaja` | ídem | `caja_cuenta_de_cobro_reactivar` | `{ cuentaDeCobroId }` |
| `crearMedioDePagoDeCaja` | `crearMedioDePago` | `caja_medio_de_pago_crear` | `{ tipo, nombre }` |
| `editarMedioDePagoDeCaja` | `editarMedioDePago` | `caja_medio_de_pago_editar` | `{ medioDePagoId, versionEsperada, nombre, datos }` |
| `desactivarMedioDePagoDeCaja` | `cambiarEstadoDeMedioDePago` | `caja_medio_de_pago_desactivar` | `{ medioDePagoId }` |
| `reactivarMedioDePagoDeCaja` | ídem | `caja_medio_de_pago_reactivar` | `{ medioDePagoId }` |

Lecturas (bajo `caja_ver`, patrón de `lecturas-de-caja.ts`; datos como texto, nunca crudos): `leerCuentasDeCobroDeAdministracion` (todas las de las sucursales del usuario, activas e inactivas, con su tipo, identificador, versión y sucursal), `leerMediosDeCobroDeAdministracion` (todos, activos e inactivos, con qué datos pide cada uno y su versión) y `leerMarcasDeTarjeta` (la lista global de marcas activas). Los nombres exactos los fija la construcción; este es el contrato que el Frente 6 puede esperar.

## 6. Invariantes y políticas (nivel 5)

Las de C3 y C3b (no se repiten): una sola cuenta de cobro **activa** por sucursal (crear, editar a una sucursal con otra activa y reactivar se rechazan con `SUCURSAL_YA_TIENE_CUENTA_ACTIVA`), el efectivo no se desactiva, nombres únicos sin distinguir mayúsculas, control de versión optimista en las ediciones. Propias de esta capa: (I1) el permiso se evalúa antes de cualquier lectura; (I2) la sucursal debe estar en el alcance del usuario; (I3) un rechazo por permiso no escribe nada; (I4) ninguna lectura devuelve datos de otra empresa o sucursal (RLS por empresa y por sucursal ya existente).

## 7. Historia y persistencia (nivel 6) y atomicidad (nivel 7)

**Sin tablas ni migración de esquema.** Migración de DATOS: siembra de las 8 claves en el rol `admin` (con `down.sql`, aditiva, como `20261117118000` y `20261117119100`), **solo se escribe cuando el orquestador confirme con la respuesta del dueño**, y sin aplicar a ninguna base real. Atomicidad y concurrencia: las de los casos de uso de C3/C3b (SERIALIZABLE, único parcial de una activa por sucursal, control de versión).

## 8. «¿Qué pasa si…?» por comando (nivel 10)

| Situación | Resultado esperado en la acción |
|---|---|
| **Permisos revocados a mitad** | rechazo por permiso, sin tocar la base (se evalúa en cada llamada) |
| **Sin la clave / sin la fila** | rechazo por permiso (la semilla es solo `admin`: un operador necesita que el gerente le prenda la fila) |
| **Sucursal fuera de alcance o ajena** | `SUCURSAL_FUERA_DE_ALCANCE` / `SUCURSAL_NO_ENCONTRADA`, sin escribir |
| **Formato inválido** (tipo, nombre, identificador, versión) | rechazo de formato del guard (lista de permitidos), sin llegar al caso de uso |
| **Repetición / doble clic** | crear: `yaExistia` (idempotente por nombre/estado); desactivar/reactivar: `yaEstabaInactiva`/`yaEstabaActiva`; editar con la misma versión dos veces: la segunda recibe `VERSION_DESACTUALIZADA` |
| **Concurrencia** (dos altas de cuenta a la vez en la misma sucursal; reactivar mientras otro crea) | la arbitra el caso de uso (SERIALIZABLE + único parcial): una gana y la otra recibe `SUCURSAL_YA_TIENE_CUENTA_ACTIVA`; nunca error crudo |
| **Desactivar la única cuenta durante un cobro** | lo arbitra el cobro (P-C3): o entra con la cuenta o queda sin cuenta; nunca asignada una inactiva |
| **Desactivar el efectivo** | `EFECTIVO_NO_SE_DESACTIVA` |
| **Pedir un dato que el tipo de medio no admite** | `DATO_NO_ADMITIDO_POR_EL_MEDIO` con el nombre del dato |
| **Reintento tras un corte de red** | idempotente por estado o por nombre; la edición se protege con la versión |
| **Error parcial** | todo o nada en la transacción del caso de uso; la acción no escribe nada por su cuenta |

## 9. Pruebas (nivel 10)

(1) **Oráculo rol × piso × clave** de las 8 claves (gerente con rol admin, administrador, operador con y sin fila, rol propio con y sin fila, sin membresía) contra la decisión de acceso real y por las acciones con usuarios reales. (2) **Matriz de denegación por defecto:** las 8 acciones y las 3 lecturas con su control positivo (familia «caja»). (3) **Concurrencia e idempotencia por las acciones reales** (dos altas simultáneas, desactivar/reactivar, doble clic, versión). (4) **Goldens de gobierno** actualizados (zona restringida: se declara en el PR). (5) **Mutaciones:** quitar el permiso de una acción → rojo; usar la clave equivocada → rojo; quitar la validación del guard → rojo. (6) **Combinaciones (regla del 2026-10-28):** (clave) × (rol) × (fila) × (piso); guardián que falla si aparece una clave `caja_*` nueva sin declarar.

## 10. Decisiones de la etapa B (2026-11-17)

El dueño delegó estas tres preguntas en Pedernal («Preguntale a Pedernal, según sus reglas…», relayado por el orquestador general el 2026-11-17) y Pedernal contestó con su código (`ZuluHub-ERP` `src/capacidades/permisos/empresa.ts:139-166`, `src/modulos/caja/consultas/declaraciones.ts:3-9`). Estado: CONFIRMADA por delegación del dueño en Pedernal.

- **Q-B3, CONFIRMADA:** OCHO claves (crear, editar, reactivar y desactivar × medios de pago y cuentas de cobro), como Pedernal. `medios_de_pago.editar` cubre elegir qué datos opcionales pide cada medio.
- **Q-B1, CONFIRMADA:** semilla igual a Pedernal: gerente y administrador (rol `admin`; el operador ninguna). **Piso operario** (Pedernal: administrador), por la decisión del dueño PISOS-65 (2026-11-17: la empresa decide fila por fila): DIFERENCIA declarada con esa cita. Igual para el ajuste de caja (`caja_registrar_ajuste`: en #429 nace de piso operario; Pedernal: gerente y administrador).
- **Q-B2, CONFIRMADA:** las lecturas van con `caja_ver`, sin clave «ver» propia (Pedernal exige `cajas.ver`, los tres roles). Los datos del cobro (DNI, cupón) también bajo `caja_ver`; en Pedernal esa restricción no está decidida (Q15 de E3): queda como está.

**Cómo se construye:** (1) las 3 lecturas de administración, ya, sin permiso nuevo; (2) las 8 acciones finas con sus 8 claves, apiladas sobre #429, en UNA sola migración de permisos (aditiva, con `down.sql` y `verificacion-previa.sql`, sin aplicar a ninguna base real), sin tocar ningún piso existente y sobre el lote A (PISOS-65).

**Estado:** DISEÑO confirmado; la construcción va en PR aparte.
