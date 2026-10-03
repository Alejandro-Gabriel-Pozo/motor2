# ADR-012: Identidad de plataforma y alta de empresas

> Redactado el 2026-10-03 (Bloque 0 del plan de plataforma). **Decidido, todavía sin implementar.** Complementa ADR-007 (instalación
> multiempresa) y ADR-008 (el «superadmin de plataforma» que allí figura como inexistente). Enmienda ADR-001 en lo fiscal (ver su sección
> «Enmiendas»). Cada migración y cada cambio de configuración remota se autoriza por separado.

## Contexto

Las empresas de una instalación se crean hoy con un script que corre el dueño, sin pantalla ni rastro propio. Se necesita una consola donde la
plataforma —las personas que operan el producto— dé de alta empresas, les asigne módulos y planes (ADR-011, ADR-013), invite al primer gerente y
corrija cosas puntuales. Esas personas **no son usuarios de ninguna empresa**: mezclarlas con `User` obligaría a darles pertenencia y rol dentro de
empresas ajenas, que es justo lo que se quiere evitar.

## Decisión

### 1. El administrador de plataforma es una entidad propia

Una tabla `AdminPlataforma`, **fuera del aislamiento por empresa** (no tiene `empresaId` ni RLS por empresa). No es un `User`, no tiene
`UsuarioEmpresa` ni rol de empresa. Nunca es gerente de nadie.

**El administrador de plataforma NO entra a las empresas.** No ve operaciones, ventas ni stock, no «impersona» a nadie y no tiene sesión de
empresa. Si una empresa necesita ayuda, la plataforma actúa sobre los datos de plataforma (módulos, plan, estado, gerente) o el gerente le
muestra su pantalla. La excepción de soporte, si algún día hace falta, es una decisión nueva y no se deja entreabierta.

### 2. Ingreso: código de un solo uso por email, y segundo factor siempre

- Primer paso: un **código de un solo uso enviado por email** (servicio Resend), válido para un solo email y una sola ocasión; se guarda su
  hash, vence a los 10 minutos y se invalida al usarse o al pedir otro. No hay contraseña.
- Segundo paso, **siempre**: TOTP. Al enrolarlo se entregan códigos de recuperación, guardados solo como hash.
- Sesión **propia**, con cookie `__Host-` distinta de la de empresas: máximo **8 horas** y **30 minutos de inactividad**.
- El **primer** administrador lo crea un script de arranque que corre el dueño con las credenciales cargadas desde archivos fuera del repositorio
  (nadie —ni el asistente de desarrollo— ve esos valores). Los siguientes los da de alta otro administrador.

### 3. Consola y base de datos de mínimo privilegio

- La consola es una aplicación **separada** (proyecto aparte en el hosting, subdominio propio); no comparte rutas ni cookies con la aplicación de
  empresas.
- Se conecta con un rol de base de datos propio, `motor2_plataforma`, con permisos **explícitos** y mínimos: sin `DELETE`, sin lectura de las
  tablas de operación, y con escritura en las tablas de plataforma (empresas, registro de módulos, planes, invitaciones, auditoría de
  plataforma). El permiso por tabla se otorga uno a uno; nada de «todo menos».

### 4. Una instalación, una identidad; una variable de conexión por instalación

Hay **un solo proyecto de plataforma**. La identidad de los administradores vive en la base de datos de la instalación de `zuluhub`. Para operar
sobre cada instalación (cada una con su propia base) la consola tiene **una variable de conexión por instalación**. Agregar una instalación es
agregar una variable y una entrada de configuración, no una aplicación nueva.

### 5. Auditoría de plataforma, con el administrador como autor

Toda acción de la consola sobre una empresa escribe una fila en una **tabla de auditoría de plataforma**, con el administrador (su id y su email)
como autor. No se crea un `User` técnico por empresa para firmar cambios. La fila se escribe **en la base de la empresa afectada y en la misma
transacción** que el cambio —sin clave foránea hacia el administrador, que vive en otra base— y la consola además guarda su propio registro de
operaciones. Un cambio de plataforma sin fila de auditoría no puede existir.

El traspaso de gerencia hecho por la plataforma usa la función del core (que no audita; ver ADR-008): la consola escribe esta auditoría.

