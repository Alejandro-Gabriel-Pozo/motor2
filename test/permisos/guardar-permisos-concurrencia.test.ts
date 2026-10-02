import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma, prismaAdmin } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { guardarPermisos } from "../../src/server/actions/permisos/permisos";
import { ACCIONES, rolAlcanzaLaAccion } from "../../src/core/permisos/acciones";
import { SIN_PERMISO } from "../../src/core/permisos/matriz";

/**
 * Concurrencia REAL de «Guardar» en la matriz de permisos (Promise.allSettled contra Postgres, sin mocks de base).
 *
 * Por qué existe: `guardarPermisos` compara lo que la persona VIO (`anterior`) con lo que hay en la base y recién después escribe.
 * En READ COMMITTED, dos «Confirmar y guardar» sobre la MISMA celda podían leer los dos el estado viejo, pasar los dos la comparación y
 * aplicar los dos: `ok: true` en ambos, el cambio de una persona pisado en silencio y el aviso de conflicto sin dispararse. Peor: la
 * auditoría del segundo guardaba un `valorAnterior` falso. Con SERIALIZABLE + reintento (`conTransaccionSerializable`) el segundo aborta
 * con 40001, reintenta, relee el estado nuevo y ahí sí devuelve «Otra persona cambió…».
 *
 * El fallo depende del timing (si el `findMany` del segundo cae DESPUÉS del commit del primero, hoy funciona por casualidad), así que
 * cada caso va en loop, igual que test/auditoria/concurrencia-idempotencia.test.ts.
 *
 * Igual que test/auditoria/traspasos-en-transito.test.ts: el mock de sesión es global al proceso, así que las dos llamadas concurrentes
 * son del mismo usuario. No es una limitación real: dos pestañas del mismo administrador o un doble clic son idénticos desde la base, y
 * `guardarPermisos` no distingue por actor al detectar conflictos.
 */
const ITERACIONES = 12;

// Acciones en las que el operador arranca SIN acceso (así el estado inicial de cada celda es SIN_PERMISO y no depende de la semilla exacta).
// Solo las que el rol operador PUEDE tener por su nivel (el piso de la acción manda: las de administrador no se le pueden dar).
const ACCIONES_SIN_ACCESO_DEL_OPERADOR = ACCIONES.filter((a) => !(a.rolesEditarSemilla as readonly string[]).includes("operador") && rolAlcanzaLaAccion("operador", a.clave)).map((a) => a.clave);

