# Проверка сборки — 20 октября 2026

- Основной вариант fork успешно собран локально из этого дерева.
- Android asfetch пересобран из Rust-исходников для arm64-v8a и armeabi-v7a (NDK r27c).
- Watcher используется из предоставленных исходным архивом prebuilt-файлов для четырёх ABI.
- 6 Rust unit tests прошли.
- 38 из 40 Python tests прошли. Два теста: test_duplicate_supervisor_cannot_start_second_daemon и test_observed_keystore_restart_churn_pauses_owned_daemon завершились по тайм-ауту. Среда возвращает разные PID из getpid() и /proc/self/stat; тесты зависят от идентичности /proc PID. Они не отключены и будут запускаться в GitHub Actions.
- Проверки shell/JavaScript syntax и YAML parsing прошли.
- CRC установочного ZIP, обязательные файлы, ELF-заголовки и совпадение содержимого ZIP со stage проверены.
- На физическом Android-устройстве модуль не проверялся; Play Integrity verdict не измерялся.

Установочный ZIP: `AlwaysStrongFork-v1.0.5-repair.1.3.zip`.
SHA256: `086709662f624cf7d57986c9db861352e13318a3ca0f9cf70f76049f07d5eff6`.

После предоставления прав записи можно загрузить дерево в main. Альтернатива на компьютере: `gh auth login`, затем `bash scripts/publish-github.sh`.
