import { describe, expect, it } from "vitest";
import { ACCIONES, type AccionClave, type NivelDeAccion } from "../../src/core/permisos/acciones";

/**
 * GT-26 (tanda T14 del plan de endurecimiento de seguridad; plan 1.4, decisión 22 del dueño, fila O.99c de `docs/pureza-integracion.md`): LAS CLASES DE CLAVES. **No cambia la matriz ni ningún
 * piso o semilla: solo DECLARA** en qué clase cae cada clave del catálogo, en una lista cerrada que se verifica en las dos direcciones. Si una clave cambia de piso o de semilla, o aparece una
 * nueva, la clase que se deduce de sus datos ya no coincide con la declarada y el test falla hasta que alguien lo decida a propósito y lo deje escrito.
 *
 * Las clases:
 *  - **G, gobierno** —usuarios, roles, permisos, sucursales, capacidades y auditoría—: piso «administrador de sistema» (12 claves) o «gerente» (2), INMUTABLE (nunca se baja: lo fija además
 *    `GOBIERNO` con el piso exacto de cada una). Semilla: solo `admin`, o ninguna las de gerente.
 *  - **O, operativas sensibles**: piso «operario» y semilla SOLO `admin`. Ningún rol de fábrica distinto del `admin` la tiene al nacer la empresa, y el gerente la delega por configuración
 *    a cualquier rol propio (un «encargado») sin tocar el piso. Hoy: los reportes de piso operario que se siembran cerrados, las 11 `pos_*`, `receta_sucursal_editar` y
 *    `producto_sincronizar_precio_carta` (S-41). La clave fina `producto_campos_sensibles` (M.2, fuera de la rama) entrará acá.
 *  - **L, libres**: piso «operario» y semilla `admin` y `operador`: lo operativo de todos los días.
 *  - **A, de piso administrador**: hoy solo la alcanza el rol `admin` (no existe `Rol.nivel`: todo otro rol es «operario» frente al piso) y no se puede delegar. Son las CANDIDATAS a pasar a O que el
 *    plan (1.4) deja como decisión del dueño POR FAMILIA (precio, stock, anulaciones, dinero, carta, recetas, reportes de dinero); nada de eso se ejecuta por defecto. Se declaran para que subir
 *    o bajar una de piso, o pasarla a O, sea una decisión a la vista.
 *
 * Lo que fija, por clase: (1) cada clave del catálogo está declarada en UNA clase y las declaradas existen; (2) la clase declarada es la que sus datos dicen (piso y semilla); (3) las 14 de
 * gobierno conservan su piso exacto; (4) las claves de piso operario con semilla solo `admin` son exactamente las de la clase O (una clave nueva de ese tipo declara su clase).
 *
 * Mutaciones (cada una pone un caso en rojo): bajar `gestion_permisos` a «administrador»; una clave nueva sin clase; sembrar `producto_sincronizar_precio_carta` también al `operador` (deja de ser O);
 * subir `reporte_historial` a «administrador» (deja de ser O).
 */

type Clase = "G" | "O" | "L" | "A";

const G = [
  "gestion_usuarios",
  "activar_usuario_sucursal",
  "notas_usuario_sucursal",
  "apagar_cuenta_empresa",
  "gestion_permisos",
  "gestion_roles",
  "renombrar_rol",
  "capacidades_sucursal",
  "alta_sucursal",
  "activar_sucursal",
  "renombrar_sucursal",
  "ver_auditoria",
  "ver_auditoria_empresa",
  "traspasar_gerencia",
] as const satisfies readonly AccionClave[];

/** El piso EXACTO de cada clave de gobierno: no baja nunca. */
const GOBIERNO: Readonly<Record<(typeof G)[number], NivelDeAccion>> = {
  gestion_usuarios: "administrador_sistema",
  activar_usuario_sucursal: "administrador_sistema",
  notas_usuario_sucursal: "administrador_sistema",
  apagar_cuenta_empresa: "administrador_sistema",
  gestion_permisos: "administrador_sistema",
  gestion_roles: "administrador_sistema",
  renombrar_rol: "administrador_sistema",
  capacidades_sucursal: "administrador_sistema",
  alta_sucursal: "administrador_sistema",
  activar_sucursal: "administrador_sistema",
  renombrar_sucursal: "administrador_sistema",
  ver_auditoria: "administrador_sistema",
  ver_auditoria_empresa: "gerente",
  traspasar_gerencia: "gerente",
};

