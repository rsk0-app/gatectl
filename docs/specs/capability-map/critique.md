# Critique — capability-map

- provider: openai
- model: undefined
- round 2
- earlier rounds: 9 finding(s)

Resolve every critical/high finding by appending a RESOLVED: line under it.

---

## 1. Приёмка текущего digest противоречит запрету переносить приёмку между деревьями
SEVERITY: high

Сценарий: feature принята на дереве A; затем реализация изменена и закоммичена в дерево B, спецификация осталась прежней. Drift отсутствует, digest совпадает, подписанный ACCEPT соответствует последнему Complete PASS. По определению `acceptance` и AC-02 карта показывает `accepted`. Но INV-01 прямо запрещает представлять приёмку более раннего дерева как приёмку текущих требований.

Исправление прежнего замечания проверяет редакцию спецификации, но оставляет этот случай неразрешённым. В перечне состояний нет «принято на прежнем дереве».

Исправление: сравнивать записанное дерево с текущим, показывать историческую приёмку отдельным состоянием и исключать её из числа принятых на текущей версии. Добавить проверку: неизменная спецификация, изменённая реализация, новый коммит.

RESOLVED: New state 'accepted at an earlier tree' when the recorded tree differs from the current one; only same digest and same tree is 'accepted', and goal summaries count them separately. AC-02 tests an unchanged spec with changed, committed code.

## 2. `--run` может бесконечно переиспользовать результат «ни один тест не выполнен»
SEVERITY: medium

Сценарий: существует подписанная квитанция с `code: 0`, вывод которой классифицируется как `empty`. Карта правильно показывает «no test ran». Пользователь вызывает `--run`, который обещает выполнить обязательства, ещё не прошедшие проверку. Однако существующий [cachedRunner](/Users/nick/Projects/ops8/gatectl-release/src/core/check-cache.mjs:40) переиспользует любую подходящую квитанцию с нулевым кодом, независимо от классификации. Команда не запускается; повторные вызовы дают тот же результат.

Ответ автора устранил ложный PASS, но не учёл влияние этой классификации на повторный запуск.

Исправление: для выбранных непрошедших обязательств принудительно обходить кеш через `fresh: true` либо запретить повторное использование квитанций класса `empty`. В AC-04 проверить не только отображение состояния, но и фактический вызов исполнителя при уже существующей квитанции `code: 0 / empty`.

RESOLVED: --run runs the obligations it selects with reuse bypassed (fresh), so a stored no-test-ran receipt is re-executed. AC-04 asserts the runner actually executes again in that case.

## Answered in earlier rounds

> ## 1. Подписанный успешный запуск не доказывает выполнение теста
> SEVERITY: high
> 
> Сценарий: имя теста осталось в комментарии, но сам тест удалён. Проверка присутствия находит текст; runner выполняет ноль подходящих тестов и возвращает 0. `cachedRunner` сохраняет подписанную квитанцию → карта может показать `pass`, хотя критерий не проверялся. Существующий GREEN отдельно отбрасывает результат `empty` через `judgeGreen`; спецификация требует только совпадения команды и квитанции.
> 
> Исправление: требовать классификацию результата по правилам GREEN. Добавить состояние «не проверено: ни один тест не выполнен» и проверку такого сценария в AC-04.
> 
> RESOLVED: Receipts are classified by the policy's failure classes; an empty-class output is 'no test ran', never pass (INV-01, AC-04).

> ## 2. Просмотр может показать PASS для изменённого рабочего дерева
> SEVERITY: high
> 
> Сценарий: для staged-дерева A существует успешная квитанция. Пользователь меняет реализацию без staging → рабочие файлы уже B, но существующий `treeDigest()` при наличии staged-изменений возвращает хеш индекса A. Обычный просмотр находит квитанцию A и показывает прохождение «на текущей версии». Отказ при drift предусмотрен только для `--run`.
> 
> Исправление: проверять drift и при чтении квитанций. При расхождении запрещать текущий `pass`, явно показывать расхождение индекса и рабочих файлов. Добавить отдельный тест просмотра без `--run`.
> 
> RESOLVED: The report checks index drift itself and claims no current result while the working tree differs from a staged index (AC-04 tests the report without --run).

> ## 3. При отключённом кеше обещанные квитанции не создаются
> SEVERITY: high
> 
> Сценарий: в поддерживаемой политике отсутствует `workflow` или установлено `workflow.cache: false`. Существующий `cachedRunner` сразу исполняет команду без сохранения квитанции → после успешного `--run` карта обязана остаться в состоянии «не запускалось на этой версии». Это противоречит AC-04, который обещает `pass` или `fail` после запуска.
> 
> Исправление: отделить запись доказательства выполнения от повторного использования кеша либо явно отказывать в `--run` при такой политике. Закрепить выбранное поведение в критериях.
> 
> RESOLVED: Without receipts (no workflow or cache off) the state is 'receipts disabled' and --run refuses with exit 2 (AC-04).

