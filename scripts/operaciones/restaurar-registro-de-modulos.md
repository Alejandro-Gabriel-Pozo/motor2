# Restaurar o revertir el registro de módulos

Cuándo usar esto: el bloque de módulos (migraciones `20261004120000`, `20261005120000`, `20261006120000`) ya está aplicado en una base y hay que volver
atrás, o el registro de una empresa quedó mal. Todo se hace como DUEÑO de las tablas (`DIRECT_URL`), por base y con autorización expresa, cargando el
archivo de entorno con `scripts/operaciones/con-env.mjs <archivo-env> -- <comando>` (nunca se escriben ni se muestran las claves).

## 1. Una empresa con módulos mal puestos (el caso común)

No hace falta revertir nada. Se corrige con la vía de la plataforma, que valida la clausura y deja auditoría:

    npm run modulos-empresa -- --slug <empresa> --actor <email-del-operador> --activar a,b --desactivar c

Los módulos se desactivan, nunca se borran filas. Si el registro de una empresa se perdió entero, se vuelve a cargar con `--activar` de sus módulos
vendibles. Antes de tocar nada, guardar el estado actual: `SELECT * FROM "ModuloEmpresa" WHERE "empresaId" = '<id>'`.

## 2. Revertir una migración del bloque

Cada migración tiene su `down.sql` (no lo corre Prisma). Orden obligatorio, de la más nueva a la más vieja, y **primero el código**:

| Migración | Antes de correr su `down.sql` | Qué se pierde |
|---|---|---|
| `20261006120000_clave_de_rol_de_sistema` | revertir en el código G1 (`4f04379`) y lo que lee `Rol.clave` | nada: la clave de un rol de sistema es su nombre y se recalcula al volver a aplicar |
| `20261005120000_renombrar_boleta_a_ticket` | revertir el renombre en el código | solo vuelve el esquema y las claves; el rollback del deploy es la rama de Neon |
| `20261004120000_registro_de_modulos_por_empresa` | revertir P7, P8 y P9 (sin eso el guard vuelve a ignorar la tabla) | el registro de TODAS las empresas: guardar antes `SELECT * FROM "ModuloEmpresa"` |

Para cada una:

    node scripts/operaciones/con-env.mjs <archivo-env> -- npx prisma db execute --file prisma/migrations/<migración>/down.sql
    node scripts/operaciones/con-env.mjs <archivo-env> -- npx prisma migrate resolve --rolled-back <migración>

`git revert --no-edit <hash>` deshace el commit de código correspondiente; los commits del bloque son uno por paso.

## 3. Volver el DEPLOY completo (código viejo + base vieja)

La reversa de esquema no alcanza para un deploy ya publicado: se restaura la rama de Neon de respaldo tomada antes de aplicar las migraciones
(`pre-modulos-2026-10-03` en el proyecto de zuluhub) y se vuelve a desplegar el código anterior. Se pierde lo escrito en esa base desde el snapshot.

## 4. Después de cualquier restauración

`node scripts/operaciones/con-env.mjs <archivo-env> -- npx prisma migrate status` y, si el bloque sigue aplicado, `... -- npx tsx scripts/verificar-registro-de-modulos.ts`
(tiene que salir con código 0).
