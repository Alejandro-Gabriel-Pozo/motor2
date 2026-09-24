import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Autenticación de servicio a servicio de `GET /api/carta/[sucursal]` (docs/plan-carta-catalogo-2026-09-24.md, M5): quien
 * llama (el servidor de restaurant-menu-design) manda `Authorization: Bearer <token>` y el token tiene que coincidir con
 * `CARTA_API_TOKEN`. Header y no `?secret=` en la query, porque la query string queda en los logs.
 *
 * Comparación en tiempo constante: `timingSafeEqual` sobre los SHA-256 de los dos lados (así los largos siempre coinciden y
 * el largo del token esperado tampoco se filtra por el tiempo de respuesta).
 *
 * `esperado` puede ser una LISTA separada por comas, para rotar el token sin cortar el servicio: se carga "nuevo,viejo" en
 * motor2, se cambia el token en la carta, y recién después se saca el viejo.
 */
export function tokenDeServicioValido(authorizationHeader: string | null | undefined, esperado: string | null | undefined): boolean {
  const validos = (esperado ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (validos.length === 0 || !authorizationHeader) return false;

  const m = /^Bearer[ ]+(\S+)[ ]*$/i.exec(authorizationHeader.trim());
  if (!m) return false;
  const recibido = sha256(m[1]);

  // Se comparan TODOS (sin cortar en el primero que coincide), para que el tiempo no dependa de cuál de la lista es.
  let ok = false;
  for (const token of validos) {
    if (timingSafeEqual(recibido, sha256(token))) ok = true;
  }
  return ok;
}

function sha256(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}
