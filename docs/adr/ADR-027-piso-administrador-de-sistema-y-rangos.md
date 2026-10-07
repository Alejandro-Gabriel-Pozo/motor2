# ADR-027: Piso «administrador de sistema» y escalera de rangos del RBAC

> Redactado el 2026-10-08 (Hito 3 de la rama `pureza-integracion`, trabajo 3.4). **Estado: aceptado por el dueño; la Fase F1 (sin migración) se implementa en
> el trabajo 3.4** (`docs/plan-hito-3-pureza.md` §9, lista de control `docs/pureza-integracion.md`). Las fases siguientes (F2 a F4) necesitan migraciones y quedan
> FUERA de la rama: cada una requiere la autorización expresa del dueño. Corrige ADR-008 (§1, §2 y Consecuencias: la escalera de niveles suma un escalón) y
> completa ADR-016 (el rol administrador se reconoce por su clave). Decisiones del dueño que recoge: **D0** (2026-10-06, «encargados» como capacidad opcional de
> cada empresa), **D15** y **D16** (2026-10-07) y el vocabulario y la interpretación de D15/D16 del plan del Hito 3 (2026-10-08). Fuentes: la evaluación del
> informe de RBAC frente a la Fase 4 (2026-10-06, carpeta de planes del dueño), el informe de RBAC que evalúa, y el grounding de roles y autoridad contra
> Odoo, ERPNext y Dolibarr (2026-10-06).

## Contexto

El RBAC de motor2 (ADR-008) es por acción y contexto, con un piso por acción (`nivelMinimo` en `src/core/permisos/acciones.ts`) que se hace cumplir dos veces:
al guardar la matriz (`guardarPermisos`, cuyo cuerpo vive en `src/server/actions/permisos/casos-de-uso/guardar-permisos.ts`) y en el guard, que ignora la fila de
un rol por debajo del piso aunque exista (`src/core/permisos/decision-de-acceso.ts`). La escalera tenía tres escalones: operario < administrador < gerente.

El problema que encontró la auditoría de RBAC: **«nivel administrador» y «rol de gobierno» son el mismo dato** (`Rol.clave = "admin"`, ADR-016). El piso
«administrador» junta dos cosas que el negocio separa:

- la **autoridad operativa** (anular una venta, cancelar un conteo, ver los reportes de dinero, administrar el catálogo), y
- el **gobierno de la empresa** (quién entra, con qué rol, qué puede hacer cada rol, qué sucursales existen y qué habilita la Central en cada una, y el
  registro de auditoría).

Por eso todo rol de negocio (mozo, cajero, depósito, «encargado») es operario por construcción: si un encargado tiene que anular ventas, hay que darle el rol
`admin` entero, con usuarios, matriz y roles incluidos (hallazgo H1). Y hay cuatro supuestos latentes del tipo «piso administrador ⇒ es el administrador de
la empresa» (H2: el alta de sucursal sin techo, cambiarse el propio rol, editar la matriz de un rol que uno tiene, el piso validado fuera de la transacción)
que hoy no se pueden explotar, porque solo la clave `admin` alcanza el piso administrador, pero se vuelven caminos de escalada apenas otro rol lo alcance.

El dueño decidió (D0) que los «encargados» —un rango intermedio con autoridad operativa y sin gobierno— son una **capacidad opcional** que la aplicación
ofrece y cada empresa decide si usa. Para ofrecerla hace falta, primero, poder NOMBRAR el gobierno como un piso propio.

## Decisión

### 1. Vocabulario de pisos: operario < administrador < administrador de sistema < gerente

`NivelDeAccion` suma el valor "administrador_sistema" (en la pantalla y en los mensajes: «administrador de sistema»). Los rangos son 1, 2, 3 y 4, en ese
orden, y viven en un solo lugar: `RANGO_DE_PISO` en `src/core/permisos/jerarquia.ts`, con la función pura `nivelAlcanzaElPiso(nivel, piso)` y la etiqueta
para mostrar `etiquetaDelPiso(nivel)`.

- **Operario (1)**: el trabajo diario (cargar compras, producción, ventas, conteos).
- **Administrador (2)**: la autoridad operativa (anular, corregir, catálogos, carta, reportes de dinero). Es el rango que en el futuro podrá tener un
  rol personalizado de la empresa («encargado», F3). Las 59 claves que hoy tienen este piso **no se renombran** a «encargado»: el nombre visible del rango
  2 en la pantalla se decide con F3; el piso sigue llamándose «administrador».
