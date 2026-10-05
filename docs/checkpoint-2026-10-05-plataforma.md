# Checkpoint 2026-10-05: plataforma E1–E8, qué falta para estar live y cómo retomar

> Para retomar desde otra terminal o sesión sin la conversación anterior. No contiene credenciales. El detalle fino de cada decisión vive en los ADR (012, 019 a 024) y en
> `docs/deploy-con-migraciones.md`; la memoria de Claude (`motor2-plan-plataforma-e1-e8-y-solicitudes-de-pago.md`) tiene el historial completo.

## 1. En una línea

El código de la plataforma (consola, alta de empresas, ciclo de vida, módulos, invitación por usuario) está **terminado y pusheado**. **Nada de esto está desplegado en producción
todavía**: faltan pasos que solo se hacen con terminal/paneles (rol de base, proyecto de Vercel de la consola, variables, migración de E8).

## 2. Dónde está el código

- Rama: `multitenancy-fase-a` (a ella se pushea siempre; `main` no se toca sin decirlo). HEAD al escribir esto: `f53776e`. Remoto: `Alejandro-Gabriel-Pozo/motor2`.
- CI (`.github/workflows/ci.yml`): verde hasta `6b826db` (incluye las pruebas con el rol real de plataforma y los e2e de la consola). El run de `f53776e` estaba en curso.
- Verificar el estado real al arrancar: `git status --short`, `git log --oneline -5`, `gh run list --branch multitenancy-fase-a --limit 3`.

## 3. Qué está hecho (resumen)

| Bloque | Qué es | ADR |
|---|---|---|
| E1–E4 | multiempresa, identidad de plataforma, consola con ingreso (código por mail + TOTP), rol de base `motor2_plataforma` | 007, 012, 019 |
| E5 | alta de empresa en `PROVISIONING` + invitación del primer gerente (CUIT declarado) | 020 |
| E6 | confirmar el alta, corregir CUIT (hasta la primera factura autorizada), suspender / reactivar | 021 |
| ADR-022 | `app_empresa_actual()` ya no cae en «la única empresa ACTIVE» | 022 |
| E7 | módulos por empresa desde la consola (`/empresas/[id]/modulos`), sin migración | 023 |
| E8 | invitación por usuario (sin precarga), vinculación de Google por invitación, **enlace automático de cuentas APAGADO** | 024 |
| extras | aviso propio para cuenta desactivada; `crearEmpresa` mudada a `test/setup` | — |

Decisiones del dueño vigentes de E8: D1 = V1 (el `User` y las membresías se crean **al aceptar**), D2 = cuenta de Google rehecha se bloquea y la resuelve soporte, D3 = todos por
invitación (sin vincular por dominio), D4 = el enlace nunca se muestra (se reenvía), C1 = invitación solo para quien **no** es miembro (a los miembros se les suma la sucursal directo),
C2 = `crearSucursalConAdmin` exige un primer admin que ya sea miembro. Solicitudes de pago (parte 3) queda como módulo piloto: **no bloquea el live**.

## 4. Estado de producción (Neon / Vercel)

- Dos instalaciones: **zuluhub** (multiempresa, 2 empresas activas; proyecto Neon `solitary-queen-72133594`, rama `br-fragrant-voice-b4buzhky`) y **stockhneuquen** (una empresa;
  `morning-field-10188884`, rama `br-steep-wind-af8iop63`). Archivos de entorno locales: `.env.vercel.zuluhub` y `.env.vercel.empresa` (no se commitean ni se imprimen).
- Migraciones ya aplicadas en ambas bases de producción: `20261010120000_invitaciones` (E5) y `20261011120000_app_empresa_actual_sin_respaldo` (ADR-022).
- **NO aplicada en producción: `20261012120000_invitacion_de_usuario` (E8).** Solo está en `motor2_dev` y `motor2_e2e` locales. Aplicarla pide **autorización expresa**, rama de
  respaldo y rama de ensayo en Neon (nunca ensayar con el Preview de stockhneuquen: comparte la base de producción).
- El rol `motor2_plataforma` **no existe** todavía en ninguna base de Neon.
- Medición del 2026-10-05 (`npm run medir-precargados`): zuluhub 1 usuario, todos con Google, 0 precargados; stockhneuquen 2 usuarios, **1 precargado activo sin Google** (hay que
  mandarle «Invitar a vincular» antes de que el cambio de E8 lo deje afuera; hoy nunca entró, así que no se corta un uso real).
- ADR-022 se migró el 2026-10-04: vigilar Sentry unas 48 horas (`P2011`/`23502` sobre `empresaId`, `42501`).
- Respaldos de Neon conservados: `respaldo-pre-e5-adr022-zuluhub-2026-10-04` y `respaldo-pre-e5-adr022-stockhneuquen-2026-10-04`.

## 5. Qué falta para estar live (en orden)

**A. Dejar viva la consola** (necesita terminal y paneles)
1. En **cada** base de Neon, como dueño, con `psql`: `scripts/operaciones/crear-rol-motor2-plataforma.sql` (hace falta superusuario).
2. Proyecto de Vercel de la consola: Root Directory `plataforma/`; variables `PLATAFORMA_DATABASE_URL` (rol `motor2_plataforma`), `PLATAFORMA_SECRETO_CODIGOS`,
   `PLATAFORMA_CLAVE_TOTP`, `PLATAFORMA_URL_APP` (dirección pública de la app de esa instalación) y el canal de mails `avisos` de Resend (`CORREO_AVISOS_*`). Por ahora un proyecto
   por instalación (ver §6). Los secretos se generan con `scripts/operaciones/generar-secretos-env.sh`.
