import { textoDePorcentaje } from "./presentacion";
import type { TipoDeGrupoDeOpciones } from "./tipos";

/**
 * Qué muestra y qué permite la pestaña Opciones de un producto sobre lo que CONSUME cada opción (`docs/diseno-consumo-de-opcion-en-el-producto-2026-11-09.md`). Funciones PURAS: la pantalla
 * solo dibuja lo que estas reglas dicen, y `test/catalogo/consumo-de-opcion-en-el-producto.test.tsx` las recorre contra una tabla escrita aparte (`….reglas.ts`).
 *
 * Qué NO decide: ningún guardado. Quién puede guardar, con qué versión y con qué validación lo resuelve el caso de uso de siempre (`agregarVersionDeOpcionCasoDeUso`); acá solo se decide si la
 * pantalla OFRECE el botón (cortesía de la interfaz: el servidor vuelve a exigir todo).
 */

/** `NO_CONSUME`: la opción «ninguna». `PENDIENTE`: sin ninguna línea de consumo cargada (nunca se inventa un valor). `CARGADO`: tiene al menos una línea. */
export type EstadoDelConsumo = "NO_CONSUME" | "PENDIENTE" | "CARGADO";

/** Por qué la pantalla NO ofrece editar el consumo de una opción (`null`: se ofrece). */
export type MotivoSinEdicion = "ninguna" | "sin-recetas" | "sin-permiso";

export interface EntradaDeConsumoDeOpcion {
  tipo: TipoDeGrupoDeOpciones;
  esNinguna: boolean;
  /** Cuántas líneas de consumo tiene la versión vigente de la opción (0 si no tiene versión). */
  lineas: number;
  /** Editar de `opciones_definir`: la MISMA clave que pide la Biblioteca para cambiar un consumo. */
  puedeEditarOpciones: boolean;
  /** La empresa tiene el módulo Recetas (los consumos lo exigen). */
  recetasActivas: boolean;
}

export interface ReglaDeConsumoDeOpcion {
  estado: EstadoDelConsumo;
  puedeEditar: boolean;
  motivoSinEdicion: MotivoSinEdicion | null;
}

/**
 * Estado y edición del consumo de UNA opción. El consumo aplica a los cuatro tipos de grupo (un adicional solo suma y no escala: lo impone el editor y `validarConsumos`), así que el tipo no
 * cambia si se ofrece editar; lo que sí lo cambia es: la opción «ninguna» (no consume, nunca), el módulo Recetas (sin él el servidor rechaza consumos) y el permiso.
 */
function reglaDeConsumoDeOpcion(e: EntradaDeConsumoDeOpcion): ReglaDeConsumoDeOpcion {
  if (e.esNinguna) return { estado: "NO_CONSUME", puedeEditar: false, motivoSinEdicion: "ninguna" };
  const estado: EstadoDelConsumo = e.lineas > 0 ? "CARGADO" : "PENDIENTE";
  if (!e.recetasActivas) return { estado, puedeEditar: false, motivoSinEdicion: "sin-recetas" };
  if (!e.puedeEditarOpciones) return { estado, puedeEditar: false, motivoSinEdicion: "sin-permiso" };
  return { estado, puedeEditar: true, motivoSinEdicion: null };
}

/** Una línea de consumo con los nombres ya resueltos (la misma forma que lee `resumenDeConsumos`). */
export interface LineaDeConsumoParaLeer {
  efecto: "SUMA" | "REEMPLAZA";
  insumoNombre: string;
  reemplazaNombre: string | null;
  cantidad: number;
  unidadNombre: string;
  mermaPorcentaje: number;
  escalaConLaMedida: boolean;
}

/**
 * Cada línea de consumo en lenguaje llano, una frase por línea: «Descuenta 0,15 kg de Pollo; escala con el tamaño», «Reemplaza Leche por 0,2 l de Bebida de almendras (merma 2 %)».
 * `formatearCantidad` es el de quien muestra (coma decimal, sin ceros de relleno).
 */
