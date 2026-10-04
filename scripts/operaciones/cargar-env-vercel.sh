#!/usr/bin/env bash
# Carga las variables de entorno de PRODUCCIÓN de un proyecto de Vercel desde un archivo local, sin que ningún valor pase por pantalla,
# por la conversación ni por los argumentos de un proceso (el valor entra por stdin al CLI de Vercel).
#
#   cargar-env-vercel.sh <proyecto> <archivo> --plantilla   crea el archivo con los nombres permitidos y los valores vacíos (no pisa uno existente)
#   cargar-env-vercel.sh <proyecto> <archivo>               ENSAYO: valida y muestra qué haría (nombres, tipo, largo; nunca valores)
#   cargar-env-vercel.sh <proyecto> <archivo> --ejecutar    carga de verdad (sobrescribe la variable de Production del mismo nombre)
#
# Formato del archivo: NOMBRE=valor, una por línea (sin comillas; el valor es todo lo que sigue al primer «=»). Se ignoran líneas en blanco,
# comentarios (#) y variables con el valor vacío: se completan solo las que se quieren cambiar.
# Falla cerrado: un nombre que no esté en las listas de abajo, un duplicado o una regla rota frena TODO antes de cargar nada.
# Las variables SENSIBLES quedan cifradas y de solo escritura en Vercel (ni el panel ni la API las muestran de nuevo).
# Los cambios rigen para los despliegues NUEVOS: hay que redesplegar el proyecto para que la aplicación los lea.
# Solo Production. Preview/Development no se tocan acá (ADR-007: ningún Preview debe apuntar a la base de producción).
set -euo pipefail

PROYECTOS_PERMITIDOS=" motor2-demo stockhneuquen "
SCOPE="${VERCEL_SCOPE:-alepozod}"
# PLATAFORMA_DATABASE_URL NO va a Vercel: la usan solo scripts locales (politica-empresa; el alta de empresas la hace la consola). Cargarla en el entorno de la app le daría
# a la app las credenciales del rol que puede escribir `Empresa`, justo lo que la separación de roles (S-13) quiere evitar.
SENSIBLES=" DATABASE_URL DIRECT_URL AUTH_SECRET AUTH_GOOGLE_ID AUTH_GOOGLE_SECRET CRON_SECRET BOOTSTRAP_ADMIN_EMAILS ALLOWED_EMAIL_DOMAINS "
# NEXT_PUBLIC_* viaja al navegador: Vercel no admite que sea sensible.
PUBLICAS=" AUTH_URL CARTA_DOMINIO_BASE CARTA_EMPRESA_UNICA MOTOR2_ROL_ESTRICTO MOTOR2_MIGRAR_EN_BUILD NEXT_PUBLIC_SENTRY_DSN "

fallar() { echo "ERROR: $*" >&2; exit 1; }

[[ $# -ge 2 ]] || fallar "uso: $0 <proyecto> <archivo> [--ejecutar|--plantilla]"
PROYECTO="$1"; ARCHIVO="$2"; MODO="${3:-ensayo}"
[[ "$PROYECTOS_PERMITIDOS" == *" $PROYECTO "* ]] || fallar "proyecto «$PROYECTO» no permitido (${PROYECTOS_PERMITIDOS})"
case "$MODO" in ensayo | --ejecutar | --plantilla) ;; *) fallar "tercer argumento inválido: $MODO" ;; esac

if [[ "$MODO" == "--plantilla" ]]; then
  [[ ! -e "$ARCHIVO" ]] || fallar "$ARCHIVO ya existe: no lo piso"
  {
    echo "# Producción de $PROYECTO. Completá SOLO las que querés cambiar; las vacías se omiten. NO se versiona (.gitignore: .env*)."
    echo "# Formato NOMBRE=valor, sin comillas."
    for n in $SENSIBLES $PUBLICAS; do echo "$n="; done
  } > "$ARCHIVO"
  echo "Plantilla creada: $ARCHIVO"
  exit 0
fi

[[ -f "$ARCHIVO" ]] || fallar "no existe $ARCHIVO (creala con --plantilla)"

