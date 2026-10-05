# ADR-025: Una consola de plataforma para varias instalaciones

> Redactado el 2026-10-05. **Estado: implementado en el código; sin migraciones.** Concreta ADR-012 §4 («un solo proyecto de plataforma, una variable de conexión por instalación») y corrige dos
> puntos de ADR-012 y de ADR-024 (ver «Correcciones»). No cambia nada de lo decidido sobre el ingreso (ADR-019) ni sobre las acciones de empresas (ADR-020, 021, 023).

## Contexto

Hay dos instalaciones en producción, cada una con su propia base de Neon y su propia app de empresas: `zuluhub` (multiempresa) y `stockhneuquen` (una empresa). La consola de E4 a E8 conocía una sola
conexión (`PLATAFORMA_DATABASE_URL`) y operaba la instalación a la que apuntaba. La idea del dueño, ya escrita en ADR-012 §4, es una sola consola para todas.

El código real mostró un riesgo que el esbozo inicial (una cookie de «instalación actual») no cubría: **las dos bases de producción tienen una empresa con el mismo id**, `empresa_principal`, porque la crea
con id fijo la migración multiempresa. Con una cookie, un formulario abierto en una pestaña puede enviarse después de cambiar de instalación en otra, y suspender la `empresa_principal` de la otra base;
releer el `empresaId` dentro de la transacción no lo frena, porque la empresa existe en las dos.

## Decisión

### 1. La instalación va en la ruta, nunca en una cookie

Las pantallas son `/instalaciones/<id>/empresas`, `…/empresas/nueva`, `…/empresas/<empresa>` y `…/empresas/<empresa>/modulos`. **Toda acción recibe la instalación como PRIMER argumento** (la enlaza con `.bind` la página
que dibujó el formulario, así una pestaña desactualizada manda siempre la instalación que mostró) y abre con `contextoDeAccion(instalacionId)`: primero la sesión del administrador y después la instalación contra la lista
cerrada del despliegue. **Un id desconocido es un 404, nunca la principal.** Sin cookie nueva no hay superficie nueva (CSRF: siguen el control de `Origin` de Next, el POST y la sesión `SameSite=Strict`).
Cada acción además suma el `empresaId`, que se vuelve a leer dentro de la transacción de ESA base. El administrador puede operar todas las instalaciones (ADR-012 §4): elegir el id no le da ningún permiso nuevo.

### 2. Identidad y operación en bases distintas

- **Identidad** (administradores, sesiones, códigos de ingreso, eventos `ingreso`, `cierre-de-sesion`, `segundo-factor-fallido`, `bloqueo-por-fallos`): siempre la base de la instalación **principal** (`dbDeIdentidad()`).
- **Operación** (empresas, invitaciones, módulos y su auditoría): la base de la instalación elegida (`dbDeInstalacion(instalacion)`, que recibe una instalación ya resuelta, nunca un texto).
- La lógica de `servidor/{empresas,ciclo-de-vida,modulos}.ts` recibe la base por parámetro y **no toca tablas de identidad**: lo que necesita (los emails de los administradores, para no invitar a uno como gerente) entra por
  sus dependencias (`emailsDeAdmins`) y se lee de la base de identidad **fuera** de la transacción de operación. Antes lo leía de la base operada, donde en otra instalación esa tabla está vacía y el control se apagaba en silencio.
- Los tipos de acción de auditoría se separan: `AccionDeIdentidad` (solo en la principal) y `AccionSobreEmpresa` (solo en la base de la empresa, dentro de la transacción del cambio, ADR-012 §5).
- **Toda fila de auditoría sobre una empresa lleva la instalación en su `detalle`** (`AutorEnInstalacion`): si una operación cayera en la base equivocada, el desacople se vería en la propia fila.

### 3. Configuración: una variable de conexión por instalación, sin secretos en el JSON

- La **principal** es la de siempre: `PLATAFORMA_DATABASE_URL` y `PLATAFORMA_URL_APP`, más dos opcionales, `PLATAFORMA_INSTALACION_ID` (por defecto `principal`) y `PLATAFORMA_INSTALACION_NOMBRE`.
- Las **adicionales**: `PLATAFORMA_INSTALACIONES_ADICIONALES` = JSON **sin secretos** `[{"id":"stockhneuquen","nombre":"Stock Neuquén","urlApp":"https://…"}]` y, por cada una, su
  `PLATAFORMA_DATABASE_URL_<ID EN MAYÚSCULAS>`. Rotar la clave de una base toca una sola variable; en Vercel una variable sensible no se puede releer, así que meter las claves en un JSON obligaría a reescribir
  las de todas las instalaciones, y un error de tipeo podría filtrarlas en un mensaje de error.
