#!/usr/bin/env bash
# Escribe secretos NUEVOS y aleatorios (32 bytes, base64) en un archivo de entorno local, sin mostrarlos. Reemplaza la línea si el nombre ya estaba.
#   bash scripts/operaciones/generar-secretos-env.sh .env.vercel.zuluhub                 → AUTH_SECRET y CRON_SECRET
#   bash scripts/operaciones/generar-secretos-env.sh .env.vercel.zuluhub CRON_SECRET     → solo los nombres indicados
# Cambiar AUTH_SECRET puede cerrar las sesiones abiertas; cambiar CRON_SECRET no afecta a nadie (solo autentica los crons de Vercel).
# El archivo no se versiona (.gitignore: .env*). Después: cargar-env-zuluhub.sh / cargar-env-empresa.sh.
set -euo pipefail
[[ $# -ge 1 ]] || { echo "uso: $0 <archivo> [NOMBRE...]" >&2; exit 1; }
archivo="$1"; shift
nombres=("$@"); [[ ${#nombres[@]} -gt 0 ]] || nombres=(AUTH_SECRET CRON_SECRET)
for n in "${nombres[@]}"; do
  case "$n" in AUTH_SECRET | CRON_SECRET) ;; *) echo "ERROR: solo se generan AUTH_SECRET y CRON_SECRET (no «$n»)" >&2; exit 1 ;; esac
done

lineas=()
if [[ -f "$archivo" ]]; then
  while IFS= read -r l || [[ -n "$l" ]]; do
    l="${l%$'\r'}"
    descartar=0
    for n in "${nombres[@]}"; do [[ "$l" == "$n="* ]] && descartar=1; done
    [[ $descartar -eq 1 ]] || lineas+=("$l")
  done < "$archivo"
fi
for n in "${nombres[@]}"; do
  lineas+=("$n=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))")")
  echo "  generado $n"
done
printf '%s\n' "${lineas[@]}" > "$archivo"
