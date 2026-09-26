# Critique — fix-issued-verify-review-reuse

- provider: openai
- model: undefined
- round 1

Resolve every critical/high finding by appending a RESOLVED: line under it.

---

## 1. Отсутствующая спецификация может пройти проверку собственным digest
SEVERITY: high

Сценарий: корректно подписанный issued verdict указывает отсутствующую в коммите спецификацию и произвольный `spec_digest`; commit, tree и policy совпадают. Сейчас вызов `checkIssued` получает `digestOfSpec ?? att.spec_digest`. После устранения undefined-функции проверка может сравнить digest записи с ним же и выдать PASS. Это нарушает INV-01: значение не получено из коммита. AC-01 такой случай не проверяет.

Исправление: запретить подстановку digest из проверяемой записи для issued verdict. Явно определить результат для отсутствующей спецификации и добавить отрицательный тест. Если выпуск без спецификации допустим, отдельно определить проверяемое представление её отсутствия для обоих способов выпуска.

RESOLVED: INV-01 now forbids taking any digest from the record; a commit without a spec matches only a record stating no spec (null or the envelope's all-zero digest). The implementation passes the derived digest, not `?? att.spec_digest`.

## 2. «Другой commit» не обязательно означает «другое tree»
SEVERITY: medium

Сценарий: после коммита A создаётся пустой коммит B. SHA различаются, деревья идентичны. AC-01 требует FAIL с указанием commit и tree для другого коммита. Если это означает две причины несовпадения, требование невыполнимо без ложной диагностики. Если достаточно просто напечатать оба поля, тест может пропустить отсутствие проверки commit.

Исправление: разделить случаи: другой SHA при том же tree → FAIL только из-за commit; другой SHA и другое tree → FAIL с обеими причинами. Проверять причины, а не присутствие слов в выводе.

RESOLVED: AC-01 separates the cases: an empty commit with the same tree fails on the commit only; a commit with another tree fails on both. The test checks the specific reasons.

## 3. AC-01 не доказывает проверку всех подписанных привязок
SEVERITY: high

Сценарий: реализация проверяет подпись, commit и tree, но игнорирует spec и policy digest. Оба положительных сценария AC-01 проходят; проверка на другом коммите тоже выдаёт ожидаемый FAIL. При этом корректно подписанная запись с неверным `spec_digest` или `policy_digest` получает PASS вопреки INV-01.

Исправление: для каждого формата issued verdict добавить независимые отрицательные случаи: неверный spec digest, неверный policy digest, повреждённая подпись. Для проверки digest подписывать изменённую запись тестовым ключом, чтобы отказ нельзя было объяснить только повреждением подписи.

RESOLVED: AC-01 adds negative cases re-signed with the test issuer key for a wrong spec digest and a wrong policy digest, plus a corrupted signature.

## 4. AC-02 оставляет неисправным сценарий устаревшего review.json
SEVERITY: high

Сценарий: ledger хранит актуальное ревью R2, а `review.json` содержит прежнее R1. Реализация восстанавливает файл только при его отсутствии. AC-02 проходит, команда сообщает об успешном повторном использовании R2, но gate X продолжает читать R1. Именно этот вариант дефекта указан в intent, однако критерий его не охватывает.

Исправление: требовать замену `review.json` выбранным ревью из ledger независимо от наличия файла. Добавить сценарий с существующим R1 и отличающимся результатом gate X; проверить содержимое восстановленного файла и результат по R2.

RESOLVED: AC-02 requires reuse to always write the ledger's review to review.json, replacing an existing older review; the test plants a different review.json and checks gate X answers from the ledger's review.

## 5. AC-03 требует reasoning, наличие которого не гарантировано
SEVERITY: medium

Сценарий: ревью содержит неподтверждённый criterion с допустимыми `target`, `verdict` и `citations`, но без `reasoning`. Текущий `validateReview` принимает такую запись. Простая замена `claim.rationale` на `claim.reasoning` снова сохранит пустой title, нарушая безусловное AC-03. Обязательность нового поля в валидаторе, напротив, изменит семантику gate X вопреки INV-02.

Исправление: определить поведение для ранее допустимых записей без reasoning. Например, гарантировать точное сохранение непустого `claim.reasoning`, а при его отсутствии записывать явное «объяснение отсутствует» вместе с verdict. Проверить оба случая и сохранение пользовательского `--reason` отдельно от объяснения ревьюера.

RESOLVED: AC-03 records non-empty reasoning, otherwise an explicit 'the reviewer gave no reasoning'; the validator is unchanged (INV-02); both cases are tested and the owner's --reason stays a separate field.
