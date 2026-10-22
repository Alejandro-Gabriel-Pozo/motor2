import { componerPrecioDeLinea, type OpcionParaPrecio } from "./componer-precio-de-linea";
import type { ModoDePrecioDeMedida, TipoDeGrupoDeOpciones } from "./tipos";

/**
 * La LECTURA del precio de una opción (Fase 6, paso 6.9a; «el espacio del producto», DEC-12). Función pura: dice, en números exactos, cuánto se cobra con una opción mientras
 * quien administra la teclea, para que la pantalla le muestre el efecto antes de guardar («Napolitana con Trucha = $ 25.000 + $ 3.000 = $ 28.000»).
 *
 * Reglas:
 * - El `total` sale SOLO de `componerPrecioDeLinea` (`precio.precioDeLista`): la lectura no tiene cuentas propias, así que no puede decir un número distinto del que cobra la venta.
 *   La `base` y la `diferencia` son las partes de ese mismo cálculo (`base + diferencia === total`, en centavos).
 * - Dinero en números de 2 decimales (`core/moneda.ts`); acá no se redondea nada por afuera del compositor.
 * - NO formatea: `core/pos` (donde vive `formatearMonto`) ya importa `core/opciones`, así que importarlo desde acá armaría un ciclo. `fraseDeLecturaDePrecio` recibe el formateador por parámetro.
 * - «Se cobra aparte» (el ADICIONAL, que es otra línea de venta con su producto de respaldo) todavía no tiene lectura: devuelve `invalido` (queda para el bloque 3).
 */

/** Las tres respuestas a «¿Cambia el precio?» que sabe crear la pantalla del producto. «Se cobra aparte» (ADICIONAL) queda para el bloque 3. */
export type ComoCambiaElPrecio = "INCLUIDO" | "SUMA" | "PRECIO_FINAL";

/** La forma que tiene un grupo según esa respuesta: lo que se guarda en `GrupoDeOpciones` (tipo y cantidades) y `ProductoAdmiteGrupo` (modo de precio). */
export interface FormaDelGrupo {
  tipo: TipoDeGrupoDeOpciones;
  cantidadMinima: number;
  cantidadMaxima: number;
  modoPrecio: ModoDePrecioDeMedida | null;
}

/**
 * De la respuesta a la forma del grupo (`validarGrupo` la acepta: MEDIDA 1 y 1, INCLUIDA con mínimo 1 o más).
 * - INCLUIDO: no cambia el precio → grupo INCLUIDA.
 * - SUMA: solo algunas opciones suman un importe → grupo VARIANTE.
 * - PRECIO_FINAL: cada opción define el precio final → grupo MEDIDA con el precio ABSOLUTO.
 */
export function formaDelGrupoPorRespuesta(respuesta: ComoCambiaElPrecio): FormaDelGrupo {
  switch (respuesta) {
    case "INCLUIDO":
      return { tipo: "INCLUIDA", cantidadMinima: 1, cantidadMaxima: 1, modoPrecio: null };
    case "SUMA":
      return { tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1, modoPrecio: null };
    case "PRECIO_FINAL":
      return { tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, modoPrecio: "ABSOLUTO" };
  }
}

/**
 * Lo inverso: la respuesta que corresponde a un grupo que ya existe, o `null` si no es una de las tres (el ADICIONAL, o una MEDIDA que se cobra por DIFERENCIA, que se lee distinto).
 */
export function respuestaDelGrupo(tipo: TipoDeGrupoDeOpciones, modoPrecio: ModoDePrecioDeMedida | null): ComoCambiaElPrecio | null {
  if (tipo === "INCLUIDA") return "INCLUIDO";
  if (tipo === "VARIANTE") return "SUMA";
  if (tipo === "MEDIDA" && modoPrecio === "ABSOLUTO") return "PRECIO_FINAL";
  return null;
}

/** Lo que dice la lectura de UNA opción. */
export type LecturaDePrecio =
  | { tipo: "precio-final"; opcion: string; total: number }
  | { tipo: "suma"; opcion: string; referencia: { opcion: string; precio: number } | null; base: number; diferencia: number; total: number }
  | { tipo: "no-cambia" }
  | { tipo: "falta"; opcion: string }
  | { tipo: "invalido"; mensaje: string };

interface EntradaDeLecturaDePrecio {
  forma: FormaDelGrupo;
  opcion: { nombre: string; esNinguna: boolean };
  /** Lo que se tecleó en el importe de la opción: un número, `null` si está vacío o `"invalido"` si no se entendió. */
  tecleado: number | null | "invalido";
  /** El precio de lista del producto (en uno que se vende por opción es el guardado, que no se cobra). */
  precioBase: number;
  /**
   * La opción más barata del grupo que FIJA el precio del producto, con lo guardado: a ella se le suma una opción de un grupo que suma. `null` si el producto se cobra por su precio de lista
   * (un producto directo): la suma parte de `precioBase`.
   */
  referencia: { opcion: string; precio: number } | null;
}

