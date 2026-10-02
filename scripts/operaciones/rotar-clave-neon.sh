#!/usr/bin/env bash
# Rota la clave de un rol de Neon y escribe la connection string NUEVA en el archivo .env.vercel.* local, sin imprimir ni la clave ni la URL
# (la respuesta del reseteo se descarta y la URL se captura en una variable que nunca se muestra).
#
#   rotar-clave-neon.sh <project-id> <rol> <archivo> [--rama <nombre>] [--base <nombre>] [--tambien-pooler]            ENSAYO
#   rotar-clave-neon.sh <project-id> <rol> <archivo> [--rama <nombre>] [--base <nombre>] [--tambien-pooler] --ejecutar  rota DE VERDAD
#   --tambien-pooler (solo con neondb_owner): además de DIRECT_URL escribe DATABASE_URL (con pooler) con ESE MISMO rol; para cuando la app
#   todavía corre con el dueño (no existe motor2_app) y por eso su DATABASE_URL también usa esta clave.
#
# Rol → variable que se escribe en el archivo:
#   neondb_owner       → DIRECT_URL                (conexión directa, sin pooler: migraciones)
#   motor2_app         → DATABASE_URL              (con pooler y pgbouncer=true: runtime de la app)
#   motor2_plataforma  → PLATAFORMA_DATABASE_URL   (conexión directa: scripts de plataforma)
#
# CUIDADO: al rotar, la clave anterior deja de servir EN ESE MOMENTO. La app de producción que la usa falla hasta que Vercel tenga la nueva y
# se redespliegue. Orden: rotar → cargar-env-zuluhub.sh|cargar-env-empresa.sh --ejecutar → redesplegar. Hacerlo de corrido, en una ventana tranquila.
# Si el rol está en uso por la app, rotar uno a la vez y cargar enseguida. Requiere el CLI de Neon con sesión (neon login) y node.
# Los valores quedan solo en el archivo (.gitignore: .env*). Para ver el proyecto/rama correctos: neon projects list --org-id <org>.
set -euo pipefail

fallar() { echo "ERROR: $*" >&2; exit 1; }
export MSYS_NO_PATHCONV=1 # Git Bash en Windows reescribe los argumentos que empiezan con «/» (rutas de la API)

[[ $# -ge 3 ]] || fallar "uso: $0 <project-id> <rol> <archivo> [--rama <nombre>] [--base <nombre>] [--ejecutar]"
PROYECTO="$1"; ROL="$2"; ARCHIVO="$3"; shift 3
RAMA=""; BASE="neondb"; EJECUTAR=0; TAMBIEN_POOLER=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rama) [[ $# -ge 2 ]] || fallar "--rama necesita un valor"; RAMA="$2"; shift 2 ;;
    --base) [[ $# -ge 2 ]] || fallar "--base necesita un valor"; BASE="$2"; shift 2 ;;
    --ejecutar) EJECUTAR=1; shift ;;
    --tambien-pooler) TAMBIEN_POOLER=1; shift ;;
    *) fallar "argumento desconocido: $1" ;;
  esac
done

[[ "$PROYECTO" =~ ^[a-z0-9-]+$ ]] || fallar "project-id con forma inválida"
case "$ROL" in
  neondb_owner) VARIABLE="DIRECT_URL"; POOLER=0 ;;
  motor2_app) VARIABLE="DATABASE_URL"; POOLER=1 ;;
  motor2_plataforma) VARIABLE="PLATAFORMA_DATABASE_URL"; POOLER=0 ;;
  *) fallar "rol «$ROL» no contemplado (neondb_owner, motor2_app o motor2_plataforma)" ;;
esac
[[ $TAMBIEN_POOLER -eq 0 || "$ROL" == "neondb_owner" ]] || fallar "--tambien-pooler solo se usa con neondb_owner"
command -v neon > /dev/null || fallar "falta el CLI de Neon (npm i -g neon) y una sesión (neon login)"
command -v node > /dev/null || fallar "falta node"
[[ -f "$ARCHIVO" ]] || fallar "no existe $ARCHIVO (creá la plantilla con cargar-env-<...>.sh --plantilla)"

json() { local codigo="$1"; shift; node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));$codigo" "$@"; }

proyecto_nombre="$(neon projects get "$PROYECTO" -o json | json "process.stdout.write(String((d.project||d).name))")" \
  || fallar "no encuentro el proyecto $PROYECTO (¿sesión de neon? ¿id correcto?)"