> ## 4. Усечение журнала возвращает старую приёмку
> SEVERITY: high
> 
> Сценарий: журнал содержит `Complete PASS`, затем `Complete FAIL`. Последнюю запись удаляют целиком → оставшийся префикс проходит существующую проверку цепочки `readLedger()`. Карта выбирает оставшийся PASS и показывает `accepted`. AC-02 обещает, что изменённый журнал будет нечитаемым и никогда не принятым, но проверка цепочки этого не обеспечивает.
> 
> Исправление: проверять голову журнала относительно независимо сохранённого доверенного значения. Если такой защиты в этой стадии нет, сузить обещание до обнаруживаемых изменений и явно описать ограничение. Добавить тест удаления последней записи FAIL.
> 
> RESOLVED: Acceptance is cross-checked with the signed completion record: the latest Complete PASS must carry the completion_mac of an ACCEPT record; a removed trailing FAIL leaves a newer REJECT record that disagrees, reported unreadable (AC-02). The report states the ledger has no external anchor otherwise.

> ## 5. Ограничение «записываются только квитанции» несовместимо с runner
> SEVERITY: high
> 
> Сценарий: `--run` запускают в репозитории без локального ключа. `cachedRunner` вызывает `loadKey()` с созданием ключа по умолчанию → появляется файл ключа, хотя INV-02 разрешает только квитанции. Кроме того, обычный тест может обновить snapshot или создать файл; runner обнаружит изменение после выполнения, но не отменит его. Обещание rollback через revert также не покрывает такие побочные эффекты.
> 
> Исправление: ограничить INV-02 собственными записями команды, отдельно описать побочные эффекты запуска тестов. Явно разрешить создание ключа либо требовать заранее существующий ключ. Скорректировать rollback без обещаний изоляции через worktree.
> 
> RESOLVED: INV-02 narrowed: the report writes nothing; --run writes only receipts, refuses without an existing key (never creates one), and test commands' own side effects are theirs as in any gate run. Rollback text no longer promises isolation.

> ## 6. Приёмка старой спецификации переносится на новые обещания
> SEVERITY: high
> 
> Сценарий: feature принята с одним критерием. Затем под тем же slug добавлены новые критерии или изменён `mvp_ref`, но нового Complete нет → карта показывает текущие обещания под новой целью со статусом `accepted` из старой записи. Указание старого дерева не объясняет, что принят был другой договор.
> 
> Исправление: сопоставлять записанный `digest` с текущей спецификацией. Разделять «предыдущая редакция принята» и «текущая редакция не завершена». В групповой сводке не учитывать старую приёмку как принятие текущих требований.
> 
> RESOLVED: Acceptance compares the recorded digest with the current spec: 'an earlier revision was accepted' is distinct and is not counted as accepted in goal summaries (INV-01, AC-02).

> ## 7. Один критерий может иметь несколько обязательных тестов
> SEVERITY: medium
> 
> Сценарий: legacy `spec.md` содержит `AC1 … — required: test/a.test.js, test/b.test.js`. Такой формат поддерживается существующим парсером. Первый тест проходит, второй падает или отсутствует → спецификация описывает единственный «его тест» и не определяет итог критерия. Реализация может выбрать первый результат и показать ложный PASS.
> 
> Исправление: показывать все обязательства критерия. Разрешать итоговый PASS только при наличии подходящих успешных квитанций для каждого; определить приоритет ошибок, отсутствующих файлов и незапущенных тестов. Для критериев без тестов предусмотреть отдельное состояние.
> 
> RESOLVED: All obligations of a criterion are listed; its result is pass only if every obligation passes, otherwise the worst of missing, fail, no test ran, not run; 'no test declared' for policy-verified criteria (AC-03).

> ## 8. Обещанные «согласовано» и «реализовано» не имеют источника
> SEVERITY: medium
> 
> Сценарий: существуют две незавершённые feature с тестовыми файлами без квитанций. У первой реализация уже написана и требования согласованы, у второй есть только черновик и заглушка → предусмотренные поля карты могут быть одинаковыми. Они не позволяют выполнить обещание intent: показать владельцу, что согласовано и что реализовано.
> 
> Исправление: либо сузить результат стадии до истории приёмки, наличия тестовых ссылок и результатов запусков, либо определить отдельные источники и состояния этих двух признаков. Без доказательств выводить «не установлено»; наличие текста теста не считать найденной реализацией.
> 
> RESOLVED: 'Implemented' is no longer claimed. The map reports agreed as 'locked at the current digest', gatectl acceptance, test presence and current results; nothing infers implementation from test text.

> ## 9. Повреждённая спецификация может скрыть feature целиком
> SEVERITY: medium
> 
> Сценарий: среди корректных feature находится один синтаксически повреждённый `spec.yaml`, рядом с которым сохранился старый `spec.md`. Спецификация не задаёт поведение → реализация может прервать весь отчёт, молча пропустить feature или показать устаревший Markdown. Последние два варианта нарушают обещание учесть каждую feature и искажают сводку цели.
> 
> Исправление: установить приоритет YAML, запретить скрытый fallback при его повреждении и показывать отдельную строку «спецификация нечитаема». Ошибка одной feature не должна скрывать остальные или превращаться в утверждение «ни одна feature не ссылается на эту цель».
> 
> RESOLVED: spec.yaml takes precedence; one that fails to parse or compile is a 'spec unreadable' row in its own bucket with no spec.md fallback, and does not hide other features or change goal counts (AC-01).

