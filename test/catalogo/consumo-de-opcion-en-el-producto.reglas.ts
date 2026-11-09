/**
 * EL ORÁCULO de «qué consume cada opción» en la pestaña Opciones del producto (`docs/diseno-consumo-de-opcion-en-el-producto-2026-11-09.md`, nivel 10): la tabla de qué se ve y qué se ofrece según las
 * dimensiones que lo cambian, escrita aparte del código (a mano, no derivada de `vistaDeConsumoDeOpcion`). `consumo-de-opcion-en-el-producto.test.tsx` recorre TODAS las combinaciones válidas contra esta tabla.
 *
 * Las dimensiones: tipo de grupo × grupo compartido (lo usa un producto o varios) × la opción (con consumo, sin consumo cargado, o «ninguna») × permiso (con = Ver y Editar de `opciones_definir`; sin = ninguno de los dos)
 * × módulo Recetas (activo o no). Una opción «ninguna» solo existe en un grupo de variantes o de incluidas (D-2): las demás combinaciones con «ninguna» no son válidas y no se prueban.
 */
export type Tipo = "MEDIDA" | "VARIANTE" | "INCLUIDA" | "ADICIONAL";
export interface Combinacion {
  tipo: Tipo;
  compartido: "uno" | "varios";
  opcion: "con-consumo" | "sin-consumo" | "ninguna";
  permiso: "con" | "sin";
  recetas: "con" | "sin";
}

export const DIMENSIONES = {
  tipo: ["MEDIDA", "VARIANTE", "INCLUIDA", "ADICIONAL"],
  compartido: ["uno", "varios"],
  opcion: ["con-consumo", "sin-consumo", "ninguna"],
  permiso: ["con", "sin"],
  recetas: ["con", "sin"],
} as const;

/** Una «ninguna» solo en una variante o una incluida. */
export const esValida = (c: Combinacion) => c.opcion !== "ninguna" || c.tipo === "VARIANTE" || c.tipo === "INCLUIDA";

/** Los datos de la maqueta que la tabla nombra tal cual (la milanesa del dueño). */
const AVISO_COMPARTIDO = "Este grupo lo usan 3 productos (Bife, Milanesa, Pechuga): cambiar el consumo de una opción los afecta a todos.";
export const FACTOR_DEL_TAMANO = 1.3;
export const NUNCA = ["$", "Recargo", "Cambiar precio", "Guardar el consumo"]; // ni precios ni el formulario abierto: el editor se abre con un toque, no viene abierto.

export function esperado(c: Combinacion): { presentes: string[]; ausentes: string[] } {
  const presentes = ["Qué consume cada opción", "Pollo"];
  const ausentes: string[] = [];

  // El aviso del grupo compartido: siempre que lo usen varios productos, aunque la persona no pueda editar; el enlace a la Biblioteca solo con «Ver» de las opciones.
  if (c.compartido === "varios") {
    presentes.push(AVISO_COMPARTIDO);
    (c.permiso === "con" ? presentes : ausentes).push("Biblioteca de opciones");
  } else {
    ausentes.push("Este grupo lo usan", "Biblioteca de opciones");
  }

  // Lo que dice de la opción.
  if (c.opcion === "con-consumo") {
    presentes.push("Descuenta 0,15 kg de Pollo");
    (c.tipo === "ADICIONAL" ? ausentes : presentes).push("escala con el tamaño"); // un adicional siempre suma lo mismo: no escala
    ausentes.push("pendiente de completar", "No consume");
  } else if (c.opcion === "sin-consumo") {
    presentes.push("Consumo: pendiente de completar.");
    ausentes.push("Descuenta", "No consume");
  } else {
    presentes.push("No consume.");
    ausentes.push("pendiente de completar", "Descuenta");
  }

  // El factor del tamaño: solo en un grupo de tamaños, en solo lectura.
  (c.tipo === "MEDIDA" ? presentes : ausentes).push("Consume ×1,3 del tamaño base");

  // Por qué no se edita (una «ninguna» no lo explica) y si se ofrece el botón. El módulo Recetas se dice primero: vale para todos, aun con permiso.
  const MOTIVO_RECETAS = "usa el módulo Recetas, que tu empresa no tiene activo";
  const MOTIVO_PERMISO = "Tu rol puede ver lo que consume cada opción, pero no cambiarlo.";
  const seEdita = c.opcion !== "ninguna" && c.recetas === "con" && c.permiso === "con";
  (seEdita ? presentes : ausentes).push("Editar consumo de Pollo");
  if (c.opcion === "ninguna") ausentes.push(MOTIVO_RECETAS, MOTIVO_PERMISO);
  else if (c.recetas === "sin") {
    presentes.push(MOTIVO_RECETAS);
    ausentes.push(MOTIVO_PERMISO);
  } else if (c.permiso === "sin") {
    presentes.push(MOTIVO_PERMISO);
    ausentes.push(MOTIVO_RECETAS);
  } else ausentes.push(MOTIVO_RECETAS, MOTIVO_PERMISO);

  return { presentes, ausentes };
}

/**
 * Cada columna de `ConsumoDeOpcion` y de `VersionDeOpcion`, declarada: ¿cambia lo que la pestaña muestra o permite? Un guardián (en el test) falla si aparece una columna nueva sin declarar acá: decidir si va a la
 * pantalla es una decisión, no un olvido.
 */
export const COLUMNAS_DE_CONSUMO_DE_OPCION: Record<string, "se-ve" | "no-se-ve"> = {
  id: "no-se-ve",
  empresaId: "no-se-ve",
  versionDeOpcionId: "no-se-ve",
  efecto: "se-ve", // «Descuenta» / «Reemplaza … por»
  insumoProductoId: "se-ve", // el nombre del insumo
  reemplazaAProductoId: "se-ve", // el nombre del reemplazado
  cantidad: "se-ve",
  unidadId: "se-ve", // la unidad de la cantidad
  mermaPorcentaje: "se-ve",
  escalaConLaMedida: "se-ve",
  orden: "no-se-ve", // el orden de las líneas
};

export const COLUMNAS_DE_VERSION_DE_OPCION: Record<string, "se-ve" | "no-se-ve"> = {
  id: "no-se-ve",
  empresaId: "no-se-ve",
  opcionId: "no-se-ve",
  numero: "no-se-ve", // es la versión esperada del guardado, no se muestra
  tipoDeDiferencia: "no-se-ve", // el precio no se edita ni se muestra acá: solo se reenvía tal cual
  diferenciaPrecio: "no-se-ve",
  porcentaje: "no-se-ve",
  factorEscala: "se-ve", // «Consume ×1,3 del tamaño base» (solo un tamaño)
  creadoPorId: "no-se-ve",
  creadoEn: "no-se-ve",
};
