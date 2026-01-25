# flowsort-balanced-wave (Сортировка треков личных плейлистов в Spotify)

DJ-friendly tempo & key sorting tracks for Goofy / Spotify.

Этот скрипт реализует FlowSort.sortBalancedWave — сортировку треков с учётом темпа, тональностей (Camelot)
и базовых DJ-сценариев плавного развития переходов по тональностям в режиме (USE_KEY_SCENARIOS = true)

Подходит для больших плейлистов (до 4000 треков) и
используется в экосистеме Goofy / Google Apps Script для работы со Spotify.

Для работы скрипта требуется премиум-подписка Spotify, настроенный https://chimildic.github.io/goofy/#/install  с приватными ключами Goofy https://chimildic.github.io/goofy/#/ (к слову огромная благодарность автору проекта Goofy, без него ничего этого не было бы)

Содержимое flowsort_sortBalancedWave.js нужно скопировать, сохранить в отдельный файл и передвинуть его повыше, следующим сразу после library.gs 

<img width="538" height="457" alt="Снимок экрана от 2025-12-08 14-39-59" src="https://github.com/user-attachments/assets/7d0da60b-296f-4d26-bd25-d74c200e5f45" />


Вызывать функцию в скриптах нужно непосредственно перед формированием финального плейлиста (по принципу переменная  "tracks = FlowSort.sortBalancedWave(tracks);" 

На скриншоте ниже пример создания плейлиста с отсортированными любимыми треками.

<img width="788" height="505" alt="Без названия" src="https://github.com/user-attachments/assets/05a8956e-8b75-4917-b2eb-8b649b50ee73" />

По умолчанию сортировка работает в режиме (USE_KEY_SCENARIOS = true)

В режиме USE_KEY_SCENARIOS = false используется классическая гармоническая сортировка по Camelot с приоритетом темпа и без сценарных цепочек. Переключение режимов выполняется простым изменением значения флага USE_KEY_SCENARIOS вверху в коде (true ↔️ false)

 П.С. Отсортированный плейлист рекомендую слушать с включенным crossfade = 10s ,в настройках Playback Spotify , либо использовать функцию Spotify - Mix (в зависимости от разножанровости плейлиста. Если плейлист очень разножанровый и треки сильно отличаются по bpm, то лучше использовать crossfade)

 <img width="1147" height="79" alt="Снимок экрана от 2026-01-25 15-48-46" src="https://github.com/user-attachments/assets/1da0157e-1025-4160-b24a-6d66e91db73a" />

 
 <img width="596" height="169" alt="Снимок экрана от 2026-01-25 15-41-40" src="https://github.com/user-attachments/assets/b00fb466-6b9e-42a5-b2b9-c5c36fe6e96d" />


25.01.2026 .Обновил. Переработал подход к сортировке треков, не имеющих в фичах тональность. А также добавил парочку дополнительных приемов в сортировке треков по тональностям.
