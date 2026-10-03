import "dotenv/config";
import { prisma } from "../src/lib/db";
import { ACCIONES } from "../src/core/permisos/acciones";

async function main() {
  // La empresa por defecto la crea la migración multiempresa_estructura (ADR-007, A2); acá solo se la busca.
  const { id: empresaId } = await prisma.empresa.findFirstOrThrow({ where: { estado: "ACTIVE" } });

  // Roles: catálogo único compartido por todo el negocio (ver plan,
  // "Roles/permisos" — decisión confirmada con el dueño tras investigar
  // ERPNext/Dolibarr).
  const [admin, operador] = await Promise.all([
    prisma.rol.upsert({ where: { empresaId_nombre: { empresaId, nombre: "admin" } }, update: {}, create: { nombre: "admin", clave: "admin" } }),
    prisma.rol.upsert({ where: { empresaId_nombre: { empresaId, nombre: "operador" } }, update: {}, create: { nombre: "operador", clave: "operador" } }),
  ]);
  const rolesPorNombre = { admin, operador } as const;

  for (const accion of ACCIONES) {
    await prisma.accion.upsert({
      where: { clave: accion.clave },
      update: { descripcion: accion.descripcion },
      create: { clave: accion.clave, descripcion: accion.descripcion },
    });

    for (const nombreRol of ["admin", "operador"] as const) {
      const puedeEditar = (accion.rolesEditarSemilla as readonly string[]).includes(nombreRol);
      // Ver arranca igual a Editar — mismo estado que "Roles Ver" vacío en
      // Apps Script (Core.js:1283-1287).
      await prisma.permisoRol.upsert({
        where: {
          rolId_accionClave: { rolId: rolesPorNombre[nombreRol].id, accionClave: accion.clave },
        },
        update: {},
        create: {
          rolId: rolesPorNombre[nombreRol].id,
          accionClave: accion.clave,
          puedeEditar,
          puedeVer: puedeEditar,
        },
      });
    }
  }

  // Sucursal inicial — punto de anclaje para el bootstrap del primer admin
  // (ver src/core/auth/bootstrap.ts).
  await prisma.sucursal.upsert({
    where: { empresaId_nombre: { empresaId, nombre: "Central" } },
    update: {},
    create: { nombre: "Central" },
  });

  // Unidades base — semilla mínima para poder cargar el primer producto sin
  // pasar antes por la pantalla de Unidades. Decimales por defecto según
  // magnitud, mismo criterio que DECIMALES_DEFAULT_POR_CATEGORIA_
  // (Catalogo.js:2671).
  const unidadesBase: Array<{ nombre: string; magnitud: "PESO" | "VOLUMEN" | "CANTIDAD"; decimales: number }> = [
    { nombre: "kg", magnitud: "PESO", decimales: 2 },
    { nombre: "g", magnitud: "PESO", decimales: 0 },
    { nombre: "l", magnitud: "VOLUMEN", decimales: 2 },
    { nombre: "ml", magnitud: "VOLUMEN", decimales: 0 },
    { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 },
  ];
  for (const u of unidadesBase) {
    await prisma.unidad.upsert({ where: { empresaId_nombre: { empresaId, nombre: u.nombre } }, update: {}, create: u });
  }

  console.log(
    `Seed OK: ${ACCIONES.length} acciones, roles admin/operador, sucursal "Central", ${unidadesBase.length} unidades base.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
