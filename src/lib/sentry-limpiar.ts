import type { Event } from "@sentry/nextjs";

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const BEARER = /\bBearer\s+[\w.~+/=-]{8,}/gi;
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const TOKEN_LARGO = /\b[A-Za-z0-9_-]{32,}\b/g;
const CABECERAS_SENSIBLES = /^(authorization|cookie|set-cookie|proxy-authorization)$|token|secret|api-key/i;

function limpiarTexto(texto: string): string {
  return texto.replace(EMAIL, "[email]").replace(BEARER, "Bearer [token]").replace(JWT, "[token]").replace(TOKEN_LARGO, "[token]");
}

function esErrorDePrisma(tipo: string | undefined, valor: string | undefined): boolean {
  return /^Prisma.*Error$/.test(tipo ?? "") || /\bprisma\.\w+\.\w+\(/.test(valor ?? "");
}

/**
 * `beforeSend`/`beforeSendTransaction` de Sentry (S-16): el evento sale sin datos personales ni de negocio. Los errores de Prisma traen en el mensaje
 * la consulta con sus argumentos (emails, importes) y se reducen a su tipo y código; al resto de los textos se les tapan emails y tokens; se
 * descartan el cuerpo del pedido, las cookies, las cabeceras de autenticación, la query string y los datos del usuario.
 */
export function limpiarEventoSentry<E extends Event>(evento: E): E {
  for (const excepcion of evento.exception?.values ?? []) {
    if (esErrorDePrisma(excepcion.type, excepcion.value)) {
      const codigo = /\bP\d{4}\b/.exec(excepcion.value ?? "")?.[0];
      excepcion.value = `Error de base de datos${codigo ? ` ${codigo}` : ""} (mensaje omitido)`;
    } else if (excepcion.value) {
      excepcion.value = limpiarTexto(excepcion.value);
    }
  }
  if (evento.message) evento.message = limpiarTexto(evento.message);

  if (evento.request) {
    delete evento.request.data;
    delete evento.request.cookies;
    delete evento.request.query_string;
    for (const nombre of Object.keys(evento.request.headers ?? {})) {
      if (CABECERAS_SENSIBLES.test(nombre)) delete evento.request.headers?.[nombre];
    }
    if (evento.request.url) evento.request.url = evento.request.url.split("?")[0];
  }

  delete evento.user;
  delete evento.extra;
  for (const miga of evento.breadcrumbs ?? []) {
    if (miga.message) miga.message = limpiarTexto(miga.message);
    if (miga.category === "console") delete miga.data;
  }
  return evento;
}
