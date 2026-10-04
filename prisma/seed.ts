import "dotenv/config";
import { parseArgs } from "node:util";
import { prisma } from "../src/lib/db";
import { dbDeEmpresa } from "../src/core/auth/base";
import { incorporarPrimerGerente } from "../src/core/permisos/gerencia";
import { ACCIONES } from "../src/core/permisos/acciones";

async function main() {
  // La empresa a sembrar se indica (ADR-022: ya no existe «la única empresa activa» como respaldo): `--empresa <slug>`, o, sin argumento, la empresa por defecto que crea
  // la migración multiempresa_estructura (ADR-007, A2; id `empresa_principal`). `Empresa` no tiene RLS: se la busca con el cliente global.
  const { values } = parseArgs({ options: { empresa: { type: "string" }, gerente: { type: "string" } }, strict: true });
  const { id: empresaId } = await prisma.empresa.findFirstOrThrow({ where: values.empresa ? { slug: values.empresa } : { id: "empresa_principal" } });
  // Todo lo que sigue es de esa empresa: cada operación corre con `app.empresa_id` fijado (el DEFAULT de `empresaId` y el RLS la ven).
  const db = dbDeEmpresa(empresaId);

  // Roles: catálogo único compartido por todo el negocio (ver plan,
  // "Roles/permisos" — decisión confirmada con el dueño tras investigar
  // ERPNext/Dolibarr).
  const [admin, operador] = await Promise.all([
    db.rol.upsert({ where: { empresaId_clave: { empresaId, clave: "admin" } }, update: {}, create: { nombre: "admin", clave: "admin" } }),
    db.rol.upsert({ where: { empresaId_clave: { empresaId, clave: "operador" } }, update: {}, create: { nombre: "operador", clave: "operador" } }),
  ]);
  const rolesPorNombre = { admin, operador } as const;

  for (const accion of ACCIONES) {
    await db.accion.upsert({
      where: { clave: accion.clave },
      update: { descripcion: accion.descripcion },
      create: { clave: accion.clave, descripcion: accion.descripcion },
    });

    for (const nombreRol of ["admin", "operador"] as const) {
      const puedeEditar = (accion.rolesEditarSemilla as readonly string[]).includes(nombreRol);
      // Ver arranca igual a Editar — mismo estado que "Roles Ver" vacío en
      // Apps Script (Core.js:1283-1287).
      await db.permisoRol.upsert({
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
  await db.sucursal.upsert({
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
    await db.unidad.upsert({ where: { empresaId_nombre: { empresaId, nombre: u.nombre } }, update: {}, create: u });
  }

  // Primer gerente de una instalación LOCAL: reemplaza al viejo BOOTSTRAP_ADMIN_EMAILS (ADR-022). En producción el primer gerente llega por la invitación de la consola de plataforma.
  if (values.gerente) {
    const email = values.gerente.trim().toLowerCase();
    const usuario = await prisma.user.upsert({ where: { email }, update: {}, create: { email } });
    const r = await incorporarPrimerGerente(db, { empresaId, usuarioId: usuario.id });
    console.log(r.ok ? `Gerente: ${email} (admin de "${r.sucursalNombre}").` : `Gerente NO asignado: ${r.mensaje}`);
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
