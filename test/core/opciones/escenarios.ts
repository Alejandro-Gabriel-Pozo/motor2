import type { ConsumoDeOpcionParaVender, IngredienteDeBase, OpcionConConsumo, AdicionalConConsumo } from "../../../src/core/movimientos/consumo-de-linea-configurada";
import type { OpcionParaPrecio } from "../../../src/core/opciones/componer-precio-de-linea";
import type { DiferenciaDePrecio, ModoDePrecioDeMedida, TipoDeGrupoDeOpciones } from "../../../src/core/opciones/tipos";
import type { GrupoPermitido, OpcionValidada } from "../../../src/core/opciones/validar-opciones-elegidas";

/**
 * Los tres casos del diseño (§10) escritos como DATOS, para que los usen todos los tests de GO-0b: un café con tamaño y tipo, una habitación de hotel con régimen y cama
 * extra, y un masaje de 30/60/90 con aceite. Lo único que cambia entre rubros son los datos: las funciones son las mismas.
 *
 * `permitidosDe`, `paraPrecio` y `paraConsumo` hacen de «cargador»: arman, a partir de una opción VALIDADA, lo que en producción va a armar GO-2 desde la base. Viven acá, en
 * el test, a propósito: no hay todavía ningún cargador.
 */

export interface DefinicionDeGrupo {
  grupoId: string;
  nombre: string;
  tipo: TipoDeGrupoDeOpciones;
  cantidadMinima: number;
  cantidadMaxima: number;
  orden: number;
}

export interface DefinicionDeOpcion {
  opcionId: string;
  nombre: string;
  grupoId: string;
  orden: number;
  versionId: string;
  /** Tope por producto y por opción. */
  tope?: number;
  esNinguna?: boolean;
  factorEscala?: number | null;
  modoPrecio?: ModoDePrecioDeMedida | null;
  precioAbsoluto?: number | null;
  diferencia?: DiferenciaDePrecio | null;
  consumos?: ConsumoDeOpcionParaVender[];
}

export interface Escenario {
  precioBase: number;
  sucursalId: string;
  base: IngredienteDeBase[];
  grupos: DefinicionDeGrupo[];
  opciones: DefinicionDeOpcion[];
}

export const SUCURSAL = "suc-centro";

function ingrediente(insumoProductoId: string, cantidad: number, unidadStockId: string, mermaPorcentaje = 0, insumoSustitutoIds: string[] = []): IngredienteDeBase {
  return { ingrediente: { insumoProductoId, cantidad, mermaPorcentaje, rendimientosLocales: [], insumoSustitutoIds }, unidadStockId };
}

function suma(insumoProductoId: string, cantidad: number, unidadStockId: string, escalaConLaMedida = false, mermaPorcentaje = 0): ConsumoDeOpcionParaVender {
  return { efecto: "SUMA", insumoProductoId, reemplazaAProductoId: null, cantidad, unidadStockId, mermaPorcentaje, escalaConLaMedida };
}

function reemplaza(reemplazaAProductoId: string, insumoProductoId: string, cantidad: number, unidadStockId: string, escalaConLaMedida = false): ConsumoDeOpcionParaVender {
  return { efecto: "REEMPLAZA", insumoProductoId, reemplazaAProductoId, cantidad, unidadStockId, mermaPorcentaje: 0, escalaConLaMedida };
}

/**
 * CAFÉ. Base: café en grano 10 g, leche 60 ml (con 5 % de merma y un sustituto declarado) y un vaso chico. Tamaño con precio propio (absoluto); el vaso no se multiplica,
 * se REEMPLAZA. Cortado reemplaza la leche; «con leche» suma leche (y esa sí escala con el tamaño); «sin lactosa» reemplaza la leche y cobra un porcentaje del precio base.
 */
