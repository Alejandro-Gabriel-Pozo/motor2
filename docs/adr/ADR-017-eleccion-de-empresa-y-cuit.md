# ADR-017: Con acceso a varias empresas hay que elegir una; el CUIT se valida y se guarda canónico

> Redactado el 2026-10-03 (pasos E1 y E2 del plan de plataforma). **Estado: E1 y E2 completos**; la migración `cuit_unico` (E2 paso 5) se ensayó,
> se aplicó a ambas bases de producción y se pusheó el 2026-10-03. La parte de `PROVISIONING`/alta de empresas se documentará acá cuando se implemente
> (E5 en adelante); el envío de mails (E3) está en ADR-018.

## Contexto

Con una sola empresa activa por instalación (ADR-007) la empresa activa de la sesión era «la única con acceso». Con dos o más, el contexto elegía en
silencio la primera por antigüedad cuando no había cookie válida: quien tenía acceso a dos empresas entraba a una que no había elegido, y una empresa
suspendida o en alta aparecía como «sin acceso» sin explicación. Además el CUIT (obligatorio para la empresa por ADR-012) no se validaba en ningún
lado: el proveedor lo guardaba como texto libre.

## Decisión

### 1. Situación de acceso con estados (E1)

`obtenerSituacionDeAcceso()` (`core/auth/contexto.ts`, con `cache()`) devuelve un estado: `SIN_SESION`, `CON_EMPRESA` (con el contexto completo),
`ELEGIR_EMPRESA`, `EMPRESA_SUSPENDIDA` o `SIN_ACCESO`. `obtenerContextoUsuario()` solo devuelve contexto con `CON_EMPRESA`: **falla cerrado**, ninguna
acción ni lectura opera en una empresa «por defecto».

- Una sola empresa activa con acceso: se entra directo (la instalación de hoy no cambia).
- Dos o más con acceso y sin cookie `empresaActivaId` válida: `ELEGIR_EMPRESA`. La cookie se valida contra las pertenencias reales del usuario; la de
  una empresa suspendida o ajena no vale.
- Ninguna activa con acceso pero pertenencia a una o más suspendidas: `EMPRESA_SUSPENDIDA` (se nombra la empresa y se ofrece cerrar sesión).
- Empresas en alta (`PROVISIONING`) o en baja (`DELETING`) no se ofrecen ni se mencionan: `SIN_ACCESO`.

La pantalla de elección vive en `/login` (una única pantalla final por estado; los layouts redirigen ahí). `cambiarEmpresaActiva(empresaId, volver?)`
sigue a la ruta pedida si es interna (`rutaInternaSegura`). Para que una carga directa con sesión también recuerde adónde volver, `src/proxy.ts` pone
`x-motor2-ruta-pedida` en todo pedido salvo `/login` (antes solo sin cookie de sesión); sigue descartando lo que mande el cliente.

### 2. CUIT canónico (E2)

`core/fiscal/cuit.ts`: se normaliza (sin espacios, puntos ni guiones, 11 dígitos), se valida el prefijo (20, 23, 24, 27, 30, 33, 34) y el dígito
verificador (módulo 11, pesos 5-4-3-2-7-6-5-4-3-2), se **guarda canónico** (11 dígitos) y se **muestra** como `XX-XXXXXXXX-X`. El proveedor ya valida y
guarda así; `scripts/medir-cuit.ts` (`npm run medir-cuit`) cuenta los CUIT existentes que no cumplen, para decidir la migración con datos
(ninguna empresa tenía CUIT cargado: nada que corregir).

### 3. CUIT único (E2 paso 5, migración `20261008120000_cuit_unico`)

Decisión del dueño (2026-10-03): **dos proveedores de una misma empresa no pueden compartir CUIT**. Un mismo proveedor con otro «punto de venta» no es otro
CUIT (el punto de venta aún no está diseñado y valdrá para empresas y proveedores); un duplicado es un error de carga. Índices únicos comunes (no parciales:
Postgres admite varios NULL): `Proveedor(empresaId, cuit)` —por empresa, no global: un índice global filtraría, por el error de unicidad, la existencia de un
proveedor de otra empresa— y `Empresa(cuit)`, global (una empresa = un CUIT). La migración normaliza primero los CUIT existentes (vacío → NULL, separadores →
11 dígitos; los inválidos no se tocan) y se detiene, nombrando las filas, si queda alguno repetido. `altaProveedor` y `actualizarProveedor` chequean antes y
responden «Ya existe un proveedor con ese CUIT (…)» nombrando al otro; el índice cubre la carrera. Reversa: `down.sql` (solo los índices).

## Correcciones a otros ADR

- **ADR-007** (línea «la empresa activa sale de la sesión»): con dos o más empresas con acceso ya no se asume la primera; ver 1.
- **ADR-012** (CUIT obligatorio de la empresa): la validación del formato vive en `core/fiscal/cuit.ts` y se reutiliza.

## Consecuencias

- Quien tenía acceso a dos empresas verá la pantalla de elección en su primer ingreso tras el despliegue.
- Un CUIT inválido ya guardado en un proveedor hace fallar la edición hasta corregirlo (la validación es estricta).
- Cargar un CUIT que ya tiene otro proveedor de la empresa falla con el nombre del otro; antes se aceptaba.
- Mensaje de empresa suspendida: el dueño lo dejó como está (texto fijo, sin contacto); quizá una casilla específica más adelante.
