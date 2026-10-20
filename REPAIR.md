# AlwaysStrong Repair 1

Неофициальная исправленная сборка AlwaysStrong v1.0.5. Исходная база: `Evokerr/AlwaysStrong`, commit `72309a7c5117f28f44a1cd72b89ff1c5302208bf`.

## Что исправлено

Поводом был оборванный `keybox.xml`: 954 байта, начало сертификата без его окончания и без закрывающих XML-тегов. После восстановления полной локальной копии и отключения трёх spoof-флагов владелец телефона подтвердил Basic / Device / Strong в отдельном Play Integrity Checker.

В этой сборке:

- загрузка проходит проверку завершённости HTTP-ответа, Base64, XML, PEM и длины DER до замены keybox;
- файл заменяется атомарно, предыдущая полная копия сохраняется;
- повреждённый файл восстанавливается из полной локальной резервной копии;
- `spoofProvider`, `spoofSignature`, `spoofVendingSdk` при первой миграции и явном сбросе настроек устанавливаются в `0` для Fork;
- режим личного keybox и остановленная регулярная загрузка сохраняются при обновлении и сбросе настроек;
- интерфейс отдельно показывает состояние файла и импортированный результат Play Integrity с датой;
- свежий импортированный результат ниже 3/3 может запустить ограниченную попытку обновления;
- конфликты модулей показываются явно; автоматическое удаление других модулей исключено из изменённых путей установки и проверки;
- по умолчанию отключено подавление диагностических логов.

Проверка структуры файла не подтверждает доверие Google к сертификатам, срок действия, отсутствие отзыва или Play Integrity. Ядра TEESimulator-RS и PlayIntegrityFork взяты из закреплённых upstream-артефактов. Собственный загрузчик asfetch пересобран из изменённого Rust-кода для ARM64 и ARMv7.

## Установка

Сборка предназначена для Magisk, KernelSU и APatch на ARM64/ARMv7, Android 10+. Для PIF нужен работающий Zygisk: встроенный Magisk либо совместимый провайдер для KernelSU/APatch. WebUI открывается через поддерживающий его менеджер или уже установленный совместимый хост.

Комплектный native helper нужен также для системных блокировок записи. Установщик проверяет его запуск до изменения личных настроек и keybox; без работающего helper запись отклоняется. Рабочий движок во время staged update не останавливается.

1. Скопировать установочный ZIP на телефон.
2. В текущем root-менеджере выбрать установку ZIP **поверх существующего AlwaysStrong** с ID `tricky_store`. Предварительное удаление запускает штатный uninstall и может удалить конфигурацию.
3. Перезагрузить телефон.
4. Открыть WebUI. Проверить состояние keybox, затем запустить отдельный Play Integrity Checker.

Установка новой сборки на телефоне ещё должна быть проверена пользователем. Проверки на компьютере и успешная упаковка ZIP не заменяют её.

## Результат именно твоего чекера

Поддержан запуск `gr.nikolasspyr.integritycheck/.MainActivity`. В проверенных исходниках приложения есть меню **JSON response → Copy JSON**. Автоматического экспорта в root-модуль это приложение не предоставляет.

После новой проверки:

1. В чекере открыть меню ⋮ → JSON response → Copy JSON.
2. В WebUI модуля раскрыть «Передать результат из чекера».
3. Вставить JSON и нажать «Применить результат» в течение 15 минут после проверки.

Модуль читает точные `MEETS_BASIC_INTEGRITY`, `MEETS_DEVICE_INTEGRITY`, `MEETS_STRONG_INTEGRITY` и исходное время `requestDetails.timestampMillis`. Отметки означают **сохранённый результат из чекера**. Через сутки они становятся неизвестными. JSON не является самостоятельно проверяемой модулем подписью Google: источник результата — приложение и его сервер.

Пустой `deviceIntegrity` с корректным свежим временем означает 0/3: Google может не включать массив verdict при отрицательном результате. Ошибка API, повреждённый JSON или отсутствие обязательных полей не считаются отрицательной проверкой. Более старый или уже обработанный timestamp не заменяет сохранённый результат.

