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

/**
 * Claves que son (o llevan) la IP de quien pide (M-31): los atributos de red de los spans del SDK (`client.address`, `network.peer.address`, `http.client_ip`, `net.sock.peer.addr`…), la
 * cabecera `x-forwarded-for` o `x-real-ip` copiada como atributo, y cualquier `ip`/`ip_address`. Se descartan enteras, sin mirar el valor.
 */
const CLAVE_DE_IP = /(^|[._-])(client|peer|remote|source|user)[._-]?(ip|address|addr)([._-]|$)|(^|[._-])ip([._-]|$)|ip[._-]?address|x-forwarded-for|x-real-ip|forwarded-for/i;
/** Un valor que ES una IP (v4, con o sin puerto, o v6): sea cual sea su clave, no viaja. */
const VALOR_ES_UNA_IP = /^(?:\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?|\[?(?:[0-9a-f]{0,4}:){2,7}[0-9a-f.]{0,15}\]?(?::\d{1,5})?)$/i;
const esIp = (valor: string) => VALOR_ES_UNA_IP.test(valor.trim());

/** Limpia un valor de cualquier forma, anidado o no (M-31): los textos pasan por la limpieza de emails y tokens, los arreglos y objetos se recorren hasta el fondo. */
function limpiarValor(valor: unknown): unknown {
  if (typeof valor === "string") return limpiarTexto(valor);
  if (Array.isArray(valor)) return valor.filter((v) => !(typeof v === "string" && esIp(v))).map(limpiarValor);
  if (valor !== null && typeof valor === "object") return limpiarDatos(valor);
  return valor;
}

/**
 * `data` de una miga o un span: URL recortadas, query y fragmento fuera, los atributos de IP fuera (M-31), y a todo texto libre —también el anidado en objetos y arreglos— se le tapan emails y
 * tokens. Devuelve un objeto nuevo.
 */
function limpiarDatos<D extends object>(datos: D): D {
  const limpios: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(datos)) {
    if (CLAVE_DE_QUERY_O_FRAGMENTO.test(clave) || CLAVE_DE_IP.test(clave)) continue;
    if (typeof valor !== "string") {
      limpios[clave] = limpiarValor(valor);
      continue;
    }
    if (esIp(valor)) continue;
    // Una URL se reconoce por la clave que la lleva O por su forma (`/ruta…`, `https://…`, `GET /ruta…`): las etiquetas y los atributos libres no siguen ninguna convención de nombres.
    limpios[clave] = limpiarTexto(CLAVE_DE_URL.test(clave) || DESCRIPCION_DE_URL.test(valor) ? sinQueryNiFragmento(valor) : valor);
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
 * descartan el cuerpo del pedido, las cookies, la query string y los datos del usuario; las cabeceras salen por lista blanca (y sus valores, anidados o no, por la limpieza de
 * textos); las URL (pedido, migas, spans y nombre de la transacción) pierden la query y el fragmento; las etiquetas (`tags`) y los `data` de migas, spans y contextos pierden los
 * atributos de IP (`client.address`, `http.client_ip`…) y se limpian hasta los valores anidados (M-31).
 *
 * Límite que hay que decir: se verificó con eventos SINTÉTICOS, armados a mano con las claves que documenta el SDK de Sentry v10 y OpenTelemetry. No se capturó un evento real del SDK
 * (hace falta un DSN y tráfico); una clave de IP con un nombre que ninguna de las dos fuentes documenta se descubriría recién en un evento real.
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
        // M-31: una cabecera permitida también puede traer datos en su VALOR (un user-agent con un email, o un valor anidado si el SDK lo manda como arreglo u objeto): se limpia hasta el fondo.
        else evento.request.headers[nombre] = limpiarValor(evento.request.headers[nombre]) as string;
      }
    }
    if (evento.request.url) evento.request.url = sinQueryNiFragmento(evento.request.url);
  }

  delete evento.user;
  delete evento.extra;
  // M-31: las etiquetas (`Sentry.setTag`, o las que pone una integración) son texto libre del código y del SDK: mismo trato que `data` (IP fuera, URL recortadas, emails y tokens tapados).
  if (evento.tags) evento.tags = limpiarDatos(evento.tags) as typeof evento.tags;
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
