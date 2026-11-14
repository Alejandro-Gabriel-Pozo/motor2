/**
 * ORÁCULO de la poda de «género de carta» e «ítem agrupado» (decisión del dueño, 2026-11-06), escrito A MANO y aparte del código: no importa nada de `src/`. La versión legible, para el dueño, es
 * `docs/oraculo-combinaciones-poda-genero-agrupado-2026-11-06.md` (dice lo mismo). Si cambia una regla, cambian las dos.
 *
 * DIMENSIONES cuyas combinaciones cambian lo que ve el cliente, el mozo o el administrador (y por lo tanto dinero, visibilidad y permisos):
 *   interruptor (apagado / encendido) × datos (sin / con un género y un ítem agrupado cargados) × superficie.
 * Superficies de ESTA etapa (servidor): la carta pública, el selector del POS y las acciones de escritura. Las pantallas, el menú y la matriz de permisos son la etapa 2 (PR2).
 *
 * REGLAS:
 *  R1. Apagado, TODA acción de escritura de géneros / ítems agrupados / «aplicar el mismo precio a los hermanos» responde `rechazada` con el mensaje del interruptor, con o sin datos, y NO cambia nada.
 *  R2. Encendido, ninguna acción responde ese mensaje (hace lo de siempre: puede salir bien o rechazar por su regla de negocio).
 *  R3. Apagado, la carta pública y el POS ignoran la estructura: ni ítem agrupado, ni carpeta de género; las opciones con contenido visible salen sueltas en su sección, y las que no, quedan «fuera de carta».
 *  R4. Encendido, la carta pública y el POS arman el ítem agrupado (con sus opciones) y las carpetas de género.
 *  R5. Sin datos, el interruptor no cambia nada de lo que se ve.
 */
export const INTERRUPTOR = ["apagado", "encendido"] as const;
export const DATOS = ["sin", "con"] as const;
export type Interruptor = (typeof INTERRUPTOR)[number];
export type Datos = (typeof DATOS)[number];

/** Las acciones de escritura que el interruptor gobierna: TODAS las que exportan los dos archivos de carta, más las dos de «igualar precio». */
export const ACCIONES_DE_ESCRITURA = [
  "guardarGeneroCarta",
  "actualizarActivoGeneroCarta",
  "guardarItemAgrupadoCarta",
  "actualizarActivoItemAgrupadoCarta",
  "agregarOpcionItemAgrupadoCarta",
  "actualizarOrdenOpcionItemAgrupadoCarta",
  "quitarOpcionItemAgrupadoCarta",
  "sincronizarPrecioGrupoCarta",
  "sincronizarPrecioLocalGrupoCarta",
] as const;
export type AccionDeEscritura = (typeof ACCIONES_DE_ESCRITURA)[number];

export const SUPERFICIES_DE_LECTURA = ["carta-publica", "pos"] as const;

/** R1 y R2: ¿la acción se rechaza por el interruptor? (no depende de los datos). */
export function rechazadaPorElInterruptor(interruptor: Interruptor): boolean {
  return interruptor === "apagado";
}

/**
 * La carta sembrada (nombres y precios reales del dueño): sección «Bebidas» con Café $4.000, Capuccino $8.000 y la Cerveza Patagonia $14.000 (con contenido visible);
 * la Cerveza Cordillera $14.000 NO tiene contenido de carta; sección «Postres» con Brownie $10.000. Con datos: el género «Agua» en el Café, el género «Cordillera» en el ítem agrupado
 * «Cerveza» (que agrupa las dos cervezas), y un género «Agua saborizada» sin productos.
 */
export function seccionesDeLaCartaPublica(interruptor: Interruptor, datos: Datos): Record<string, string[]> {
  const conEstructura = interruptor === "encendido" && datos === "con";
  return {
    Bebidas: conEstructura ? ["Café", "Capuccino", "Cerveza"] : ["Café", "Capuccino", "Cerveza Patagonia"],
    Postres: ["Brownie"],
  };
}

/** R3/R4: las opciones del ítem agrupado «Cerveza» en la carta pública (solo existe encendido y con datos). */
export function opcionesDelAgrupadoEnLaCartaPublica(interruptor: Interruptor, datos: Datos): string[] | null {
  return interruptor === "encendido" && datos === "con" ? ["Cerveza Cordillera", "Cerveza Patagonia"] : null;
}

/** Lo que dibuja el selector del POS, por sección: `carpeta:<género>{…}`, `agrupado:<ítem>[opciones]` o el nombre del producto suelto. */
export function seccionesDelPos(interruptor: Interruptor, datos: Datos): Record<string, string[]> {
  const conEstructura = interruptor === "encendido" && datos === "con";
  return {
    Bebidas: conEstructura ? ["Capuccino", "carpeta:Agua{Café}", "carpeta:Cordillera{agrupado:Cerveza[Cerveza Cordillera,Cerveza Patagonia]}"] : ["Café", "Capuccino", "Cerveza Patagonia"],
    Postres: ["Brownie"],
  };
}

/** Los productos sembrados que el POS deja en «Fuera de carta» (los demás productos del salón de prueba no cuentan). */
export function fueraDeCartaDelPos(interruptor: Interruptor, datos: Datos): string[] {
  return interruptor === "encendido" && datos === "con" ? [] : ["Cerveza Cordillera"];
}

/**
 * CAMPOS de las tablas de la estructura (lo que lee el guardián contra `prisma/schema.prisma`, columnas y relaciones): cada una declara si el interruptor cambia lo que se ve por ella
 * (`afecta`: se lee o se escribe solo con el interruptor encendido) o no. Una columna o relación nueva sin declarar hace fallar el guardián.
 */
export const CAMPOS_DECLARADOS: Record<string, Record<string, "afecta" | "no-afecta">> = {
  GeneroCarta: {
    id: "no-afecta", empresaId: "no-afecta", empresa: "no-afecta", sucursalId: "no-afecta", sucursal: "no-afecta", nombre: "afecta", orden: "afecta", activo: "afecta", creadoEn: "no-afecta",
    contenidos: "afecta", agrupados: "afecta",
  },
  ItemAgrupadoCarta: {
    id: "no-afecta", empresaId: "no-afecta", empresa: "no-afecta", sucursalId: "no-afecta", sucursal: "no-afecta", nombre: "afecta", seccionCartaId: "afecta", seccionCarta: "afecta",
    descripcion: "afecta", tags: "afecta", especial: "afecta", orden: "afecta", activo: "afecta", generoCartaId: "afecta", generoCarta: "afecta", creadoEn: "no-afecta", actualizadoEn: "no-afecta",
    opciones: "afecta",
  },
  OpcionItemAgrupadoCarta: {
    id: "no-afecta", empresaId: "no-afecta", empresa: "no-afecta", sucursalId: "no-afecta", sucursal: "no-afecta", itemAgrupadoCartaId: "afecta", itemAgrupadoCarta: "afecta",
    productoId: "afecta", producto: "afecta", orden: "afecta", creadoEn: "no-afecta",
  },
};

/** Las columnas de OTRAS tablas que apuntan a la estructura (deben seguir existiendo, declaradas): el género de cada producto en la carta y las relaciones del producto hacia los agrupados. */
export const CAMPOS_AJENOS_QUE_APUNTAN: Record<string, readonly string[]> = {
  ContenidoCartaProducto: ["generoCartaId", "generoCarta"],
  Producto: ["opcionesItemAgrupadoCarta"],
};
