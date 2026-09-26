# Critique — release-0-17-0

- provider: openai
- model: undefined
- round 1

Resolve every critical/high finding by appending a RESOLVED: line under it.

---

## 1. Совпадение версий не подтверждает состав плагина
SEVERITY: medium

Сценарий: версии обновлены до `0.17.0`, но в разрешённом для изменения Codex-манифесте поле `skills` указывает только на `./skills/delivery/` → AC-01 проходит, однако хост не получает навык `context`, обещанный в `intent`.

Указанный тест читает номера версий и заголовок changelog. Существующий `check:plugin` проверяет сгенерированный runtime и версии манифестов, но не доступность навыка через настройки хоста. Проверка установленного плагина в `test/plugin.test.mjs` также не подтверждает обнаружение `context`. Поэтому даже эти дополнительные проверки не закрывают сценарий.

**Исправление:** добавить условие приёмки состава поставки: оба манифеста сохраняют настройки загрузки, навык `context` доступен хостам, а копия поставляемого плагина выполняет `work` и возвращает записанный checkpoint через SessionStart. Для задачи только с метаданными настройки загрузки можно просто потребовать сохранить побайтово относительно `ddf28ed`, кроме явно разрешённых полей версии.

RESOLVED: New AC-03: an installed copy of the bundled plugin must ship skills/context where both manifests load skills from, run `work checkpoint` with its own CLI and return the next action through its SessionStart hook.

## 2. Пустая запись о релизе удовлетворяет приёмке
SEVERITY: medium

Сценарий: сразу после `## Unreleased` добавляется пустой заголовок `## 0.17.0 — 2026-09-26`, а существующие пункты о `work`, навыке `context` и исправлениях остаются выше него → первый датированный заголовок совпадает с версиями, AC-01 проходит, но выпущенные возможности всё ещё обозначены как невыпущенные. README также может сохранить текущий заголовок `Work context (unreleased)`.

Это противоречит цели подготовки release notes: пользователь не может определить, какие изменения вошли в устанавливаемую версию. Проверка одного заголовка не устанавливает принадлежность записей релизу.

**Исправление:** явно потребовать перенести принятые изменения `ad507f3` и `ddf28ed` в раздел `0.17.0`, убрать для них обозначение `unreleased` из README и проверить содержимое раздела до следующего заголовка релиза. Пустой раздел не должен удовлетворять приёмке.

RESOLVED: New AC-02: the 0.17.0 section must list the work store, loop guard, context skill and the verify/review fixes, and the README must no longer mark work context as unreleased.
