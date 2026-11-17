import { describe, expect, it } from "vitest";
import { ACCIONES, ACCIONES_QUE_DA_SOLO_EL_GERENTE, ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE, nivelMinimoDeAccion, type AccionClave, type NivelDeAccion } from "../../src/core/permisos/acciones";
import { etiquetaDelPiso, nivelAlcanzaElPiso, nivelDelRolFrenteAlPiso, rolAlcanzaLaAccion } from "../../src/core/permisos/jerarquia";
import { esCeldaFueraDeNivel } from "../../src/core/permisos/matriz";

/**
 * ADR-027 (Hito 3, trabajo 3.4, F1 del RBAC): el piso «administrador de sistema» y la escalera de cuatro rangos de los pisos de una acción,
 * operario < administrador < administrador de sistema < gerente. Puro: sin base.
 *
 * Lo que este archivo fija:
 *  - la tabla 4×4 de `nivelAlcanzaElPiso` (quién llega a qué piso), escrita a mano y no derivada del código: invertir dos rangos la pone en rojo;
 *  - que el rango 2 («administrador», el futuro «encargado» de F3) NO alcanza el piso de gobierno: es la razón de ser del escalón nuevo (D16);
 *  - quién es administrador de sistema hoy: el rol de clave «admin», y nadie más (ningún rol tiene rango 2 hasta que exista `Rol.nivel`);
 *  - las etiquetas que muestran la matriz;
 *  - (3.4-4) la reclasificación: las 12 claves de gobierno, escritas a mano, son EXACTAMENTE las de piso «administrador de sistema», y las 19 (16 desde S-10/D1) acciones de
 *    empresa de D15 quedan congeladas como blanco explícito de F3.
 */
const NIVELES: readonly NivelDeAccion[] = ["operario", "administrador", "administrador_sistema", "gerente"];

/** Fila = nivel de quien actúa; columna = piso de la acción (en el orden de `NIVELES`). Escrita a mano a propósito. */
const ALCANZA: Record<NivelDeAccion, readonly boolean[]> = {
  operario: [true, false, false, false],
  administrador: [true, true, false, false],
  administrador_sistema: [true, true, true, false],
  gerente: [true, true, true, true],
};

describe("los rangos de los pisos (ADR-027): operario < administrador < administrador de sistema < gerente", () => {
  it.each(NIVELES)("tabla 4×4: lo que alcanza el nivel «%s»", (nivel) => {
    expect(NIVELES.map((piso) => nivelAlcanzaElPiso(nivel, piso))).toEqual(ALCANZA[nivel]);
  });

  it("el rango 2 (administrador) NO alcanza el piso de gobierno, y el de gobierno no alcanza el de gerente", () => {
    expect(nivelAlcanzaElPiso("administrador", "administrador_sistema")).toBe(false);
    expect(nivelAlcanzaElPiso("administrador_sistema", "administrador")).toBe(true);
    expect(nivelAlcanzaElPiso("administrador_sistema", "gerente")).toBe(false);
  });

  it("frente al piso, el rol de clave «admin» es el administrador de sistema y cualquier otro es operario (nadie es de rango 2 hasta F3)", () => {
    expect(nivelDelRolFrenteAlPiso({ clave: "admin" })).toBe("administrador_sistema");
    expect(nivelDelRolFrenteAlPiso({ clave: "operador" })).toBe("operario");
    expect(nivelDelRolFrenteAlPiso({ clave: null })).toBe("operario");
    for (const clave of ["Admin", "administrador", "administrador_sistema", "gerente", "encargado"]) expect(nivelDelRolFrenteAlPiso({ clave }), clave).toBe("operario");
  });

  it("las etiquetas que ve la persona: «administrador de sistema» para el piso nuevo, el resto tal cual", () => {
    expect(NIVELES.map(etiquetaDelPiso)).toEqual(["operario", "administrador", "administrador de sistema", "gerente"]);
  });

  it("PISOS-65: una celda fuera de nivel es EXACTAMENTE una de las 14 de gobierno y de gerente (las 65 bajaron a operario)", () => {
    const las14 = new Set<string>(ACCIONES.filter((a) => (a.nivelMinimo as NivelDeAccion) === "administrador_sistema" || (a.nivelMinimo as NivelDeAccion) === "gerente").map((a) => a.clave));
    expect(las14.size).toBe(14);
    for (const rol of [{ clave: "admin" }, { clave: "operador" }, { clave: null }]) {
      for (const a of ACCIONES) {
        if (esCeldaFueraDeNivel(rol, a.clave)) expect(las14.has(a.clave), `${rol.clave}/${a.clave}`).toBe(true);
      }
    }
    // el operador y un rol sin clave no pueden tener ninguna de las 14; ninguna de las 65 está cerrada para ellos
    for (const rol of [{ clave: "operador" }, { clave: null }]) {
      for (const a of ACCIONES) expect(esCeldaFueraDeNivel(rol, a.clave), `${rol.clave}/${a.clave}`).toBe(las14.has(a.clave));
    }
    for (const clave of ACCIONES_QUE_DA_SOLO_EL_GERENTE) expect(esCeldaFueraDeNivel({ clave: "operador" }, clave), clave).toBe(false);
  });
});