- **Administrador de sistema (3)**: el gobierno de la empresa. Hoy lo alcanza SOLO el rol con la clave técnica `admin` (`CLAVE_ROL_ADMIN`, ADR-016).
- **Gerente (4)**: uno por empresa (`UsuarioEmpresa.rolEmpresa`), sin matriz (ADR-008 §2 y §3).

No confundir con el «rol de sistema» (un rol con clave técnica: `admin` y `operador`, ADR-016) ni con el administrador de plataforma de la consola (ADR-012),
que está fuera de toda empresa.

### 2. Quién es administrador de sistema hoy

El rol con la clave `admin`. `rolAlcanzaLaAccion` pasa a comparar rangos: el rango de un rol es 3 si su clave es `admin` y 1 para cualquier otro (`operador`
y todo rol creado a mano). **Nadie tiene rango 2** porque `Rol.nivel` no existe (F2). Como el rol `admin` ya alcanzaba todo lo que no es de gerente, y
ningún otro rol alcanzaba nada por encima de operario, **F1 no cambia ninguna respuesta de acceso**: la caracterización del guard
(`test/permisos/caracterizacion/matriz-de-acceso.txt`) queda idéntica byte a byte, sin regenerarla.

Lo que NO cambia: `NivelDePersona`, `nivelDe`, `puedeGestionarA` y `puedeAsignarRol` (el techo de personas) siguen con tres escalones; el rango de una
PERSONA con cuatro escalones llega con F3, cuando exista alguien de rango 2.

### 3. Reclasificación: las 12 claves de gobierno pasan al piso «administrador de sistema»

Son las del módulo `administracion` que no son de piso gerente:

- de sucursal: `gestion_usuarios`, `activar_usuario_sucursal`, `notas_usuario_sucursal` y `ver_auditoria` (D16);
- de empresa: `apagar_cuenta_empresa`, `gestion_permisos`, `gestion_roles`, `renombrar_rol`, `capacidades_sucursal`, `alta_sucursal`, `activar_sucursal`
  y `renombrar_sucursal`.

Conteo del catálogo: de 51 operario, 71 administrador y 2 gerente pasa a 51 operario, 59 administrador, 12 administrador de sistema y 2 gerente. Incluye
las seis claves fijas del admin (`ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE`) y `capacidades_sucursal` (que la Central no puede apagar). Las dos de piso gerente
(`ver_auditoria_empresa`, `traspasar_gerencia`) no cambian.

### 4. D16: `ver_auditoria` es de gobierno

El registro de auditoría de la sucursal muestra cambios de precios y de permisos: es control sobre los demás, no trabajo diario. Va al piso administrador de
sistema; ningún rango 2 lo alcanza nunca, ni con una fila de la matriz.

### 5. D15: el rango 2 no recibe ninguna acción de empresa por defecto

Hay 19 acciones de contexto empresa que siguen en piso administrador (catálogos, recetas, carta, clientes, proveedores, `comparar_precios`, el reporte de
huecos de catálogo, renombrar o fusionar insumos). Como una acción de empresa vale con CUALQUIER membresía activa (ADR-008 §1), darle una a un encargado le
da alcance de empresa entera. Por eso D15 decide que **ninguna llega al rango 2 por defecto**; la empresa las habilita **de a una, con filas de la matriz**
(sin schema y sin subir el piso de esas 19: subirlas al piso de gobierno haría imposible habilitarlas). El blanco explícito para F3 queda congelado en un
test (la lista de las 19).

### 6. Contratos (O.35) que preparan a F3 sin cambiar comportamiento

- **C1** filtros con nombre propio en `src/core/permisos/filtros.ts` (admin efectivo para el gobierno; autoridad de admin para el techo): hoy dan lo mismo.
- **C2** una sola función pura para «¿puede darle este rol a esta persona?» (`mensajeSiNoPuedeDarRolA`).
- **C3** una sola selección del rol para la jerarquía (`SELECCION_DE_ROL_PARA_JERARQUIA`).
- **C4** ningún caso de uso ni persistencia lee la clave de un rol (regla 4 de `test/arquitectura/acceso-solo-por-el-guard.test.ts`).
- **C5** las escrituras de `Rol`/`PermisoRol` solo dentro de `conEdicionDePermisos` (`test/arquitectura/escrituras-de-permisos-por-politica.test.ts`).
- **C6** techo en el alta de sucursal (`test/permisos/techo-en-el-alta-de-sucursal.test.ts`).
- Pendientes dentro del Hito 3: releer el rol y el actor dentro de la transacción, la regla de «uno mismo» («nunca por encima del rango propio en el
  contexto, salvo el gerente»), y D13/D14 (la matriz del rol `admin` y de los roles de rango 2 la edita solo el gerente; commit propio al final del hito).
  Se agregan además una caracterización de los supuestos de hoy (que F3 y D13/D14 editan a propósito) y un guardián de que nadie escribe `Rol.nivel` fuera de
  la futura acción de cambiar el nivel (lista de permitidos vacía hasta F3).