Когда свежий результат ниже 3/3 и включён переключатель автовосстановления, допускается одна попытка загрузки на результат, не чаще раза за шесть часов. Эта отдельная попытка может заменить и личный keybox, сохранив предыдущую полную копию. Режим личного keybox остаётся включённым, поэтому обычные ежечасные загрузки по-прежнему остановлены. Переключатель автовосстановления отключает такую замену по результату чекера. После обновления файла нужно выполнить новую проверку: скачивание само по себе не подтверждает возвращение Strong.

Для внешней автоматизации предусмотрен файл `alwaysstrong/verdict-inbox.json` с полным свежим JSON от проверяющего приложения/сервера. При наличии файла служба его импортирует. Сам Play Integrity Checker этот файл не записывает. Ошибку сети/API нельзя заменять выдуманным отрицательным verdict.

## Проверка на телефоне

Ни один тест не гарантирует неизменный Strong после будущих изменений Google. Можно доказать исправление конкретной ошибки и работу текущей сборки в текущем состоянии телефона.

### 1. Версия, keybox и флаги

В MT Manager открыть терминал и получить root:

```sh
su
AS_MOD=/data/adb/modules/tricky_store
AS_CFG=/data/adb/tricky_store
grep -E '^(id|name|version|versionCode)=' "$AS_MOD/module.prop"
sh "$AS_MOD/keybox_manage.sh" health
sh "$AS_MOD/keybox_manage.sh" check
echo "keybox_check_rc=$?"
grep -E '^(spoofProvider|spoofSignature|spoofVendingSdk)=' "$AS_MOD/custom.pif.prop"
sh "$AS_MOD/as_store.sh" get custom_keybox
sh "$AS_MOD/as_store.sh" get auto_keybox
```

Ожидается версия Repair, `complete`, `keybox_check_rc=0`, три нужных флага равны `0`. Для ранее восстановленного личного keybox ожидаются `custom_keybox=1` и `auto_keybox=0`, пока ты сам их не менял.

### 2. Движок загружен

Для комплектного TEESimulator-RS:

```sh
pidof TEESimulator
AS_KEYSTORE_PID=$(pidof keystore2)
grep -F libTEESimulator.so "/proc/$AS_KEYSTORE_PID/maps"
```

Ожидаются PID и запись о библиотеке. Это подтверждает работу процесса и загрузку библиотеки, но ещё не прохождение проверки Google.

### 3. Настоящие три результата

В `gr.nikolasspyr.integritycheck` нажать кнопку новой проверки. Нужны все три `MEETS_*_INTEGRITY`, полученные именно сейчас. Скопировать JSON в WebUI и сверить дату и три отметки. При 3/3 попытка замены по этому результату не требуется.

Повторить новую проверку после перезагрузки и после полного интервала автоматического обновления. Если результат сохраняется, флаги остаются правильными, файл полный и ошибок движка нет, подтверждён и сценарий повторного запуска, а не только один удачный запрос.

### 4. Загрузка без замены рабочего файла

Загрузка проверяется в отдельном приватном каталоге через `AS_CFG_ROOT`. Команда ниже не предназначена для замены текущего keybox:

```sh
umask 077
AS_MOD=/data/adb/modules/tricky_store
AS_CFG=/data/adb/tricky_store
AS_TEST_DIR=$(mktemp -d /data/local/tmp/as-nettest.XXXXXX) || exit 1
cp "$AS_CFG/keybox.xml" "$AS_TEST_DIR/keybox.xml" || exit 1
AS_BEFORE=$(sha256sum "$AS_CFG/keybox.xml" | cut -d' ' -f1)
AS_CFG_ROOT="$AS_TEST_DIR" MODPATH="$AS_MOD" sh "$AS_MOD/as_store.sh" set custom_keybox 0
AS_CFG_ROOT="$AS_TEST_DIR" MODPATH="$AS_MOD" sh "$AS_MOD/keybox_fetch.sh"
AS_DOWNLOAD_RC=$?
echo "download_rc=$AS_DOWNLOAD_RC"
AS_CFG_ROOT="$AS_TEST_DIR" MODPATH="$AS_MOD" sh "$AS_MOD/keybox_manage.sh" check
echo "scratch_keybox_rc=$?"
AS_AFTER=$(sha256sum "$AS_CFG/keybox.xml" | cut -d' ' -f1)
[ "$AS_BEFORE" = "$AS_AFTER" ] && echo 'LIVE_KEYBOX_UNCHANGED'
rm -rf "$AS_TEST_DIR"
```

