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
