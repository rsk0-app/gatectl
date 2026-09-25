# Critique — work-state-brief

- provider: openai
- model: undefined
- round 2
- earlier rounds: 9 finding(s)

Resolve every critical/high finding by appending a RESOLVED: line under it.

---

## 1. Нормализация объединяет разные поисковые действия
SEVERITY: medium

Сценарий: попытка `rg 'UserID' src` завершилась без результата. Агент пробует `rg 'userid' src` на тех же файлах. Поиск чувствителен к регистру, поэтому это другая проверка, способная найти нужный код. Но определение Repeat сворачивает регистр: `work try` отказывает как при повторении прежнего действия. Аналогичные коллизии создаёт сворачивание пунктуации внутри шаблонов поиска.

Исправление: сохранять значимые символы в действиях, командах и фрагментах кода. Использовать точное представление действия либо явно заданный идентификатор стратегии. Добавить тест: два поиска, различающихся регистром шаблона, принимаются без `--reason`, точный повтор — отклоняется.

RESOLVED: Repeat now compares hypothesis and action exactly after collapsing whitespace only; case and punctuation are significant. AC-02 asserts an action differing only in case is accepted without --reason while an exact repeat is refused.

## 2. Маркеры входов позволяют объявить непроверенный вывод актуальным
SEVERITY: high

Исправление замечания № 2 оставило неразрешённым значение маркеров при проверке актуальности. Спецификация запрещает `current` для вывода без входов, но не для входов, содержимое которых не удалось проверить.

Сценарий: вывод привязан к `--input src`, и сохраняется маркер `directory`. Затем меняется `src/config.mjs`. При следующем brief вход снова получает `directory`: отпечатки равны, хотя основание вывода изменилось. Аналогично файл, нечитаемый при записи и при восстановлении, получает одинаковые маркеры `unreadable`, даже если между проверками его содержимое заменили. Сравнение предусмотренных спецификацией отпечатков допускает ложное `current`.

Исправление: для каталогов либо вычислять отпечаток содержимого, либо отклонять их как неподдерживаемый вход. `unreadable` должен означать неизвестную актуальность независимо от равенства маркеров. Добавить проверки изменения файла внутри каталога и повторной невозможности чтения: ни один сценарий не должен давать `current`.

RESOLVED: Directory inputs are refused (files must be named). Freshness is `current` only when every input is readable now and matches; any unreadable input, now or at record time, yields `unknown`. AC-03 covers directory refusal and unreadable-input unknown freshness.

## Answered in earlier rounds

> ## 1. Бюджет отсутствия прогресса не определён
> SEVERITY: high
> 
> Сценарий: агент делает несколько попыток с разными формулировками гипотезы, но одинаковым отрицательным результатом → проверка повторов пропускает их, а момент исчерпания бюджета установить невозможно. AC-02 не определяет размер бюджета, признаки прогресса, правила сброса и влияние `--reason`.
> 
> Исправление: задать бюджет по умолчанию, события его расходования и сброса. Указать, что `--reason` разрешает исключение, но само по себе не считается прогрессом. Проверять границу бюджета отдельным тестом.
> 
> RESOLVED: Intent now defines the budget: 3 no_progress attempts per question since its last progress result; progress resets; --reason permits one attempt, is recorded, and is not progress. AC-02 tests the boundary and the reset.

> ## 2. «Неизменившиеся входы» не имеют проверяемого определения
> SEVERITY: high
> 
> Сценарий: попытка использует файл конфигурации, но записанные входы содержат только исходник. Конфигурация меняется → повтор ошибочно запрещается, а прежний вывод остаётся актуальным. Обратный случай: относительный путь разрешается из другой рабочей директории → одинаковое обозначение входа означает другой файл.
> 
> AC-02 и AC-03 не задают обязательность списка входов, правила разрешения путей, обработку удаления, символьных ссылок и ошибок чтения.
> 
> Исправление: определить формат входов и алгоритм отпечатка, разрешать пути относительно корня worktree, явно учитывать отсутствующие и нечитаемые файлы. Вывод без достаточных сведений о входах помечать как «актуальность неизвестна», а не как подтверждённо актуальный.
> 
> RESOLVED: Intent defines inputs: --input paths resolved against the worktree root, symlink escapes refused, sha256 per file with absent/unreadable/directory markers; attempts without inputs use the whole working-tree digest; conclusions without inputs report unknown freshness. AC-03 covers change, deletion, unknown and symlink escape.

