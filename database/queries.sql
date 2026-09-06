-- Поиск доступности и контроль качества данных. :service_id и :date — именованные параметры
-- клиента SQL, а не встроенный синтаксис PostgreSQL. Передать их связанными
-- параметрами в драйвере; не конкатенировать пользовательский ввод.

-- 1. Поиск доступных слотов. API до SQL проверяет горизонт даты.
SELECT s.id, s.service_id, s.specialist_id, p.display_name,
       s.starts_at, s.ends_at
FROM slot s
JOIN service v ON v.id = s.service_id
JOIN specialist p ON p.id = s.specialist_id
WHERE s.service_id = CAST(:service_id AS uuid)
  AND s.published AND v.active
  AND s.starts_at > clock_timestamp()
  AND s.starts_at >= (CAST(:date AS date)::timestamp AT TIME ZONE 'Europe/Saratov')
  AND s.starts_at < ((CAST(:date AS date) + 1)::timestamp AT TIME ZONE 'Europe/Saratov')
  AND NOT EXISTS (
      SELECT 1 FROM appointment a
      WHERE a.slot_id = s.id AND a.status = 'CONFIRMED'
  )
ORDER BY s.starts_at, s.id;

-- 2. Аудит BG-01: результат должен быть пустым.
SELECT slot_id, count(*) AS active_count
FROM appointment
WHERE status = 'CONFIRMED'
GROUP BY slot_id
HAVING count(*) > 1;

-- 3. Доля отмен по локальной дате начала слота (не по дате отмены).
SELECT (s.starts_at AT TIME ZONE 'Europe/Saratov')::date AS service_day,
       count(*) AS total_created,
       count(*) FILTER (WHERE a.status = 'CANCELLED') AS cancelled,
       round(100.0 * count(*) FILTER (WHERE a.status = 'CANCELLED')
             / NULLIF(count(*), 0), 2) AS cancelled_percent
FROM appointment a
JOIN slot s ON s.id = a.slot_id
GROUP BY service_day
ORDER BY service_day;

-- BG-02 нельзя честно вычислить только из MVP: в нём source всегда WEB.
-- Для пилота нужен независимый учёт телефонных/ручных записей в знаменателе
-- либо расширение модели источников после добавления ручного создания.
