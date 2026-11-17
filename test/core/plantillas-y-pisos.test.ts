import { describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { matrizDeFabrica } from "../../src/core/permisos/roles-de-fabrica";
import {
  PISO_INICIAL_POR_NIVEL,
  PlantillasError,
  aplicarCambiosALaPlantilla,
  incumplimientosDeLaPlantilla,
  planDeSincronizacion,
  semillaDePlantillas,
  validarClaveDeAccion,
} from "../../src/core/permisos/plantillas-y-pisos";
import { MATRIZ_ESPERADA } from "../permisos/matriz-esperada";

/**
 * Plantillas y pisos (EB-1), parte pura. PARIDAD (I-10): la versión 1 de cada plantilla de la semilla es EXACTAMENTE lo que el catálogo, la matriz esperada (escrita aparte, a mano) y `matrizDeFabrica` dicen hoy; los pisos
 * son los del nivel de cada acción. Las cuentas se derivan del catálogo (no se fija «133» ni «140»).
 */
const semilla = semillaDePlantillas();
const PISOS = semilla.pisos;

const SOLO_GERENTE_ESPERADOS = [
  "activar_sucursal",
  "activar_usuario_sucursal",
  "alta_sucursal",
  "apagar_cuenta_empresa",
  "capacidades_sucursal",
  "gestion_permisos",
  "gestion_roles",
  "gestion_usuarios",
  "notas_usuario_sucursal",
  "renombrar_rol",
  "renombrar_sucursal",
  "traspasar_gerencia",
  "ver_auditoria",
  "ver_auditoria_empresa",
];

describe("paridad de la semilla con el catálogo", () => {
  it("para cada acción y cada rol de fábrica: Ver/Editar de la versión 1 ⇔ MATRIZ_ESPERADA ⇔ fila de matrizDeFabrica", () => {
    const filas = matrizDeFabrica("empresa-x", { admin: "rol-admin", operador: "rol-operador" });
    for (const accion of ACCIONES) {
      for (const [plantilla, rol] of [["ADMINISTRADOR", "admin"], ["OPERADOR", "operador"]] as const) {
        const enVer = semilla.versiones[plantilla].ver.includes(accion.clave);
        const enEditar = semilla.versiones[plantilla].editar.includes(accion.clave);
        const esperada = (MATRIZ_ESPERADA[accion.clave].roles as readonly string[]).includes(rol);
        const fila = filas.find((f) => f.accionClave === accion.clave && f.rolId === `rol-${rol}`)!;
        expect({ accion: accion.clave, plantilla, enVer, enEditar }).toEqual({ accion: accion.clave, plantilla, enVer: esperada, enEditar: esperada });
        expect({ enVer, enEditar }).toEqual({ enVer: fila.puedeVer, enEditar: fila.puedeEditar });
      }
    }
  });

  it("los pisos SOLO_GERENTE son exactamente las acciones de nivel gerente o administrador de sistema (las 14 nombradas); no hay TODOS_LOS_ROLES", () => {
    const porNivel = ACCIONES.filter((a) => a.nivelMinimo === "gerente" || a.nivelMinimo === "administrador_sistema").map((a) => a.clave).sort();
    expect(PISOS.filter((p) => p.tipo === "SOLO_GERENTE").map((p) => p.accionClave)).toEqual(porNivel);
    expect(porNivel).toEqual(SOLO_GERENTE_ESPERADOS);
    expect(PISOS.filter((p) => p.tipo === "TODOS_LOS_ROLES")).toEqual([]);
    expect(PISOS).toHaveLength(SOLO_GERENTE_ESPERADOS.length);
  });

  it("introducidas = todas las claves del catálogo; las cuentas salen del catálogo (nada de 133 a mano)", () => {
    expect(semilla.introducidas).toEqual(ACCIONES.map((a) => a.clave).sort());
    expect(semilla.versiones.ADMINISTRADOR.ver).toHaveLength(ACCIONES.filter((a) => a.rolesEditarSemilla.includes("admin")).length);
    expect(semilla.versiones.OPERADOR.ver).toHaveLength(ACCIONES.filter((a) => a.rolesEditarSemilla.includes("operador")).length);
    expect(semilla.versiones.ADMINISTRADOR.editar).toEqual(semilla.versiones.ADMINISTRADOR.ver);
    expect(semilla.versiones.OPERADOR.editar).toEqual(semilla.versiones.OPERADOR.ver);
  });

  it("las listas están ordenadas y ninguna versión de la semilla viola las reglas de plantilla", () => {
    for (const plantilla of ["ADMINISTRADOR", "OPERADOR"] as const) {
      const { ver, editar } = semilla.versiones[plantilla];
      expect(ver).toEqual([...ver].sort());
      expect(incumplimientosDeLaPlantilla(plantilla, ver, editar, PISOS), plantilla).toEqual([]);
    }
  });

  it("el piso inicial por nivel: operario y administrador sin piso; administrador de sistema y gerente SOLO_GERENTE", () => {
    expect(PISO_INICIAL_POR_NIVEL).toEqual({ operario: null, administrador: null, administrador_sistema: "SOLO_GERENTE", gerente: "SOLO_GERENTE" });
  });
});

describe("validarClaveDeAccion", () => {
  it("acepta una clave del catálogo y rechaza la que no tiene la forma o no está en el catálogo", () => {
    expect(validarClaveDeAccion("ver_stock")).toBe("ver_stock");
    for (const mala of ["Ver_stock", "ver stock", "v", "1abc", "", "ver_stock\n", "no_existe_en_el_catalogo"]) expect(() => validarClaveDeAccion(mala), mala).toThrow(PlantillasError);
  });
});

describe("aplicarCambiosALaPlantilla", () => {
  const ultima = { ver: ["ver_stock", "proceso_compra"], editar: ["ver_stock"] };

  it("dar Editar implica dar Ver; quitar saca de las dos listas; quitar Editar deja Ver", () => {
    const r = aplicarCambiosALaPlantilla(ultima, { darEditar: ["alta_producto"], quitar: ["proceso_compra"], quitarEditar: ["ver_stock"] });
    expect(r).toEqual({ ver: ["alta_producto", "ver_stock"], editar: ["alta_producto"], agregadas: ["alta_producto"], quitadas: ["proceso_compra", "ver_stock"] });
  });

  it("dar Ver agrega solo a Ver", () => {
    expect(aplicarCambiosALaPlantilla(ultima, { darVer: ["alta_producto"] })).toMatchObject({ ver: ["alta_producto", "proceso_compra", "ver_stock"], editar: ["ver_stock"], agregadas: ["alta_producto"], quitadas: [] });
  });

  it("rechaza dar y quitar la misma clave, un pedido que no cambia nada, una clave inválida y «quitar» con «quitar Editar» de la misma clave", () => {
    expect(() => aplicarCambiosALaPlantilla(ultima, { darVer: ["alta_producto"], quitar: ["alta_producto"] })).toThrow(/dar y quitar/);
    expect(() => aplicarCambiosALaPlantilla(ultima, { darVer: ["ver_stock"] })).toThrow(/no cambia nada/);
    expect(() => aplicarCambiosALaPlantilla(ultima, { quitar: ["alta_producto"] })).toThrow(/no cambia nada/);
    expect(() => aplicarCambiosALaPlantilla(ultima, { darVer: ["Mala"] })).toThrow(PlantillasError);
    expect(() => aplicarCambiosALaPlantilla(ultima, { quitar: ["ver_stock"], quitarEditar: ["ver_stock"] })).toThrow(/a la vez/);
  });
});

describe("incumplimientosDeLaPlantilla: una regla por vez, en orden", () => {
  const reglas = (plantilla: string, ver: string[], editar: string[], pisos = PISOS) => incumplimientosDeLaPlantilla(plantilla, ver, editar, pisos).map((i) => i.regla);
  const admin = semilla.versiones.ADMINISTRADOR;
  const operador = semilla.versiones.OPERADOR;

  it("GERENTE no lleva versiones", () => {
    expect(reglas("GERENTE", [], [])).toEqual(["SIN_LISTA"]);
  });
  it("una clave fuera del catálogo", () => {
    expect(reglas("OPERADOR", [...operador.ver, "no_existe"], operador.editar)).toContain("CATALOGO");
  });
  it("Editar fuera de Ver", () => {
    expect(reglas("OPERADOR", operador.ver.filter((c) => c !== "ver_stock"), operador.editar)).toEqual(["EDITAR_SIN_VER"]);
  });
  it("regla de nivel: el administrador no recibe las de gerente; el operador, nada por encima de operario", () => {
    expect(reglas("ADMINISTRADOR", [...admin.ver, "traspasar_gerencia"], [...admin.editar, "traspasar_gerencia"])).toContain("NIVEL");
    expect(reglas("OPERADOR", [...operador.ver, "carta_ver"], [...operador.editar, "carta_ver"])).toContain("NIVEL");
  });
  it("SOLO_GERENTE se rechaza en OPERADOR y NO en ADMINISTRADOR (D-E)", () => {
    const conPisoNuevo: typeof PISOS = [...PISOS, { accionClave: "ver_stock", tipo: "SOLO_GERENTE" }];
    expect(reglas("OPERADOR", operador.ver, operador.editar, conPisoNuevo)).toEqual(["SOLO_GERENTE"]);
    expect(reglas("ADMINISTRADOR", admin.ver, admin.editar, conPisoNuevo)).toEqual([]);
    expect(reglas("ADMINISTRADOR", admin.ver, admin.editar)).toEqual([]);
  });
  it("TODOS_LOS_ROLES ausente de Ver", () => {
    const conTodos: typeof PISOS = [...PISOS, { accionClave: "alta_producto", tipo: "TODOS_LOS_ROLES" }];
    expect(reglas("OPERADOR", operador.ver.filter((c) => c !== "alta_producto"), operador.editar.filter((c) => c !== "alta_producto"), conTodos)).toEqual(["TODOS_LOS_ROLES"]);
  });
  it("ADMINISTRADOR sin Ver y Editar de una acción que conserva siempre", () => {
    expect(reglas("ADMINISTRADOR", admin.ver.filter((c) => c !== "gestion_roles"), admin.editar.filter((c) => c !== "gestion_roles"))).toEqual(["ADMIN_SIEMPRE"]);
    expect(reglas("ADMINISTRADOR", admin.ver, admin.editar.filter((c) => c !== "gestion_roles"))).toEqual(["ADMIN_SIEMPRE"]);
  });
  it("sin pisos legibles se rechaza", () => {
    expect(reglas("OPERADOR", operador.ver, operador.editar, [])).toEqual(["SIN_PISOS"]);
  });
});

describe("planDeSincronizacion", () => {
  const ultimas = { ADMINISTRADOR: { ver: ["a"], editar: ["a"] }, OPERADOR: { ver: ["a"], editar: ["a"] } };
  const nueva = (clave: string, nivelMinimo: "operario" | "administrador" | "administrador_sistema" | "gerente", roles: ("admin" | "operador")[]) => ({ clave, nivelMinimo, rolesEditarSemilla: roles });

  it("suma cada acción nueva a las plantillas de su semilla y crea el piso por nivel; solo figuran las plantillas que cambian", () => {
    const plan = planDeSincronizacion([nueva("z_nueva", "operario", ["admin", "operador"]), nueva("y_gobierno", "administrador_sistema", ["admin"]), nueva("x_gerente", "gerente", [])], ultimas, []);
    expect(plan.pisosNuevos).toEqual([{ accionClave: "x_gerente", tipo: "SOLO_GERENTE" }, { accionClave: "y_gobierno", tipo: "SOLO_GERENTE" }]);
    expect(plan.versiones.ADMINISTRADOR).toEqual({ ver: ["a", "y_gobierno", "z_nueva"], editar: ["a", "y_gobierno", "z_nueva"], agregadas: ["y_gobierno", "z_nueva"] });
    expect(plan.versiones.OPERADOR).toEqual({ ver: ["a", "z_nueva"], editar: ["a", "z_nueva"], agregadas: ["z_nueva"] });
  });

  it("no pisa un piso que ya existe, no repone una acción que ya estaba y no escribe nada si no hay nada que sumar", () => {
    const plan = planDeSincronizacion([nueva("y_gobierno", "administrador_sistema", [])], ultimas, ["y_gobierno"]);
    expect(plan).toEqual({ pisosNuevos: [], versiones: {} });
    expect(planDeSincronizacion([nueva("a", "operario", ["admin", "operador"])], ultimas, []).versiones).toEqual({});
  });
});