3. Primer administrador: `npm run plataforma:crear-admin` con ese entorno (imprime el TOTP y los códigos de recuperación **una sola vez**).

**B. Llevar E8 a producción** (detalle y vuelta atrás en `docs/deploy-con-migraciones.md`, sección «Invitación por usuario…»)
1. En los proyectos de Vercel de **la app** de cada instalación: `CORREO_AVISOS_*` y `AUTH_URL` (https, fija, sin ruta). Sin eso las invitaciones quedan «sin enviar».
2. Solo lectura antes: `node scripts/operaciones/con-env.mjs .env.vercel.<zuluhub|empresa> -- npx prisma migrate status` y `… -- npm run medir-precargados`.
3. Orden por base (zuluhub primero): desplegar la **consola** → rama de respaldo + rama de ensayo con `migrate deploy` → comprobar privilegios y triggers → `… -- npm run migrar:aprobar`
   → desplegar la **app**. Borrar la rama de ensayo al terminar.
4. «Invitar a vincular» a la persona de stockhneuquen (Administración → Usuarios) y prueba de humo con una cuenta real: alta de una persona nueva → mail → enlace → Google → Aceptar.
5. En cada app de Vercel conviene borrar `BOOTSTRAP_ADMIN_EMAILS` (ya no se usa).

## 6. Lo que sigue en el código: una consola para las dos instalaciones

Idea del dueño (y ya decidida en ADR-012 §4): **un solo proyecto de plataforma**; la identidad de los administradores vive en la base de zuluhub; la consola tiene **una variable de
conexión por instalación**. Hoy el código solo conoce UNA conexión (`plataforma/src/db.ts`, `plataforma/src/entorno.ts`: `PLATAFORMA_DATABASE_URL`).

Esbozo (a validar con el agente `Plan` antes de escribir código, como pide `AGENTS.md`):
- Entorno: la instalación principal (`PLATAFORMA_DATABASE_URL`, `PLATAFORMA_URL_APP`, nombre) más una lista de adicionales (`PLATAFORMA_INSTALACIONES_ADICIONALES`, un JSON con id, nombre,
  URL de base y URL de la app), todas con el rol `motor2_plataforma`; se valida que no repitan base ni id.
- Una cookie de «instalación actual» (httpOnly, `SameSite=Strict`) validada siempre contra la lista (un valor desconocido cae en la principal, nunca elige una base) y un selector en la consola.
- Las pantallas y acciones operan sobre la base de la instalación elegida; los enlaces de los mails apuntan a la app de **esa** instalación. La sesión del administrador sigue siendo una sola
  (base principal).
- Auditoría: ADR-012 §5 pide la fila de `AuditoriaPlataforma` **en la base de la empresa afectada y en la misma transacción** (ya es así: la tabla existe en cada base).
- Se agregan: ADR-025, tests de entorno y de aislamiento entre instalaciones, spec E2E con dos bases. Sin migración.

## 7. Reglas del proyecto que hay que respetar (están en `AGENTS.md` / `CLAUDE.md`)

- Next.js de esta versión tiene cambios: leer `node_modules/next/dist/docs/` antes de usar APIs de Next.
- Planificar con la skill `plan-con-verificacion-e2e` (agente `Plan`, `opus`, verifica el código real) y terminar siempre con el **gate de 8 comandos, en la misma corrida y limpios**:
  `npx tsc --noEmit`, `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto`, `npm test`, `npm run build`, `npm run plataforma:build`, `npm run test:e2e`.
- Migraciones y escrituras en producción: **solo con autorización expresa**, con rama de respaldo y ensayo. Un clasificador puede bloquear escrituras a producción desde la sesión de Claude:
  en ese caso las corre el dueño con `! comando`.
- Nunca imprimir credenciales; `git add` por nombre (no `-A` a ciegas); commit y push solo con autorización (a `multitenancy-fase-a`).
- Prisma 7 rechaza `undefined` explícito en `data`. Los tests con el rol real de plataforma (`describe.skipIf(!PLATAFORMA_DATABASE_URL)`) solo corren en CI.
- En Windows/Git Bash los heredocs con comillas son frágiles: usar el editor de archivos y scripts de Python para ediciones; respetar CRLF/LF del archivo.

## 8. Pendientes menores y deuda conocida

- Mutación sobreviviente aceptada: `count !== 1` en `vincularCuentaConInvitacion` (defensa redundante; la transacción serializable ya lo impide).
- Hoy se puede invitar como usuario el email de un administrador de plataforma (ya existía): la app no puede consultar `AdminPlataforma`.
- Revocar las invitaciones pendientes al apagar una cuenta; `pages.error` para llevar todos los rechazos del login a `/login`.
- Desactivar el módulo Carta no oculta la carta pública (es previo a E7).
- Pendientes anteriores: `diagnostico-roles-de-sistema.ts:37`, `huerfanos.cjs`, O0, V6, rama por defecto, ruleset de GitHub, scripts `medir-*`, `allowDangerousEmailAccountLinking` ya resuelto en E8.
- Parte 3 (solicitudes de pago): módulo piloto, después del live.

## 9. Cómo arrancar una sesión nueva

1. Leer este archivo y la memoria (`MEMORY.md` del proyecto) y correr los comandos de §2.
2. Decidir el frente: (a) producción (§5, necesita terminal del dueño), o (b) consola única (§6, solo código).
3. Antes de tocar la base de producción: pedir autorización expresa, hacer rama de respaldo, ensayar.
