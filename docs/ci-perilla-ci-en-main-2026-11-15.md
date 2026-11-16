# Perilla `CI_EN_MAIN`: el CI completo en `main` se prende y se apaga

Pedido del dueño (2026-11-15, chat con el orquestador): «Creo que la opción es sacar el CI de main por completo. Siempee y cuando sea como una perilla que se activa/desactiva cuando querramos volver a tener en main el CI, SE PUEDE?».

## Qué hace

Cada merge a `main` volvía a correr el CI completo (`ci.yml`, 25 trabajos) y `seguridad.yml`. Con la regla de `main` «PR al día», el árbol que queda en `main` es idéntico al que el PR ya probó: la segunda corrida era trabajo repetido que además competía por runners con el PR siguiente.

La perilla es la variable de repositorio de GitHub Actions `CI_EN_MAIN`:

| Valor de `CI_EN_MAIN` | Push a `main` |
|---|---|
| `si` | corre todo, como antes |
| cualquier otro valor, o la variable no existe | **se omiten** los trabajos pesados (valor por defecto: apagada, decisión del dueño) |

Se omiten solo con `github.event_name == 'push' && github.ref == 'refs/heads/main' && vars.CI_EN_MAIN != 'si'`:

- `ci.yml`: `estatico`, `build`, `integracion`, `e2e` y `gate` (el gate lleva la misma condición, así que se omite en vez de fallar).
- `seguridad.yml`: `dependencias`, `pruebas-de-seguridad` y `zap`.

**Nunca se omiten** en `pull_request` (el Gate requerido de los PR sigue exigiendo todo y falla si algo se omitió), en `push` a `ci/**`, en `workflow_dispatch` ni en el cron semanal de `seguridad.yml`.

Con la perilla apagada, `main` corre solo `codeql.yml` y `gitleaks.yml` (livianos; no se tocaron).

## Cómo prenderla y apagarla (sin tocar código)

1. Desde GitHub: Settings → Secrets and variables → Actions → pestaña Variables → `CI_EN_MAIN` (crearla o editarla): valor `si` para prender; borrarla o cambiar el valor para apagar.
2. Desde la terminal: `gh variable set CI_EN_MAIN --body si` (prender) y `gh variable delete CI_EN_MAIN` (apagar).

Corrida manual completa de `main` sin prender la perilla: Actions → CI → «Run workflow» sobre `main` (`workflow_dispatch`).

## Cuándo conviene prenderla

- **Antes de cualquier despliegue a producción.** NO VERIFICADO: no se comprobó si los Deployment Checks de Vercel exigen el Gate sobre el commit de `main`. Con la perilla apagada ese commit no tiene Gate.
- Si algún día se afloja la regla «PR al día con `main`»: ya no habría garantía de que el árbol de `main` sea el que el PR probó.

## Guardián

`test/arquitectura/ci-perilla-en-main.test.ts` evalúa la condición real de cada trabajo sobre todas las combinaciones de evento, rama y valor de la variable, y exige que solo se omita en «push a `main` con la perilla distinta de `si`» (jamás un `pull_request`). Trae violaciones inyectadas. El guardián de cableado (`cumplimiento.ts`) tiene la condición en su lista de `if` permitidos.
