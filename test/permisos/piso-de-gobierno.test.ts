import { describe, expect, it } from "vitest";
import { ACCIONES, ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE, nivelMinimoDeAccion, type AccionClave, type NivelDeAccion } from "../../src/core/permisos/acciones";
import { etiquetaDelPiso, nivelAlcanzaElPiso, nivelDelRolFrenteAlPiso, rolAlcanzaLaAccion } from "../../src/core/permisos/jerarquia";
import { nivelesDeLaCelda } from "../../src/core/permisos/matriz";

/**
 * ADR-027 (Hito 3, trabajo 3.4, F1 del RBAC): el piso «administrador de sistema» y la escalera de cuatro rangos de los pisos de una acción,
 * operario < administrador < administrador de sistema < gerente. Puro: sin base.
 *
 * Lo que este archivo fija:
 *  - la tabla 4×4 de `nivelAlcanzaElPiso` (quién llega a qué piso), escrita a mano y no derivada del código: invertir dos rangos la pone en rojo;
 *  - que el rango 2 («administrador», el futuro «encargado» de F3) NO alcanza el piso de gobierno: es la razón de ser del escalón nuevo (D16);
 *  - quién es administrador de sistema hoy: el rol de clave «admin», y nadie más (ningún rol tiene rango 2 hasta que exista `Rol.nivel`);
 *  - las etiquetas que muestran la matriz y el rechazo de `guardarPermisos`;
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

  it("el mensaje de una celda fuera de nivel lleva las etiquetas, no los valores internos", () => {
    expect(nivelesDeLaCelda({ clave: "operador" }, "anular_venta")).toEqual({ piso: "administrador", delRol: "operario" });
    expect(nivelesDeLaCelda({ clave: "admin" }, "traspasar_gerencia")).toEqual({ piso: "gerente", delRol: "administrador de sistema" });
    expect(nivelesDeLaCelda({ clave: "admin" }, "no_existe")).toBeNull();
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

  it("(vii) D15: las 16 acciones de empresa de piso administrador (eran 19 antes de S-10/D1), congeladas (blanco de F3); el rango 2 las alcanzaría por piso, pero ninguna se le da por defecto", () => {
    expect(ACCIONES_DE_EMPRESA_DE_D15).toHaveLength(16);
    const deEmpresaDePisoAdministrador = ACCIONES.filter((a) => a.contexto === "empresa" && (a.nivelMinimo as NivelDeAccion) === "administrador").map((a) => a.clave);
    expect(ordenadas(deEmpresaDePisoAdministrador)).toEqual(ordenadas(ACCIONES_DE_EMPRESA_DE_D15));
    for (const clave of ACCIONES_DE_EMPRESA_DE_D15) expect(nivelAlcanzaElPiso("administrador", nivelMinimoDeAccion(clave)), clave).toBe(true);
    // «Ninguna por defecto»: de fábrica las tiene solo el rol «admin»; un rol de la empresa las recibe recién cuando alguien tilda su fila en la matriz.
    for (const a of ACCIONES.filter((x) => (ACCIONES_DE_EMPRESA_DE_D15 as readonly string[]).includes(x.clave))) expect([...a.rolesEditarSemilla], a.clave).toEqual(["admin"]);
  });

  it("el conteo del catálogo: 51 operario, 59 administrador, 12 administrador de sistema, 2 gerente", () => {
    expect(["operario", "administrador", "administrador_sistema", "gerente"].map((p) => conPiso(p as NivelDeAccion).length)).toEqual([51, 59, 12, 2]);
  });
});