declare -A VALORES=()
ORDEN=()
numero=0
while IFS= read -r linea || [[ -n "$linea" ]]; do
  numero=$((numero + 1))
  linea="${linea%$'\r'}"
  [[ -z "${linea//[[:space:]]/}" || "$linea" == \#* ]] && continue
  [[ "$linea" =~ ^[A-Z_][A-Z0-9_]*= ]] || fallar "línea $numero: no tiene la forma NOMBRE=valor"
  nombre="${linea%%=*}"
  valor="${linea#*=}"
  if [[ "$nombre" == "PLATAFORMA_DATABASE_URL" ]]; then
    [[ -z "$valor" ]] || fallar "línea $numero: PLATAFORMA_DATABASE_URL no se carga en Vercel (solo la usan scripts locales: ponela en un archivo local y apuntá DOTENV_CONFIG_PATH a él)"
    continue
  fi
  [[ "$SENSIBLES$PUBLICAS" == *" $nombre "* ]] || fallar "línea $numero: «$nombre» no está en las listas permitidas (¿error de tipeo?)"
  [[ -z "${VALORES[$nombre]+x}" ]] || fallar "línea $numero: «$nombre» está repetida"
  [[ -n "$valor" ]] || continue
  [[ "$valor" != *[[:space:]] && "$valor" != [[:space:]]* ]] || fallar "$nombre: el valor empieza o termina con espacio"
  [[ "$valor" != \"* && "$valor" != \'* ]] || fallar "$nombre: el valor no lleva comillas"
  VALORES[$nombre]="$valor"
  ORDEN+=("$nombre")
done < "$ARCHIVO"

[[ ${#ORDEN[@]} -gt 0 ]] || fallar "$ARCHIVO no tiene ninguna variable con valor"

# Reglas de coherencia (no muestran valores).
usuario_de_url() { local resto="${1#*://}"; echo "${resto%%:*}"; }
if [[ -n "${VALORES[AUTH_URL]+x}" ]]; then
  [[ "${VALORES[AUTH_URL]}" =~ ^https://[^/]+$ ]] || fallar "AUTH_URL tiene que ser https://<host> sin barra final ni ruta"
fi
if [[ -n "${VALORES[CARTA_DOMINIO_BASE]+x}" ]]; then
  [[ "${VALORES[CARTA_DOMINIO_BASE]}" != *://* && "${VALORES[CARTA_DOMINIO_BASE]}" != */* ]] || fallar "CARTA_DOMINIO_BASE es un dominio pelado (carta.zuluhub.com.ar), sin https:// ni barras"
fi
# Add-on CARTA_EMPRESA_UNICA (ADR-006): slug de la empresa cuya carta se sirve en el dominio base pelado, sin slug en la URL. Exige CARTA_DOMINIO_BASE.
if [[ -n "${VALORES[CARTA_EMPRESA_UNICA]+x}" && -n "${VALORES[CARTA_EMPRESA_UNICA]}" ]]; then
  [[ "${VALORES[CARTA_EMPRESA_UNICA]}" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ && ${#VALORES[CARTA_EMPRESA_UNICA]} -le 63 ]] || fallar "CARTA_EMPRESA_UNICA es un slug (minúsculas, números y guiones simples, hasta 63 caracteres)"
  [[ -n "${VALORES[CARTA_DOMINIO_BASE]+x}" && -n "${VALORES[CARTA_DOMINIO_BASE]}" ]] || fallar "CARTA_EMPRESA_UNICA se carga junto con CARTA_DOMINIO_BASE: sin dominio base el add-on no tiene dónde servir la carta"
fi
for u in DATABASE_URL DIRECT_URL; do
  if [[ -n "${VALORES[$u]+x}" ]]; then
    [[ "${VALORES[$u]}" == postgres://* || "${VALORES[$u]}" == postgresql://* ]] || fallar "$u no parece una URL de Postgres"
  fi
done
if [[ -n "${VALORES[MOTOR2_ROL_ESTRICTO]+x}" && "${VALORES[MOTOR2_ROL_ESTRICTO]}" == "1" ]]; then
  [[ -n "${VALORES[DATABASE_URL]+x}" && "$(usuario_de_url "${VALORES[DATABASE_URL]}")" == "motor2_app" ]] \
    || fallar "MOTOR2_ROL_ESTRICTO=1 solo se carga junto con una DATABASE_URL del rol motor2_app (ADR-007, S-11): con otro rol la aplicación se niega a arrancar"
fi

echo "Proyecto: $PROYECTO (scope $SCOPE) · entorno: Production · modo: ${MODO/ensayo/ENSAYO (no carga nada)}"
for nombre in "${ORDEN[@]}"; do
  tipo="config"; [[ "$SENSIBLES" == *" $nombre "* ]] && tipo="SENSIBLE"
  extra=""
  case "$nombre" in
    DATABASE_URL | DIRECT_URL) extra=" · rol de base: $(usuario_de_url "${VALORES[$nombre]}")" ;;
  esac
  printf '  %-26s %-9s %4d caracteres%s\n' "$nombre" "$tipo" "${#VALORES[$nombre]}" "$extra"
done
if [[ -n "${VALORES[DATABASE_URL]+x}" && "$(usuario_de_url "${VALORES[DATABASE_URL]}")" != "motor2_app" ]]; then
  echo "AVISO: DATABASE_URL no usa el rol motor2_app (ADR-007, A0): con otro rol el aislamiento por empresa (RLS) no se aplica."
fi

if [[ "$MODO" != "--ejecutar" ]]; then
  echo "Ensayo terminado. Para cargar de verdad: repetí el comando con --ejecutar"
  exit 0
fi

command -v vercel > /dev/null || fallar "falta el CLI de Vercel (npm i -g vercel) y vercel login"
errores="$(mktemp)"; trap 'rm -f "$errores"' EXIT
fallidas=0
for nombre in "${ORDEN[@]}"; do
  bandera="--no-sensitive"; [[ "$SENSIBLES" == *" $nombre "* ]] && bandera="--sensitive"
  if printf '%s' "${VALORES[$nombre]}" | vercel env add "$nombre" production --project "$PROYECTO" --scope "$SCOPE" --force --yes "$bandera" > /dev/null 2> "$errores"; then
    echo "  OK      $nombre"
  else
    echo "  FALLÓ   $nombre: $(tail -n 1 "$errores")"
    fallidas=$((fallidas + 1))
  fi
done
[[ $fallidas -eq 0 ]] || fallar "$fallidas variable(s) no se cargaron: revisá lo de arriba (¿vercel login?, ¿scope?)"
echo "Listo. Redesplegá $PROYECTO (Production) para que la aplicación lea los valores nuevos."
