import { esIdentificador } from "@/core/datos/identificador";
import { validarImporte } from "@/core/datos/importe";
import { ENTERO_MAXIMO_RAZONABLE, MAXIMO_INGREDIENTES_RECETA } from "@/core/datos/limites";
import { numeroDeEntrada, tieneALoSumoDecimales } from "@/core/datos/numero-tecleado";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { texto } from "@/core/texto";
import { MENSAJE_SUCURSAL_CAMBIADA } from "./opciones-por-sucursal.guard";
import type {
  ComandoCrearGrupoDePrecio,
  ComandoEditarGrupoDePrecio,
  ComandoFijarEjesDeProducto,
  ComandoFijarPrecioLocalDeCombinacion,
  ComandoGuardarCombinacion,
  ComandoGuardarRecetaDeCombinacion,
  IngredienteDeCombinacionEnComando,
  PrecioLocalDeCombinacionVisto,
} from "./combinaciones.schema";

/**
 * Guard de la feature «precio y receta por combinación» (GO-3b, ADR-032). FORMATO Y RANGO de cada comando, ANTES de tocar la base; lo llama la Server Action DENTRO de su `conPermiso…(…)`. Puro.
 * Todo número pasa por el parser estricto de `core/datos` y lo que trae más decimales de los que guarda su columna se RECHAZA, no se redondea (la base redondearía sin avisar): precios `(14,2)`,
 * cantidades `(14,4)`, merma `(6,2)` de 0 a 100. Las reglas de los ejes, de las combinaciones y de la receta las aplica el caso de uso, que es el que lee.
 */

const LARGO_MAXIMO_DE_ID = 64;
const LARGO_MAXIMO_NOMBRE_DE_GRUPO = 80;
const CANTIDAD_MAXIMA_DE_INGREDIENTE = 1e10;

function id(valor: unknown, mensaje: string): ResultadoDato<string> {
  return esIdentificador(valor) && valor.length <= LARGO_MAXIMO_DE_ID ? aceptar(valor) : rechazar("formato", mensaje);
}

function idONulo(valor: unknown, mensaje: string): ResultadoDato<string | null> {
  return valor === null || valor === undefined ? aceptar(null) : id(valor, mensaje);
}

function version(valor: unknown, minimo: 0 | 1): ResultadoDato<number> {
  const n = numeroDeEntrada(valor);
  if (!n.ok || n.valor === null || !Number.isInteger(n.valor) || n.valor < minimo || n.valor > ENTERO_MAXIMO_RAZONABLE) return rechazar("formato", "La versión que se esperaba no es válida: recargá la pantalla.");
  return aceptar(n.valor);
}

/** Un precio de lista: 0,01 o más, con hasta 2 decimales (los CHECK de las tres tablas de precio). */
function precio(valor: unknown, etiqueta: string): ResultadoDato<number> {
  const p = validarImporte(valor, { etiqueta, obligatorio: true, permitirCero: false });
  return p.ok ? aceptar(p.valor!) : rechazar(p.codigo, p.mensaje);
}

function precioONulo(valor: unknown, etiqueta: string): ResultadoDato<number | null> {
  return valor === null || valor === undefined || valor === "" ? aceptar(null) : precio(valor, etiqueta);
}

export function guardComandoFijarEjesDeProducto(entrada: { productoId: unknown; eje1GrupoId: unknown; eje2GrupoId: unknown }): ResultadoDato<ComandoFijarEjesDeProducto> {
  const productoId = id(entrada.productoId, "No se encontró el producto.");
  if (!productoId.ok) return productoId;
  const eje1 = idONulo(entrada.eje1GrupoId, "El grupo del eje 1 no es válido.");
  if (!eje1.ok) return eje1;
  const eje2 = idONulo(entrada.eje2GrupoId, "El grupo del eje 2 no es válido.");
  if (!eje2.ok) return eje2;
  if (eje1.valor === null && eje2.valor !== null) return rechazar("formato", "Para tener un eje 2 hace falta el eje 1.");
  if (eje1.valor !== null && eje1.valor === eje2.valor) return rechazar("formato", "Un grupo no puede ser los dos ejes.");
  return aceptar({ productoId: productoId.valor, eje1GrupoId: eje1.valor, eje2GrupoId: eje2.valor });
}