> ## 3. Последовательный тест не защищает от двух одновременных результатов
> SEVERITY: high
> 
> Сценарий: два процесса читают одну planned-попытку без результата. Оба проходят проверку и записывают разные результаты → последний перезаписывает первый либо появляются две записи результата. Аналогичная гонка позволяет одновременно зарегистрировать две одинаковые попытки.
> 
> AC-04 проверяет завершение «позднейшим процессом», но не конкурентное выполнение; транзакционные требования отсутствуют.
> 
> Исправление: потребовать атомарную проверку и запись, ограничение уникальности результата по идентификатору попытки и атомарную проверку повторов. Добавить тест с двумя одновременно работающими процессами: ровно один результат принимается, второй получает определённую ошибку.
> 
> RESOLVED: INV-03 requires one IMMEDIATE transaction for duplicate-check-plus-insert and for result recording (conditional on status planned). New AC-07 runs two concurrent processes for both races and expects exactly one winner and a named ATTEMPT_ALREADY_RESOLVED refusal.

> ## 4. Ограниченный SessionStart конфликтует с обязательным полным восстановлением
> SEVERITY: high
> 
> Сценарий: накоплены тысячи открытых вопросов и выводов → AC-01 требует вернуть их через SessionStart, а INV-04 требует ограничить время и размер. Без правил сокращения полная выдача нарушает ограничение; сокращённая может потерять цель или следующий шаг.
> 
> Дополнительно блокировка SQLite или медленное чтение входных файлов может задержать hook независимо от размера вывода.
> 
> Исправление: задать предел времени и байтов, порядок приоритетов и явный признак сокращения. Разделить контракт полного `work brief` и краткой вставки SessionStart. Предусмотреть прерываемое получение brief, сохранение существующих напоминаний при отказе и тесты большого, заблокированного и недоступного хранилища.
> 
> RESOLVED: Split contracts. `work brief` is the full view; SessionStart uses a child process with a 3 s timeout and 2000-character limit, a fixed priority order and an explicit truncation marker (INV-04). New AC-08 tests a large store, a damaged store and missing node:sqlite; failure adds one unavailable line and keeps existing context.

> ## 5. Проверка импортов не обеспечивает запрет чтения хранилища gates
> SEVERITY: high
> 
> Сценарий: `next` вызывает общий helper, который открывает work store, либо запускает `work brief` дочерним процессом → модуль `next` непосредственно хранилище не импортирует, AC-06 проходит. При этом INV-01 и объявленная граница «context informs, gates decide» нарушены.
> 
> Исправление: распространить запрет на транзитивные вызовы, дочерние процессы и предварительную инициализацию CLI. Помимо проверки зависимостей, проверять отсутствие обращений к хранилищу при запуске gate-команд. Одинаковые файлы репозитория должны давать одинаковые решения gates при отсутствующем, повреждённом и произвольно заполненном work store.
> 
> RESOLVED: INV-01 now covers transitive imports and child processes. AC-06 checks the import graph reachable from gate/next/completion/Stop paths, requires commands.mjs to reach the store only lazily inside work/brief code, and compares next --json and status output with the store absent, corrupted and populated.

