/**
 * Todos los hosts a los que una URL de Postgres puede conectarse DE VERDAD (M-29 de la auditoría intermedia; S-33).
 *
 * `new URL(url).hostname` no alcanza: el cliente `pg` (`pg-connection-string`) y `libpq` (psql) dan prioridad al parámetro `host` de la query sobre el host de la URL
 * («solo se fija el host de la URL si no hay un parámetro equivalente»), y `libpq` también entiende `hostaddr` y una lista de hosts separada por comas. Así,
 * `postgresql://u:p@localhost/x_demo?host=10.0.0.5` parece local, pasa una guarda que mira solo `hostname`, y conecta a `10.0.0.5`. Toda guarda de «solo contra un Postgres local» tiene que
 * mirar ESTA lista y exigir que TODOS sean locales. Devuelve el host de la URL y cada uno de los de `host` y `hostaddr`, en minúsculas y sin espacios.
 */
export function hostsDeUnaConexion(url: URL): string[] {
  const salida = [url.hostname.toLowerCase()];
  for (const clave of ["host", "hostaddr"]) {
    for (const valor of url.searchParams.getAll(clave)) {
      for (const h of valor.split(",")) {
        const limpio = h.trim().toLowerCase();
        if (limpio) salida.push(limpio);
      }
    }
  }
  return salida;
}

/** El primer host de la lista que no figura entre los `locales`, o `null` si TODOS lo son (la guarda lo nombra en su mensaje, nunca la URL entera: lleva la clave). */
export function primerHostNoLocal(url: URL, locales: readonly string[]): string | null {
  return hostsDeUnaConexion(url).find((h) => !locales.includes(h)) ?? null;
}
