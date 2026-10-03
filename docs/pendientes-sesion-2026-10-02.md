# Pendientes de la sesión del 2026-10-02

Decisiones del dueño sobre los planes de backlog (ocho planes de lectura, cada uno verificado contra el código antes de
proponer) y el orden para implementarlos. Rama `multitenancy-fase-a`; `origin/main` no se toca. Commits/push, siempre con OK
expreso por hash. Todo cambio de schema o de configuración remota va con autorización expresa aparte.

## Correcciones al backlog (verificadas contra el código)

- R1 y R2 del ADR-009 ya estaban resueltas (`35fb344`); el ítem 10 de `pendientes-sesion-2026-09-30.md` quedó atrasado. Abierta: R3.
- Margen objetivo: etapas 0 y 1 hechas (`395e0e3`, `3a48990`); el ítem 9 decía solo "Módulo de margen objetivo".
- Íconos tanda B (`87a99d4`) y dos paneles F0–F2 (`8ea7b0c`) ya están commiteados; `dosPaneles` ya es columna de `Empresa` (`7ec4198`).
- Recetas/carta por sucursal: corridas 1 hechas (`2c8c5db`, `c055f7e`), permisos de carta (`15ca92d`), precio local on/off (`3664052`).
- El índice único de gerente (`20261001240000_gerente_unico_indice`) ya está aplicado en stockhneuquen (79/79 migraciones).
- GitHub no tiene ruleset ni protección de rama; ya se publicó con el gate en rojo (`26867c8`, `00b8ef2`). Dependabot no funciona: su config no está en la rama default (`main`).
- `motor2_plataforma` NO salta RLS (`NOSUPERUSER NOBYPASSRLS`); ninguna migración crea roles; si no existe no se rompe nada.

## Decisiones (2026-10-02)

| Tema | Decisión |
|---|---|
| Gate obligatorio | Vercel primero (Deployment Checks en `motor2-demo` y `stockhneuquen`), ruleset de GitHub después (obliga a pushear vía rama `ci/...`). |
| Dependabot | La rama default de GitHub pasa a `multitenancy-fase-a`; reescribir `.github/dependabot.yml` (semanal, grupos minor/patch, majors aparte, `github-actions` mensual). |
| Worktrees | Limpiar con respaldo (`refs/respaldo/wtN`), quitar `motor2-wt1..5`, `git branch -d` de las 9 ramas `wt/*`, borrar logs. |
| `motor2_plataforma` | Solo código ahora: corregir encabezado del SQL (solo psql), sacar `PLATAFORMA_DATABASE_URL` de `cargar-env-vercel.sh`, test que impide devolver escritura de `Empresa` a `motor2_app`. El rol en Neon, después. |
| Traspaso de gerencia (UI) | Las 4 sugeridas: `conPermisoDeEmpresa("traspasar_gerencia")` (borra `conGerenteDeEmpresa`), confirmar escribiendo el email del destino, descripción de auditoría con emails, mensaje + enlace a `/inicio`. Migración solo de datos. |
| Margen objetivo | Alerta pasiva en Período, solo si la empresa cargó un objetivo; precio de lista y costo de hoy; sin schema ni claves nuevas. |
| R3 ítems agrupados | Por diseño: la carta muestra el mayor y avisa al admin. Tests de caracterización + doc. |
| Carta propia, pregunta P | (c): secciones de empresa; lo propio de cada sucursal es contenido, géneros, agrupados y orden. Promos y cupos intactos. |
| Receta, pregunta Q | No hay capacidad que apague la receta propia: se gobierna solo por permisos. |
| WAF | Por etapas, modo log 48–72 h; enforce solo con OK. |
| Paneles F3 | No mover «Calibrar recetas» (ya está en el panel Sucursal); resumen v1 = nombre de la sucursal visible bajo el selector. |
| Íconos tanda B | Remanente completo (sin POS ni «Quitar» de formularios), guardián para `<summary>`, `aria-label`/`aria-pressed` en capacidades; Δgzip ≤ 1 KB. |

## Orden de implementación (cada tanda = un gate de 7 comandos)

1. **Tanda 0 (sin código nuevo de negocio):** corregir textos desactualizados (este archivo, ítem 10 y 3 y 9 de `pendientes-sesion-2026-09-30.md`, ADR-009 R3, ADR-010 §4, ADR-008, comentario de `gerencia.ts`); tests de caracterización de R3; test de arquitectura de `motor2_plataforma`; correcciones de scripts.
2. **Tanda 1 (sin schema):** íconos remanente; resumen de sucursal v1; alerta de margen en Período.
3. **Tanda 2 (sin schema):** R2 (receta recibe `alcance.sucursalId`, lo ignora) y C2 (`whereCartaDeSucursal`, devuelve `{}`).
4. **Tanda 3 (migración de datos, autorización expresa para aplicar):** UI de gerencia con la clave `traspasar_gerencia`.
5. **Tanda 4 (schema, autorización expresa):** R3 de receta propia por sucursal (`RecetaVersion.sucursalId`, `RecetaSucursal`), luego R4 (permisos `receta_sucursal_*`, copia, aviso «la central cambió»).
6. **Tanda 5 (schema, autorización expresa):** C3/C4 carta propia con la variante (c) de P.
7. **Operaciones (las ejecuta el dueño):** Deployment Checks de Vercel → ruleset de GitHub; default branch + dependabot; WAF en log; limpieza de worktrees; snapshot de Neon.
