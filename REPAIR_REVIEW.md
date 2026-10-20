# AlwaysStrong Repair: независимая проверка

Дата: 2026-10-19. База: AlwaysStrong v1.0.5, commit `72309a7c5117f28f44a1cd72b89ff1c5302208bf`. Проверен текущий repair-diff, новые repair-скрипты, связь с установщиком, службой, адаптером Fork и WebUI. Оригинальный каталог AlwaysStrong не изменялся.

## Найденные и исправленные ошибки

1. **Гонки и зависшие mkdir-lock.** Удаление устаревшей директории могло удалить уже новый lock другого writer; `$$` в shell-подпроцессах также мог указывать на живого родителя. Вместо PID и удаления lock теперь используется системный `flock(2)` в `asfetch lock-run`. Дескриптор наследуется writer-процессом, поэтому принудительное завершение обёртки не освобождает lock раньше времени. Ожидание ограничено 15 секундами для config/state; keybox/auto-repair используют неблокирующую попытку. Общие `.flock`-файлы не удаляются во время работы. Код: `native/asfetch/src/main.rs:80`, `module/repair_runtime.sh:17`, `module/as_store.sh:91`, `module/keybox_manage.sh:46`, `module/auto_repair.sh:10`.

2. **Лишняя запись одинакового state и неатомарный сброс config.** Повторная запись того же state теперь сохраняет inode/mtime. Сброс config сохраняет `custom_keybox` и `auto_keybox` в одной транзакции под lock. Repair-флаги spoof повторно устанавливаются при явном сбросе, без повторной миграции исходных backup. Код: `module/as_store.sh:211`, `module/as_store.sh:229`, `module/reset_defaults.sh:35`, `module/repair_init.sh:7`.

