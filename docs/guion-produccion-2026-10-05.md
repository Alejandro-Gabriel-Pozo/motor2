# Guion de producción (para correr desde otra PC), actualizado a la consola única (ADR-025)

> Autocontenido: usa solo archivos de esta carpeta (`.env`, `.env.vercel.zuluhub`, `.env.vercel.empresa`) y comandos de PowerShell. Se corre parado en la raíz del repo (`motor2`).
> **Qué pegarle de vuelta a Claude:** solo las salidas que dicen «PEGAR». **Nunca** pegues URLs de conexión, claves, secretos TOTP ni códigos de recuperación.
> Cada bloque tiene su motivo en `docs/deploy-con-migraciones.md` y en `docs/checkpoint-2026-10-05-plataforma.md`.
>
> **Estado al 2026-10-05:** la migración de E8 **ya está aplicada en las dos bases de producción** (respaldadas: `respaldo-pre-e8-zuluhub-2026-10-05` y `respaldo-pre-e8-stockhneuquen-2026-10-05`). Lo que falta es lo de abajo.

## 0. Preparación (una vez)

```powershell
git pull                      # tiene que decir que estás en multitenancy-fase-a
npm install
psql --version                # tiene que existir (cliente de Postgres); si no, instalarlo
```

## 1. Solo lectura (seguro)

```powershell
node scripts/operaciones/con-env.mjs .env.vercel.zuluhub -- npx prisma migrate status
node scripts/operaciones/con-env.mjs .env.vercel.empresa -- npx prisma migrate status
```
PEGAR las dos salidas. Esperado: «Database schema is up to date!» en ambas.

## 2. Rol `motor2_plataforma` (una vez por base: zuluhub y después stockhneuquen)

Conectarse **como dueño** (la `DIRECT_URL` de cada archivo). En Neon no hace falta superusuario y **nunca** crear el rol desde la consola de Neon (nacería con BYPASSRLS). Elegí una clave nueva y fuerte **por base** y guardala.

```powershell
$u = ((Get-Content .env.vercel.zuluhub | Where-Object { $_ -like 'DIRECT_URL=*' }) -replace '^DIRECT_URL=','').Trim()
psql $u -v clave="LA-CLAVE-NUEVA-DE-ZULUHUB" -f scripts/operaciones/crear-rol-motor2-plataforma.sql

$u = ((Get-Content .env.vercel.empresa | Where-Object { $_ -like 'DIRECT_URL=*' }) -replace '^DIRECT_URL=','').Trim()
psql $u -v clave="LA-CLAVE-NUEVA-DE-STOCKHNEUQUEN" -f scripts/operaciones/crear-rol-motor2-plataforma.sql
```
**No** usar `-v restringir=1` todavía. PEGAR si hay algún error (si termina sin error, avisar «ok»). El script es idempotente: si ya lo corriste antes de que agregara el `GRANT SELECT` sobre `_prisma_migrations` (ADR-025, aviso de
«instalación atrasada en migraciones»), volver a correrlo en cada base agrega solo ese permiso nuevo, sin tocar el resto.

## 3. Las variables de la consola (un solo proyecto para las dos instalaciones)

Los nombres son estos, exactos. **Vos reemplazás los valores entre `<…>`** (claves reales y direcciones). Los hosts de Neon que se ven abajo no son secretos.

| Variable | Valor |
|---|---|
| `PLATAFORMA_DATABASE_URL` | `postgresql://motor2_plataforma:<CLAVE_ZULUHUB>@ep-noisy-truth-b41up2et.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require` |
| `PLATAFORMA_URL_APP` | `https://<dirección pública de la app de zuluhub>` (https, sin ruta) |
| `PLATAFORMA_INSTALACION_ID` | `zuluhub` |
| `PLATAFORMA_INSTALACION_NOMBRE` | `Zuluhub` |
| `PLATAFORMA_INSTALACIONES_ADICIONALES` | `[{"id":"stockhneuquen","nombre":"Stock Neuquén","urlApp":"https://<dirección pública de la app de stockhneuquen>"}]` |
| `PLATAFORMA_DATABASE_URL_STOCKHNEUQUEN` | `postgresql://motor2_plataforma:<CLAVE_STOCKHNEUQUEN>@ep-lingering-morning-afg7n33y.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require` |
| `PLATAFORMA_SECRETO_CODIGOS` | un secreto de **32 caracteres o más** (ver el comando de abajo) |
| `PLATAFORMA_CLAVE_TOTP` | una clave de **32 bytes en base64** (ver el comando de abajo) |
| `CORREO_AVISOS_RESEND_API_KEY` | `<clave de Resend>` |
| `CORREO_AVISOS_REMITENTE` | `Avisos <no-responder@<tu dominio verificado en Resend>>` |

