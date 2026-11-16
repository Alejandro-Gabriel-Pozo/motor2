/**
 * «Ocultar» un producto, como Pedernal (docs/diseno-ocultar-como-pedernal-2026-11-15.md, etapa E2): el NÚCLEO PURO de la decisión.
 * Sin Prisma, sin reloj, sin azar: recibe los hechos y devuelve qué pasa. Todavía NO está conectado a ninguna pantalla ni acción (eso
 * es E3 en adelante, con su tabla `OcultamientoProducto`); existe para fijar la regla en un solo lugar y recorrerla entera contra el
 * oráculo escrito aparte (`test/catalogo/ocultar-producto-oraculo.ts`).
 *
 * Dos marcas INDEPENDIENTES (diseño, O-1; I-1): «Desactivar» (la `DisponibilidadProducto` de hoy: activo / desactivado) y «Ocultar»
 * (nueva: sin marca = visible). Las cuatro combinaciones existen. Ocultar y Desactivar no se pisan.
 *
 * Todo nace cerrado (AGENTS.md, 2026-11-11): lo permitido se declara por operación; una operación que esta función no conoce NO
 * está permitida (el `default` de cada `switch` falla de tipo y, si llegara un valor ajeno en ejecución, rechaza).
 *
 * Saldo (dimensión D3): es el saldo que el producto TENDRÍA DESPUÉS de la operación (diseño I-5, «suma es suma»: se rechaza lo que
 * deja el saldo por encima de cero; restar y corregir un negativo hasta cero se permiten). Para las operaciones que no mueven stock
 * (ocultar, desactivar, contar, carta, selector) es el saldo actual.
 *
 * Idempotencia y concurrencia: la función es pura, así que repetirla no cambia nada y no hay carrera dentro de ella. El «ya estaba»
 * (fijar el estado en el que ya está) y el bloqueo del producto (`FOR UPDATE` / `FOR SHARE`) los resuelve la acción de E3/E5.
 */

/** D1. Desactivar (`DisponibilidadProducto`): «sin fila» y `disponible = false` son lo mismo → `desactivado`. */
export type EstadoDesactivar = "activo" | "desactivado";

/** D2. Ocultar, tal como llegan las dos marcas: la de la empresa y la del local. Sin marca = `false`. */
export interface MarcasDeOcultar {
  readonly empresa: boolean;
  readonly local: boolean;
}

/** D3. Saldo (ver el encabezado). */
export type Saldo = "cero" | "positivo" | "negativo";

/** D7. Quién pide una operación de administración. */
export type Quien = "operador_de_este_local" | "operador_de_otro_local" | "admin_alcance_total" | "sin_permiso";

/** Alcance de un ocultar / volver a mostrar. */
export type AlcanceDeOcultar = "local" | "empresa";

/** D6. Operaciones que miran los dos estados. Las de administración (que además piden permiso) van aparte. */
export const OPERACIONES_DE_PRODUCTO = [
  "agregar_linea_salon",
  "agregar_linea_cuenta_mostrador",
  "venta_directa_mostrador",
  "cobrar_linea_ya_cargada",
  "anular_venta",
  "entrada_que_suma",
  "salida_que_resta",
  "corregir_negativo_hasta_cero",
  "contar",
  "carta_publica",
  "selector_pos",
] as const;
export type OperacionDeProducto = (typeof OPERACIONES_DE_PRODUCTO)[number];

export const OPERACIONES_DE_ADMINISTRACION = ["ocultar", "mostrar", "desactivar", "activar"] as const;
export type OperacionDeAdministracion = (typeof OPERACIONES_DE_ADMINISTRACION)[number];

/** Los hechos del producto que cuentan para decidir (D1, D2, D3, D4, D5). */
export interface HechosDelProducto {
  readonly desactivar: EstadoDesactivar;
  readonly ocultar: MarcasDeOcultar;
  readonly saldo: Saldo;
  /** D4. Un conteo registrado sin resolver. NO se usa todavía (diseño §4.6 y decisión técnica 9: no se implementa hasta verificar qué es `EstadoConteo.PENDIENTE`); está declarado para que el guardián lo vea. */
  readonly conteoSinResolver: boolean;
  /** D5. El producto está en la receta vigente de un plato disponible. */
  readonly enRecetaVigente: boolean;
}

