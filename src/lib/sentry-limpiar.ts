import type { Event } from "@sentry/nextjs";

import { esErrorDePrisma, limpiarTexto, resumenErrorDePrisma } from "./mensaje-seguro";

const CABECERAS_SENSIBLES = /^(authorization|cookie|set-cookie|proxy-authorization)$|token|secret|api-key/i;

/**
 * `beforeSend`/`beforeSendTransaction` de Sentry (S-16): el evento sale sin datos personales ni de negocio. Los errores de Prisma traen en el mensaje
 * la consulta con sus argumentos (emails, importes) y se reducen a su tipo y código; al resto de los textos se les tapan emails y tokens; se
 * descartan el cuerpo del pedido, las cookies, las cabeceras de autenticación, la query string y los datos del usuario.
 */
export function limpiarEventoSentry<E extends Event>(evento: E): E {
  for (const excepcion of evento.exception?.values ?? []) {
    if (esErrorDePrisma(excepcion.type, excepcion.value)) {
      excepcion.value = resumenErrorDePrisma(excepcion.value);
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
