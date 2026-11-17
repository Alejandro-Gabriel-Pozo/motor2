import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { decidirEnEmpresa, nivelesEnLaEmpresa, type MembresiaParaEmpresa } from "../../src/core/permisos/decision-de-acceso";
import { cambiarHoraDeCorteDeSucursal } from "../../src/server/actions/auth/sucursales";
import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { CASOS_DEL_DISENO, FILAS_DE_LA_MATRIZ, permitidoEsperado, ROLES_DE_EMPRESA, ROLES_DE_MEMBRESIA, type CombinacionDeAcceso } from "./oraculo-de-hora-de-corte";

/**
 * C2c: combinaciones rol × piso × fila de `renombrar_sucursal` (el permiso de cambiar la hora de corte; dueño 2026-11-17, «5.- recomendado»), contra el oráculo escrito aparte
 * (`oraculo-de-hora-de-corte.ts`). Dos niveles: (1) las funciones puras de decisión (`nivelesEnLaEmpresa` + `decidirEnEmpresa`) con TODAS las combinaciones; (2) la Server Action real
 * `cambiarHoraDeCorteDeSucursal` contra Postgres con un usuario real de cada tipo del diseño: lo permitido escribe, lo rechazado no deja rastro.
 *
 * Mutaciones (rojo/verde): sacar `conPermisoDeEmpresa("renombrar_sucursal", …)` de `cambiarHoraDeCorteDeSucursal` (`src/server/actions/auth/sucursales.ts`) deja en rojo los casos
 * rechazados de la parte (2) (la hora se escribiría); cambiar el piso de `renombrar_sucursal` en `acciones.ts` deja en rojo la parte (1).
 */
const CLAVE = "renombrar_sucursal" as const;

function membresiasDe(c: CombinacionDeAcceso): MembresiaParaEmpresa[] {
  if (c.rolDeMembresia === "ninguno") return [];
  const permisos = c.fila === "sin_fila" ? [] : [{ accionClave: CLAVE, puedeVer: true, puedeEditar: c.fila === "editar_prendida" }];
  const rol = c.rolDeMembresia === "propio" ? { nombre: "encargado", clave: null } : { nombre: c.rolDeMembresia, clave: c.rolDeMembresia };
  return [{ rol: { ...rol, permisos } }];
}

function decidePuro(c: CombinacionDeAcceso): boolean {
  const resultado = nivelesEnLaEmpresa({
    membresias: membresiasDe(c),
    habilitadas: membresiasDe(c).map(() => new Set([CLAVE])),
    efectivos: null,
    rolEmpresa: c.rolDeEmpresa === "ninguno" ? null : c.rolDeEmpresa,
    claves: [CLAVE],
  });
  return decidirEnEmpresa(resultado, CLAVE, "editar").ok;
}

describe("hora de corte: quién puede cambiarla (rol × piso × fila), decisión pura", () => {
  it("los casos con nombre del diseño dan lo que dice el oráculo", () => {
    for (const caso of CASOS_DEL_DISENO) expect(decidePuro(caso.combinacion), caso.nombre).toBe(caso.permitido);
  });

  it("TODAS las combinaciones de rol de membresía × fila × rol de empresa dan lo que dice la regla del oráculo", () => {
    let total = 0;
    for (const rolDeMembresia of ROLES_DE_MEMBRESIA) {
      for (const fila of FILAS_DE_LA_MATRIZ) {
        for (const rolDeEmpresa of ROLES_DE_EMPRESA) {
          const c = { rolDeMembresia, fila, rolDeEmpresa };
          expect(decidePuro(c), JSON.stringify(c)).toBe(permitidoEsperado(c));
          total++;
        }
      }
    }
    expect(total).toBe(ROLES_DE_MEMBRESIA.length * FILAS_DE_LA_MATRIZ.length * ROLES_DE_EMPRESA.length);
  });
});

describe("hora de corte: la Server Action real respeta el oráculo (Postgres real)", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  async function armar(c: CombinacionDeAcceso) {
    const base = await sembrarBase();
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    let rolId: string | null = null;
    if (c.rolDeMembresia === "admin") rolId = base.admin.id;
    else if (c.rolDeMembresia === "operador") rolId = base.operador.id;
    else if (c.rolDeMembresia === "propio") rolId = (await prismaAdmin.rol.create({ data: { nombre: "encargado", empresaId: EMPRESA_POR_DEFECTO_ID } })).id;
    // La fila del rol de la combinación (la semilla trae la de `admin` prendida y la de `operador` apagada).
    if (rolId) {
      await prismaAdmin.permisoRol.deleteMany({ where: { rolId, accionClave: CLAVE } });
      if (c.fila !== "sin_fila") await prismaAdmin.permisoRol.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, rolId, accionClave: CLAVE, puedeVer: true, puedeEditar: c.fila === "editar_prendida" } });
    }
    const usuario = rolId
      ? await crearUsuarioConMembresia({ email: "actor@test.com", sucursalId: base.sucursal.id, rolId })
      : await prisma.user.create({ data: { email: "actor@test.com" } });
    if (c.rolDeEmpresa === "gerente") await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: usuario.id, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { rolEmpresa: "gerente" } });
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });
    return { norte };
  }

  const horaEnBase = async (id: string) => {
    const r = await prismaAdmin.$queryRaw<{ h: string }[]>`SELECT to_char("horaDeCorte", 'HH24:MI') AS h FROM "Sucursal" WHERE id = ${id}`;
    return r[0]!.h;
  };

  for (const caso of CASOS_DEL_DISENO) {
    it(`${caso.nombre}: ${caso.permitido ? "permitido (escribe y audita)" : "rechazado (no escribe ni audita)"}`, async () => {
      const { norte } = await armar(caso.combinacion);
      const antes = await prismaAdmin.registroAuditoria.count({ where: { campo: "horaDeCorte" } });
      if (caso.combinacion.rolDeMembresia === "ninguno") {
        // Sin ninguna membresía no hay contexto de usuario: la acción redirige al ingreso (no devuelve un resultado) y no escribe.
        await expect(cambiarHoraDeCorteDeSucursal(norte.id, "06:00")).rejects.toThrow("NEXT_REDIRECT");
      } else {
        const r = await cambiarHoraDeCorteDeSucursal(norte.id, "06:00");
        expect(r.ok, r.mensaje).toBe(caso.permitido);
      }
      expect(await horaEnBase(norte.id)).toBe(caso.permitido ? "06:00" : "00:00");
      expect(await prismaAdmin.registroAuditoria.count({ where: { campo: "horaDeCorte" } })).toBe(antes + (caso.permitido ? 1 : 0));
    });
  }
});