export const CAFE: Escenario = {
  precioBase: 3000,
  sucursalId: SUCURSAL,
  base: [ingrediente("mp-grano", 10, "u-g"), ingrediente("mp-leche", 60, "u-ml", 5, ["mp-leche-deslactosada"]), ingrediente("mp-vaso-chico", 1, "u-u")],
  grupos: [
    { grupoId: "g-tamano", nombre: "Tamaño", tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, orden: 0 },
    { grupoId: "g-tipo", nombre: "Tipo", tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1, orden: 1 },
    { grupoId: "g-extras", nombre: "Extras", tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 2, orden: 2 },
  ],
  opciones: [
    { opcionId: "o-chico", nombre: "Chico", grupoId: "g-tamano", orden: 0, versionId: "v-chico-1", factorEscala: 1, modoPrecio: "ABSOLUTO", precioAbsoluto: 2800 },
    {
      opcionId: "o-mediano",
      nombre: "Mediano",
      grupoId: "g-tamano",
      orden: 1,
      versionId: "v-mediano-1",
      factorEscala: 1.5,
      modoPrecio: "ABSOLUTO",
      precioAbsoluto: 3400,
      consumos: [reemplaza("mp-vaso-chico", "mp-vaso-mediano", 1, "u-u")],
    },
    {
      opcionId: "o-grande",
      nombre: "Grande",
      grupoId: "g-tamano",
      orden: 2,
      versionId: "v-grande-1",
      factorEscala: 2,
      modoPrecio: "ABSOLUTO",
      precioAbsoluto: 4000,
      consumos: [reemplaza("mp-vaso-chico", "mp-vaso-grande", 1, "u-u")],
    },
    { opcionId: "o-cortado", nombre: "Cortado", grupoId: "g-tipo", orden: 0, versionId: "v-cortado-1", diferencia: { tipo: "MONTO", monto: 0 }, consumos: [reemplaza("mp-leche", "mp-leche", 30, "u-ml")] },
    {
      opcionId: "o-con-leche",
      nombre: "Con leche",
      grupoId: "g-tipo",
      orden: 1,
      versionId: "v-con-leche-1",
      diferencia: { tipo: "MONTO", monto: 300 },
      consumos: [suma("mp-leche", 100, "u-ml", true)],
    },
    {
      opcionId: "o-sin-lactosa",
      nombre: "Sin lactosa",
      grupoId: "g-tipo",
      orden: 2,
      versionId: "v-sin-lactosa-1",
      diferencia: { tipo: "PORCENTAJE", porcentaje: 8.5 },
      consumos: [reemplaza("mp-leche", "mp-leche-vegetal", 60, "u-ml", true)],
    },
    { opcionId: "o-shot", nombre: "Shot extra", grupoId: "g-extras", orden: 0, versionId: "v-shot-1", tope: 2, diferencia: { tipo: "MONTO", monto: 500 }, consumos: [suma("mp-grano", 9, "u-g")] },
  ],
};

/**
 * HOTEL. Una noche en habitación doble. Régimen (variante obligatoria), tipo de cama (incluida, $0) y adicionales: cama extra (tope 1) y desayuno extra (tope 4).
 * El «Noche» se pide en cantidad (noches); los adicionales cuelgan de la cantidad de noches.
 */