export function guardComandoGuardarCombinacion(entrada: {
  productoId: unknown;
  opcionEje1Id: unknown;
  opcionEje2Id?: unknown;
  versionEsperada: unknown;
  activa: unknown;
  precio?: unknown;
  grupoDePrecioId?: unknown;
}): ResultadoDato<ComandoGuardarCombinacion> {
  const productoId = id(entrada.productoId, "No se encontró el producto.");
  if (!productoId.ok) return productoId;
  const eje1 = id(entrada.opcionEje1Id, "La opción del eje 1 no es válida.");
  if (!eje1.ok) return eje1;
  const eje2 = idONulo(entrada.opcionEje2Id, "La opción del eje 2 no es válida.");
  if (!eje2.ok) return eje2;
  const v = version(entrada.versionEsperada, 0);
  if (!v.ok) return v;
  if (typeof entrada.activa !== "boolean") return rechazar("formato", "Elegí si la combinación se vende o no.");
  const p = precioONulo(entrada.precio, "El precio de la combinación");
  if (!p.ok) return p;
  const grupo = idONulo(entrada.grupoDePrecioId, "El grupo de precio no es válido.");
  if (!grupo.ok) return grupo;
  if (p.valor !== null && grupo.valor !== null) return rechazar("formato", "Una combinación lleva un precio propio O una tarifa compartida, no las dos.");
  return aceptar({ productoId: productoId.valor, opcionEje1Id: eje1.valor, opcionEje2Id: eje2.valor, versionEsperada: v.valor, activa: entrada.activa, precio: p.valor, grupoDePrecioId: grupo.valor });
}

function nombreDeGrupo(valor: unknown): ResultadoDato<string> {
  const n = texto(valor).trim();
  if (!n) return rechazar("vacio", "La tarifa necesita un nombre.");
  if (n.length > LARGO_MAXIMO_NOMBRE_DE_GRUPO) return rechazar("largo", `El nombre de una tarifa puede tener hasta ${LARGO_MAXIMO_NOMBRE_DE_GRUPO} caracteres.`);
  return aceptar(n);
}

export function guardComandoCrearGrupoDePrecio(entrada: { nombre: unknown; precio: unknown }): ResultadoDato<ComandoCrearGrupoDePrecio> {
  const n = nombreDeGrupo(entrada.nombre);
  if (!n.ok) return n;
  const p = precio(entrada.precio, "El precio de la tarifa");
  if (!p.ok) return p;
  return aceptar({ nombre: n.valor, precio: p.valor });
}

export function guardComandoEditarGrupoDePrecio(entrada: { grupoDePrecioId: unknown; versionEsperada: unknown; nombre: unknown; precio: unknown; activo: unknown }): ResultadoDato<ComandoEditarGrupoDePrecio> {
  const grupoDePrecioId = id(entrada.grupoDePrecioId, "No se encontró la tarifa.");
  if (!grupoDePrecioId.ok) return grupoDePrecioId;
  const v = version(entrada.versionEsperada, 1);
  if (!v.ok) return v;
  const n = nombreDeGrupo(entrada.nombre);
  if (!n.ok) return n;
  const p = precio(entrada.precio, "El precio de la tarifa");
  if (!p.ok) return p;
  if (typeof entrada.activo !== "boolean") return rechazar("formato", "Elegí si la tarifa queda activa o no.");
  return aceptar({ grupoDePrecioId: grupoDePrecioId.valor, versionEsperada: v.valor, nombre: n.valor, precio: p.valor, activo: entrada.activo });
}

