/**
 * ¿Se puede ENRUTAR este path? Lo usa `src/proxy.ts` para cortar con un 404 limpio los pedidos cuyos segmentos Next no sabe decodificar, antes de que lleguen al enrutador.
 *
 * Por qué: Next decodifica cada segmento dinámico (`decodeURIComponent`) y, si no puede, lanza «failed to decode param» (500, ruido en Sentry y en las métricas: un anónimo lo
 * provoca a voluntad). Pasa con un `%` que no es un escape válido (`/a/%zz`, `/a/abc%`), con un UTF-8 inválido (`%ff`, `%C0%AF`) y —en la carta pública, que es ISR— también con un
 * `%25` (un `%` bien escapado): Next decodifica la ruta DOS veces para esas páginas, y el segundo `%` suelto ya no se puede decodificar. Ningún slug de empresa ni de sucursal lleva `%`
 * (son `[a-z0-9-]`), así que en la carta pública un segmento que decodifica a algo con `%` nunca es una carta.
 *
 * Además un NUL (`%00`) en el path no es válido en ningún lado: Postgres no lo admite y llegaría a una consulta como error.
 *
 * Solo mira el path: no decide nada de seguridad ni de permisos (eso lo siguen decidiendo el layout y cada acción), y un path válido sigue su camino sin cambios.
 */
export function esPathServible(pathname: string): boolean {
  const esCartaPublica = pathname === "/carta-publica" || pathname.startsWith("/carta-publica/");
  for (const segmento of pathname.split("/")) {
    let decodificado: string;
    try {
      decodificado = decodeURIComponent(segmento);
    } catch {
      return false;
    }
    if (decodificado.includes("\u0000")) return false;
    if (esCartaPublica && decodificado.includes("%")) return false;
  }
  return true;
}
