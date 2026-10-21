import { interpretarNumero } from "@/core/datos/numero-tecleado";
import { leerPrecioDeOpcion, type LecturaDePrecio } from "./lectura-de-precio";
import { IMPORTE_MINIMO, type DiferenciaDePrecio, type ModoDePrecioDeMedida, type TipoDeGrupoDeOpciones } from "./tipos";

/**
 * La lectura del precio dentro de «Opciones de venta» de UN producto (Fase 6, paso 6.15a; `AdmisionDeGrupo`): cuándo se lee una fila del formulario de un grupo y contra qué precio. Puro: arma la
 * entrada de `leerPrecioDeOpcion` (que es quien compone el precio, con el mismo compositor que la venta) y decide, sin cuentas propias, qué filas NO se leen.
 */

/** La opción más barata del grupo que FIJA el precio del producto, con lo guardado: a ella se le suma lo de un grupo que suma. */
export interface ReferenciaDePrecio {
  opcion: string;
  precio: number;
}

/** Lo que la referencia mira de un grupo que el producto tiene asignado (activo o no en el producto): lo que ya entrega la lectura de la pantalla (`GrupoAdmitidoDelPanel`). */
export interface AdmisionParaLaReferencia {
  tipo: TipoDeGrupoDeOpciones;
  activoEnEmpresa: boolean;
  fila: { activo: boolean; modoPrecio: ModoDePrecioDeMedida | null };
  opciones: readonly { nombre: string; activaEnEmpresa: boolean; fila: { activo: boolean; precioAbsoluto: number | null } | null }[];
}

/**
 * La referencia del producto, con lo GUARDADO: el precio final más barato de sus grupos de precio (MEDIDA en ABSOLUTO, vigentes en el producto y en la empresa) entre las opciones que ofrece
 * (prendidas en la empresa y admitidas) y que tienen precio final (0,01 o más). Es la misma regla que `precioDeReferenciaDeAdmisiones` (el control de precio de lista) y que la composición de la venta: una
 * medida en ABSOLUTO REEMPLAZA al precio base, sea el producto directo o se venda por opción. `null` si no tiene ninguna (entonces rige el precio de lista). En un empate gana la primera, en el orden dado.
 */
export function referenciaDePrecioDeAdmisiones(admisiones: readonly AdmisionParaLaReferencia[]): ReferenciaDePrecio | null {
  let mejor: ReferenciaDePrecio | null = null;
  for (const a of admisiones) {
    if (!a.fila.activo || !a.activoEnEmpresa || a.tipo !== "MEDIDA" || a.fila.modoPrecio !== "ABSOLUTO") continue;
    for (const o of a.opciones) {
      const precio = o.fila?.precioAbsoluto ?? null;
      if (!o.activaEnEmpresa || !o.fila?.activo || precio === null || !Number.isFinite(precio) || precio < IMPORTE_MINIMO) continue;
      if (mejor === null || precio < mejor.precio) mejor = { opcion: o.nombre, precio };
    }
  }
  return mejor;
}

/** Cómo se cobra la opción en ESTE producto (el selector de la fila): la diferencia de la opción, o un monto o un porcentaje propios. */
type ComoSeCobraEnElProducto = "DE_LA_OPCION" | "MONTO" | "PORCENTAJE";

export interface FilaDeAdmisionParaLeer {
  tipoDeGrupo: TipoDeGrupoDeOpciones;
  /** El modo de precio que está elegido en el formulario (solo un tamaño lo tiene). */
  modoPrecio: ModoDePrecioDeMedida | null;
  opcion: { nombre: string; esNinguna: boolean; diferenciaDeLaOpcion: DiferenciaDePrecio | null };
  /** La opción está tildada: solo se lee lo que el producto va a ofrecer. */
  admitida: boolean;
  precio: ComoSeCobraEnElProducto;
  /** Lo que emite `CampoNumero` en «precio propio»: vacío, el número canónico o, si no se entendió, el texto tal cual. */
  precioAbsoluto: string;
  /** Lo mismo, en la diferencia propia (monto o porcentaje). */
  valor: string;
  /** El precio de lista del producto en la sucursal. `null` si no se cobra (un producto que se vende por opción cobra el de sus opciones, no el guardado). */
  precioDeLista: number | null;
  referencia: ReferenciaDePrecio | null;
}

/** Lo tecleado como lo entiende `leerPrecioDeOpcion`: el número, `null` si está vacío o `"invalido"` si no se entendió. */
function tecleado(texto: string): number | null | "invalido" {
  const r = interpretarNumero(texto);
  return r.ok ? r.valor : "invalido";
}

/**
 * La lectura de UNA fila del formulario, o `null` si no hay nada que leer:
 * - una opción sin tildar, la «ninguna» (no suma nada) y los grupos que no tienen importe que leer (INCLUIDA) o que todavía no se leen (ADICIONAL, «se cobra aparte»);
 * - una MEDIDA sin modo de precio elegido;
 * - lo que suma sin un precio contra el cual sumar: ni referencia ni precio de lista de 0,01 o más (un producto que se vende por opción y todavía no tiene precio final, o un directo sin precio). Sumar
 *   sobre 0 daría el error del compositor («queda en menos de 0,01»), que no habla de lo que la persona tecleó;
 * - un porcentaje (la lectura es en pesos), y una diferencia propia vacía (todavía no tecleó nada).
 * Todo lo demás lo lee `leerPrecioDeOpcion`: el precio final tecleado en un tamaño con precio propio, o «referencia con opción = base + diferencia = total».
 */
export function leerPrecioDeFilaDeAdmision(fila: FilaDeAdmisionParaLeer): LecturaDePrecio | null {
  const { tipoDeGrupo, modoPrecio, opcion, admitida, precio, precioAbsoluto, valor, precioDeLista, referencia } = fila;
  if (!admitida || opcion.esNinguna) return null;
  if (tipoDeGrupo === "INCLUIDA" || tipoDeGrupo === "ADICIONAL") return null;
  if (tipoDeGrupo === "MEDIDA" && modoPrecio === null) return null;

  if (tipoDeGrupo === "MEDIDA" && modoPrecio === "ABSOLUTO") {
    return leerPrecioDeOpcion({
      forma: { tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, modoPrecio: "ABSOLUTO" },
      opcion,
      tecleado: tecleado(precioAbsoluto),
      precioBase: 0,
      referencia: null,
    });
  }

  const base = referencia?.precio ?? precioDeLista;
  if (base === null || base < IMPORTE_MINIMO) return null;
  if (precio === "PORCENTAJE") return null;
  let importe: number | null | "invalido";
  if (precio === "MONTO") {
    importe = tecleado(valor);
    if (importe === null) return null;
  } else {
    // La diferencia de la opción: en pesos se lee; en porcentaje no (la lectura es en pesos); una VARIANTE sin diferencia suma 0 y una MEDIDA sin diferencia no tiene con qué cobrarse.
    const d = opcion.diferenciaDeLaOpcion;
    if (d === null) {
      if (tipoDeGrupo === "MEDIDA") return null;
      importe = 0;
    } else if (d.tipo === "MONTO") importe = d.monto;
    else return null;
  }
  return leerPrecioDeOpcion({
    forma: { tipo: tipoDeGrupo, cantidadMinima: 1, cantidadMaxima: 1, modoPrecio: tipoDeGrupo === "MEDIDA" ? modoPrecio : null },
    opcion,
    tecleado: importe,
    precioBase: precioDeLista ?? 0,
    referencia,
  });
}
