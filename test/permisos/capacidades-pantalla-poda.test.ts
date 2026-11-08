import { describe, expect, it } from "vitest";
import { ACCIONES, ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE, esAccionReservada, type AccionClave } from "../../src/core/permisos/acciones";
import { capacidadEfectiva, accionesConfigurablesPorSucursal, esCapacidadSiempreHabilitada } from "../../src/core/permisos/capacidades-sucursal";
import { accesoDeSucursal, decidirEnSucursal } from "../../src/core/permisos/decision-de-acceso";
import { rolAlcanzaLaAccion } from "../../src/core/permisos/jerarquia";
import { capacidadesDeSucursal, sucursalTieneCapacidad } from "../../src/server/acceso/capacidades-sucursal";
import type { Db } from "../../src/lib/db-tipos";

/**
 * Poda de la pantalla «Capacidades por sucursal» (dueño, 2026-11-06: «los interruptores muertos hay que ocultarlos»), SIN cambiar ninguna decisión de acceso.
 *
 * (a) Una tabla de reglas ESCRITA APARTE (el oráculo) se recorre contra la función REAL de acceso (`sucursalTieneCapacidad`, `capacidadesDeSucursal`, `accesoDeSucursal` +
 *     `decidirEnSucursal`) para TODAS las combinaciones clave × rol × fila del Default × fila de la sucursal: lo que decide el acceso es lo de siempre, y la pantalla muestra lo mismo.
 * (b) Las filas muertas no aparecen y todas las demás sí.
 * (c) La pantalla muestra el valor EFECTIVO (el del acceso), con «hereda del Default» cuando la sucursal no tiene fila propia.
 */
const SUCURSAL = "suc-1";
const OTRA = "suc-2";

type Fila = "sin_fila" | "prendida" | "apagada";
const FILAS: readonly Fila[] = ["sin_fila", "prendida", "apagada"];

interface FilaCapacidad {
  accionClave: string;
  sucursalId: string | null;
  habilitado: boolean;
}

function filasDe(clave: string, porDefecto: Fila, propia: Fila): FilaCapacidad[] {
  const filas: FilaCapacidad[] = [];
  if (porDefecto !== "sin_fila") filas.push({ accionClave: clave, sucursalId: null, habilitado: porDefecto === "prendida" });
  if (propia !== "sin_fila") filas.push({ accionClave: clave, sucursalId: SUCURSAL, habilitado: propia === "prendida" });
  return filas;
}

/** ORÁCULO de la capacidad (Sucursales.js:616-628), escrito aparte: las claves de gobierno de accesos y `capacidades_sucursal` siempre prendidas; si no, manda la fila propia, después el Default, y sin filas se puede. */
function capacidadEsperada(clave: string, porDefecto: Fila, propia: Fila): boolean {
  if (clave === "capacidades_sucursal" || (ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE as readonly string[]).includes(clave)) return true;
  if (propia !== "sin_fila") return propia === "prendida";
  if (porDefecto !== "sin_fila") return porDefecto === "prendida";
  return true;
}

/** Una base mínima que contesta como Prisma a las dos lecturas del lector (`accionClave` exacta o `in`); los filtros de sucursal los resuelve la regla, no la base. */
function dbConFilas(filas: FilaCapacidad[]): Db {
  return {
    capacidadSucursal: {
      findMany: async ({ where }: { where: { accionClave: string | { in: string[] } } }) =>
        filas.filter((f) => (typeof where.accionClave === "string" ? f.accionClave === where.accionClave : where.accionClave.in.includes(f.accionClave))),
    },
  } as unknown as Db;
}

const CLAVES = ACCIONES.map((a) => a.clave as AccionClave);

describe("(a) la decisión de acceso es idéntica: clave × Default × fila de la sucursal", () => {
  it("sucursalTieneCapacidad, capacidadesDeSucursal y la pantalla coinciden con el oráculo en TODAS las combinaciones", async () => {
    let combinaciones = 0;
    for (const clave of CLAVES) {
      for (const porDefecto of FILAS) {
        for (const propia of FILAS) {
          const filas = filasDe(clave, porDefecto, propia);
          const db = dbConFilas(filas);
          const esperado = capacidadEsperada(clave, porDefecto, propia);
          const contexto = `${clave} · Default ${porDefecto} · sucursal ${propia}`;
          expect(await sucursalTieneCapacidad(SUCURSAL, clave, db), `acceso: ${contexto}`).toBe(esperado);
          expect((await capacidadesDeSucursal(SUCURSAL, [clave], db)).has(clave), `menú: ${contexto}`).toBe(esperado);
          expect(capacidadEfectiva(clave, filas, SUCURSAL).habilitado, `pantalla: ${contexto}`).toBe(esperado);
          combinaciones++;
        }
      }
    }
    expect(combinaciones).toBe(CLAVES.length * 9);
  });

  it("clave × rol × fila del rol × Default × fila de la sucursal: el gate de ver/editar decide como el oráculo", async () => {
    const ROLES = [{ clave: "admin" }, { clave: "operador" }, { clave: null }] as const; // administrador de sistema, operario de fábrica y un rol propio de la empresa
    const FILAS_DEL_ROL = [null, { puedeVer: true, puedeEditar: false }, { puedeVer: true, puedeEditar: true }] as const;
    const deSucursal = ACCIONES.filter((a) => a.contexto === "sucursal");
    for (const accion of deSucursal) {
      const clave = accion.clave as Extract<AccionClave, string>;
      for (const rol of ROLES) {
        for (const filaDelRol of FILAS_DEL_ROL) {
          for (const porDefecto of FILAS) {
            for (const propia of FILAS) {
              const tieneCapacidad = await sucursalTieneCapacidad(SUCURSAL, clave, dbConFilas(filasDe(clave, porDefecto, propia)));
              const acceso = accesoDeSucursal({ membresia: { rol: { ...rol, nombre: "rol", activo: true } }, filaDelRol, sinModulo: null, tieneCapacidad }, clave as never);
              for (const para of ["ver", "editar"] as const) {
                const real = decidirEnSucursal(acceso, clave as never, para).ok;
                const fila = filaDelRol === null ? false : para === "ver" ? filaDelRol.puedeVer : filaDelRol.puedeEditar;
                const esperado = capacidadEsperada(clave, porDefecto, propia) && rolAlcanzaLaAccion(rol, clave) && fila;
                expect(real, `${clave} · rol ${rol.clave} · fila ${JSON.stringify(filaDelRol)} · Default ${porDefecto} · sucursal ${propia} · ${para}`).toBe(esperado);
              }
            }
          }
        }
      }
    }
  });

  it("una fila de OTRA sucursal no cambia la decisión ni lo que muestra la pantalla", () => {
    const filas = [...filasDe("precio_local", "apagada", "sin_fila"), { accionClave: "precio_local", sucursalId: OTRA, habilitado: true }];
    expect(capacidadEfectiva("precio_local", filas, SUCURSAL)).toEqual({ habilitado: false, heredaDelDefault: true });
    expect(capacidadEfectiva("precio_local", filas, OTRA)).toEqual({ habilitado: true, heredaDelDefault: false });
  });
});