export const HOTEL: Escenario = {
  precioBase: 100000,
  sucursalId: SUCURSAL,
  base: [ingrediente("mp-kit-de-limpieza", 1, "u-u")],
  grupos: [
    { grupoId: "g-regimen", nombre: "Régimen", tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1, orden: 0 },
    { grupoId: "g-cama", nombre: "Tipo de cama", tipo: "INCLUIDA", cantidadMinima: 1, cantidadMaxima: 1, orden: 1 },
    { grupoId: "g-adicionales", nombre: "Adicionales", tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 5, orden: 2 },
  ],
  opciones: [
    { opcionId: "o-solo-alojamiento", nombre: "Solo alojamiento", grupoId: "g-regimen", orden: 0, versionId: "v-solo-1", diferencia: { tipo: "MONTO", monto: 0 } },
    {
      opcionId: "o-con-desayuno",
      nombre: "Con desayuno",
      grupoId: "g-regimen",
      orden: 1,
      versionId: "v-desayuno-1",
      diferencia: { tipo: "MONTO", monto: 8000 },
      consumos: [suma("mp-desayuno", 2, "u-u")],
    },
    { opcionId: "o-matrimonial", nombre: "Cama matrimonial", grupoId: "g-cama", orden: 0, versionId: "v-matrimonial-1", consumos: [suma("mp-juego-de-sabanas", 1, "u-u")] },
    { opcionId: "o-dos-camas", nombre: "Dos camas", grupoId: "g-cama", orden: 1, versionId: "v-dos-camas-1", consumos: [suma("mp-juego-de-sabanas", 2, "u-u")] },
    {
      opcionId: "o-cama-extra",
      nombre: "Cama extra",
      grupoId: "g-adicionales",
      orden: 0,
      versionId: "v-cama-extra-1",
      tope: 1,
      diferencia: { tipo: "MONTO", monto: 15000 },
      consumos: [suma("mp-juego-de-sabanas", 1, "u-u"), suma("mp-toalla", 2, "u-u")],
    },
    {
      opcionId: "o-desayuno-extra",
      nombre: "Desayuno extra",
      grupoId: "g-adicionales",
      orden: 1,
      versionId: "v-desayuno-extra-1",
      tope: 4,
      diferencia: { tipo: "MONTO", monto: 5000 },
      consumos: [suma("mp-desayuno", 1, "u-u")],
    },
  ],
};

/**
 * SPA. Un masaje: la duración (30/60/90 minutos) fija el precio y ESCALA el aceite; el aceite premium REEMPLAZA al estándar (y escala) y cobra un porcentaje del precio base;
 * el aroma es una guarnición incluida ($0) que suma la esencia; las piedras calientes son un adicional (tope 1).
 */
export const SPA: Escenario = {
  precioBase: 20000,
  sucursalId: SUCURSAL,
  base: [ingrediente("mp-aceite-estandar", 30, "u-ml")],
  grupos: [
    { grupoId: "g-duracion", nombre: "Duración", tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, orden: 0 },
    { grupoId: "g-aceite", nombre: "Aceite", tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1, orden: 1 },
    { grupoId: "g-aroma", nombre: "Aroma", tipo: "INCLUIDA", cantidadMinima: 1, cantidadMaxima: 1, orden: 2 },
    { grupoId: "g-extras-spa", nombre: "Extras", tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 1, orden: 3 },
  ],
  opciones: [
    { opcionId: "o-30", nombre: "30 minutos", grupoId: "g-duracion", orden: 0, versionId: "v-30-1", factorEscala: 0.5, modoPrecio: "ABSOLUTO", precioAbsoluto: 12000 },
    { opcionId: "o-60", nombre: "60 minutos", grupoId: "g-duracion", orden: 1, versionId: "v-60-1", factorEscala: 1, modoPrecio: "ABSOLUTO", precioAbsoluto: 20000 },
    { opcionId: "o-90", nombre: "90 minutos", grupoId: "g-duracion", orden: 2, versionId: "v-90-1", factorEscala: 1.5, modoPrecio: "ABSOLUTO", precioAbsoluto: 27000 },
    {
      opcionId: "o-aceite-premium",
      nombre: "Aceite premium",
      grupoId: "g-aceite",
      orden: 0,
      versionId: "v-premium-1",
      diferencia: { tipo: "PORCENTAJE", porcentaje: 12.5 },
      consumos: [reemplaza("mp-aceite-estandar", "mp-aceite-premium", 30, "u-ml", true)],
    },
    { opcionId: "o-lavanda", nombre: "Lavanda", grupoId: "g-aroma", orden: 0, versionId: "v-lavanda-1", consumos: [suma("mp-esencia-lavanda", 2, "u-ml")] },
    { opcionId: "o-eucalipto", nombre: "Eucalipto", grupoId: "g-aroma", orden: 1, versionId: "v-eucalipto-1", consumos: [suma("mp-esencia-eucalipto", 2, "u-ml")] },
    {
      opcionId: "o-piedras",
      nombre: "Piedras calientes",
      grupoId: "g-extras-spa",
      orden: 0,
      versionId: "v-piedras-1",
      tope: 1,
      diferencia: { tipo: "MONTO", monto: 4000 },
      consumos: [suma("mp-gel-caliente", 1, "u-u")],
    },
  ],
};