ramas="$(neon branches list --project-id "$PROYECTO" -o json)"
if [[ -z "$RAMA" ]]; then
  RAMA_ID="$(printf '%s' "$ramas" | json "const b=(d.branches||d).find(x=>x.default);process.stdout.write(b?b.id:'')")"
  RAMA_NOMBRE="$(printf '%s' "$ramas" | json "const b=(d.branches||d).find(x=>x.default);process.stdout.write(b?b.name:'')")"
else
  RAMA_ID="$(printf '%s' "$ramas" | json "const b=(d.branches||d).find(x=>x.name===process.argv[1]||x.id===process.argv[1]);process.stdout.write(b?b.id:'')" "$RAMA")"
  RAMA_NOMBRE="$RAMA"
fi
[[ -n "$RAMA_ID" ]] || fallar "no encuentro la rama «${RAMA:-por defecto}» en $PROYECTO"

roles="$(neon roles list --project-id "$PROYECTO" --branch "$RAMA_ID" -o json | json "process.stdout.write((d.roles||d).map(r=>r.name).join(' '))")"
[[ " $roles " == *" $ROL "* ]] || fallar "el rol «$ROL» no existe en esa rama (roles: $roles)"
bases="$(neon databases list --project-id "$PROYECTO" --branch "$RAMA_ID" -o json | json "process.stdout.write((d.databases||d).map(r=>r.name).join(' '))")"
[[ " $bases " == *" $BASE "* ]] || fallar "la base «$BASE» no existe en esa rama (bases: $bases; usá --base)"

echo "Proyecto : $proyecto_nombre ($PROYECTO)"
echo "Rama     : $RAMA_NOMBRE ($RAMA_ID)"
echo "Rol      : $ROL   Base: $BASE"
echo "Archivo  : $ARCHIVO → variable $VARIABLE$([[ $POOLER -eq 1 ]] && echo ' (con pooler)' || echo ' (directa)')$([[ $TAMBIEN_POOLER -eq 1 ]] && echo ' + DATABASE_URL (con pooler, mismo rol)')"

if [[ $EJECUTAR -ne 1 ]]; then
  echo "ENSAYO terminado: no se cambió nada. Para rotar de verdad (la clave actual deja de servir YA): repetí con --ejecutar"
  exit 0
fi

echo "Rotando la clave de $ROL..."
neon api "/projects/$PROYECTO/branches/$RAMA_ID/roles/$ROL/reset_password" -X POST > /dev/null || fallar "Neon rechazó el reseteo (la clave NO cambió, o no se sabe: revisá en la consola)"

obtener_url() { # $1 = 1 si con pooler
  local a=(connection-string "$RAMA_ID" --project-id "$PROYECTO" --role-name "$ROL" --database-name "$BASE") u
  [[ "$1" -eq 1 ]] && a+=(--pooled)
  u="$(neon "${a[@]}" 2> /dev/null | tail -n 1)"
  [[ "$u" == postgres://* || "$u" == postgresql://* ]] || fallar "la clave se rotó pero no pude obtener la connection string nueva; sacala de la consola de Neon y pegala a mano"
  if [[ "$1" -eq 1 && "$u" != *pgbouncer=true* ]]; then
    [[ "$u" == *\?* ]] && u="$u&pgbouncer=true" || u="$u?pgbouncer=true"
  fi
  printf '%s' "$u"
}
escribir_variable() { # $1 = nombre, $2 = valor
  local lineas=() reemplazada=0 l
  while IFS= read -r l || [[ -n "$l" ]]; do
    l="${l%$'\r'}"
    if [[ "$l" == "$1="* ]]; then lineas+=("$1=$2"); reemplazada=1; else lineas+=("$l"); fi
  done < "$ARCHIVO"
  [[ $reemplazada -eq 1 ]] || lineas+=("$1=$2")
  printf '%s\n' "${lineas[@]}" > "$ARCHIVO"
  echo "  escrita $1 en $ARCHIVO (${#2} caracteres, rol $ROL)"
}

url="$(obtener_url "$POOLER")"
escribir_variable "$VARIABLE" "$url"
if [[ $TAMBIEN_POOLER -eq 1 ]]; then
  url_pooler="$(obtener_url 1)"
  escribir_variable DATABASE_URL "$url_pooler"
fi

echo "Listo. La clave anterior de $ROL ya NO sirve."
echo "Ahora, de corrido: cargá a Vercel (cargar-env-<...>.sh --ejecutar) y redesplegá el proyecto."
