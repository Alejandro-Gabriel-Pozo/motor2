/**
 * La CLASIFICACIÓN de los rechazos de la matriz de denegación por defecto (GT-3b; hallazgo I-3 de la auditoría final, fila O.177).
 *
 * Antes la matriz contaba como «denegado» CUALQUIER `{ ok: false }` o excepción. Pero una puerta puede rechazar por FORMA («La unidad de stock es obligatoria», «secuencia no válida») sin haber mirado nunca de quién
 * es el id ajeno: si después alguien le saca el chequeo de pertenencia, el escenario seguiría en verde. Ahora, en los escenarios con ids ajenos (otra empresa, otra sucursal), solo cuenta como negar un rechazo de
 * PERTENENCIA: el mensaje dice que lo que se pidió no se encontró, no existe, no es de quien actúa o no se puede usar desde acá. Cualquier otro rechazo (forma, validación, estado) es un problema, salvo que la
 * puerta y el escenario estén en `RECHAZOS_DE_ESTADO_ADMITIDOS` (lista cerrada, con motivo, que solo se achica).
 */
export type CategoriaDeRechazo = "no-encontrado" | "sin-acceso" | "ajeno" | "contexto";

interface Regla {
  categoria: CategoriaDeRechazo;
  patron: RegExp;
}

/** Orden: la primera que coincide. Los patrones son los de los mensajes reales de las puertas (se revisaron uno por uno contra la salida de la matriz). */
const REGLAS: readonly Regla[] = [
  // «No se encontró el producto.», «No se encontró esa cuenta en esta sucursal.», «No se encontró una de las secciones de destino.»
  { categoria: "no-encontrado", patron: /\bno se encontr[óo](?![a-záéíóúñ])/i },
  // «El producto no existe.», «El proveedor no existe.», «Esa sucursal no existe o no está activa.», «Alguna sección de carta de los cupos no existe.»
  { categoria: "no-encontrado", patron: /\bno existen?\b/i },
  // «El proveedor elegido ya no está disponible.», «No se encontró esa promo, o ya no está disponible.»
  { categoria: "no-encontrado", patron: /\bya no est[áa] disponible\b/i },
  // «No tenés acceso a esa sucursal.», «No tenés acceso a esta sucursal, o tu usuario está inactivo.»
  { categoria: "sin-acceso", patron: /\bno ten[ée]s (acceso|permiso)\b/i },
  // «Ese usuario no pertenece a esta empresa.»
  { categoria: "ajeno", patron: /\bno pertenece\b/i },
  // «La elección incluye una sección que no es parte de esta promo.»
  { categoria: "ajeno", patron: /\bno es parte de\b/i },
  // «Este traspaso no está dirigido a esta sucursal como origen.», «Esta solicitud no la creó esta sucursal.»
  { categoria: "ajeno", patron: /\bno est[áa] dirigido a esta sucursal\b/i },
  { categoria: "ajeno", patron: /\bno la cre[óo] esta sucursal(?![a-záéíóúñ])/i },
  // «Esta sucursal no está en el portal.», «Esta sucursal no tiene receta propia (habilitada) para este producto.»
  { categoria: "ajeno", patron: /\besta sucursal no est[áa] en el portal\b/i },
  { categoria: "ajeno", patron: /\besta sucursal no tiene receta propia\b/i },
  // «Elegí de qué sección propia sale.», «Elegí a qué sección propia (tiene que) entra(r).»: la sección que llegó no es una sección propia.
  { categoria: "ajeno", patron: /\bsecci[óo]n propia(?![a-záéíóúñ])/i },
  // «Cada ingrediente tiene que ser una materia prima (MP) (ZZ-E2-mp no lo es).»: el id que llegó no es una MP de ESTA empresa.
  { categoria: "ajeno", patron: /\bque ser una materia prima\b/i },
  // «Rol inválido o inactivo.», «No se encontró uno de los roles (¿está desactivado?)»
  { categoria: "ajeno", patron: /\brol inv[áa]lido\b/i },
  // «La sucursal activa cambió desde que se cargó la pantalla: recargala y volvé a intentar.»: el id de sucursal que llegó no es la activa.
  { categoria: "contexto", patron: /\bsucursal activa cambi[óo](?![a-záéíóúñ])/i },
];

/** ¿Este mensaje de rechazo dice que lo pedido no es de quien actúa (o no se encontró)? Devuelve la categoría, o `null` si es otra cosa (forma, validación, estado). */
export function categoriaDeRechazo(mensaje: string): CategoriaDeRechazo | null {
  for (const r of REGLAS) if (r.patron.test(mensaje)) return r.categoria;
  return null;
}

/**
 * Los mensajes de rechazo que trae una salida: la excepción si lanzó, el `mensaje` de un `{ ok: false }`, o el de cada fila rechazada de un lote (`{ ok: true, resultados: [{ ok: false, mensaje }] }`).
 * Vacío = la salida no es un rechazo.
 */
export function mensajesDeRechazo(salida: { lanzo: boolean; error: string; valor: unknown }): string[] {
  if (salida.lanzo) return [salida.error];
  const v = salida.valor as { ok?: unknown; mensaje?: unknown; error?: unknown; resultados?: unknown } | null | undefined;
  if (!v || typeof v !== "object") return [];
  const texto = (x: { mensaje?: unknown; error?: unknown }): string => (typeof x.mensaje === "string" ? x.mensaje : typeof x.error === "string" ? x.error : JSON.stringify(x));
  if (v.ok === true && Array.isArray(v.resultados) && v.resultados.length > 0) {
    const filas = v.resultados as Array<{ ok?: unknown; mensaje?: unknown; error?: unknown }>;
    return filas.every((r) => r?.ok === false) ? filas.map((r) => texto(r ?? {})) : [];
  }
  // `{ ok: false }` sin ningún texto es un DATO (`validarStockSuficiente` → `{ ok: false, actual: 0, requerido: 1 }`: «no hay stock»), no un rechazo con motivo que clasificar.
  if (v.ok !== false) return [];
  return typeof v.mensaje === "string" || typeof v.error === "string" ? [texto(v)] : [];
}
