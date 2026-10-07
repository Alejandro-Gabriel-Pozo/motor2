# ADR-024: Invitación por usuario y sin enlace automático de cuentas de Google

> Redactado el 2026-10-05 (paso E8 del plan de plataforma). **Estado: implementado en el código; la migración `20261012120000_invitacion_de_usuario` se aplicó solo a la base
> local y a la de E2E**: en cada base de Neon se aplica con autorización expresa, ensayo en una rama y respaldo previo (ver `docs/deploy-con-migraciones.md`). Completa ADR-020
> (la invitación ya no es solo del primer gerente) y corrige ADR-007 en lo que decía de `allowDangerousEmailAccountLinking`.

## Contexto

Hasta E8, `agregarOActualizarUsuario` creaba el `User` por email **antes** de que la persona entrara, y Auth.js lo vinculaba solo al primer ingreso con Google gracias a
`allowDangerousEmailAccountLinking: true`. Eso significa que quien controle una cuenta de Google con ese email entra como ese usuario, sin que nadie le haya demostrado nada: el
correo no se verificó por un canal propio y el usuario precargado queda a disposición de cualquiera que lo adivine. Con varias empresas en la misma base el riesgo crece. Medido
el 2026-10-05: zuluhub 0 precargados sin Google; stockhneuquen 1 activo sin Google.

## Decisión

### 1. El enlace automático se apaga y no vuelve

`src/lib/auth.ts` declara `Google` sin opciones de enlace. Con el flag apagado, Auth.js tira `OAuthAccountNotLinked` si el `User` existe y no tiene cuenta de Google (verificado contra
`@auth/core` 0.41.3 en `test/auth/contrato-authjs-vinculacion.test.ts`: si una actualización cambia ese orden, el test falla). Un email que no existe se crea sin conflicto.
`test/arquitectura/sin-enlace-automatico-de-cuentas.test.ts` (AST) impide volver a encenderlo.

### 2. Tres tipos de invitación, en la columna `rolEmpresa` que ya existía

| Tipo | La crea | Para qué | La consume | Abre la vía 3 del login |
|---|---|---|---|---|
| `gerente` (E5) | la plataforma | primer gerente de una empresa en alta | aceptar con el CUIT | sí, con la empresa en `PROVISIONING` |
| `usuario` | un gestor (`gestion_usuarios`) | sumar a alguien que **no es miembro** de la empresa | el botón «Aceptar» de `/invitacion` | sí, con la empresa `ACTIVE` |
| `vinculacion` | un gestor | vincular la cuenta de Google de un usuario que **ya es miembro** y todavía no entró | el login al vincular | no |

La invitación es una **credencial de vinculación**: prueba que quien entra controla el buzón del email invitado. No da acceso por sí sola: el ingreso lo siguen decidiendo las vías 1 y
2 del gate y el kill-switch (`User.activoGlobal`) va primero. El token, el hash, la cookie `__Host-` de una hora, los 7 días de vida y el estado «vencida» calculado son los de E5.
No se agregó una columna `tipo`: así el código anterior, tras un Instant Rollback, no rompe al leer filas.

### 3. Sin precarga: las membresías nacen al aceptar (D1 = V1)

`agregarOActualizarUsuario` **no crea** `User`, `UsuarioEmpresa` ni `UsuarioSucursal` de quien no es miembro: crea una invitación de usuario con una fila `InvitacionSucursal` por
sucursal (con su rol y quién la otorgó) y manda el mail. Una segunda sucursal para el mismo email suma una fila a la misma invitación y no manda otro mail (hay una sola
pendiente por empresa y email). A quien **ya es miembro** se le suma la sucursal o se le cambia el rol al instante, como siempre (C1); si no tiene Google, se le manda además la
invitación de vinculación. `crearSucursalConAdmin` exige un primer admin que ya sea miembro (C2): «nunca una sucursal sin administrador» se mantiene y no se crea ningún `User`.

### 4. Aceptar revalida todo, todo o nada