/**
 * Las 12 claves de gobierno (ADR-027 §3; D16 para `ver_auditoria`), escritas a mano y a propósito aparte del catálogo: si alguien baja una de piso, o
 * sube otra al gobierno, este archivo no cambia solo y el test falla. Son las del módulo `administracion` que no son de piso gerente.
 */
const CLAVES_DE_GOBIERNO: readonly AccionClave[] = [
  // de sucursal
  "gestion_usuarios",
  "activar_usuario_sucursal",
  "notas_usuario_sucursal",
  "ver_auditoria",
  // de empresa
  "apagar_cuenta_empresa",
  "gestion_permisos",
  "gestion_roles",
  "renombrar_rol",
  "capacidades_sucursal",
  "alta_sucursal",
  "activar_sucursal",
  "renombrar_sucursal",
];

/**
 * D15 (decisión del dueño, 2026-10-07): las acciones de CONTEXTO EMPRESA que siguen en piso administrador (19 entonces; 16 desde S-10/D1, que pasó tres de carta a contexto sucursal). El rango 2 («encargado», F3) no recibe
 * ninguna por defecto: la empresa se las habilita de a una con filas de la matriz (sin schema y sin subirles el piso). Congeladas acá para que F3 tenga
 * el blanco explícito: una acción de empresa nueva de piso administrador obliga a decidir, a la vista en el diff, si entra en esta lista.
 */
const ACCIONES_DE_EMPRESA_DE_D15: readonly AccionClave[] = [
  "partes_desactivar", // Parte P1: desactivar y reactivar fichas (piso administrador, semilla solo admin).
  "guardar_receta",
  "grupos_familia",
  "unidades",
  "proveedores",
  "categorias",
  "margen_objetivo_editar",
  "motivos_merma",
  "motivos_destino_consumo",
  // S-10/D1 (O.59): `carta_generos`, `carta_contenido_producto` y `carta_items_agrupados` salieron de esta lista (eran 19, ahora 16): escriben en la carta de UNA sucursal y pasaron a contexto
  // sucursal. Siguen en piso administrador y con semilla solo `admin`, y el rango 2 sigue sin recibirlas por defecto.
  "carta_secciones",
  "carta_portal",
  "carta_promo_definir",
  "comparar_precios",
  "insumos_mezclados",
  "reporte_huecos_catalogo",
  "clientes",
  "insumo_renombrar_fusionar",
  // Paquete 3, M3a (D3): repartir una factura de proveedor entre sucursales. De empresa, piso administrador, semilla solo `admin` (clase A); el rango 2 no la recibe por defecto.
  // GO-2a: el catálogo de opciones de venta y lo que admite cada producto. De empresa, piso administrador, semilla solo `admin` (clase A).
  "opciones_definir",
  "producto_opciones_admitidas",
  // (GO-3b sumó `grupos_de_precio_definir`, las tarifas de las combinaciones; la Fase 3 de la ola «precio y carta» la retiró con GO-3a.)
];

const conPiso = (piso: NivelDeAccion) => ACCIONES.filter((a) => (a.nivelMinimo as NivelDeAccion) === piso).map((a) => a.clave as AccionClave);
const ordenadas = (claves: readonly string[]) => [...claves].sort();

