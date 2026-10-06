import type { Prisma } from "@prisma/client";
import { DESTINOS_CONSUMO_SEMILLA, MOTIVOS_MERMA_SEMILLA } from "@/core/movimientos/public";
import { ACCIONES } from "@/core/permisos/acciones";
import { CLAVE_ROL_ADMIN, CLAVE_ROL_OPERADOR } from "@/core/permisos/jerarquia";

/** Mismas 5 unidades base que `prisma/seed.ts` (decimales por magnitud, como DECIMALES_DEFAULT_POR_CATEGORIA_ de Apps Script). */
const UNIDADES_BASE: ReadonlyArray<{
  nombre: string;
  magnitud: "PESO" | "VOLUMEN" | "CANTIDAD";
  decimales: number;
}> = [
  { nombre: "kg", magnitud: "PESO", decimales: 2 },
  { nombre: "g", magnitud: "PESO", decimales: 0 },
  { nombre: "l", magnitud: "VOLUMEN", decimales: 2 },
  { nombre: "ml", magnitud: "VOLUMEN", decimales: 0 },
  { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 },
];

/**
 * Lo que toda empresa nueva necesita para existir, sin personas: roles admin/operador con su matriz de permisos, unidades base, motivos de
 * merma, destinos de consumo y su primera sucursal. Lo comparten `crearEmpresa` (alta directa) y el alta de la consola (E5, ADR-020).
 *
 * `tx` ya tiene fijado `app.empresa_id` en `empresaId` (el RLS de las tablas sembradas lo exige).
 */
export async function sembrarEmpresa(tx: Prisma.TransactionClient, empresaId: string, nombreSucursal: string) {
  // `Accion` es global (una fila por clave para todo el sistema): las de la primera empresa ya están, no se pisan.
  await tx.accion.createMany({
    data: ACCIONES.map((a) => ({ clave: a.clave, descripcion: a.descripcion })),
    skipDuplicates: true,
  });

  const rolAdmin = await tx.rol.create({
    data: { empresaId, nombre: "admin", clave: CLAVE_ROL_ADMIN },
  });
  const rolOperador = await tx.rol.create({
    data: { empresaId, nombre: "operador", clave: CLAVE_ROL_OPERADOR },
  });
  const rolesPorNombre = { admin: rolAdmin, operador: rolOperador } as const;
  await tx.permisoRol.createMany({
    data: ACCIONES.flatMap((accion) =>
      (["admin", "operador"] as const).map((nombreRol) => {
        const puedeEditar = (accion.rolesEditarSemilla as readonly string[]).includes(nombreRol);
        // Ver arranca igual a Editar (mismo estado que en el seed).
        return {
          empresaId,
          rolId: rolesPorNombre[nombreRol].id,
          accionClave: accion.clave,
          puedeEditar,
          puedeVer: puedeEditar,
        };
      }),
    ),
  });

  await tx.unidad.createMany({
    data: UNIDADES_BASE.map((u) => ({ empresaId, ...u })),
  });
  await tx.motivoMerma.createMany({
    data: MOTIVOS_MERMA_SEMILLA.map((m) => ({
      empresaId,
      nombre: m.nombre,
      descripcion: m.descripcion ?? null,
    })),
  });
  await tx.destinoConsumo.createMany({
    data: DESTINOS_CONSUMO_SEMILLA.map((d) => ({
      empresaId,
      nombre: d.nombre,
      descripcion: d.descripcion ?? null,
    })),
  });

  const sucursal = await tx.sucursal.create({
    data: { empresaId, nombre: nombreSucursal },
  });
  return { rolAdmin, rolOperador, sucursal };
}