Las membresías no existen hasta aceptar, así que al aceptar se revalida por cada sucursal lo que valía al invitar: la sucursal y el rol siguen activos, quien la otorgó sigue activo
(cuenta global, cuenta en la empresa) y con `gestion_usuarios` en esa sucursal (pasa por el guard de módulos y capacidades), y su techo de privilegio alcanza al rol y a quien
se incorpora (`mensajeSiNoPuedeAsignarRol`, `mensajeSiNoPuedeGestionar`, `mensajeSiReactivaAdminSinSerGerente`, medidos desde la base). Si una sucursal falla no se crea nada y la
invitación sigue pendiente. La auditoría lleva a quien otorgó como actor: la autoridad es suya. **Reenviar** rota el token, renueva los 7 días y vuelve a firmar la invitación y todas
sus sucursales a nombre de quien reenvía (que tiene que poder otorgar todas): es la salida cuando quien invitó perdió el permiso.

### 5. Vincular en el callback `signIn`

El callback corre **antes** de que Auth.js busque o cree nada (`@auth/core` `callback/index.js:55-70`). `decidirInicioDeSesion` (`server/sesion/acceso.ts`): email verificado y el gate de
siempre; usuario inexistente → entra; ya tiene esa cuenta → entra; tiene **otra** cuenta de Google → `/login?aviso=cuenta-distinta` (D2: se bloquea, lo resuelve soporte); existe y no tiene
Google → `vincularCuentaConInvitacion` crea la `Account` (con `id_token`, que lee el detector S-01) en una transacción serializable si el token sirve; si no, `/login?aviso=falta-invitacion`.
La de vinculación se consume al vincular; las de gerente y de usuario no (las consume su aceptación). Es idempotente. D3: no se vincula por dominio de Workspace; D4: el enlace nunca se
muestra en pantalla (se reenvía), y se arma con `AUTH_URL`, nunca con el encabezado `Host`.

### 6. Migración `20261012120000_invitacion_de_usuario` (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR)

`Invitacion`: el `CHECK` de tipo admite los tres, `invitadoPorId` (FK a `User`, obligatorio salvo en `gerente`), el CUIT solo en las de gerente, índice único `(empresaId, id)`. Tabla
`InvitacionSucursal` con claves foráneas **compuestas por empresa** (invitación, sucursal y rol son de la misma empresa por construcción), RLS `aislamiento_empresa`, `motor2_app` con
`SELECT`/`INSERT`/`UPDATE` de tres columnas y sin `DELETE`, nada para `motor2_plataforma`, y un trigger que exige que la madre sea una `usuario` pendiente. `proteger_invitacion()` se
reescribe por tipo: la app inserta, rota, revoca y acepta solo lo suyo; **la plataforma queda limitada a `gerente`**. Aditiva en lo funcional. `down.sql` incluido.

## Alternativas descartadas

- **Precarga + invitación de vinculación para todos (V2):** cambio más chico, pero deja usuarios fantasma por emails mal tipeados y conserva la precarga. El dueño eligió V1.
- **Vincular por dominio de Workspace:** deja una excepción al apagado (D3).
- **Mostrar el enlace si el mail no sale (D4):** un enlace de acceso visible en pantalla es superficie de fuga; se reenvía.
- **Aceptar una segunda cuenta de Google con invitación (D2):** abriría otra vía de vinculación.
- **Guardar las sucursales como JSON en la invitación:** se pierden las claves foráneas compuestas y el RLS por fila.

## Correcciones a otros ADR

- **ADR-020 §2:** el tipo de invitación ya no es solo `gerente`; §Consecuencias: «E8 pendiente» queda hecho.
- **ADR-007:** el enlace automático de cuentas por email ya no existe (la protección contra signup público dejó de apoyarse en él).
- **ADR-018:** la app de empresas pasa a ser consumidora del canal de mails `avisos` (hasta ahora solo lo usaba la consola).

## Consecuencias