const O = [
  "reporte_vencimientos",
  "reporte_salud",
  "reporte_historial",
  "reporte_trazabilidad",
  "reporte_rotacion_mesas",
  "pos_mesas",
  "pos_tomar_pedido",
  "pos_anular_item",
  "pos_cerrar_cuenta",
  "receta_sucursal_editar",
  "pos_asignar_cliente",
  "pos_emitir_ticket_corregido",
  "producto_sincronizar_precio_carta",
  "pos_alta_mesa",
  "pos_limite_mesas_abiertas",
  "pos_abrir_cuenta",
  "pos_enviar_a_cocina",
  "pos_liberar_mesa",
] as const satisfies readonly AccionClave[];

const L = [
  "alta_producto",
  "producto_editar",
  "ver_stock",
  "proceso_compra",
  "proceso_produccion",
  "proceso_consumo",
  "proceso_control",
  "proceso_transferencia",
  "proceso_merma",
  "proceso_venta",
  "proceso_devolucion_consignacion",
  "proceso_devolucion_cliente",
  "proceso_devolucion_proveedor",
  "traspaso_ver_bandeja",
  "traspaso_solicitar",
  "traspaso_enviar_directo",
  "traspaso_aprobar",
  "traspaso_cancelar_solicitud",
  "traspaso_rechazar_solicitud",
  "traspaso_aceptar",
  "traspaso_rechazar_envio",
  "traspaso_confirmar_reingreso",
  "reporte_conteos",
  "conteo_resolver_pendiente",
  "stock_reclasificar",
  "conteo_frecuencia",
  "producto_ver_catalogo",
  "producto_presentaciones",
  "insumo_alta",
  "categoria_alta",
  "proveedor_alta",
  "producto_asignar_insumo",
  "producto_disponibilidad",
] as const satisfies readonly AccionClave[];

const A = [
  "guardar_receta",
  "grupos_familia",
  "secciones",
  "unidades",
  "proveedores",
  "categorias",
  "margen_objetivo_editar",
  "motivos_merma",
  "motivos_destino_consumo",
  "carta_ver",
  "carta_secciones",
  "carta_generos",
  "carta_contenido_producto",
  "carta_producto_descuento",
  "carta_items_agrupados",
  "carta_portal",
  "carta_promo_definir",
  "carta_promo_activar",
  "carta_promo_precio_local",
  "carta_tema",
  "stock_minimo",
  "precio_local",
  "comparar_precios",
  "notificar_alertas",
  "insumos_mezclados",
  "proceso_ajuste",
  "cancelar_conteo",
  "anular_venta",
  "anular_compra",
  "corregir_compra",
  "pagar_consignante",
  "reporte_resumen",
  "reporte_consolidado",
  "reporte_periodo",
  "reporte_categorias",
  "reporte_ventas_por_seccion",
  "reporte_costos",
  "reporte_compras",
  "reporte_rendimiento_recetas",
  "reporte_rendimiento_sucursal",
  "reporte_valuacion",
  "reporte_tickets",
  "reporte_descuentos_clientes",
  "reporte_descuentos_productos",
  "reporte_margen_promociones",
  "reporte_historial_importes",
  "reporte_perdidas",
  "reporte_devoluciones",
  "reporte_diferencias",
  "reporte_sin_receta",
  "reporte_insumos_sin_receta",
  "reporte_huecos_catalogo",
  "calibrar_rendimiento_local",
  "receta_sucursal_copiar",
  "receta_sucursal_volver_central",
  "carta_copiar_de_sucursal",
  "clientes",
  "stock_seccion_habitual",
  "insumo_renombrar_fusionar",
] as const satisfies readonly AccionClave[];

const DECLARADAS: Readonly<Record<Clase, readonly string[]>> = { G, O, L, A };