- Validación (falla cerrada, con mensajes que **nombran la variable y nunca el valor**): ids `^[a-z][a-z0-9]{1,29}$` sin repetir; el JSON no admite campos de más (una clave pegada ahí se rechaza); cada adicional tiene su conexión y
  conecta con el rol `motor2_plataforma`; ninguna base repetida (se compara host sin `-pooler`, puerto y nombre); ninguna dirección de app repetida; hasta 10 instalaciones. El nombre de la variable de conexión se arma
  **solo** en `entorno.ts`.
- `cargar-env-vercel.sh` sigue rechazando toda variable `PLATAFORMA_*` (son de la consola, no de la app).

### 4. Una instalación caída no tumba la consola

Cada cliente de base se crea al primer uso, con pocas conexiones (3) y tiempo límite de conexión (10 s). El **inicio** muestra una tarjeta por instalación con lo que espera al administrador y lee cada una con un tope
de 5 s: la que falla dice «No pudimos leer esta instalación ahora» y las demás andan. Las pantallas de una instalación tienen su `error.tsx` («No pudimos conectar con esta instalación», «Reintentar», enlace al inicio, sin
mostrar `error.message`); el selector de instalaciones queda arriba porque el layout no consulta ninguna base. **Si la base principal está caída, la consola entera lo está** (la sesión vive ahí): es inherente al diseño.

### 5. Lista de empresas por instalación

Una lista **por instalación** más el resumen del inicio, no una vista agregada: las filas se pisarían (`empresa_principal` en las dos), los filtros y el aviso de «CUIT repetido» son por base (`Empresa_cuit_key` es por base) y con
una base caída una lista parcial haría creer que una empresa no existe. El selector es un `nav` con `aria-current`.

### 6. Los mails apuntan a la app de cada instalación

Las invitaciones, los reenvíos y el aviso de activación arman el enlace con la `urlApp` de **la instalación de la ruta** (`dependenciasParaInstalacion`), no con la de la principal.

## Alternativas descartadas

- **Cookie de «instalación actual»** (esbozo inicial): ver el contexto; operaría sobre la instalación equivocada con pestañas desactualizadas.
- **Un solo JSON con las URLs de conexión adentro**: ver §3.
- **Un proyecto de consola por instalación**: duplica sesiones, segundos factores y mantenimiento; el aislamiento ya lo da el rol de base.
- **Vista agregada de empresas**: ver §5.
- **Un «registro propio» de la consola** (ADR-012 §5, «además guarda su propio registro de operaciones»): no existe hoy y se posterga; se cubre después con una pantalla de **solo lectura** que junte la auditoría de cada base
  por administrador, sin escribir filas duplicadas.

## Correcciones a otros ADR

- **ADR-012 §4:** el formato concreto de las variables es el de §3 (no «una variable por instalación» a secas). **ADR-012 §5:** el registro propio de la consola queda postergado (arriba).
- **ADR-024 (orden de despliegue):** «primero la consola» valía con una sola base. Con una consola sobre dos bases que se migran de a una, **la consola tiene que andar contra una base un paso atrás en migraciones**. Hoy las
  dos bases de producción ya tienen la migración de E8; para las próximas, las consultas de la consola a tablas con columnas nuevas deben usar `select` explícito.
- **ADR-023:** la pantalla de módulos pasa a `/instalaciones/<id>/empresas/<empresa>/modulos`.

## Consecuencias

- Agregar una instalación = una entrada del JSON + su variable de conexión + el rol `motor2_plataforma` creado en su base, **sin código ni migración**.
- Pendientes explícitos: que `crear-primer-admin` revise también las bases adicionales (hoy solo la principal: un usuario de otra instalación podría quedar como administrador); aviso informativo de CUIT repetido **entre**
  instalaciones (hoy se permite sin control cruzado); `--instalacion` en los scripts `modulos-empresa` y `politica-empresa` (operan sobre la base del archivo de entorno que se use); aviso de «instalación atrasada en migraciones».
- Los E2E levantan la consola con dos instalaciones reales (la base de siempre y una segunda, `motor2_b_e2e`) más una «caída»; el spec `consola-instalaciones` corre en CI.

## Implementación

`plataforma/src/{entorno,db,rutas,registro-de-clientes}.ts`, `plataforma/src/servidor/{contexto,dependencias,identidad,resumen,auditoria}.ts`, `plataforma/src/app/page.tsx` y `plataforma/src/app/instalaciones/[instalacion]/**`.
Pruebas: `test/plataforma/{entorno,instalaciones}.test.ts`, `test/persistencia/consola-varias-instalaciones.test.ts` (dos bases reales con el mismo id de empresa),
`test/arquitectura/{consola-de-plataforma,consola-acciones-con-sesion,rol-plataforma-separado,base-e2e-guard}.test.ts` y `test/e2e/consola-instalaciones.spec.ts`.