describe("guardarPermisos — concurrencia real", () => {
  let operadorRolId: string;

  const estado = async (accionClave: string) => {
    const f = await prisma.permisoRol.findUnique({ where: { rolId_accionClave: { rolId: operadorRolId, accionClave } } });
    return f ? { puedeVer: f.puedeVer, puedeEditar: f.puedeEditar } : SIN_PERMISO;
  };
  /** Deja las celdas en SIN_PERMISO y borra la auditoría, para que cada iteración parta del mismo estado. */
  const reiniciar = async (claves: string[]) => {
    await prisma.permisoRol.updateMany({ where: { rolId: operadorRolId, accionClave: { in: claves } }, data: { puedeVer: false, puedeEditar: false } });
    await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "PermisoRol" } });
  };
  const cambio = (accionClave: string, nuevo: { puedeVer: boolean; puedeEditar: boolean }) => ({ rolId: operadorRolId, accionClave, anterior: SIN_PERMISO, nuevo });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    operadorRolId = base.operador.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("dos guardados sobre la MISMA celda desde el mismo estado: gana uno, el otro recibe el aviso de conflicto, y la auditoría no miente", async () => {
    expect(ACCIONES_SIN_ACCESO_DEL_OPERADOR.length).toBeGreaterThan(3);
    const ACCION = ACCIONES_SIN_ACCESO_DEL_OPERADOR[0];
    const soloVer = { puedeVer: true, puedeEditar: false };
    const verYEditar = { puedeVer: true, puedeEditar: true };

    for (let i = 0; i < ITERACIONES; i++) {
      await reiniciar([ACCION]);
      const settled = await Promise.allSettled([guardarPermisos([cambio(ACCION, soloVer)]), guardarPermisos([cambio(ACCION, verYEditar)])]);

      // Ninguna promesa rechaza: un conflicto de serialización que llegara hasta acá sería un error de servidor crudo.
      expect(settled.every((s) => s.status === "fulfilled"), `iteración ${i}: una promesa rechazó`).toBe(true);
      const resultados = settled.map((s) => (s as PromiseFulfilledResult<Awaited<ReturnType<typeof guardarPermisos>>>).value);

      const oks = resultados.filter((r) => r.ok);
      expect(oks.length, `iteración ${i}: tenían que ganar EXACTAMENTE uno (ganaron ${oks.length}: los dos vieron el estado viejo y aplicaron)`).toBe(1);
      const ganador = resultados[0].ok ? 0 : 1;
      const perdedor = resultados[ganador === 0 ? 1 : 0];
      expect(perdedor.ok, `iteración ${i}`).toBe(false);
      if (!perdedor.ok) expect(perdedor.mensaje, `iteración ${i}`).toMatch(/Otra persona cambió/);

      // El estado final es EXACTAMENTE el pedido por quien ganó: ni un híbrido ni el del perdedor.
      expect(await estado(ACCION), `iteración ${i}: el estado final no es el del ganador`).toEqual(ganador === 0 ? soloVer : verYEditar);

      // La auditoría cuenta solo lo que pasó de verdad: una sola fila de «ver» (false → true), no dos.
      const auditoria = await prisma.registroAuditoria.findMany({ where: { entidad: "PermisoRol" } });
      const filasVer = auditoria.filter((a) => a.campo === "puedeVer");
      expect(filasVer.length, `iteración ${i}: la auditoría registró ${filasVer.length} cambios de «ver» (el del perdedor también, con un valor anterior falso)`).toBe(1);
      expect(filasVer[0].valorAnterior, `iteración ${i}`).toBe("false");
      expect(filasVer[0].valorNuevo, `iteración ${i}`).toBe("true");
      const filasEditar = auditoria.filter((a) => a.campo === "puedeEditar");
      expect(filasEditar.length, `iteración ${i}`).toBe(ganador === 1 ? 1 : 0);
    }
  });

  it("el reintento es parte del contrato: dos guardados sobre celdas DISTINTAS terminan los dos bien, sin promesas rechazadas", async () => {
    // `PermisoRol` es una tabla chica (unas 100 filas): Postgres suele leerla con un Seq Scan, y bajo SERIALIZABLE el bloqueo de predicado
    // cae sobre TODA la relación. Dos guardados sin relación entre sí pueden chocar igual (40001); lo que evita que uno falle es el
    // reintento. Este caso se rompe si alguien saca el reintento o lo implementa mal.
    const [celdaA, celdaB] = ACCIONES_SIN_ACCESO_DEL_OPERADOR;
    const soloVer = { puedeVer: true, puedeEditar: false };

    for (let i = 0; i < ITERACIONES; i++) {
      await reiniciar([celdaA, celdaB]);
      const settled = await Promise.allSettled([guardarPermisos([cambio(celdaA, soloVer)]), guardarPermisos([cambio(celdaB, soloVer)])]);

      expect(settled.every((s) => s.status === "fulfilled"), `iteración ${i}: una promesa rechazó (un conflicto no se absorbió con el reintento)`).toBe(true);
      for (const s of settled) {
        const r = (s as PromiseFulfilledResult<Awaited<ReturnType<typeof guardarPermisos>>>).value;
        expect(r.ok, `iteración ${i}: ${r.ok ? "" : r.mensaje}`).toBe(true);
      }
      expect(await estado(celdaA), `iteración ${i}`).toEqual(soloVer);
      expect(await estado(celdaB), `iteración ${i}`).toEqual(soloVer);
    }
  });

  it("todo o nada bajo concurrencia: si el guardado pierde, NO deja escritas las celdas que no chocaban", async () => {
    const libres = ACCIONES_SIN_ACCESO_DEL_OPERADOR;
    expect(libres.length).toBeGreaterThanOrEqual(9);
    const compartida = libres[0];
    const propiasDeA = libres.slice(1, 5);
    const propiasDeB = libres.slice(5, 9);
    const soloVer = { puedeVer: true, puedeEditar: false };

    for (let i = 0; i < 4; i++) {
      await reiniciar(libres);
      const settled = await Promise.allSettled([
        guardarPermisos([...propiasDeA, compartida].map((k) => cambio(k, soloVer))),
        guardarPermisos([...propiasDeB, compartida].map((k) => cambio(k, soloVer))),
      ]);
      expect(settled.every((s) => s.status === "fulfilled"), `iteración ${i}: una promesa rechazó`).toBe(true);
      const resultados = settled.map((s) => (s as PromiseFulfilledResult<Awaited<ReturnType<typeof guardarPermisos>>>).value);
      expect(resultados.filter((r) => r.ok).length, `iteración ${i}: tenía que ganar EXACTAMENTE uno`).toBe(1);

      const ganoA = resultados[0].ok;
      const propiasDelPerdedor = ganoA ? propiasDeB : propiasDeA;
      const propiasDelGanador = ganoA ? propiasDeA : propiasDeB;
      for (const k of propiasDelGanador) expect(await estado(k), `iteración ${i}: ${k} del ganador`).toEqual(soloVer);
      for (const k of propiasDelPerdedor) expect(await estado(k), `iteración ${i}: ${k} del perdedor quedó escrita a pesar del rechazo`).toEqual(SIN_PERMISO);
      expect(await estado(compartida), `iteración ${i}`).toEqual(soloVer);
    }
  });
});
