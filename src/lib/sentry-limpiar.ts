import type { Breadcrumb, Event } from "@sentry/nextjs";

import { esErrorDePrisma, limpiarTexto, resumenErrorDePrisma } from "./mensaje-seguro";

/**
 * LISTA BLANCA de cabeceras (S-29): solo viajan estas. Antes era una lista negra (`authorization`, `cookie`, `token`…) y dejaba pasar `x-forwarded-for`
 * (la IP de la persona), `referer` (una URL con fragmento) y `x-motor2-ruta-pedida` (la ruta con su query), entre otras. Una cabecera nueva
 * que mande un proxy o el navegador queda afuera hasta que alguien la sume acá a propósito. En minúsculas: se compara sin mirar mayúsculas.
 */
export const CABECERAS_PERMITIDAS: ReadonlySet<string> = new Set(["user-agent", "content-type"]);

/**
 * Claves de `data` (de migas y spans) que traen una URL o una ruta: se recortan en `?` y en `#`. El token de una invitación viaja en el FRAGMENTO del
 * enlace (`/invitacion#t=<token>`, ADR-020 §3) y el SDK del navegador toma la dirección entera (con fragmento) para el pedido, la miga de navegación
 * (`from`/`to`) y el span de carga de página (`url.full`).
 */
const CLAVE_DE_URL = /^(from|to)$|url|href|referrer|referer|target|path|route/i;
/** Claves de `data` que SON la query o el fragmento: se descartan enteras (no hay nada legítimo que conservar). */
const CLAVE_DE_QUERY_O_FRAGMENTO = /(^|[._-])(query|fragment|search|hash)([._-]|$)|query_string/i;
/** Descripción de un span que es una URL o una ruta (`GET https://…?x`, `/api/x?y`): solo a esas se les recorta la query (la de una consulta SQL lleva `?` de parámetros). */
const DESCRIPCION_DE_URL = /^(?:[A-Z]+ )?(?:https?:\/\/|\/)/;

/** La URL (o `METHOD URL`) sin query ni fragmento. */
function sinQueryNiFragmento(texto: string): string {
  return texto.replace(/[?#]\S*/g, "");
}

/** `data` de una miga o un span: URL recortadas, query y fragmento fuera, y a todo texto libre se le tapan emails y tokens. Devuelve un objeto nuevo. */
function limpiarDatos<D extends object>(datos: D): D {
  const limpios: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(datos)) {
    if (CLAVE_DE_QUERY_O_FRAGMENTO.test(clave)) continue;
    if (typeof valor !== "string") {
      limpios[clave] = valor;
      continue;
    }
    limpios[clave] = limpiarTexto(CLAVE_DE_URL.test(clave) ? sinQueryNiFragmento(valor) : valor);
  }
  return limpios as D;
}

/**
 * `beforeBreadcrumb` y limpieza de las migas de un evento (S-29): las de consola pierden los datos; en las demás la `data` se recorta
 * (`navigation`: `from`/`to`; `fetch`/`xhr`: `url`) y el mensaje pasa por la limpieza de textos.
 */
export function limpiarMigaSentry<M extends Breadcrumb>(miga: M): M {
  if (miga.message) miga.message = limpiarTexto(miga.message);
  if (miga.category === "console") delete miga.data;
  else if (miga.data) miga.data = limpiarDatos(miga.data);
  return miga;
}

/**
 * `beforeSend`/`beforeSendTransaction` de Sentry (S-16, S-29): el evento sale sin datos personales ni de negocio. Los errores de Prisma traen en el
 * mensaje la consulta con sus argumentos (emails, importes) y se reducen a su tipo y código; al resto de los textos se les tapan emails y tokens; se
 * descartan el cuerpo del pedido, las cookies, la query string y los datos del usuario; las cabeceras salen por lista blanca; las URL (pedido,
 * migas, spans y nombre de la transacción) pierden la query y el fragmento.
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
  if (evento.transaction) evento.transaction = limpiarTexto(sinQueryNiFragmento(evento.transaction));

  if (evento.request) {
    delete evento.request.data;
    delete evento.request.cookies;
    delete evento.request.query_string;
    delete evento.request.env;
    if (evento.request.headers) {
      for (const nombre of Object.keys(evento.request.headers)) {
        if (!CABECERAS_PERMITIDAS.has(nombre.toLowerCase())) delete evento.request.headers[nombre];
      }
    }
    if (evento.request.url) evento.request.url = sinQueryNiFragmento(evento.request.url);
  }

  delete evento.user;
  delete evento.extra;
  for (const miga of evento.breadcrumbs ?? []) limpiarMigaSentry(miga);

  // TODOS los contextos pasan por la limpieza (M-1 de la auditoría final): `onRequestError = Sentry.captureRequestError` hace `setContext("nextjs", { request_path, router_path, … })` con
  // la ruta pedida Y su query. De la traza solo se limpia `data` (sus `trace_id`/`span_id` son tokens largos que la limpieza de textos taparía y rompería la correlación).
  for (const [nombre, contexto] of Object.entries(evento.contexts ?? {})) {
    if (!contexto || typeof contexto !== "object") continue;
    if (nombre === "trace") {
      const traza = contexto as { data?: Record<string, unknown> };
      if (traza.data) traza.data = limpiarDatos(traza.data);
    } else {
      evento.contexts![nombre] = limpiarDatos(contexto);
    }
  }
  for (const span of evento.spans ?? []) {
    if (span.description) span.description = limpiarTexto(DESCRIPCION_DE_URL.test(span.description) ? sinQueryNiFragmento(span.description) : span.description);
    if (span.data) span.data = limpiarDatos(span.data);
  }
  return evento;
}
