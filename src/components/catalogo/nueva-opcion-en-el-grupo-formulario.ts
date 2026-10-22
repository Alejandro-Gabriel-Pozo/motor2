import { numeroDelCampo } from "@/core/datos/numero-tecleado";
import type { ModoDePrecioDeMedida, TipoDeGrupoDeOpciones } from "@/core/opciones/public";

/**
 * Lo puro de la ventana «+ Opción» / «+ Extra» de la tarjeta de un grupo del producto (`NuevaOpcionEnElGrupo`): qué lleva la opción nueva según el grupo, el formulario como estado, los textos y el comando
 * que arma para `crearOpcionEnElProducto`. Sin React: lo prueban los tests con datos. NO valida: el guard y el caso de uso del servidor lo hacen todo (y deciden por el tipo del grupo que ELLOS leen: lo
 * de acá es solo para mostrar el campo que corresponde).
 */

/** Qué lleva la opción nueva: el precio final de la opción (medida en precio propio), lo que suma (variante o medida en diferencia), lo que cobra el extra (adicional) o nada (grupo incluido). */
export type LoQueLleva = "precio-final" | "suma" | "cobra" | "nada";

export function loQueLleva(tipo: TipoDeGrupoDeOpciones, modoPrecio: ModoDePrecioDeMedida | null): LoQueLleva {
  if (tipo === "ADICIONAL") return "cobra";
  if (tipo === "INCLUIDA") return "nada";
  return tipo === "MEDIDA" && modoPrecio === "ABSOLUTO" ? "precio-final" : "suma";
}

/** Los textos de la ventana: «+ Extra» en un adicional, «+ Opción» en los demás. */
export function textosDeLaVentana(tipo: TipoDeGrupoDeOpciones, grupoNombre: string) {
  const extra = tipo === "ADICIONAL";
  return {
    boton: extra ? "+ Extra" : "+ Opción",
    botonAccesible: extra ? `+ Extra en ${grupoNombre}` : `+ Opción en ${grupoNombre}`,
    titulo: extra ? `Nuevo extra en «${grupoNombre}»` : `Nueva opción en «${grupoNombre}»`,
    nombre: extra ? "Nombre del extra" : "Nombre de la opción",
    enviar: extra ? "Agregar el extra" : "Agregar la opción",
    errorDeConexion: extra ? "No se pudo agregar el extra. Revisá tu conexión y probá de nuevo." : "No se pudo agregar la opción. Revisá tu conexión y probá de nuevo.",
  };
}

/** La etiqueta del importe según lo que lleva (`null` si no lleva). */
export function etiquetaDelImporte(lleva: LoQueLleva): string | null {
  if (lleva === "precio-final") return "Precio final de la opción";
  if (lleva === "suma") return "Cuánto suma";
  if (lleva === "cobra") return "Cuánto cobra";
  return null;
}

/** La ayuda bajo el importe. */
export function ayudaDelImporte(lleva: LoQueLleva): string | null {
  if (lleva === "precio-final") return "Lo que se cobra el producto cuando se elige esta opción.";
  if (lleva === "suma") return "Se agrega al precio del producto. Si no cambia el precio, dejalo en 0.";
  if (lleva === "cobra") return "Se cobra aparte, en su propia línea. El sistema crea un producto interno para el stock del extra; no lo tenés que administrar.";
  return null;
}

/** `importe` y `unidadStockId` son lo que emiten `CampoNumero` (vacío, el número canónico o el texto tal cual) y el selector. */
export interface FormularioDeOpcionNueva {
  nombre: string;
  importe: string;
  unidadStockId: string;
}

export function formularioDeOpcionInicial(lleva: LoQueLleva): FormularioDeOpcionNueva {
  return { nombre: "", importe: lleva === "suma" ? "0" : "", unidadStockId: "" };
}

/**
 * El comando de `crearOpcionEnElProducto`. Tipado como el cuerpo de la acción (valores `unknown` que valida el guard):
 *  - el importe: un grupo incluido no lleva (`null`); lo demás, el número tecleado (`null` si está vacío —y el servidor dice que falta—, salvo lo que suma, donde vacío es 0—; `NaN` si no se entendió, y dice
 *    que no es un número);
 *  - la unidad del respaldo solo viaja en un extra (`null` si no se eligió: el servidor dice que falta).
 */
export function armarComandoDeOpcionNueva(
  grupo: { productoId: string; grupoId: string; versionEsperada: number; lleva: LoQueLleva },
  f: FormularioDeOpcionNueva
): { productoId: string; grupoId: string; versionEsperada: number; nombre: string; importe: number | null; unidadStockId: string | null } {
  const n = numeroDelCampo(f.importe);
  const importe = grupo.lleva === "nada" ? null : n === undefined ? (grupo.lleva === "suma" ? 0 : null) : n;
  return {
    productoId: grupo.productoId,
    grupoId: grupo.grupoId,
    versionEsperada: grupo.versionEsperada,
    nombre: f.nombre.trim(),
    importe,
    unidadStockId: grupo.lleva === "cobra" && f.unidadStockId !== "" ? f.unidadStockId : null,
  };
}