export type EntradaDeDecision =
  | { readonly hechos: HechosDelProducto; readonly operacion: OperacionDeProducto }
  | {
      readonly hechos: HechosDelProducto;
      readonly operacion: OperacionDeAdministracion;
      readonly quien: Quien;
      /** Solo ocultar y mostrar tienen alcance de empresa; desactivar y activar son siempre del local activo. */
      readonly alcance: AlcanceDeOcultar;
    };

/** Motivos cerrados. Cada uno corresponde a un mensaje que decidirán las etapas que conecten el núcleo. */
export const MOTIVOS_DE_RECHAZO = [
  "PRODUCTO_DESACTIVADO",
  "PRODUCTO_OCULTO",
  "TIENE_EXISTENCIA",
  "EN_RECETA_VIGENTE",
  "SIN_PERMISO",
  "FUERA_DE_ALCANCE",
  "EMPRESA_LO_OCULTA",
] as const;
export type MotivoDeRechazo = (typeof MOTIVOS_DE_RECHAZO)[number];

export type Decision = { readonly ok: true } | { readonly ok: false; readonly motivo: MotivoDeRechazo };

const PERMITIDO: Decision = { ok: true };
const rechazo = (motivo: MotivoDeRechazo): Decision => ({ ok: false, motivo });

/**
 * Oculto en la sucursal S = hay marca de la empresa con `oculto` O marca del local con `oculto` (I-3). La empresa gana: es la que
 * impide «mostrar» desde el local. Recibe las filas del producto (las de otros locales no cuentan aunque lleguen); `sucursalId`
 * nulo en una fila = toda la empresa. Igual que `ocultoPor` de Pedernal (`src/modulos/catalogo/dominio/carta-publica.ts`).
 */
export function ocultoPor(filas: readonly { readonly sucursalId: string | null; readonly oculto: boolean }[], sucursalId: string): "EMPRESA" | "SUCURSAL" | null {
  if (filas.some((f) => f.oculto && f.sucursalId === null)) return "EMPRESA";
  if (filas.some((f) => f.oculto && f.sucursalId === sucursalId)) return "SUCURSAL";
  return null;
}

/** Las marcas efectivas de una sucursal, en la forma que usa `decidirSobreProducto`. */
export function marcasDeOcultar(filas: readonly { readonly sucursalId: string | null; readonly oculto: boolean }[], sucursalId: string): MarcasDeOcultar {
  return {
    empresa: filas.some((f) => f.oculto && f.sucursalId === null),
    local: filas.some((f) => f.oculto && f.sucursalId === sucursalId),
  };
}

const estaOculto = (m: MarcasDeOcultar): boolean => m.empresa || m.local;

/** Permiso y alcance de ocultar / mostrar (CU-1 a CU-3; O-10: la empresa, solo administración; el operador, solo en su local). */
function permisoDeOcultar(quien: Quien, alcance: AlcanceDeOcultar): Decision {
  if (quien === "sin_permiso") return rechazo("SIN_PERMISO");
  if (alcance === "empresa") return quien === "admin_alcance_total" ? PERMITIDO : rechazo("SIN_PERMISO");
  return quien === "operador_de_otro_local" ? rechazo("FUERA_DE_ALCANCE") : PERMITIDO;
}

/** Permiso y alcance de desactivar / activar (`producto_disponibilidad`, hoy): solo el local activo. */
function permisoDeDesactivar(quien: Quien): Decision {
  if (quien === "sin_permiso") return rechazo("SIN_PERMISO");
  return quien === "operador_de_otro_local" ? rechazo("FUERA_DE_ALCANCE") : PERMITIDO;
}

function decidirAdministracion(hechos: HechosDelProducto, operacion: OperacionDeAdministracion, quien: Quien, alcance: AlcanceDeOcultar): Decision {
  switch (operacion) {
    case "ocultar": {
      const permiso = permisoDeOcultar(quien, alcance);
      if (!permiso.ok) return permiso;
      // R-11 / R-12; R-17: Ocultar NO mira recetas ni Desactivar. Cualquier saldo distinto de cero (también el negativo) lo impide.
      return hechos.saldo === "cero" ? PERMITIDO : rechazo("TIENE_EXISTENCIA");
    }
    case "mostrar": {
      const permiso = permisoDeOcultar(quien, alcance);
      if (!permiso.ok) return permiso;
      // R-15: sin más condiciones, salvo que un local no puede mostrar lo que la empresa oculta.
      return alcance === "local" && hechos.ocultar.empresa ? rechazo("EMPRESA_LO_OCULTA") : PERMITIDO;
    }
    case "desactivar": {
      const permiso = permisoDeDesactivar(quien);
      if (!permiso.ok) return permiso;
      // R-16 (como hoy, no cambia): receta vigente o saldo lo bloquean. Si hay las dos, el motivo es el primero que lista hoy `actualizarDisponibilidadProducto` (la receta).
      if (hechos.enRecetaVigente) return rechazo("EN_RECETA_VIGENTE");
      return hechos.saldo === "cero" ? PERMITIDO : rechazo("TIENE_EXISTENCIA");
    }
    case "activar":
      return permisoDeDesactivar(quien);
    default:
      return rechazo("SIN_PERMISO"); // todo nace cerrado: lo que no se declara, no se permite
  }
}

