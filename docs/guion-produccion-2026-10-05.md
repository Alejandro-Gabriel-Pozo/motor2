# Guion de producción (para correr desde otra PC), 2026-10-05

> Autocontenido: usa solo archivos de esta carpeta (`.env`, `.env.vercel.zuluhub`, `.env.vercel.empresa`) y comandos de PowerShell. Se corre parado en la raíz del repo (`motor2`).
> **Qué pegarle de vuelta a Claude:** solo las salidas que dicen «PEGAR». **Nunca** pegues URLs de conexión, claves, secretos TOTP ni códigos de recuperación.
> Cada bloque tiene su motivo en `docs/deploy-con-migraciones.md` (sección ADR-024) y en `docs/checkpoint-2026-10-05-plataforma.md`.

## 0. Preparación (una vez)

```powershell
git pull                      # tiene que decir que estás en multitenancy-fase-a
npm install
psql --version                # tiene que existir (cliente de Postgres); si no, instalarlo
```

## 1. Solo lectura (seguro, sin cambios)

```powershell
node scripts/operaciones/con-env.mjs .env.vercel.zuluhub -- npx prisma migrate status
node scripts/operaciones/con-env.mjs .env.vercel.empresa -- npx prisma migrate status
node scripts/operaciones/con-env.mjs .env.vercel.zuluhub -- npm run medir-precargados
node scripts/operaciones/con-env.mjs .env.vercel.empresa -- npm run medir-precargados
```
PEGAR las cuatro salidas. Esperado: en cada base **una** migración pendiente (`20261012120000_invitacion_de_usuario`); zuluhub 0 precargados sin Google y stockhneuquen 1.

## 2. Rol `motor2_plataforma` (una vez por base: zuluhub y después stockhneuquen)

Conectarse **como dueño** (la `DIRECT_URL` de cada archivo; en Neon no hace falta superusuario y **nunca** crear el rol desde la consola de Neon). Elegí una clave nueva y fuerte por base y guardala.

```powershell
$u = ((Get-Content .env.vercel.zuluhub | Where-Object { $_ -like 'DIRECT_URL=*' }) -replace '^DIRECT_URL=','').Trim()
psql $u -v clave="LA-CLAVE-NUEVA-DE-ZULUHUB" -f scripts/operaciones/crear-rol-motor2-plataforma.sql
```
Repetir con `.env.vercel.empresa` y otra clave. **No** usar `-v restringir=1` todavía. PEGAR si hay algún error (si termina sin error, avisar «ok»). El script es idempotente.

## 3. Archivo de entorno de la consola (por instalación)

Crear `.env.plataforma.zuluhub` (gitignored; repetir con `.empresa` si querés una consola por instalación hasta que exista la consola única). La URL del rol es la misma que la `DIRECT_URL` pero con el usuario `motor2_plataforma` y su clave:

```powershell
$clave = "LA-CLAVE-NUEVA-DE-ZULUHUB"
$uri = [Uri]$u
"PLATAFORMA_DATABASE_URL=postgresql://motor2_plataforma:$([Uri]::EscapeDataString($clave))@$($uri.Host)$($uri.PathAndQuery)" | Out-File -Encoding ascii .env.plataforma.zuluhub
"PLATAFORMA_URL_APP=https://LA-DIRECCION-PUBLICA-DE-LA-APP-DE-ZULUHUB" | Add-Content -Encoding ascii .env.plataforma.zuluhub
node -e "const c=require('crypto'),f=require('fs');f.appendFileSync('.env.plataforma.zuluhub','PLATAFORMA_SECRETO_CODIGOS='+c.randomBytes(32).toString('base64')+'\n'+'PLATAFORMA_CLAVE_TOTP='+c.randomBytes(32).toString('base64')+'\n')"
```
Probar que conecta (PEGAR la salida; no imprime valores): `$env:DOTENV_CONFIG_PATH=".env.plataforma.zuluhub"; npx tsx -e "import('./scripts/cliente-plataforma').then(async m=>{console.log(await m.prismaPlataforma.empresa.count());process.exit(0)})"`

## 4. Proyecto de Vercel de la consola (panel web, sin terminal)

1. New Project → importar `Alejandro-Gabriel-Pozo/motor2` → **Root Directory `plataforma`**, framework Next.js.
2. **Production Branch:** poner `multitenancy-fase-a` (el código de la consola solo está ahí; `main` no lo tiene).
3. Variables de entorno (Production), copiando los valores de `.env.plataforma.zuluhub`: `PLATAFORMA_DATABASE_URL`, `PLATAFORMA_SECRETO_CODIGOS`, `PLATAFORMA_CLAVE_TOTP`, `PLATAFORMA_URL_APP`; y las del canal de mails: `CORREO_AVISOS_RESEND_API_KEY`, `CORREO_AVISOS_REMITENTE`.
4. Deploy. PEGAR la dirección que te da Vercel (no es secreta).

## 5. Primer administrador de la consola

```powershell
$env:DOTENV_CONFIG_PATH=".env.plataforma.zuluhub"
npm run plataforma:crear-admin -- --email tu-email@dominio.com --nombre "Tu Nombre"
```
Imprime **una sola vez** el secreto TOTP y los códigos de recuperación: escanear/guardar al instante. Después borrar `.env.plataforma.*` si no los vas a usar más. Probar el ingreso a la consola desplegada.

## 6. E8 en producción (después de que la consola ande)

1. Variables de **la app** de cada instalación (sin pasar valores por pantalla): `bash scripts/operaciones/cargar-env-zuluhub.sh --plantilla` crea `.env.vercel.zuluhub` si no existe; con el archivo ya existente, agregar `AUTH_URL=` (https, sin ruta), `CORREO_AVISOS_RESEND_API_KEY=` y `CORREO_AVISOS_REMITENTE=`; luego `bash scripts/operaciones/cargar-env-zuluhub.sh` (ensayo: muestra qué haría) y `bash scripts/operaciones/cargar-env-zuluhub.sh --ejecutar`. Lo mismo con `cargar-env-empresa.sh` para stockhneuquen. Hay que **redesplegar** la app para que las lea.
2. Migración, base por base (zuluhub primero): en Neon crear la rama de respaldo `respaldo-pre-e8-<despliegue>-2026-10-05` y una rama de ensayo; correr `migrate deploy` contra el ensayo (con un archivo propio que apunte a esa rama), comprobar con `psql` que `has_table_privilege('motor2_app','"Invitacion"','INSERT')` es `t` y `'DELETE'` es `f`, que `InvitacionSucursal` existe con 2 triggers, y borrar el ensayo. **Pedirle a Claude la autorización expresa antes del paso siguiente.** Luego:
   `node scripts/operaciones/con-env.mjs .env.vercel.zuluhub -- npm run migrar:aprobar` (y lo mismo con `.env.vercel.empresa`). Después volver a correr el §2 (idempotente).
3. Desplegar la app. En Administración → Usuarios, «Invitar a vincular» a la persona precargada de stockhneuquen. Prueba de humo: alta de una persona nueva → mail → enlace → Google → Aceptar.
4. Vigilar Sentry 48 horas.

## Dónde se traba y qué hacer

- `psql` pide contraseña o falla el SSL: la `DIRECT_URL` ya trae `sslmode=require`; si no, agregarlo.
- `migrate status` dice que hay migraciones que no conoce: falta `git pull`.
- El ingreso a la consola no manda el código: revisar `CORREO_AVISOS_*` en el proyecto de la consola.
- Cualquier error: pegarlo a Claude (sin URLs ni claves).