describe("(b) las filas muertas no aparecen y las demás sí", () => {
  const muertas = ["capacidades_sucursal", "gestion_permisos", "gestion_roles", "gestion_usuarios", "activar_usuario_sucursal", "notas_usuario_sucursal", "apagar_cuenta_empresa"];

  it("las 6 claves de gestión de usuarios y permisos y `capacidades_sucursal` quedan fuera", () => {
    const visibles = accionesConfigurablesPorSucursal(CLAVES.map((clave) => ({ clave }))).map((a) => a.clave as string);
    for (const clave of muertas) expect(visibles, clave).not.toContain(clave);
  });

  it("todas las demás siguen apareciendo, en el mismo orden", () => {
    const entrada = CLAVES.map((clave) => ({ clave }));
    const visibles = accionesConfigurablesPorSucursal(entrada).map((a) => a.clave as string);
    expect(visibles).toEqual(CLAVES.filter((c) => !muertas.includes(c) && !esAccionReservada(c)));
    expect(visibles.length).toBe(CLAVES.length - muertas.length - CLAVES.filter(esAccionReservada).length);
  });

  it("una fila se oculta si el acceso la da siempre por prendida (la misma marca que usa el acceso) o si está reservada", () => {
    for (const clave of CLAVES) {
      const aparece = accionesConfigurablesPorSucursal([{ clave }]).length === 1;
      expect(aparece, clave).toBe(!esCapacidadSiempreHabilitada(clave) && !esAccionReservada(clave)); // la reservada (`compra_recibir`) se oculta por otra marca (poda 2/2)
    }
  });

  it("las claves fuera del catálogo (restos de la base) tampoco aparecen", () => {
    expect(accionesConfigurablesPorSucursal([{ clave: "ver_reportes_stock" }])).toEqual([]);
  });
});

describe("(c) la pantalla muestra el valor EFECTIVO y dice cuándo hereda del Default", () => {
  it("sin fila propia + Default apagado: ⛔ (apagado) y hereda", () => {
    expect(capacidadEfectiva("precio_local", filasDe("precio_local", "apagada", "sin_fila"), SUCURSAL)).toEqual({ habilitado: false, heredaDelDefault: true });
  });

  it("sin fila propia + Default prendido: ✅ y hereda", () => {
    expect(capacidadEfectiva("precio_local", filasDe("precio_local", "prendida", "sin_fila"), SUCURSAL)).toEqual({ habilitado: true, heredaDelDefault: true });
  });

  it("sin ninguna fila: ✅ (se puede) y no hereda nada", () => {
    expect(capacidadEfectiva("precio_local", [], SUCURSAL)).toEqual({ habilitado: true, heredaDelDefault: false });
  });

  it("con fila propia: manda la propia y no hereda, aunque el Default diga otra cosa", () => {
    expect(capacidadEfectiva("precio_local", filasDe("precio_local", "apagada", "prendida"), SUCURSAL)).toEqual({ habilitado: true, heredaDelDefault: false });
    expect(capacidadEfectiva("precio_local", filasDe("precio_local", "prendida", "apagada"), SUCURSAL)).toEqual({ habilitado: false, heredaDelDefault: false });
  });

  it("la columna Default (sucursalId null) muestra su fila, o ✅ si no hay, y nunca «hereda»", () => {
    expect(capacidadEfectiva("precio_local", filasDe("precio_local", "apagada", "sin_fila"), null)).toEqual({ habilitado: false, heredaDelDefault: false });
    expect(capacidadEfectiva("precio_local", [], null)).toEqual({ habilitado: true, heredaDelDefault: false });
  });

  it("solo cuentan las filas de ESA acción", () => {
    const filas = [{ accionClave: "carta_ver", sucursalId: null, habilitado: false }];
    expect(capacidadEfectiva("precio_local", filas, SUCURSAL)).toEqual({ habilitado: true, heredaDelDefault: false });
  });
});
