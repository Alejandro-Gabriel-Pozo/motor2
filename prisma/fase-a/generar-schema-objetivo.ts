// Genera prisma/fase-a/schema.prisma (schema OBJETIVO de la Fase F, ADR-007 paso A1) a partir de
// prisma/schema.prisma real, para que la prueba no dependa de una copia mantenida a mano.
// Uso: `npx tsx prisma/fase-a/generar-schema-objetivo.ts` (no toca ninguna base ni el Client real).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const GLOBALES = new Set([
  "User",
  "Account",
  "Session",
  "VerificationToken",
  "Accion",
  "IndicePrecio",
  "CotizacionDolar",
]);
// Unicidades por campo que pasan a ser por empresa (ADR-007, "Unicidades por empresa").
const UNICOS_POR_EMPRESA = new Set(["nombre", "codigo", "slug"]);

const raiz = process.cwd();
const origen = readFileSync(join(raiz, "prisma", "schema.prisma"), "utf8").replace(/\r\n/g, "\n");
const lineas = origen.split("\n");

const modelos = new Set<string>();
for (const l of lineas) {
  const m = /^model (\w+) \{/.exec(l);
  if (m) modelos.add(m[1]);
}
const tenant = [...modelos].filter((m) => !GLOBALES.has(m));
const esTenant = (m: string) => modelos.has(m) && !GLOBALES.has(m);

// Campos FK de relaciones compuestas por modelo: un `@unique` sobre ellos (1:1) pasa a `@@unique([empresaId, campo])`.
const fkPorModelo = new Map<string, Set<string>>();
{
  let m: string | null = null;
  for (const l of lineas) {
    const abre = /^model (\w+) \{/.exec(l);
    if (abre) m = abre[1];
    if (l === "}") m = null;
    const campo = /^\s+(\w+)\s+(\w+)(\[\]|\?)?\s*(.*)$/.exec(l);
    const fk = /fields: \[([^\]]+)\], references: \[id\]/.exec(l);
    if (m && esTenant(m) && campo && fk && esTenant(campo[2])) {
      const set = fkPorModelo.get(m) ?? new Set<string>();
      set.add(fk[1]);
      fkPorModelo.set(m, set);
    }
  }
}

const lc = (s: string) => s[0].toLowerCase() + s.slice(1);
const salida: string[] = [];
let actual: string | null = null;
let tieneId = false;
let composites = 0;
const pendientes: string[] = [];

for (let l of lineas) {
  const abre = /^model (\w+) \{/.exec(l);
  if (abre) {
    actual = abre[1];
    tieneId = false;
  }
  if (actual && esTenant(actual)) {
    const campo = /^\s+(\w+)\s+(\w+)(\[\]|\?)?\s*(.*)$/.exec(l);
    if (campo && campo[1] === "id" && /@id\b/.test(l)) {
      tieneId = true;
      salida.push(l);
      salida.push(`  empresaId String @default(dbgenerated("app_empresa_actual()"))`);
      salida.push(`  empresa   Empresa @relation(fields: [empresaId], references: [id])`);
      continue;
    }
    if (campo && /fields: \[/.test(l) && esTenant(campo[2])) {
      l = l.replace(/fields: \[([^\]]+)\], references: \[id\]/, "fields: [empresaId, $1], references: [empresaId, id]");
      composites++;
    }
    const esUnicoPorEmpresa = campo && (UNICOS_POR_EMPRESA.has(campo[1]) || fkPorModelo.get(actual)?.has(campo[1]));
    if (campo && esUnicoPorEmpresa && /@unique\b/.test(l) && !campo[3]) {
      l = l.replace(/\s*@unique\b/, "");
      pendientes.push(`  @@unique([empresaId, ${campo[1]}])`);
    }
    if (l === "}") {
      if (!tieneId) throw new Error(`${actual}: sin campo id con @id`);
      for (const p of pendientes) salida.push(p);
      pendientes.length = 0;
      salida.push("  @@unique([empresaId, id])");
    }
  } else if (actual === "User" && l === "}") {
    salida.push("  empresas                  UsuarioEmpresa[]");
  }
  if (l === "}") actual = null;
  salida.push(l);
}
let texto = salida.join("\n");
texto = texto.replace(
  /generator client \{\n  provider = "prisma-client-js"\n\}/,
  `// ===================================================================\n// SCHEMA OBJETIVO DE LA FASE F (ADR-007 A1) — GENERADO por\n// prisma/fase-a/generar-schema-objetivo.ts desde prisma/schema.prisma. No se edita a mano.\n// Client aislado: nunca pisa @prisma/client. Ver ADR-004 y ADR-007.\n// ===================================================================\n\ngenerator client {\n  provider = "prisma-client-js"\n  output   = "../../node_modules/.prisma/fase-a-client"\n}`,
);

const backRel = tenant.map((m) => `  ${lc(m)}Rel ${m}[]`).join("\n");
texto += `
// ===================================================================
// PLATAFORMA (Fase F) — Empresa y su pertenencia de usuarios. Sin RLS por empresa.
// ===================================================================

enum EstadoEmpresa {
  PROVISIONING
  ACTIVE
  SUSPENDED
  DELETING
}

model Empresa {
  id          String        @id @default(cuid())
  nombre      String        @unique
  slug        String        @unique
  cuit        String?
  zonaHoraria String
  moneda      String
  estado      EstadoEmpresa @default(PROVISIONING)
  creadoEn    DateTime      @default(now())

  usuarios UsuarioEmpresa[]
${backRel}
}

model UsuarioEmpresa {
  id         String   @id @default(cuid())
  usuarioId  String
  usuario    User     @relation(fields: [usuarioId], references: [id])
  empresaId  String
  empresa    Empresa  @relation(fields: [empresaId], references: [id])
  rolEmpresa String?
  activo     Boolean  @default(true)
  creadoEn   DateTime @default(now())

  @@unique([usuarioId, empresaId])
}
`;

writeFileSync(join(raiz, "prisma", "fase-a", "schema.prisma"), texto);
console.log(`modelos=${modelos.size} globales=${GLOBALES.size} tenant=${tenant.length} fkCompuestas=${composites}`);
