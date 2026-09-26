# Critique — fix-exit-closed-pipe

- provider: openai
- model: undefined
- round 1

Resolve every critical/high finding by appending a RESOLVED: line under it.

---

## 1. Обработка только финального drain оставляет ранний EPIPE
SEVERITY: high

Сценарий: обработчик команды пишет в stdout → читатель закрывает pipe → обработчик продолжает асинхронную работу → stdout сообщает ошибку до возврата обработчика. Защита только финального `process.stdout.write("", ...)` не поможет: процесс завершится раньше, чем получит код команды.

Спецификация объясняет проблему через финальное ожидание, но не требует обработки закрытия stdout на протяжении выполнения команды.

Исправление: требовать установки обработчика ошибок stdout **до запуска команды**. При EPIPE запоминать закрытие потока, позволять команде завершиться и возвращать её фактический код. Добавить проверку закрытия pipe во время работы обработчика, до получения его результата.

RESOLVED: The stdout error handler is installed before the command runs; EPIPE at any time is remembered and treated as flushed, and the command's code is used.

## 2. Пример с head может скрыть неисправность
SEVERITY: high

Сценарий: тест запускает `gatectl work brief | head -3` → gatectl падает с кодом 1 → оболочка возвращает код последнего процесса, то есть успешный код `head`. Если вывод небольшой, он также может целиком попасть в буфер до закрытия читателя: тест вообще не воспроизведёт EPIPE.

AC-01 не задаёт способ наблюдения кода производителя и гарантированного раннего закрытия. Проверка только успешной команды дополнительно пропустит исправление, которое всегда завершает процесс кодом 0.

Исправление: запускать CLI отдельным дочерним процессом, проверять именно его `exit code`, сигнал завершения и stderr. Согласовать закрытие читателя с оставшейся записью производителя; предусмотреть тайм-аут. Проверить сохранение кодов 0, 1 и 2. Для полностью читающего потребителя сравнивать весь ожидаемый JSON, включая конечные данные.

RESOLVED: The test spawns the CLI as its own child, destroys the read end before it writes, and checks that child's exit code (0, 1 and 2 cases), that no signal killed it and that stderr has no EPIPE trace, with a timeout; the large-output case parses the complete JSON.

## 3. Инвариант полного вывода не покрывает исключение команды
SEVERITY: medium

Сценарий: команда ставит большой вывод в очередь stdout → затем выбрасывает исключение → существующий `catch` в `bin/gatectl.mjs` немедленно вызывает `process.exit(2)` → открытый, исправно читаемый pipe получает обрезанный вывод.

INV-01 обещает полный вывод в открытый pipe, однако AC-01 не требует проверки этого пути. Исправление исключительно финального drain оставит нарушение инварианта. Аналогичный обход есть в поставляемом `plugins/gatectl/bin/gatectl.mjs`.

Исправление: явно определить код 2 для исключения и провести этот путь через общее завершение с ожиданием stdout. Добавить сценарий «большой вывод → исключение → медленный читатель» с проверкой полноты вывода и кода 2 для обоих CLI.

RESOLVED: Exceptions exit with code 2 through the same drain-then-exit path as normal returns. No command today throws after queuing large output, so the case is covered by sharing the path rather than by an injected fault.