function decidirDeProducto(hechos: HechosDelProducto, operacion: OperacionDeProducto): Decision {
  const desactivado = hechos.desactivar === "desactivado";
  const oculto = estaOculto(hechos.ocultar);
  switch (operacion) {
    case "carta_publica":
    case "selector_pos": // R-1 / R-2: aparece solo si está activo Y no está oculto
    case "agregar_linea_salon":
    case "agregar_linea_cuenta_mostrador":
    case "venta_directa_mostrador": // R-3 / R-4: una línea NUEVA; el desactivado gana sobre el oculto (decisión técnica 7)
    case "contar": // R-10
      if (desactivado) return rechazo("PRODUCTO_DESACTIVADO");
      return oculto ? rechazo("PRODUCTO_OCULTO") : PERMITIDO;
    case "cobrar_linea_ya_cargada": // R-5: lo ya cargado se cobra aunque esté oculto; Desactivar sigue rechazando como hoy
      return desactivado ? rechazo("PRODUCTO_DESACTIVADO") : PERMITIDO;
    case "anular_venta": // R-8 / R-9: solo el oculto con saldo final por encima de cero se rechaza; el desactivado se permite (O-11)
      return oculto && hechos.saldo === "positivo" ? rechazo("PRODUCTO_OCULTO") : PERMITIDO;
    case "entrada_que_suma": // R-6: suma = deja el saldo final por encima de cero
      if (desactivado) return rechazo("PRODUCTO_DESACTIVADO");
      return oculto && hechos.saldo === "positivo" ? rechazo("PRODUCTO_OCULTO") : PERMITIDO;
    case "salida_que_resta": // R-7
    case "corregir_negativo_hasta_cero": // R-7
      return desactivado ? rechazo("PRODUCTO_DESACTIVADO") : PERMITIDO;
    default:
      return rechazo("PRODUCTO_OCULTO"); // todo nace cerrado
  }
}

/** La decisión sobre un producto en una operación. Pura y total: toda combinación da una respuesta. */
export function decidirSobreProducto(entrada: EntradaDeDecision): Decision {
  if ((OPERACIONES_DE_ADMINISTRACION as readonly string[]).includes(entrada.operacion)) {
    if (!("quien" in entrada)) return rechazo("SIN_PERMISO"); // una operación de administración sin quién: cierra
    return decidirAdministracion(entrada.hechos, entrada.operacion as OperacionDeAdministracion, entrada.quien, entrada.alcance);
  }
  return decidirDeProducto(entrada.hechos, entrada.operacion as OperacionDeProducto);
}

/**
 * ¿Quien pide es «administración con alcance total» (O-10: «Solo administración»), o sea, puede ocultar un producto en TODA la empresa? UNA sola definición, fácil de cambiar: hoy es
 * administrador (por la clave de su rol) en TODAS las sucursales activas de la empresa; si falta una sola, o no hay ninguna, no. La acción (etapa d) la calcula con las membresías de la sesión y
 * las sucursales activas de la empresa y le pasa el resultado al caso de uso (`puedeEnLaEmpresa`). DEFINICIÓN PENDIENTE DE CONFIRMAR POR EL DUEÑO (la consulta el orquestador): cambia permisos.
 */
export function esAdministracionConAlcanceTotal(membresias: readonly { readonly sucursalId: string; readonly esAdmin: boolean }[], sucursalesActivasDeLaEmpresa: readonly string[]): boolean {
  if (sucursalesActivasDeLaEmpresa.length === 0) return false;
  const admin = new Set(membresias.filter((m) => m.esAdmin).map((m) => m.sucursalId));
  return sucursalesActivasDeLaEmpresa.every((id) => admin.has(id));
}