`download_rc=0` означает принятую новую загрузку в тестовый каталог, `2` — совпадающий файл. `1` означает отказ загрузки/проверки: это повод проверить источник и сеть; рабочий keybox должен сохраниться. `scratch_keybox_rc=0` подтверждает полноту файла в тестовом каталоге, `LIVE_KEYBOX_UNCHANGED` — неизменность рабочего файла. Закрывать глаза на `download_rc=1` и называть загрузку успешной нельзя.

Не нужно повреждать рабочий keybox или очищать данные Google Play ради теста. Повреждение, оборванная передача, сохранение предыдущего файла, восстановление резервной копии и конкурентные записи проверяются на изолированных тестовых данных.

### 5. Доказать исправление именно обрыва файла

Этот тест специально обрезает **только отдельную тестовую копию** до 954 байт и восстанавливает её из полной копии. Рабочий файл используется только для чтения:

```sh
umask 077
AS_MOD=/data/adb/modules/tricky_store
AS_CFG=/data/adb/tricky_store
AS_TEST_DIR=$(mktemp -d /data/local/tmp/as-recoverytest.XXXXXX) || exit 1
cp "$AS_CFG/keybox.xml" "$AS_TEST_DIR/keybox.xml.bak" || exit 1
head -c 954 "$AS_CFG/keybox.xml" > "$AS_TEST_DIR/keybox.xml"
AS_CFG_ROOT="$AS_TEST_DIR" MODPATH="$AS_MOD" sh "$AS_MOD/keybox_manage.sh" health
AS_CFG_ROOT="$AS_TEST_DIR" MODPATH="$AS_MOD" sh "$AS_MOD/keybox_manage.sh" recover
echo "recovery_rc=$?"
AS_CFG_ROOT="$AS_TEST_DIR" MODPATH="$AS_MOD" sh "$AS_MOD/keybox_manage.sh" health
cmp -s "$AS_TEST_DIR/keybox.xml" "$AS_CFG/keybox.xml" && echo 'RESTORED_COPY_MATCHES'
rm -rf "$AS_TEST_DIR"
```

Ожидается последовательность: `invalid`, сообщение о восстановлении, `recovery_rc=0`, `complete`, `RESTORED_COPY_MATCHES`. Так проверяются на твоём Android валидатор, выбор резервной копии, системная блокировка и замена файла, без повреждения рабочего keybox.

### 6. Если что-то не сходится

Собрать новый лог штатной кнопкой WebUI или командой:

```sh
sh /data/adb/modules/tricky_store/collect_logs.sh
```

Полученный `.txt` — файл для чтения, а не команда. Для вывода использовать `cat /sdcard/ИМЯ_ПОЛУЧЕННОГО_ФАЙЛА.txt`. Содержимое `keybox.xml`, `hbk` и приватных ключей публиковать для диагностики не требуется.

## Загрузка, защита от бутлупа и откат

По присланным владельцем скриншоту и выводу терминала исходная Repair 1 установлена: Action завершился, keybox имеет статус complete, TEESimulator запущен, счётчик дошёл до attempts=0. Текущий ZIP дополнительно содержит авторство @SUKISU_ULTR4; его повторная установка ещё не подтверждена. На компьютере прошли 40 Python-тестов и 6 Rust-тестов, включая зависание раннего worker, падения daemon, занятые блокировки и повреждённый keybox. Это не даёт 100% гарантии загрузки OxygenOS: нативные PIF/TEE-библиотеки остаются зависимыми от прошивки и Zygisk.

Ранний blocking worker ограничен шестью секундами; миграция и восстановление перенесены в service с отдельным пределом 20 секунд. Ожидание Android ограничено 180 секундами. Сетевая Action запускается после загрузки и имеет предел 480 секунд. Повторный запуск service или TEE supervisor не создаёт второй комплект процессов.

Три быстрых падения TEE или два наблюдаемых изменения PID keystore2 за минуту приостанавливают TEE до следующей загрузки. Три разных запуска Android без контрольной точки стабильности отключают только этот модуль. Контрольная точка ставится через две минуты после `sys.boot_completed=1`; три намеренно быстрых перезагрузки тоже могут включить защиту.

Повреждённый keybox не передаётся в запуск TEE. Записи в boot/vbmeta, блокировки загрузчика, удаления ключей экрана блокировки и операции Widevine provisioning в boot-пути этой сборки отсутствуют.

### Проверка после установки