> ## 6. Совместимость с Node 20 может сломаться до выбора команды
> SEVERITY: high
> 
> Сценарий: разрешённый к изменению `src/cli/commands.mjs` статически импортирует модуль work, который импортирует `node:sqlite` → среда без этого модуля падает ещё при загрузке CLI. Перестают работать обычные команды и SessionStart, хотя пользователь не запускал `work`.
> 
> Это прямо нарушает INV-04 и INV-05, но среди acceptance criteria нет проверки такого запуска.
> 
> Исправление: потребовать отложенную загрузку SQLite только внутри work-операций и обработку её отсутствия в hook. Добавить проверки обычной команды и SessionStart на Node 20; для неподдерживаемого `work` определить именованную ошибку.
> 
> RESOLVED: INV-05 requires lazy loading of node:sqlite inside work operations only, re-exec with --experimental-sqlite on Node 22.5-23.3, and SQLITE_UNAVAILABLE exit 2 otherwise. AC-08 checks the hook and another command on a runtime where node:sqlite is unavailable (forced by GATECTL_WORK_SQLITE=off, which is also the owner's kill switch).

> ## 7. «Оставить файл неизменным» недостаточно для SQLite-хранилища
> SEVERITY: high
> 
> Сценарий: хранилище содержит подтверждённые записи в WAL. Команда открывает его с возможностью записи до проверки схемы и выполняет checkpoint, затем обнаруживает слишком новую схему → отказ уже изменил состояние хранилища. Проверка только основного файла также не защищает сопутствующие файлы.
> 
> AC-05 говорит о byte-identical «файле», не определяя состав хранилища и безопасный порядок проверки.
> 
> Исправление: определить хранилище как основной файл и существующие сопутствующие файлы. Проверять читаемость и версию без записи, миграций и checkpoint до принятия схемы. Проверить отказ на базе с WAL и сохранность всего исходного состояния, включая отсутствие замены или удаления файлов.
> 
> RESOLVED: Store is defined as the db file plus existing -wal/-shm companions. INV-02 requires read-only validation (header, quick_check, user_version) before any write, migration or checkpoint. AC-05 includes a store with a WAL companion and checks every file stays byte-identical and in place.

> ## 8. Не определено, какой checkpoint представляет текущую работу
> SEVERITY: medium
> 
> Сценарий: в одном worktree сначала записана задача A с незавершённой попыткой, затем задача B с другой целью. Новый сеанс запускает brief → спецификация допускает смешение цели B, следующего действия A и выводов обеих задач. Все перечисленные сущности восстановлены, но агент получает неправильное продолжение.
> 
> Worktree определяет место хранения, однако не определяет принадлежность записей к задаче, выбор активной цели и приоритет checkpoint.
> 
> Исправление: ввести минимальную привязку записей к задаче или явно ограничить store одной активной работой с операцией переключения. Задать правила выбора checkpoint и отдельно показывать незавершённые попытки предыдущей работы. Полный граф задач для этого не нужен.
> 
> RESOLVED: Records carry a work id (active spec slug unless --work). The brief takes goal, checkpoint and next action only from the current work; other work appears only as a count of its interrupted attempts. AC-01 asserts no mixing.

> ## 9. Round-trip не задаёт безопасный контракт импорта
> SEVERITY: high
> 
> Сценарий: импорт содержит корректные записи в начале и повреждённую ссылку на попытку в конце. Реализация записывает данные последовательно и затем отказывает → прежде пустое хранилище остаётся частично заполненным, повторный импорт в «пустое» хранилище уже невозможен. При этом round-trip корректного экспорта из AC-05 проходит.
> 
> Также не определены сохранение идентификаторов, версии формата и перенос привязок входных файлов между worktree.
> 
> Исправление: задать версионированный формат, проверку ссылок и уникальности, атомарный импорт с полным откатом при ошибке. Определить перенос привязок файлов и повторную проверку актуальности. Добавить тест повреждённой последней записи: после отказа целевое хранилище остаётся в исходном состоянии.
> 
> RESOLVED: INV-06: versioned export format, import only into an empty store, full validation of records and references before writing, one transaction. Ids are preserved; input fingerprints are kept as historical and freshness is recomputed against the current worktree at brief time. New AC-09 tests round-trip, a broken last record leaving the store empty, and refusal of a non-empty target.

