import { describe, expect, it } from "vitest";
import { ACCIONES, esAccionReservada, esAccionSoloVer, type AccionClave } from "../../src/core/permisos/acciones";
import { accionesConfigurablesPorSucursal, esCapacidadSiempreHabilitada, resolverCapacidad } from "../../src/core/permisos/capacidades-sucursal";
import { accesoDeSucursal, decidirEnSucursal } from "../../src/core/permisos/decision-de-acceso";
import { rolAlcanzaLaAccion } from "../../src/core/permisos/jerarquia";
import { accionesDeLaMatrizDePermisos } from "../../src/core/permisos/matriz";

/**
 * Poda de la matriz de permisos (dueño, 2026-11-06), SIN cambiar ninguna decisión de acceso:
 * (3) la casilla «Editar» se oculta en las claves de solo ver (marca `soloVer` del catálogo);
 * (4) una clave RESERVADA (sin consumidores) sale de las matrices de permisos y de capacidades. Hoy no hay ninguna: `compra_recibir`, la única, dejó de estar reservada con la recepción separada de Compras (N3-a, 2026-11-16).
 *
 * (a) clave × rol × fila del rol × Default × fila de la sucursal: la decisión real (`accesoDeSucursal` + `decidirEnSucursal`, con la capacidad que decide `resolverCapacidad`) coincide con un
 *     oráculo escrito aparte, TAMBIÉN para las claves marcadas: ocultar la casilla no le quita ni le da nada a nadie (una fila vieja con Editar sigue decidiendo como siempre).
 * (b) las filas ocultas no aparecen y las demás sí.
 */
const SUCURSAL = "suc-1";
type Fila = "sin_fila" | "prendida" | "apagada";
const FILAS: readonly Fila[] = ["sin_fila", "prendida", "apagada"];

function capacidadEsperada(clave: string, porDefecto: Fila, propia: Fila): boolean {
  if (clave === "capacidades_sucursal" || ["gestion_permisos", "gestion_roles", "gestion_usuarios", "activar_usuario_sucursal", "notas_usuario_sucursal", "apagar_cuenta_empresa"].includes(clave)) return true;
  if (propia !== "sin_fila") return propia === "prendida";
  if (porDefecto !== "sin_fila") return porDefecto === "prendida";
  return true;
}

function candidatas(porDefecto: Fila, propia: Fila) {
  const filas: Array<{ sucursalId: string | null; habilitado: boolean }> = [];
  if (porDefecto !== "sin_fila") filas.push({ sucursalId: null, habilitado: porDefecto === "prendida" });
  if (propia !== "sin_fila") filas.push({ sucursalId: SUCURSAL, habilitado: propia === "prendida" });
  return filas;
}

describe("(a) la decisión de acceso no cambia: clave × rol × fila del rol × Default × fila de la sucursal", () => {
  it("las claves de solo ver y la reservada deciden Ver y Editar como el oráculo, con o sin fila de Editar", () => {
    const marcadas = ACCIONES.filter((a) => a.contexto === "sucursal" && (esAccionSoloVer(a.clave) || esAccionReservada(a.clave)));
    expect(marcadas.length).toBeGreaterThan(20);
    const ROLES = [{ clave: "admin" }, { clave: "operador" }, { clave: null }] as const;
    const FILAS_DEL_ROL = [null, { puedeVer: true, puedeEditar: false }, { puedeVer: true, puedeEditar: true }] as const;
    for (const accion of marcadas) {
      const clave = accion.clave as AccionClave;
      for (const rol of ROLES) {
        for (const filaDelRol of FILAS_DEL_ROL) {
          for (const porDefecto of FILAS) {
            for (const propia of FILAS) {
              const tieneCapacidad = esCapacidadSiempreHabilitada(clave) || resolverCapacidad(candidatas(porDefecto, propia), SUCURSAL);
              const acceso = accesoDeSucursal({ membresia: { rol: { ...rol, nombre: "rol", activo: true } }, filaDelRol, sinModulo: null, tieneCapacidad }, clave as never);
              for (const para of ["ver", "editar"] as const) {
                const fila = filaDelRol === null ? false : para === "ver" ? filaDelRol.puedeVer : filaDelRol.puedeEditar;
                const esperado = capacidadEsperada(clave, porDefecto, propia) && rolAlcanzaLaAccion(rol, clave) && fila;
                expect(decidirEnSucursal(acceso, clave as never, para).ok, `${clave} · ${rol.clave} · ${JSON.stringify(filaDelRol)} · ${porDefecto}/${propia} · ${para}`).toBe(esperado);
              }
            }
          }
        }
      }
    }
  });
});

describe("(b) lo oculto no aparece y lo demás sí", () => {
  const todas = ACCIONES.map((a) => ({ clave: a.clave as string }));

  it("la matriz de permisos lista todas las claves (ya no hay reservadas: `compra_recibir` se usa desde Compras N3-a), en el mismo orden", () => {
    const claves = accionesDeLaMatrizDePermisos(todas).map((a) => a.clave);
    expect(claves).toContain("compra_recibir");
    expect(claves).toEqual(todas.map((a) => a.clave).filter((c) => !esAccionReservada(c)));
  });

  it("la matriz de permisos sigue listando las claves de solo ver (se oculta la casilla, no la fila) y las de gobierno", () => {
    const claves = accionesDeLaMatrizDePermisos(todas).map((a) => a.clave);
    for (const c of todas.map((a) => a.clave).filter(esAccionSoloVer)) expect(claves, c).toContain(c);
    expect(claves).toContain("gestion_permisos");
  });

  it("los restos de la base (claves fuera del catálogo) no aparecen en ninguna matriz", () => {
    expect(accionesDeLaMatrizDePermisos([{ clave: "ver_reportes_stock" }])).toEqual([]);
    expect(accionesConfigurablesPorSucursal([{ clave: "ver_reportes_stock" }])).toEqual([]);
  });

  it("la matriz de capacidades lista lo configurable, `compra_recibir` incluida (de sucursal y ya no reservada)", () => {
    const claves = accionesConfigurablesPorSucursal(todas).map((a) => a.clave);
    expect(claves).toContain("compra_recibir");
    expect(claves).toContain("precio_local");
    expect(claves).toContain("compra_repartir");
    expect(claves.length).toBe(todas.filter((a) => !esAccionReservada(a.clave) && !esCapacidadSiempreHabilitada(a.clave)).length);
  });

  it("la marca `soloVer` cubre exactamente los reportes (y `partes_ver`, la búsqueda de fichas de Parte P1, y `orden_de_compra_ver`, ver las órdenes de compra de la etapa OC) y ninguna está `reservada` (la última, `compra_recibir`, se usa desde Compras N3-a)", () => {
    const soloVer = todas.map((a) => a.clave).filter(esAccionSoloVer);
    expect(soloVer).toEqual(todas.map((a) => a.clave).filter((c) => c.startsWith("reporte_") || c === "partes_ver" || c === "orden_de_compra_ver"));
    expect(todas.map((a) => a.clave).filter(esAccionReservada)).toEqual([]);
  });

  it("una clave fuera del catálogo no es ni de solo ver ni reservada", () => {
    expect(esAccionSoloVer("no_existe")).toBe(false);
    expect(esAccionReservada("no_existe")).toBe(false);
  });
});
