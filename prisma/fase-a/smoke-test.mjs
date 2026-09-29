// Smoke test manual de la Fase A: valida que el Prisma Client aislado
// (node_modules/.prisma/fase-a-client, generado desde prisma/fase-a/schema.prisma)
// funciona de punta a punta contra el Neon dedicado de .env.multitenancy.
// No se ejecuta en CI ni en el gate de verificación real — es una
// herramienta de esta rama mientras el schema todavía no se integra a
// prisma/schema.prisma. Requiere FASE_A_DIRECT_URL en el entorno.
import { PrismaClient } from "../../node_modules/.prisma/fase-a-client/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.FASE_A_DIRECT_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const empresa = await prisma.empresa.create({
    data: {
      id: "smoke_empresa_1",
      nombre: "Empresa Smoke Test",
      slug: "empresa-smoke-test",
      zonaHoraria: "America/Argentina/Buenos_Aires",
      moneda: "ARS",
    },
  });
  console.log("Empresa creada:", empresa.id, empresa.estado);

  const sucursal = await prisma.sucursal.create({
    data: { id: "smoke_suc_1", nombre: "Sucursal Smoke", empresaId: empresa.id },
  });
  console.log("Sucursal creada:", sucursal.id, "empresaId:", sucursal.empresaId);

  const usuario = await prisma.user.create({
    data: { id: "smoke_user_1", email: "smoke-fase-a@example.test" },
  });

  const membresia = await prisma.usuarioEmpresa.create({
    data: { usuarioId: usuario.id, empresaId: empresa.id, rolEmpresa: "gerente" },
  });
  console.log("UsuarioEmpresa creada:", membresia.id, "rolEmpresa:", membresia.rolEmpresa);

  const conRelaciones = await prisma.empresa.findUnique({
    where: { id: empresa.id },
    include: { sucursales: true, usuarios: true },
  });
  console.log(
    "Empresa con relaciones -> sucursales:",
    conRelaciones.sucursales.length,
    "usuarios:",
    conRelaciones.usuarios.length
  );

  // Carta multisucursal + sincronización de precios (plan del panel, 2.4/2.5).
  const seccion = await prisma.seccionCarta.create({
    data: { id: "smoke_seccion_1", nombre: "Sección Smoke", empresaId: empresa.id },
  });
  console.log("SeccionCarta creada:", seccion.id, "alcance:", seccion.alcance);

  const seccionSucursal = await prisma.seccionCartaSucursal.create({
    data: { empresaId: empresa.id, seccionCartaId: seccion.id, sucursalId: sucursal.id },
  });
  console.log("SeccionCartaSucursal creada:", seccionSucursal.seccionCartaId, seccionSucursal.sucursalId);

  const promo = await prisma.promoCarta.create({
    data: {
      id: "smoke_promo_1",
      empresaId: empresa.id,
      sucursalId: sucursal.id,
      seccionCartaId: seccion.id,
      titulo: "Promo Smoke",
      precio: "100.00",
    },
  });
  console.log("PromoCarta creada:", promo.id, "empresaId:", promo.empresaId);

  const grupo = await prisma.grupoSincroPrecio.create({
    data: { id: "smoke_grupo_1", empresaId: empresa.id, nombre: "Grupo Smoke" },
  });
  const grupoSucursal = await prisma.grupoSincroPrecioSucursal.create({
    data: { empresaId: empresa.id, grupoId: grupo.id, sucursalId: sucursal.id },
  });
  console.log("GrupoSincroPrecio creado:", grupo.id, "sucursal:", grupoSucursal.sucursalId);

  await prisma.grupoSincroPrecioSucursal.delete({
    where: { grupoId_sucursalId: { grupoId: grupo.id, sucursalId: sucursal.id } },
  });
  await prisma.grupoSincroPrecio.delete({ where: { id: grupo.id } });
  await prisma.promoCarta.delete({ where: { id: promo.id } });
  await prisma.seccionCartaSucursal.delete({
    where: { seccionCartaId_sucursalId: { seccionCartaId: seccion.id, sucursalId: sucursal.id } },
  });
  await prisma.seccionCarta.delete({ where: { id: seccion.id } });

  await prisma.usuarioEmpresa.delete({ where: { id: membresia.id } });
  await prisma.user.delete({ where: { id: usuario.id } });
  await prisma.sucursal.delete({ where: { id: sucursal.id } });
  await prisma.empresa.delete({ where: { id: empresa.id } });
  console.log("Limpieza OK");
}

main()
  .catch((e) => {
    console.error("SMOKE TEST FALLÓ:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