### 7. Fases

- **F1 (esta rama, sin migración, trabajo 3.4):** este ADR; el vocabulario y los rangos en `jerarquia.ts`; la etiqueta en la matriz («Piso: administrador
  de sistema») y en el rechazo de `guardarPermisos`; el guardián de acceso aprende el valor nuevo; la reclasificación de las 12 claves (las declaraciones
  del catálogo, la matriz esperada de `test/permisos/matriz-esperada.ts` y la foto de `test/modulos/__golden__/empresa-principal.json`, regenerada a
  propósito).
- **F2 [MIG]:** la columna `Rol.nivel` dormida (aditiva, con valor por defecto operario y relleno del rol `admin`) y el CHECK «editar ⇒ ver» de
  `PermisoRol`. Ningún lector la lee todavía.
- **F3 (código + migración de datos):** despertar la columna (rango 2 para los roles que la empresa suba), la acción nivel_rol para cambiarlo (citada sin
  comillas porque todavía no existe), la regla de «uno mismo», limpiar las filas por encima del piso al bajar, y la interfaz.
- **F4 [MIG]:** el CHECK de los roles de sistema (el rol `admin` no puede quedar con otro nivel) y el diagnóstico en el build.

## Qué queda fuera (requiere autorización expresa del dueño)

- **`Rol.nivel`** y su CHECK, el CHECK «editar ⇒ ver» y la acción nivel_rol: son [MIG] (Fase 5 o ventanas propias) y no se tocan en esta rama.
- Leer o limpiar filas de `PermisoRol` en producción.
- El nombre visible del rango 2 en la pantalla.

## Alternativas descartadas

- **Renombrar las 59 claves de piso administrador a «encargado».** Cambiaría el piso de casi la mitad del catálogo, el golden de visibilidad y la matriz
  esperada sin ganar nada: el rango 2 no existe todavía y el piso «administrador» ya describe lo que esas claves exigen.
- **Subir el gobierno al piso gerente.** El gerente es uno por empresa y sin matriz: una empresa con varias sucursales se quedaría sin quien gestione a su
  gente cuando el gerente no está; además rompería la salvaguarda del admin (las seis claves fijas).
- **D15 por piso** (subir las 19 acciones de empresa al piso de gobierno). Impediría habilitarlas a un encargado de a una, que es justamente lo que D15 pide.
- **Piso también en la base** (trigger sobre `PermisoRol`). Contradice ADR-008 §1 (el catálogo vive en código) y agrega poco: el guard ya ignora la fila.
- **Contención tipo Kubernetes** (no dar un rol con permisos que uno no tiene, verbos escalate y bind). Ningún ERP de referencia la tiene; el rango y el
  piso por acción la aproximan. Opcional más adelante.
- **Hacer todo el RBAC antes del tramo B de la Fase 4.** Habría que escribir dos veces casi todos los archivos de gobierno, rompía la huella de gobierno y
  la lista de escrituras, y mezclaba una regla nueva con mudanzas en lo más sensible del sistema.

## Consecuencias

- La matriz muestra el piso «administrador de sistema» en las 12 claves de gobierno y el rechazo de `guardarPermisos` lo nombra. Para el rol `admin` y
  para los roles de nivel operario no cambia nada: la caracterización del acceso queda idéntica.
- Un rol de rango 2, cuando exista, no alcanza el gobierno ni la auditoría, por más filas que tenga en la matriz: el piso manda (ADR-008 §2).
- Una clave nueva de las Etapas B y C se clasifica una sola vez en cuatro escalones (por ejemplo, cerrar o reabrir un período, o los datos fiscales de la
  empresa, son de gobierno), sin migraciones de datos dobles.
- El guardián de acceso (`test/arquitectura/acceso-solo-por-el-guard.test.ts`) reconoce el valor nuevo: una comparación con él fuera de `core/permisos`
  es una decisión de acceso fuera del guard.