3. **Несовместимость валидатора с настоящим источником.** При реальной HTTPS-загрузке зеркало вернуло полный XML с алгоритмами `ecdsa` и `@evokerr`. Первоначальная проверка принимала только literal `ecdsa|rsa` и ошибочно отклоняла такой файл. Закреплённый TEESimulator-RS определяет алгоритм по разобранному приватному ключу, а XML-метку использует для диагностики. Валидатор теперь допускает непустую корректную метку; проверки XML/PEM/Base64/DER и, при наличии OpenSSL, настоящего key/X.509 parser сохраняются. Содержимое ключей не переписывается и не нормализуется. Код: `module/keybox_validate.awk:62`. Основание: [KeyBoxManager.kt, pinned commit](https://github.com/Enginex0/TEESimulator-RS/blob/6d241e56d6e8146cd67ed4ac3dadc9c632969549/app/src/main/java/org/matrix/TEESimulator/pki/KeyBoxManager.kt#L213).

4. **Неполная изоляция проверки через AS_CFG_ROOT.** Раньше scratch-загрузка могла уведомить рабочий TEE-адаптер, а scratch auto-repair мог вызвать `killall` для Google-процесса. Теперь эти действия выполняются только для штатного `/data/adb/tricky_store`. Проверено fixture-маркером и реальной загрузкой в отдельный каталог. Код: `module/repair_runtime.sh:38`, `module/keybox_fetch.sh:182`, `module/auto_repair.sh:23`.

5. **Неполная резервная копия оставалась непочиненной.** Непустой, но испорченный `.good` раньше мог пережить установку полного файла. Теперь полнота `.good` проверяется, он восстанавливается также при установке совпадающего файла. Код: `module/keybox_manage.sh:22`, `module/keybox_manage.sh:40`.

6. **Неверная обработка настоящего 0/3.** Google может опустить `deviceRecognitionVerdict` внутри `deviceIntegrity`, когда ни один device-label не выполнен. Такой объект теперь даёт `000`, если request timestamp свежий. Ошибка API, отсутствующий deviceIntegrity, неправильный тип, повреждённый JSON и устаревшее время остаются ошибками импорта. Код: `native/asfetch/src/main.rs:605`. Формат подтверждён [официальной документацией Google](https://developer.android.com/google/play/integrity/verdicts).

7. **Гонки импорта JSON.** Inbox сначала атомарно переносится в приватный рабочий каталог. Новый inbox, пришедший во время разбора, остаётся на месте для следующего прохода. Публикация normalized report защищена отдельным flock; более старый или уже обработанный timestamp не заменяет новый report. Ошибочный inbox расходуется без публикации; полные JSON/nonce не архивируются. auto-repair читает один снимок normalized fields. Код: `module/verdict_report.sh:8`, `module/verdict_report.sh:29`, `module/auto_repair.sh:31`.

8. **Принятие partial-download в fingerprint fallback.** Старый `pif_native_fetch.sh` смотрел только на непустой файл даже после ненулевого exit downloader и имел BusyBox `--no-check-certificate` fallback. Теперь принимается только успешная HTTPS-передача через asfetch/curl; downgrade редиректов исключён. Неуспешные partial-файлы удаляются. В keybox-path добавлена независимая строгая проверка Base64-envelope, чтобы не зависеть от терпимости Android decoder. Код: `module/pif_native_fetch.sh:142`, `module/keybox_fetch.sh:107`, `module/repair_runtime.sh:38`.

9. **Отказ установки мог остановить рабочий старый движок.** Установщик больше не завершает live-процессы во время staged update. До изменения пользовательского config/keybox он проверяет наличие и запуск native helper. Если helper отсутствует или не стартует, установка прерывается. Для ARM64/ARMv7 он включён в комплект; x86 runtime в этой Repair-сборке не заявлен. Код: `module/customize.sh`, блоки staged update и native runtime preflight.

## Выполненная проверка

- **40 Python tests** (24 repair, 13 boot-safety, 3 installer/WebUI) на одноразовых копиях модуля и свежих self-signed fixtures. Проверяются обрыв XML и DER, atomic replace/recovery, резервные копии, личный режим и явное удаление, запрет concurrent writer, выживание flock после kill родителя, освобождение lock после завершения writer, конкурентные config/state-записи, reset, неуспешные partial network/fingerprint responses, строгий Base64, branded metadata, malformed/expired/API-error JSON, cooldown, более старый verdict и новый inbox во время разбора.
- **6 Rust unit tests**: HTTP framing/chunk terminator, Content-Length/Transfer-Encoding ambiguity, timeout, TLS downgrade, точные labels и freshness, пустой отрицательный device verdict и отказ API-error.
- `git diff --check`, shell syntax для изменённых путей, `bash -n` для build-скриптов и `node --check module/webroot/main.js` прошли.
- Native helper пересобран NDK r30 для `aarch64-linux-android` и `armv7-linux-androideabi`, API 29. ELF подтверждён как AArch64/ARM PIE, зависимости только `libc.so` и `libdl.so`. Это проверка сборки и формата, не выполнение ARM-бинарников на телефоне.

SHA256 пересобранных helper:

| ABI | SHA256 |
|---|---|
| arm64-v8a | `bed7625826ef1bd8738e21e24e1a8f7f7f274d2efc9d866c16ea510190a3373c` |
| armeabi-v7a | `baa1005497bfeda0b737121b720f9b2bcbef065c0a76ee65b9944d22ae75d071` |

## Реальная сеть

Проверки выполнены host-сборкой того же Rust-кода. Ответы keybox сохранялись только во временных приватных каталогах и удалены; содержимое PEM и приватные ключи не выводились.

- `https://evoker.qzz.io/key`: native HTTPS exit 0, 22588 encoded bytes, SHA256 `b078f3ee9a13e93ccd77b2fe20625ccd669a19b09e042b5f649f0ddbd545a4cd`.
- Полный `keybox_fetch.sh` в отдельной копии модуля: exit 0, engine `asfetch`, Base64 → XML/PEM/DER/OpenSSL → atomic install. Установлено 16940 decoded bytes с правами `0600`, SHA256 `15a5128b81381604f5449c5571665e1c76a4f4a536923180a9f10924bdb74a02`. Уведомление live-engine не выполнялось.
- `asfetch autopif --out <private> --module <private>`: exit 0, записан публичный Canary fingerprint `google/bluejay_beta/bluejay:CANARY/ZP11.260918.007/16484274:user/release-keys`.
- Активный beta URL `Vagelis1608/get_the_canary_miner/main/devices/bluejay.pif.prop`: native HTTPS exit 0, 852 bytes, обязательные identity-поля присутствуют, SHA256 `1978382f8b19eb76460e1e392eb9b9e9fc2b55674eccc9b117b834672efdefac`.

Содержимое зеркал изменяемое; указанные размеры и хеши относятся к этому прогону.

## Отдельное boot-safety ревью

Проверены post-fs-data, service startup, TEE и постоянные jobs. Исправлены следующие подтверждённые риски:

- Синхронная миграция/seed, repair_init, recovery и state locks до 15 секунд удалены из blocking post-fs. Они выполняются локально в service prepare с deadline 20 секунд, один раз на boot ID. Повторный service в том же boot не очищает активный tmp.
- Ранний worker ограничен шестью секундами. Native `run-bounded` создаёт отдельную process group и при timeout завершает дочерние helpers. Текущие официальные бюджеты blocking stage: [Magisk 40 секунд](https://topjohnwu.github.io/Magisk/guides.html#boot-scripts), [KernelSU 10 секунд](https://kernelsu.org/guide/module.html#boot-scripts), [APatch 10 секунд](https://apatch.dev/apm-guide.html#boot-scripts). Общий budget могут расходовать и другие модули; host-тест не доказывает отсутствие kernel I/O hangs.
- Ожидание boot completion ограничено 180 секундами, с внешним deadline 185 секунд. При отказе оставшиеся jobs не запускаются. Первая Action работает после boot completion в фоне, с deadline 480 секунд; marker успеха пишется только при exit 0. Сеть не участвует в blocking stage.
- Service целиком защищён неблокирующим kernel flock. Дескриптор наследуют фоновые watchdog/hourly shells; повторный service не создаёт второй комплект постоянных jobs. Attestation supervisor имеет отдельный flock.
- Pinned upstream supervisor имеет backoff 0.5–32 секунды, но повторяет exits без конечного бюджета. Адаптеры теперь используют один `attest_supervise.sh`: backoff 10/30 секунд, после трёх exits продолжительностью менее минуты — pause до следующего boot. Два наблюдаемых изменения PID keystore2 за 60 секунд также включают pause. Завершается только собственный daemon, с проверкой process start time на Android; keystore2 не убивается. Наблюдение идёт раз в 5 секунд первые две минуты, затем раз в 30 секунд.
- Отсутствующий или повреждённый keybox не передаётся в старт TEE. После появления полного файла запуск может повторить watchdog. Проверки gate тоже имеют deadline.
- Boot guard считает разные boot ID. Checkpoint успеха появляется через две минуты после boot completion. Три boot без checkpoint создают только собственные `tricky_store/disable` и `alwaysstrong/boot-safe`. Три намеренно быстрых reboot тоже могут включить защиту; пользовательские файлы и чужие модули не удаляются.
- Удалены legacy dd-patch property area, подмена recovery props, подмена ro.crypto.state и chmod интерфейсов SELinux. Распознанные recovery/charger/rescue/fastboot mode вызывают выход до изменений. Используется resetprop -n; новые ROM overrides работают только в памяти. Широкое удаление persistent pihook/pixelprops исключено. Целевая миграция repair_init по-прежнему удаляет собственные старые persist.log.tag suppression values.
- Гигантский/неправильный refresh interval теперь ограничен до безопасного диапазона, чтобы ошибка sleep не превращала hourly loop в busy-loop.
- Родительское ревью удалило не относящиеся к Play Integrity Widevine provisioning script, демонстрационный XML и WebUI-кнопку. Эта сборка не предлагает DRM provisioning и не включает тот демонстрационный private key.

Все три boot helper перечислены в customize.sh. Build копирует весь module/, нормализует и делает исполняемыми *.sh; native helper берётся из пересобранных ARM prebuilts. Родительская финальная проверка подтвердила совпадение исходников, UI и ABI binaries с ZIP, извлечение HTML/JS/CSS и отсутствие demo keybox/Widevine payload.

### Проверки и границы boot-защиты

13 boot tests используют одноразовые каталоги и подменённые Android properties/pidof. Проверены занятый config flock без раннего repair, timeout зависшего post-fs worker, завершение дочерней process group и освобождение flock, recovery exit, once-per-boot prepare, конечное boot wait, checkpoint, три незавершённых boot без изменения чужого модуля, missing/corrupt keybox без запуска daemon, rapid exits, второй supervisor/service, наблюдаемые keystore restarts и некорректный interval.

Финальные тестовые семьи: **24 repair + 13 boot + 3 installer/WebUI = 40 Python PASS**, дополнительно **6 Rust PASS**. Родительский прогон также подтвердил syntax всех 41 shell script, Node syntax и diff check. Это не измерение boot time APatch на OnePlus.

Пауза останавливает дальнейшие попытки и собственный daemon. Она **не выгружает уже внедрённую библиотеку из живого keystore2**. Boot guard также не отменяет native Zygisk payload в текущих процессах. Для полного отключения нужен Disable и reboot. Несовместимый native hook может вызвать сбой с первой попытки, раньше наблюдения скриптом. Нулевой риск bootloop не доказан.

Boot-скрипты не пишут boot/vbmeta partitions, не блокируют загрузчик и не удаляют FBE/credential/keystore data. Rollback выполняется через Disable + reboot: штатный upstream uninstall удаляет собственный config и persistent_keys. Точные команды и safe-mode инструкции находятся в boot-разделе REPAIR.md.

Исходная проверенная упаковка: 93 ZIP entries, SHA256 `6e256ef5943cd5d1bc9f778135bb80de4ab07bc207262f6ab83e7c861408ca37`. Позже владелец прислал подтверждение её установки на OxygenOS 16: Action завершился, keybox complete, TEESimulator PID 10660, attempts=0. Это подтверждает достижение boot checkpoint по отчёту пользователя, но не полную аппаратную совместимость или новый Google verdict.

По запросу владельца добавлен @SUKISU_ULTR4 в module.prop, вывод установки, Action и footer WebUI. Повторно собран ZIP SHA256 `a189ad055af26d8949b41cfa4d67dba2ebf7c42be2510ab94432bab08d5692fc`; изменились только эти четыре файла, нативные и boot-safety части идентичны предыдущему архиву. Три installer/WebUI теста, shell syntax и diff check повторно прошли. Повторная установка архива с добавленным автором ещё не подтверждена.

## Границы доказательства

Телефон по ADB не был подключён. Установка исходной Repair 1 и достижение boot checkpoint подтверждены только присланными владельцем материалами, как описано выше. SELinux и root-manager runtime отдельно не исследованы; карта injection, повторная загрузка и новый Google verdict не получены. Родительская задача собрала и проверила ZIP; состав файлов и контрольные суммы сохранены в манифесте релиза.

Валидатор проверяет ограниченный keybox-формат и полноту PEM/внешней DER-длины. При доступном OpenSSL дополнительно проверяется разбор ключей и X.509; без него проверка не равна полноценной криптографической валидации сертификатной цепочки. Ни одна локальная проверка не доказывает отсутствие отзыва, доверие Google или сохранение Strong в будущем.

Импортированный JSON не является самостоятельно проверенной модулем подписью Google. Модуль показывает сохранённые поля приложения/сервера с исходной датой. Автовосстановление ограничено свежим отрицательным импортом, одной попыткой на результат и шестичасовой паузой; оно не может самостоятельно запросить Google verdict через неподдерживающий экспорт checker. Нужен новый настоящий запрос в checker после установки, перезагрузки и полного интервала обновления. Инструкция находится в `REPAIR.md`.