/** El precio local de una combinación o de una tarifa en la sucursal ACTIVA: lo primero es el eco de la sucursal (la pantalla manda la que tenía cargada). */
export function guardComandoFijarPrecioLocalDeCombinacion(entrada: {
  sucursalId: unknown;
  sucursalActivaId: string;
  combinacionId?: unknown;
  grupoDePrecioId?: unknown;
  esperado: unknown;
  precio: unknown;
}): ResultadoDato<ComandoFijarPrecioLocalDeCombinacion> {
  if (entrada.sucursalId !== entrada.sucursalActivaId) return rechazar("formato", MENSAJE_SUCURSAL_CAMBIADA);
  const combinacion = idONulo(entrada.combinacionId, "No se encontró la combinación.");
  if (!combinacion.ok) return combinacion;
  const grupo = idONulo(entrada.grupoDePrecioId, "No se encontró la tarifa.");
  if (!grupo.ok) return grupo;
  if ((combinacion.valor === null) === (grupo.valor === null)) return rechazar("formato", "El precio local es de una combinación O de una tarifa.");
  let esperado: PrecioLocalDeCombinacionVisto | null = null;
  if (entrada.esperado !== null && entrada.esperado !== undefined) {
    if (typeof entrada.esperado !== "object") return rechazar("formato", "El precio que mostraba la pantalla no es válido: recargala.");
    const visto = entrada.esperado as { precio?: unknown; habilitado?: unknown };
    const p = precio(visto.precio, "El precio que mostraba la pantalla");
    if (!p.ok) return p;
    if (typeof visto.habilitado !== "boolean") return rechazar("formato", "El precio que mostraba la pantalla no es válido: recargala.");
    esperado = { precio: p.valor, habilitado: visto.habilitado };
  }
  const nuevo = precioONulo(entrada.precio, "El precio");
  if (!nuevo.ok) return nuevo;
  const objetivo = combinacion.valor !== null ? { combinacionId: combinacion.valor } : { grupoDePrecioId: grupo.valor! };
  return aceptar({ objetivo, esperado, precio: nuevo.valor });
}

function ingrediente(valor: unknown): ResultadoDato<IngredienteDeCombinacionEnComando> {
  const i = (typeof valor === "object" && valor !== null ? valor : {}) as { insumoProductoId?: unknown; cantidad?: unknown; mermaPorcentaje?: unknown };
  const insumo = id(i.insumoProductoId, "Elegí la materia prima de cada ingrediente.");
  if (!insumo.ok) return insumo;
  const c = numeroDeEntrada(i.cantidad);
  if (!c.ok || c.valor === null || !(c.valor > 0) || c.valor >= CANTIDAD_MAXIMA_DE_INGREDIENTE) return rechazar("rango", "Cada ingrediente necesita una cantidad mayor que 0.");
  if (!tieneALoSumoDecimales(c.valor, 4)) return rechazar("decimales", "La cantidad de un ingrediente admite como máximo 4 decimales.");
  const m = numeroDeEntrada(i.mermaPorcentaje ?? 0);
  if (!m.ok) return rechazar("formato", "La merma no es un número válido.");
  const merma = m.valor ?? 0;
  if (merma < 0 || merma > 100) return rechazar("rango", "La merma va de 0 a 100.");
  if (!tieneALoSumoDecimales(merma, 2)) return rechazar("decimales", "La merma admite como máximo 2 decimales.");
  return aceptar({ insumoProductoId: insumo.valor, cantidad: c.valor, mermaPorcentaje: merma });
}

export function guardComandoGuardarRecetaDeCombinacion(entrada: { combinacionId: unknown; numeroEsperado: unknown; ingredientes: unknown }): ResultadoDato<ComandoGuardarRecetaDeCombinacion> {
  const combinacionId = id(entrada.combinacionId, "No se encontró la combinación.");
  if (!combinacionId.ok) return combinacionId;
  const numero = version(entrada.numeroEsperado, 0);
  if (!numero.ok) return numero;
  if (!Array.isArray(entrada.ingredientes) || entrada.ingredientes.length > MAXIMO_INGREDIENTES_RECETA) return rechazar("formato", `La receta lleva a lo sumo ${MAXIMO_INGREDIENTES_RECETA} ingredientes.`);
  const ingredientes: IngredienteDeCombinacionEnComando[] = [];
  for (const i of entrada.ingredientes as unknown[]) {
    const r = ingrediente(i);
    if (!r.ok) return r;
    if (ingredientes.some((x) => x.insumoProductoId === r.valor.insumoProductoId)) return rechazar("formato", "Una materia prima va una sola vez en la receta: sumá las cantidades.");
    ingredientes.push(r.valor);
  }
  return aceptar({ combinacionId: combinacionId.valor, numeroEsperado: numero.valor, ingredientes });
}
