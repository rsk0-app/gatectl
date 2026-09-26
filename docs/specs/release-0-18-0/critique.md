# Critique — release-0-18-0

- provider: openai
- model: undefined
- round 1

Resolve every critical/high finding by appending a RESOLVED: line under it.

---

## 1. AC-03 требует RED для уже реализованного поведения
SEVERITY: high

Сценарий: базовый коммит `abab826` уже содержит `goal propose`, `capabilities` и вывод цели через SessionStart → тест AC-03 проверяет только это существующее поведение, без привязки к 0.18.0 → ожидаемого падения `assertion` нет. Gate R отклоняет уже проходящий тест как «nothing to implement against» (`src/core/replay.mjs`). Требование RED конфликтует с INV-01, запрещающим изменение поведения.

Исправление: сформулировать AC-03 как проверку **установленного выпуска 0.18.0** и проверять `version` скопированного CLI. Тогда старая версия даёт содержательный RED, а существующие команды остаются регрессионными проверками.

RESOLVED: AC-03 now checks that the installed copy reports version 0.18.0, which is RED at the base; the command checks remain as regression checks.

## 2. AC-01 допускает разные версии движка в двух CI jobs
SEVERITY: high

Сценарий: в шаблоне `run` получает `ref: v0.18.0`, а `attest` — `ref: main` → регулярное выражение `/ref: (v\S+)/g` видит только первую ссылку → тест проходит, хотя job с ключом подписи запускает другую, изменяемую версию движка.

Исправление: разбирать YAML и отдельно проверять checkout репозитория gatectl в **обоих** jobs: наличие шага, `repository` и точное значение `ref`. Проверять также поставляемую копию шаблона в плагине либо явно включить существующий `check:plugin` в обязательную проверку этого критерия. Сетевые обращения для такой проверки не нужны.

RESOLVED: The test parses the template YAML, requires a gatectl checkout step in every job with ref v<version>, and requires the bundled plugin copy to be identical to templates/ci/gatectl-verify.yml.

## 3. Проверка AC-03 не доказывает показ цели владельца
SEVERITY: medium

Сценарий: установленный CLI возвращает строку `Owner goal [draft]: wrong goal` → текущая проверка `toContain('Owner goal [draft')` проходит → пользователь получает чужую или неверную цель, хотя AC-03 считается выполненным. Кроме того, тест напрямую вызывает `cli hook`, обходя поставляемую регистрацию SessionStart.

Исправление: проверять точный текст созданной цели `ship the release` и её статус; запускать команду из установленного `hooks/hooks.json` с корнем скопированного плагина. Это проверит и содержимое сообщения, и поставляемую связь между событием и CLI.

RESOLVED: The test runs the SessionStart command from the installed hooks.json with CLAUDE_PLUGIN_ROOT set to the copy, and checks the exact goal text with draft status.

## 4. Публикация допускает выдачу шаблона с ещё несуществующим тегом
SEVERITY: medium

Сценарий: после `finish` сначала выполняется push коммита с новым marketplace и шаблоном, затем создание тега задерживается или завершается ошибкой → пользователь устанавливает доступный плагин и создаёт CI → checkout `v0.18.0` падает, поскольку тег ещё не опубликован. Все локальные критерии при этом могут быть выполнены.

Исправление: определить порядок публикации: атомарная отправка release-коммита и тега, затем GitHub release. Привязать тег к проверенному коммиту и описать восстановление после частичного сбоя. Проверка удалённой публикации должна быть отдельным шагом доставки, а не gate, читающим сетевой сервис.

RESOLVED: Intent fixes the publication order: one `git push --atomic` of the release commit and its annotated tag, then the GitHub release; a failed push publishes nothing and a failed release creation is retried against the existing tag. Publication stays a delivery step, not a gate.