/** La lista de permitidos del producto, sin nada apagado. `ajustar` deja cambiar un grupo o una opción para armar los casos de apagado. */
export function permitidosDe(
  escenario: Escenario,
  ajustar: { grupo?: (g: GrupoPermitido) => GrupoPermitido; opcion?: (o: GrupoPermitido["opciones"][number], g: GrupoPermitido) => GrupoPermitido["opciones"][number] } = {}
): GrupoPermitido[] {
  return [...escenario.grupos]
    .sort((a, b) => a.orden - b.orden)
    .map((def) => {
      const grupo: GrupoPermitido = {
        grupoId: def.grupoId,
        nombre: def.nombre,
        tipo: def.tipo,
        activo: true,
        admitido: true,
        cantidadMinima: def.cantidadMinima,
        cantidadMaxima: def.cantidadMaxima,
        opciones: escenario.opciones
          .filter((o) => o.grupoId === def.grupoId)
          .sort((a, b) => a.orden - b.orden)
          .map((o) => ({
            opcionId: o.opcionId,
            nombre: o.nombre,
            activa: true,
            admitida: true,
            apagadaEnSucursal: false,
            cantidadMaxima: o.tope ?? 1,
            versionVigenteId: o.versionId,
            esNinguna: o.esNinguna ?? false,
          })),
      };
      const conOpciones = ajustar.opcion ? { ...grupo, opciones: grupo.opciones.map((o) => ajustar.opcion!(o, grupo)) } : grupo;
      return ajustar.grupo ? ajustar.grupo(conOpciones) : conOpciones;
    });
}

function definicion(escenario: Escenario, opcionId: string): DefinicionDeOpcion {
  const def = escenario.opciones.find((o) => o.opcionId === opcionId);
  if (!def) throw new Error(`El escenario no tiene la opción ${opcionId}`);
  return def;
}

/** Lo que el compositor necesita de cada opción validada. */
export function paraPrecio(escenario: Escenario, validadas: readonly OpcionValidada[]): OpcionParaPrecio[] {
  return validadas.map((v) => {
    const def = definicion(escenario, v.opcionId);
    return {
      opcionId: v.opcionId,
      versionDeOpcionId: v.versionDeOpcionId,
      nombre: v.nombreOpcion,
      tipo: v.tipo,
      cantidad: v.cantidad,
      factorEscala: def.factorEscala ?? null,
      modoPrecio: def.modoPrecio ?? null,
      precioAbsoluto: def.precioAbsoluto ?? null,
      diferencia: def.diferencia ?? null,
    };
  });
}

/** Lo que el consumo necesita de cada opción validada: las de dentro del precio y los adicionales por separado. */
export function paraConsumo(escenario: Escenario, validadas: readonly OpcionValidada[]): { opciones: OpcionConConsumo[]; adicionales: AdicionalConConsumo[] } {
  const opciones: OpcionConConsumo[] = [];
  const adicionales: AdicionalConConsumo[] = [];
  for (const v of validadas) {
    const def = definicion(escenario, v.opcionId);
    const grupo = escenario.grupos.find((g) => g.grupoId === v.grupoId)!;
    if (v.tipo === "ADICIONAL") {
      adicionales.push({ opcionId: v.opcionId, nombre: v.nombreOpcion, cantidadPorUnidad: v.cantidad, consumos: def.consumos ?? [] });
    } else {
      opciones.push({
        opcionId: v.opcionId,
        nombre: v.nombreOpcion,
        tipo: v.tipo,
        ordenDeGrupo: grupo.orden,
        ordenDeOpcion: def.orden,
        cantidad: v.cantidad,
        factorEscala: def.factorEscala ?? null,
        consumos: def.consumos ?? [],
      });
    }
  }
  return { opciones, adicionales };
}
