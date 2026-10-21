import { numeroDelCampo } from "@/core/datos/numero-tecleado";
import {
  admitePrefijoEnCarta,
  formaDelGrupoPorRespuesta,
  leerOpcionEnCarta,
  leerPrecioDeFilaDeAdmision,
  type ComoCambiaElPrecio,
  type LecturaDePrecio,
  type ReferenciaDePrecio,
} from "@/core/opciones/public";

/**
 * Lo puro de la ventana «+ Nuevo grupo» del producto (Fase 6, paso 6.15c; `NuevoGrupoEnElProducto`): el formulario como estado, el comando que arma para `crearGrupoEnElProducto`, la lectura del precio de
 * cada fila y el texto de «Se lee en la carta como». Sin React: lo prueban los tests con datos. NO valida: el guard del servidor (`guardComandoCrearGrupoEnElProducto`) lo hace todo; acá solo se arma lo que
 * se tecleó con las reglas de forma que la ventana promete (una fila entera vacía no cuenta; sin importe, una opción que suma suma 0).
 */

/** Una fila de opción de la ventana: `clave` es solo para que React no confunda filas al agregar otra; `importe` es lo que emite `CampoNumero` (vacío, el número canónico o el texto tal cual). */
export interface FilaDeOpcionNueva {
  clave: number;
  nombre: string;
  importe: string;
}

export interface FormularioDeGrupoNuevo {
  nombre: string;
  /** «¿Cambia el precio?»; vacío hasta que se elige (no hay una respuesta por defecto: el tipo no se cambia después). */
  respuesta: ComoCambiaElPrecio | "";
  prefijo: string;
  filas: readonly FilaDeOpcionNueva[];
}

/** Con cuántas filas vacías abre la ventana. */
export const FILAS_AL_ABRIR = 3;

export function filaNueva(clave: number): FilaDeOpcionNueva {
  return { clave, nombre: "", importe: "" };
}

export function formularioInicial(): FormularioDeGrupoNuevo {
  return { nombre: "", respuesta: "", prefijo: "", filas: Array.from({ length: FILAS_AL_ABRIR }, (_, i) => filaNueva(i)) };
}

const estaVacia = (f: FilaDeOpcionNueva) => f.nombre.trim() === "" && f.importe.trim() === "";

/** Si la respuesta lleva un importe por opción (precio final o lo que suma): lo incluido no. */
export function llevaImporte(respuesta: ComoCambiaElPrecio | ""): respuesta is "SUMA" | "PRECIO_FINAL" {
  return respuesta === "SUMA" || respuesta === "PRECIO_FINAL";
}

/** Si la respuesta admite «Se lee en la carta como» (el grupo es un tamaño o una variante: `admitePrefijoEnCarta`). */
export function admitePrefijo(respuesta: ComoCambiaElPrecio | ""): boolean {
  return respuesta !== "" && admitePrefijoEnCarta(formaDelGrupoPorRespuesta(respuesta).tipo);
}

/**
 * El comando de `crearGrupoEnElProducto` a partir del formulario. Tipado como el cuerpo de la acción (valores `unknown` que valida el guard):
 *  - sin respuesta elegida va `""` y el servidor dice «Elegí si el grupo cambia el precio.»;
 *  - el prefijo solo viaja si la respuesta lo admite y no está vacío (`null` si no);
 *  - una fila entera vacía no se manda; las demás sí, y el servidor numera las opciones por su lugar entre las que viajan;
 *  - el importe: «incluido» no lleva (`null`); precio final: el número tecleado (`null` si está vacío, y el servidor dice que falta; `NaN` si no se entendió, y dice que no es un número); lo que suma: igual,
 *    salvo que vacío es 0 (una opción que no suma nada no necesita que se teclee un cero).
 */
export function armarComandoDeGrupoNuevo(productoId: string, f: FormularioDeGrupoNuevo): { productoId: string; nombre: string; respuesta: string; prefijoEnCarta: string | null; opciones: { nombre: string; importe: number | null }[] } {
  const importe = (texto: string): number | null => {
    if (!llevaImporte(f.respuesta)) return null;
    const n = numeroDelCampo(texto);
    if (n === undefined) return f.respuesta === "SUMA" ? 0 : null;
    return n;
  };
  const prefijo = f.prefijo.trim();
  return {
    productoId,
    nombre: f.nombre.trim(),
    respuesta: f.respuesta,
    prefijoEnCarta: admitePrefijo(f.respuesta) && prefijo !== "" ? prefijo : null,
    opciones: f.filas.filter((fila) => !estaVacia(fila)).map((fila) => ({ nombre: fila.nombre.trim(), importe: importe(fila.importe) })),
  };
}

/**
 * La lectura del precio de UNA fila («Napolitana = $ 25.000», «Falta el precio final de «Napolitana»»), o `null` si no hay nada que leer: sin respuesta, en un grupo incluido, sin nombre, o (lo que suma)
 * mientras no hay con qué sumar. Lo que suma se lee contra `referencia` o `precioDeLista` si el producto los da (la página los calcula con lo guardado); sin ellos no se inventa una base.
 * Es `leerPrecioDeFilaDeAdmision` con la fila como si ya estuviera admitida: el total sale del compositor de la venta.
 */
export function lecturaDeLaFilaNueva(entrada: {
  respuesta: ComoCambiaElPrecio | "";
  fila: FilaDeOpcionNueva;
  precioDeLista: number | null;
  referencia: ReferenciaDePrecio | null;
}): LecturaDePrecio | null {
  const { respuesta, fila, precioDeLista, referencia } = entrada;
  if (!llevaImporte(respuesta) || fila.nombre.trim() === "") return null;
  const forma = formaDelGrupoPorRespuesta(respuesta);
  return leerPrecioDeFilaDeAdmision({
    tipoDeGrupo: forma.tipo,
    modoPrecio: forma.modoPrecio,
    opcion: { nombre: fila.nombre.trim(), esNinguna: false, diferenciaDeLaOpcion: null },
    admitida: true,
    precio: "MONTO",
    precioAbsoluto: fila.importe,
    valor: fila.importe,
    precioDeLista,
    referencia,
  });
}

/**
 * «En la carta se verá: …»: cómo lee la carta cada opción del grupo con el prefijo tecleado (`leerOpcionEnCarta`: «De» + «Carne» → «De carne»). Vacío: «Sin prefijo: cada opción se lee con su nombre.».
 * Con prefijo y sin opciones todavía: «En la carta se verá: De … (todavía no hay opciones)». La misma redacción que la lectura de «Se lee en la carta como» de un grupo que ya existe.
 */
export function textoDeLecturaEnCarta(prefijo: string, nombres: readonly string[]): string {
  const limpio = prefijo.trim();
  if (limpio === "") return "Sin prefijo: cada opción se lee con su nombre.";
  const leidas = nombres.map((n) => n.trim()).filter((n) => n !== "").map((n) => leerOpcionEnCarta(limpio, { nombre: n, esNinguna: false }));
  return leidas.length > 0 ? `En la carta se verá: ${leidas.join(" · ")}` : `En la carta se verá: ${limpio} … (todavía no hay opciones)`;
}