function invalido(mensaje: string): LecturaDePrecio {
  return { tipo: "invalido", mensaje };
}

/**
 * Lee el precio de UNA opción según la forma de su grupo.
 * - INCLUIDA: `no-cambia` (lo que se teclee no se mira: una opción incluida no tiene importe).
 * - MEDIDA en ABSOLUTO (precio final): `precio-final` con el total; si el importe está vacío, `falta`.
 * - VARIANTE (y MEDIDA en DIFERENCIA): `suma` = base + diferencia. El importe vacío o la opción «ninguna» suman 0.
 * - Un importe que no se entendió, o que el compositor rechaza, es `invalido` con el mensaje de la regla de cobro.
 */
export function leerPrecioDeOpcion(entrada: EntradaDeLecturaDePrecio): LecturaDePrecio {
  const { forma, opcion, tecleado, precioBase, referencia } = entrada;
  if (forma.tipo === "INCLUIDA") return { tipo: "no-cambia" };
  if (forma.tipo === "ADICIONAL") return invalido("«Se cobra aparte» todavía no se lee acá: el recargo se ve en su producto de respaldo.");

  const alAbsoluto = forma.tipo === "MEDIDA" && forma.modoPrecio === "ABSOLUTO";
  if (forma.tipo === "MEDIDA" && forma.modoPrecio === null) return invalido(`«${opcion.nombre}» no tiene definido cómo se cobra.`);
  if (opcion.esNinguna && forma.tipo === "MEDIDA") return invalido("La opción «ninguna» no va en un grupo que fija el precio final.");

  // La opción «ninguna» no suma nada, tenga lo que tenga tecleado.
  const lo = opcion.esNinguna ? null : tecleado;
  if (alAbsoluto && lo === null) return { tipo: "falta", opcion: opcion.nombre };
  if (lo === "invalido") return invalido(`Revisá el importe de «${opcion.nombre}»: no se entendió.`);

  const base = referencia === null ? precioBase : referencia.precio;
  const paraElPrecio: OpcionParaPrecio = {
    opcionId: "lectura",
    versionDeOpcionId: "lectura",
    nombre: opcion.nombre,
    tipo: forma.tipo,
    cantidad: 1,
    factorEscala: null,
    modoPrecio: forma.tipo === "MEDIDA" ? forma.modoPrecio : null,
    precioAbsoluto: alAbsoluto ? lo : null,
    diferencia: alAbsoluto ? null : { tipo: "MONTO", monto: lo ?? 0 },
  };
  const compuesto = componerPrecioDeLinea({ precioBase: base, cantidad: 1, opciones: [paraElPrecio] });
  if (!compuesto.ok) return invalido(compuesto.mensaje);

  const total = compuesto.precio.precioDeLista;
  if (alAbsoluto) return { tipo: "precio-final", opcion: opcion.nombre, total };
  return { tipo: "suma", opcion: opcion.nombre, referencia, base, diferencia: compuesto.precio.dentroDelPrecio[0].importeUnitario, total };
}

/**
 * La frase de una lectura, lista para mostrar. `formatear` pone el dinero en el formato de la pantalla (`formatearMonto`, es-AR): se recibe por parámetro porque este módulo no puede importar `core/pos`.
 * - suma con referencia: «Napolitana con Trucha = $ 25.000 + $ 3.000 = $ 28.000»; sin referencia: «Con Trucha = $ 25.000 + $ 3.000 = $ 28.000».
 * - precio final: «Napolitana = $ 25.000».
 * - no-cambia: «Este grupo no cambia el precio». Falta: «Falta el precio final de «Napolitana»». Inválido: su mensaje.
 */
export function fraseDeLecturaDePrecio(lectura: LecturaDePrecio, formatear: (n: number) => string): string {
  switch (lectura.tipo) {
    case "precio-final":
      return `${lectura.opcion} = ${formatear(lectura.total)}`;
    case "suma": {
      const sujeto = lectura.referencia === null ? `Con ${lectura.opcion}` : `${lectura.referencia.opcion} con ${lectura.opcion}`;
      return `${sujeto} = ${formatear(lectura.base)} + ${formatear(lectura.diferencia)} = ${formatear(lectura.total)}`;
    }
    case "no-cambia":
      return "Este grupo no cambia el precio";
    case "falta":
      return `Falta el precio final de «${lectura.opcion}»`;
    case "invalido":
      return lectura.mensaje;
  }
}