Reglas: la clave de cada URL tiene que estar **codificada en porcentaje** si lleva caracteres especiales; el JSON de instalaciones **no lleva claves**; cada URL de conexión conecta con el usuario `motor2_plataforma`.
Los dos secretos aleatorios se generan sin mostrarse en pantalla, directo a un archivo local (después los copiás a Vercel desde el archivo):

```powershell
node -e "const c=require('crypto'),f=require('fs');f.appendFileSync('.env.plataforma.consola','PLATAFORMA_SECRETO_CODIGOS='+c.randomBytes(32).toString('base64')+'\n'+'PLATAFORMA_CLAVE_TOTP='+c.randomBytes(32).toString('base64')+'\n')"
```

**Comprobar la configuración antes de subirla a Vercel** (arma un archivo `.env.plataforma.consola` con las variables de la tabla y corre esto; imprime solo ids y hosts, nunca claves):
```powershell
$env:DOTENV_CONFIG_PATH=".env.plataforma.consola"
npx tsx -e "import 'dotenv/config'; import('./plataforma/src/entorno').then(m => console.log(m.leerInstalaciones(process.env).map(i => i.id + ' -> ' + new URL(i.databaseUrl).hostname + ' (' + i.urlApp + ')')))"
```
PEGAR la salida. Si algo está mal, el mensaje nombra la variable (nunca el valor).

## 4. Proyecto de Vercel de la consola (panel web, sin terminal). UNO solo.

1. New Project → importar `Alejandro-Gabriel-Pozo/motor2` → **Root Directory `plataforma`**, framework Next.js.
2. **Production Branch:** `multitenancy-fase-a` (el código de la consola solo está ahí; `main` no lo tiene).
3. Variables de entorno (Production): las 10 de la tabla del §3, copiadas del archivo `.env.plataforma.consola`.
4. Deploy. PEGAR la dirección que te da Vercel (no es secreta).

## 5. Primer administrador de la consola

El administrador vive en la base de la instalación **principal** (zuluhub), pero el alta revisa TAMBIÉN las bases adicionales (stockhneuquen): como `.env.plataforma.consola` ya trae `PLATAFORMA_INSTALACIONES_ADICIONALES` y
`PLATAFORMA_DATABASE_URL_STOCKHNEUQUEN` (del §3), no hace falta nada extra para que esa revisión cruzada funcione — si ese archivo NO tuviera esas variables, el alta revisaría solo la principal.
```powershell
$env:DOTENV_CONFIG_PATH=".env.plataforma.consola"
npm run plataforma:crear-admin -- --email tu-email@dominio.com --nombre "Tu Nombre"
```
Primero imprime qué instalaciones revisó (solo ids, nunca una URL): confirmá que diga `zuluhub (principal), stockhneuquen`. Si alguna no respondió, el mensaje lo dice y **no crea nada** (reintentar es gratis). Después imprime
**una sola vez** el secreto TOTP y los códigos de recuperación: escanear/guardar al instante. Después borrar `.env.plataforma.consola`. Probar el ingreso a la consola desplegada: tienen que verse las dos instalaciones en el inicio.

## 6. E8 (invitación por usuario) en producción

La migración ya está aplicada (ver el estado arriba). Falta:
1. Variables de **la app** de cada instalación (sin pasar valores por pantalla): `AUTH_URL` (https, fija, sin ruta), `CORREO_AVISOS_RESEND_API_KEY` y `CORREO_AVISOS_REMITENTE`. Con `bash scripts/operaciones/cargar-env-zuluhub.sh --plantilla` se crea `.env.vercel.zuluhub` si no existe; agregá esas tres líneas, probá con `bash scripts/operaciones/cargar-env-zuluhub.sh` (ensayo: muestra qué haría) y cargá con `--ejecutar`. Lo mismo con `cargar-env-empresa.sh` para stockhneuquen. También se pueden cargar a mano en el panel de Vercel. Hay que **redesplegar** la app para que las lea.
2. Desplegar la app (rama `multitenancy-fase-a`). En Administración → Usuarios, «Invitar a vincular» a la persona precargada de stockhneuquen. Prueba de humo: alta de una persona nueva → mail → enlace → Google → Aceptar.
3. Vigilar Sentry 48 horas.

## Dónde se traba y qué hacer

- `psql` pide contraseña o falla el SSL: la `DIRECT_URL` ya trae `sslmode=require`; si no, agregarlo.
- La consola no arranca y dice «Configuración de la consola de plataforma inválida»: el mensaje nombra la variable que falta o está mal (revisar la tabla del §3).
- El ingreso a la consola no manda el código: revisar `CORREO_AVISOS_*` en el proyecto de la consola.
- Una instalación aparece como «No pudimos leer…»: revisar su `PLATAFORMA_DATABASE_URL_<ID>` y que el rol exista en esa base (§2).
- Cualquier error: pegarlo a Claude (sin URLs ni claves).