### 6. Alta de empresa: CUIT obligatorio y primer gerente por invitación

- El **CUIT es obligatorio y único**. Lo fija solo la plataforma y queda **inmutable** a partir de la primera factura autorizada (el resto de los
  datos fiscales los edita el gerente; ver ADR-001).
- El alta **no crea usuarios con contraseña ni otorga módulos**: crea la empresa vacía (solo núcleo) y una **invitación** para el primer gerente.
- La invitación se envía por email (Resend) con un enlace de un solo uso y vencimiento. Al aceptarla, la persona queda como gerente de esa
  empresa. Es la **única** vía de alta; no hay autoservicio de registro.
- Cuando todas las pertenencias estén migradas a invitaciones, se elimina la vinculación automática de cuentas por email que hoy está habilitada
  como atajo.
- La migración que vuelve obligatorio el CUIT va **después** de que el dueño complete los CUIT faltantes de las empresas existentes.

### 7. Un deploy de plataforma no migra solo

Como ya rige para la aplicación de empresas (ADR-007, Tanda 7): el build verifica, no aplica migraciones. Las migraciones de plataforma se aplican
con la aprobación explícita del dueño, base por base.

## Alternativas descartadas

- **El administrador como `User` con rol especial dentro de una empresa «plataforma»**: lo deja a un paso de leer datos de empresas ajenas por un
  error de rol o de contexto. Se prefiere que la separación sea estructural.
- **Contraseña + segundo factor opcional**: el dueño decidió código por email más segundo factor siempre; sin contraseña no hay nada que filtrar.
- **Un proyecto de plataforma por instalación**: multiplica el mantenimiento sin ganar aislamiento, porque el aislamiento ya lo da el rol de base.
- **Un `User` técnico por empresa para firmar la auditoría**: ensucia las listas de usuarios de cada empresa y simula una persona que no existe.

## Correcciones a otros ADR

Los ADR originales no se reescriben; lo que ya no es cierto se corrige acá y cada uno lleva una línea de estado que apunta a este.

1. **ADR-008, §3 (gerente único).** Dice que el traspaso de la plataforma «llama a la función del core» y que «queda fila de auditoría».
   La función del core (`transferirGerenciaDeEmpresa`) **no audita**: la fila de auditoría la escribe la acción de usuarios que la invoca
   desde la pantalla de gerencia. Cuando lo haga la consola de plataforma, la auditoría la escribe ella (punto 5).
2. **ADR-008, «Superadmin de plataforma».** Dice que no existe como concepto. Queda decidido en este ADR (punto 1), aún sin implementar.
3. **ADR-007, tablas de plataforma y flujo de contexto.** `UsuarioEmpresa` **sí** tiene RLS desde la migración
   `20261001250000_rls_usuario_empresa` (política de aislamiento por empresa y otra de solo lectura de la propia pertenencia, que usa
   `app.usuario_id`); `Empresa` sigue sin RLS por empresa. Las lecturas previas al contexto de empresa van por `dbDeUsuario`.
4. **ADR-007, `Empresa.cuit` opcional.** Pasa a ser obligatorio y único (punto 6), después de que el dueño complete los faltantes.
5. **ADR-007, «`npm run build` corre `prisma migrate deploy`».** Era cierto al redactarlo; desde la Tanda 7 (2026-10-02) el build solo
   verifica y las migraciones las aplica el dueño (ver S-03 del propio ADR-007 y `docs/deploy-con-migraciones.md`).
6. **ADR-001.** El gerente también edita los datos fiscales salvo el CUIT y administra los puntos de venta fiscales; eso lo decide un ADR de
   datos fiscales aparte, todavía sin numerar. El CUIT es de este ADR (punto 6).

## Consecuencias

- Nueva superficie de seguridad (consola, rol de base, sesión propia), de ahí los controles: segundo factor siempre, mínimo privilegio, sesión
  corta y registro de toda acción.
- Depende de un proveedor externo de email para entrar y para invitar: si falla, el ingreso falla (no hay vía alternativa distinta de los
  códigos de recuperación).
- Las bases de las instalaciones quedan con una tabla de auditoría de plataforma que solo escribe el rol de plataforma.
- Hasta que esto exista, el alta de empresas sigue siendo el script manual de hoy.