describe("la reclasificación del gobierno (ADR-027 §3, 3.4-4)", () => {
  it("(i) las claves de piso «administrador de sistema» son EXACTAMENTE las 12 de gobierno", () => {
    expect(CLAVES_DE_GOBIERNO).toHaveLength(12);
    expect(ordenadas(conPiso("administrador_sistema"))).toEqual(ordenadas(CLAVES_DE_GOBIERNO));
  });

  it("(ii) una acción es de piso «administrador de sistema» si y solo si es del módulo administración y no es de piso gerente", () => {
    for (const a of ACCIONES) {
      const deGobierno = a.modulo === "administracion" && (a.nivelMinimo as NivelDeAccion) !== "gerente";
      expect((a.nivelMinimo as NivelDeAccion) === "administrador_sistema", a.clave).toBe(deGobierno);
    }
  });

  it("(iii) las claves fijas del admin y `capacidades_sucursal` son de gobierno", () => {
    for (const clave of [...ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE, "capacidades_sucursal" as const]) {
      expect(nivelMinimoDeAccion(clave), clave).toBe("administrador_sistema");
    }
  });

  it("(iv) el rol de clave «admin» alcanza las 12: la empresa no se queda sin quien la gobierne", () => {
    for (const clave of CLAVES_DE_GOBIERNO) expect(rolAlcanzaLaAccion({ clave: "admin" }, clave), clave).toBe(true);
  });

  it("(v) un rol creado a mano (sin clave) y el «operador» no alcanzan ninguna", () => {
    for (const clave of CLAVES_DE_GOBIERNO) {
      expect(rolAlcanzaLaAccion({ clave: null }, clave), `sin clave/${clave}`).toBe(false);
      expect(rolAlcanzaLaAccion({ clave: "operador" }, clave), `operador/${clave}`).toBe(false);
    }
  });

  it("(vi) el rango 2 («administrador», el futuro encargado) no alcanza ninguna: no gobierna ni ve la auditoría (D16)", () => {
    for (const clave of CLAVES_DE_GOBIERNO) expect(nivelAlcanzaElPiso("administrador", nivelMinimoDeAccion(clave)), clave).toBe(false);
    expect(nivelMinimoDeAccion("ver_auditoria")).toBe("administrador_sistema");
  });

  it("(vii) D15 (PISOS-65): las 19 acciones de empresa de la lista que da solo el gerente son las congeladas, y de fábrica las tiene solo el rol «admin»", () => {
    expect(ACCIONES_DE_EMPRESA_DE_D15).toHaveLength(19);
    const deEmpresaDeLaLista = ACCIONES.filter((a) => a.contexto === "empresa" && (ACCIONES_QUE_DA_SOLO_EL_GERENTE as readonly string[]).includes(a.clave)).map((a) => a.clave);
    expect(ordenadas(deEmpresaDeLaLista)).toEqual(ordenadas(ACCIONES_DE_EMPRESA_DE_D15));
    for (const clave of ACCIONES_DE_EMPRESA_DE_D15) expect(nivelMinimoDeAccion(clave), clave).toBe("operario");
    // «Ninguna por defecto»: de fábrica las tiene solo el rol «admin»; un rol de la empresa las recibe recién cuando el gerente tilda su fila en la matriz.
    for (const a of ACCIONES.filter((x) => (ACCIONES_DE_EMPRESA_DE_D15 as readonly string[]).includes(x.clave))) expect([...a.rolesEditarSemilla], a.clave).toEqual(["admin"]);
  });

  it("el conteo del catálogo: 141 operario, 0 administrador, 12 administrador de sistema, 2 gerente (PISOS-65, cierre del día y administración de la caja)", () => {
    // 61 → 60 administrador: se retira `notificar_alertas` (decisión del dueño, limpieza paquete A paso 3; clase A).
    // 56 → 55 operario: se retira `pos_limite_mesas_abiertas` (el límite de mesas abiertas por sucursal; decisión del dueño 2026-10-29; clase O).
    // 55 → 56 operario y 62 → 61 administrador: E3a baja `compra_repartir` a piso operario (decisión del dueño P3, 2026-10-28; clase A → O, semilla sigue solo `admin`).
    // 63 → 62 administrador: la Fase 3 de la ola «precio y carta» retira `grupos_de_precio_definir` (GO-3a).
    // 54 → 55 operario: GO-3b suma `promo_menu_del_dia` (clase O).
    // 62 → 63 administrador: GO-3b suma `grupos_de_precio_definir` (clase A).
    // 53 → 54 operario: GO-2a suma `opcion_apagar_en_sucursal` (clase O).
    // 60 → 62 administrador: GO-2a suma `opciones_definir` y `producto_opciones_admitidas` (clase A).
    // 52 → 53 operario: Paquete 3 M3a suma `compra_recibir` (clase O).
    // 59 → 60 administrador: Paquete 3 M3a suma `compra_repartir` (clase A).
    // 55 → 56 operario: Pagos X0 suma `declarar_pago_compra` (clase O).
    // 56 → 58 operario y 60 → 61 administrador: Parte P1 suma `partes_ver` y `partes_editar` (clase O) y `partes_desactivar` (clase A).
    // 58 → 57 operario y 61 → 62 administrador: Compras N3-a (2026-11-16) sube `compra_recibir` de piso operario (clase O) a administrador (clase A): confirman el gerente y el administrador, no el operador.
    // 57 → 58 operario: Compras N3-b (2026-11-16) suma `compra_controlar_recepcion` (clase L: piso operario, semilla admin y operador).
    // +3 operario y +3 administrador: Caja y cobro C1 PR-B suma `caja_ver`, `caja_abrir_sesion` y `cobrar_cuenta` (clase O) y `caja_cerrar_sesion`, `caja_mover_efectivo` y `caja_anular_movimiento_ajeno` (clase A).
    // PISOS-65 (2026-11-17): las 65 de piso administrador bajan a operario: 61 → 126 operario, 65 → 0 administrador.
    // +7 operario: Caja, cierre del día (etapa A) suma siete claves de piso operario (`caja_jornada_ver`, `caja_jornada_iniciar_auditoria`, `caja_jornada_cancelar_auditoria`, `caja_jornada_cerrar`, `caja_corregir_medio_de_cobro`, `caja_declarar_total` y `caja_registrar_ajuste`; clase O).
    // +8 operario: Caja, etapa B suma ocho claves de administración de la caja (`caja_medio_de_pago_*` y `caja_cuenta_de_cobro_*`; clase O): 133 → 141 operario.
    // 51 → 52: M.2 P1 suma `producto_campos_sensibles` (piso operario, clase O); los otros pisos no se mueven.
    expect(["operario", "administrador", "administrador_sistema", "gerente"].map((p) => conPiso(p as NivelDeAccion).length)).toEqual([141, 0, 12, 2]);
    expect(ACCIONES_QUE_DA_SOLO_EL_GERENTE).toHaveLength(65);
  });
});