- **Requisito previo en cada app de Vercel:** `CORREO_AVISOS_*` (Resend) y `AUTH_URL` (fija, ADR-007). Sin ellos las invitaciones quedan «sin enviar» y nadie puede ser invitado.
- **Orden de despliegue:** primero la consola (ya filtra por `rolEmpresa = 'gerente'`), después la migración en cada base, después la app.
- **Quien siga precargado sin invitación queda afuera** al desplegar: antes, `medir-precargados` y «Invitar a vincular» a cada uno (hoy, 1 en stockhneuquen).
- **Cuenta de Google rehecha (mismo email, otro identificador):** queda bloqueada hasta que soporte actúe (ver el runbook).
- **El gerente ve a la persona invitada en «Invitaciones pendientes», no en la tabla de usuarios**, hasta que acepta. Hay que explicarlo en la ayuda.
- **Pendientes explícitos:** mudar `crearEmpresa` (fixture de pruebas que todavía precarga) a `test/setup`; revocar las pendientes al apagar una cuenta; que la app pueda saber si un email es de un
  administrador de plataforma (hoy se puede invitar uno como usuario); `pages.error` para llevar todos los rechazos a `/login`.

## Implementación

`src/core/features/empresa/invitacion.ts`, `src/server/actions/auth/casos-de-uso/invitaciones-de-usuario-en-tx.ts` (antes en `core/features/empresa/`, Hito 3, I.5e), `src/core/auth/{invitacion,avisos-de-login}.ts`, `src/server/sesion/{acceso,invitacion,vincular-cuenta}.ts`, `src/server/actions/auth/{usuarios,sucursales}.ts`,
`src/server/actions/auth/casos-de-uso/enviar-invitacion-y-anotar.ts` (antes en `src/server/`, Hito 3, I.5f), `src/app/invitacion/*`, `src/app/(app)/administracion/usuarios/*`, `src/lib/auth.ts`, `prisma/seed.ts` (`--gerente` imprime el enlace de vinculación local).
Pruebas: `test/auth/{contrato-authjs-vinculacion,vinculacion}.test.ts`, `test/persistencia/{invitacion-de-usuario,aceptar-invitacion-de-usuario}.test.ts`,
`test/aislamiento/invitacion-de-usuario-rls.test.ts`, `test/administracion/invitacion-de-usuario.test.ts`, `test/arquitectura/sin-enlace-automatico-de-cuentas.test.ts`, `test/e2e/usuarios-invitacion.spec.ts`.

**Nota (Hito 3 de la pureza, B3, 2026-10-08): nace `server/sesion` y la aceptación es un caso de uso.** Sin cambio de comportamiento (huellas `huella-de-login` y
`huella-de-aceptacion`, intactas). El login previo al contexto de empresa salió de `core` a `src/server/sesion/`: `acceso.ts` (el gate de `signIn` y `decidirInicioDeSesion`; su reloj y
`ALLOWED_EMAIL_DOMAINS` quedan declarados hasta la Fase 6), `invitacion.ts` (la lectura por token e `invitacionConSuBase`, la única puerta de un token a la base de su empresa) y
`vincular-cuenta.ts` (`vincularCuentaConInvitacion`, escritor de infraestructura de login dentro del callback, «Permanente» en la lista de escrituras). Es una capa de abajo, lista cerrada
de archivos y de importadores (`test/arquitectura/server-sesion.test.ts`, regla `sesion-capa`); `ahora` es obligatorio en la invitación y la vinculación (O.24) y toda entrada verifica el
rol de ejecución (`test/arquitectura/invitacion-verifica-el-rol.test.ts`). Aceptar una invitación de usuario es el caso de uso
`src/server/actions/auth/casos-de-uso/aceptar-invitacion-de-usuario.ts` (`permiso=SIN_PERMISO`; el guard de quien otorgó sigue entrando por parámetro: leerlo dentro de la transacción
es el contrato C2 de O.35), con sus escrituras en `src/server/persistencia/invitaciones/marcar-invitacion-aceptada.ts` y `src/server/persistencia/permisos/membresias.ts`.