Установить ZIP поверх текущего `tricky_store`, без предварительного удаления. После загрузки подождать минимум две минуты после появления рабочего стола, затем в root-терминале:

```sh
sh /data/adb/modules/tricky_store/boot_safety.sh status
cat /data/adb/tricky_store/alwaysstrong/logs/boot-prepare.log
cat /data/adb/tricky_store/alwaysstrong/logs/attest-safety.log 2>/dev/null
```

Нормальное состояние: `attempts=0`, нет `safe=1` и `attestation_paused=1`. Отсутствующий `attest-safety.log` допустим: файл создаётся при срабатывании защиты. Затем выполнить проверки keybox, движка и настоящего verdict из предыдущих разделов. Повторить после ещё одной обычной перезагрузки и полного интервала обновления. Если есть зависания, пропала разблокировка, биометрия, Wi-Fi или приложения падают, сначала отключить модуль и перезагрузиться.

### Аварийное отключение с сохранением файлов

В root-менеджере выключить AlwaysStrong и перезагрузить телефон. Если доступен root-терминал, эквивалент:

```sh
su
for AS_D in /data/adb/modules/tricky_store /data/adb/modules_update/tricky_store; do
  [ ! -d "$AS_D" ] || touch "$AS_D/disable"
done
reboot
```

Если Android не загружается, использовать режим отключения модулей своего менеджера: [KernelSU](https://kernelsu.org/guide/rescue-from-bootloop.html), [APatch](https://apatch.dev/rescue-bootloop.html). Для KernelSU официальная инструкция требует нажать и отпустить Volume Down более трёх раз после первого экрана загрузки до boot animation. Режим менеджера отключает все его модули; это отличается от собственного предохранителя AlwaysStrong, отключающего только `tricky_store`.

При уже доступном ADB и работающем root можно выполнить с компьютера:

```sh
adb shell su -c 'touch /data/adb/modules/tricky_store/disable'
adb reboot
```

ADB здесь не был подключён и эти команды на твоём телефоне не выполнялись. В Recovery тот же файл `disable` можно создать только если `/data` доступен и расшифрован.

Для отката выбирать **Disable + reboot**. Штатное удаление upstream-модуля удаляет его config и `persistent_keys`. Пауза daemon сама по себе не выгружает уже внедрённую библиотеку из keystore2; для полного отключения также нужна перезагрузка.

### Если сработал собственный предохранитель

После успешной загрузки с выключенным модулем прочитать `alwaysstrong/logs/boot-safety.log` и `attest-safety.log`. Автоматически повторно включать модуль после защиты нельзя. Если причина устранена и нужен осознанный повторный запуск, оставить модуль выключенным, в root-терминале удалить только счётчик/маркеры:

```sh
rm -f /data/adb/tricky_store/alwaysstrong/boot-safe \
      /data/adb/tricky_store/alwaysstrong/boot-state \
      /data/adb/tricky_store/alwaysstrong/attest-paused
```

Затем включить модуль в root-менеджере и перезагрузиться. `keybox.xml`, `hbk`, `persistent_keys` и данные приложений для этого удалять не нужно.

## Проверки и воспроизведение сборки

Результаты независимой проверки находятся в `REPAIR_REVIEW.md`. Итоговые хеши и состав сборки приведены в манифесте релиза.

Для изменения нативного загрузчика нужны Rust с Android-таргетами и Android NDK. Пересборка и тесты:

```sh
rustup target add aarch64-linux-android armv7-linux-androideabi
# ANDROID_NDK_HOME должен указывать на установленный NDK.
bash scripts/build-repair-native.sh
cargo test --locked --manifest-path native/asfetch/Cargo.toml
cargo build --locked --manifest-path native/asfetch/Cargo.toml
python3 -m unittest discover -s tests -v
bash build.sh --variant fork
```

В установленном ZIP не должно быть демонстрационного keybox с приватным ключом. Личная конфигурация и ключи телефона в исходный архив не включаются.

## Источники формата результата

- [Google: формат и значения Play Integrity](https://developer.android.com/google/play/integrity/verdicts).
- [Play Integrity Checker: обработка ответа и Copy JSON](https://github.com/1nikolas/play-integrity-checker-app/blob/ee6316e906c7fa948fe688e534c6499f74a919a6/app/src/main/java/gr/nikolasspyr/integritycheck/MainActivity.java).