/** La clase que dicen los DATOS de la clave (piso y semilla). `undefined` = no encaja en ninguna (una combinación nueva que hay que decidir). */
function claseDeducida(piso: NivelDeAccion, semilla: readonly string[]): Clase | undefined {
  if (piso === "administrador_sistema" || piso === "gerente") return "G";
  if (piso === "administrador") return "A";
  const s = [...semilla].sort().join(",");
  if (s === "admin") return "O";
  if (s === "admin,operador") return "L";
  return undefined;
}

describe("GT-26 — las clases de claves (G gobierno, O operativas sensibles, L libres, A de piso administrador)", () => {
  const declaradaDe = new Map<string, Clase>();
  for (const [clase, claves] of Object.entries(DECLARADAS) as [Clase, readonly string[]][]) for (const c of claves) declaradaDe.set(c, clase);

  it("sanidad: las cuatro clases suman todo el catálogo y cada clave está en UNA sola", () => {
    const todas = [...G, ...O, ...L, ...A];
    expect(new Set(todas).size, "una clave declarada en dos clases").toBe(todas.length);
    expect(todas.length).toBe(ACCIONES.length);
    expect([G.length, O.length, L.length, A.length]).toEqual([14, 18, 33, 59]);
  });

  it("toda clave del catálogo declara su clase, y toda clase declarada existe en el catálogo (las dos direcciones)", () => {
    const delCatalogo = new Set<string>(ACCIONES.map((a) => a.clave));
    expect(ACCIONES.map((a) => a.clave).filter((c) => !declaradaDe.has(c)), "una clave nueva declara su clase acá (G, O, L o A)").toEqual([]);
    expect([...declaradaDe.keys()].filter((c) => !delCatalogo.has(c)), "una clave declarada que ya no existe sale de la lista").toEqual([]);
  });

  it("la clase declarada es la que dicen el piso y la semilla de la clave", () => {
    const desparejas = ACCIONES.flatMap((a) => {
      const deducida = claseDeducida(a.nivelMinimo, a.rolesEditarSemilla);
      const declarada = declaradaDe.get(a.clave);
      return deducida === declarada ? [] : [`${a.clave}: declarada ${declarada}, pero su piso «${a.nivelMinimo}» y su semilla [${a.rolesEditarSemilla.join(", ")}] dicen ${deducida ?? "ninguna"}`];
    });
    expect(desparejas, "cambiar el piso o la semilla de una clave es cambiar su clase: decidilo a propósito y actualizá la lista").toEqual([]);
  });

  it("las 14 claves de gobierno conservan su piso exacto (inmutable: nunca se baja)", () => {
    for (const clave of G) {
      const accion = ACCIONES.find((a) => a.clave === clave)!;
      expect(accion.nivelMinimo, `${clave}: el piso de gobierno no baja`).toBe(GOBIERNO[clave]);
    }
    expect(Object.keys(GOBIERNO).sort()).toEqual([...G].sort());
    // la semilla de gobierno: solo `admin`, o ninguna (las de gerente se las queda el gerente)
    for (const clave of G) {
      const semilla = ACCIONES.find((a) => a.clave === clave)!.rolesEditarSemilla;
      expect(semilla.every((r) => r === "admin"), `${clave}: la semilla de gobierno es solo admin`).toBe(true);
    }
  });

  it("toda clave de piso operario con semilla SOLO admin es de la clase O (y al revés): la clase delegable por configuración está a la vista", () => {
    const deLosDatos = ACCIONES.filter((a) => a.nivelMinimo === "operario" && a.rolesEditarSemilla.length === 1 && a.rolesEditarSemilla[0] === "admin").map((a) => a.clave).sort();
    expect(deLosDatos).toEqual([...O].sort());
  });

  it("el detector de clase distingue las cuatro y rechaza lo que no encaja (casos sintéticos)", () => {
    expect(claseDeducida("administrador_sistema", ["admin"])).toBe("G");
    expect(claseDeducida("gerente", [])).toBe("G");
    expect(claseDeducida("administrador", ["admin"])).toBe("A");
    expect(claseDeducida("operario", ["admin"])).toBe("O");
    expect(claseDeducida("operario", ["operador", "admin"])).toBe("L");
    expect(claseDeducida("operario", ["operador"])).toBeUndefined();
    expect(claseDeducida("operario", [])).toBeUndefined();
  });
});