function frasesDeConsumo(lineas: readonly LineaDeConsumoParaLeer[], formatearCantidad: (n: number) => string): string[] {
  return lineas.map((l) => {
    const cuanto = `${formatearCantidad(l.cantidad)}${l.unidadNombre ? ` ${l.unidadNombre}` : ""} de ${l.insumoNombre}`;
    const base = l.efecto === "REEMPLAZA" ? `Reemplaza ${l.reemplazaNombre ?? "un ingrediente"} por ${cuanto}` : `Descuenta ${cuanto}`;
    const merma = l.mermaPorcentaje > 0 ? ` (merma ${textoDePorcentaje(l.mermaPorcentaje)} %)` : "";
    return `${base}${merma}${l.escalaConLaMedida ? "; escala con el tamaño" : ""}`;
  });
}

/** El factor de un tamaño, en solo lectura («Consume ×1,3 del tamaño base»); `null` si el grupo no es de tamaños o la opción no tiene factor. */
function fraseDelFactor(tipo: TipoDeGrupoDeOpciones, factorEscala: number | null, formatearCantidad: (n: number) => string): string | null {
  if (tipo !== "MEDIDA" || factorEscala === null) return null;
  return `Consume ×${formatearCantidad(factorEscala)} del tamaño base`;
}

/**
 * El aviso de un grupo que usa más de un producto, antes de editar el consumo de una opción (decisión del dueño, 2026-11-09). `null` si lo usa uno solo (o ninguno). Los nombres van por orden
 * alfabético en español, tal como llegan.
 */
export function avisoDeGrupoCompartido(productos: readonly { nombre: string }[]): string | null {
  if (productos.length <= 1) return null;
  return `Este grupo lo usan ${productos.length} productos (${productos.map((p) => p.nombre).join(", ")}): cambiar el consumo de una opción los afecta a todos.`;
}

/** Lo que dice la pantalla cuando NO ofrece editar (el motivo, en una línea); `null` si se ofrece. */
function textoDeMotivoSinEdicion(motivo: MotivoSinEdicion | null): string | null {
  switch (motivo) {
    case null:
      return null;
    case "ninguna":
      return null; // «ninguna» ya dice «No consume»: no hace falta explicar por qué no se edita.
    case "sin-recetas":
      return "Lo que consume una opción usa el módulo Recetas, que tu empresa no tiene activo.";
    case "sin-permiso":
      return "Tu rol puede ver lo que consume cada opción, pero no cambiarlo.";
  }
}

/** Todo lo que la pestaña dibuja de UNA opción, ya decidido (lo que consume la pieza `ConsumoDeOpcion`). */
export interface VistaDeConsumoDeOpcion {
  estado: EstadoDelConsumo;
  puedeEditar: boolean;
  /** Una frase por línea de consumo (vacío si no hay). */
  frases: string[];
  /** El factor del tamaño en solo lectura (`null` si no aplica). */
  factor: string | null;
  /** Por qué no se ofrece editar, en una línea (`null` si se ofrece o si no hace falta explicarlo). */
  motivoSinEdicion: string | null;
}

/** Junta las reglas de arriba para una opción: es lo que prueba la tabla de combinaciones y lo que la página le pasa a la pieza que dibuja. */
export function vistaDeConsumoDeOpcion(
  o: Omit<EntradaDeConsumoDeOpcion, "lineas"> & { consumos: readonly LineaDeConsumoParaLeer[]; factorEscala: number | null },
  formatearCantidad: (n: number) => string
): VistaDeConsumoDeOpcion {
  const regla = reglaDeConsumoDeOpcion({ tipo: o.tipo, esNinguna: o.esNinguna, lineas: o.consumos.length, puedeEditarOpciones: o.puedeEditarOpciones, recetasActivas: o.recetasActivas });
  return {
    estado: regla.estado,
    puedeEditar: regla.puedeEditar,
    frases: frasesDeConsumo(o.consumos, formatearCantidad),
    factor: fraseDelFactor(o.tipo, o.factorEscala, formatearCantidad),
    motivoSinEdicion: textoDeMotivoSinEdicion(regla.motivoSinEdicion),
  };
}
