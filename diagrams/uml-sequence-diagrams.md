# UML Sequence Diagrams

Диаграммы описывают взаимодействия на уровне API и базы данных. Имена операций соответствуют [OpenAPI-контракту](../api/openapi.json).

## SD-01. Успешное создание записи и конкурентный конфликт

```mermaid
sequenceDiagram
    autonumber
    actor A as Клиент A
    actor B as Клиент B
    participant UI as Web UI
    participant API as Booking API
    participant DB as PostgreSQL

    A->>UI: Выбирает слот X
    UI->>API: POST /appointments\nIdempotency-Key: key-A
    API->>DB: BEGIN
    API->>DB: SELECT slot X FOR UPDATE
    DB-->>API: X свободен
    API->>DB: INSERT appointment A
    API->>DB: INSERT idempotency_result key-A
    API->>DB: COMMIT
    API-->>UI: 201 CONFIRMED
    UI-->>A: Показать подтверждение

    B->>API: POST /appointments\nIdempotency-Key: key-B
    API->>DB: BEGIN
    API->>DB: SELECT slot X FOR UPDATE
    DB-->>API: X уже занят
    API->>DB: ROLLBACK
    API-->>B: 409 SLOT_UNAVAILABLE
```

## SD-02. Повтор после потери ответа

```mermaid
sequenceDiagram
    autonumber
    actor C as Клиент
    participant UI as Web UI
    participant API as Booking API
    participant DB as PostgreSQL

    C->>UI: Нажимает «Записаться»
    UI->>API: POST /appointments\nkey-K, slot X
    API->>DB: Создать запись и результат ключа
    API-->>UI: 201 (ответ потерян сетью)
    UI->>API: Повтор POST\nтот же key-K и slot X
    API->>DB: Найти (clientId, key-K)
    DB-->>API: Сохранённый response_body
    API-->>UI: 201, тот же appointmentId
    Note over API,DB: Новая запись не создаётся
```

Если ключ использован с другим `slotId`, API возвращает 409 `IDEMPOTENCY_KEY_REUSED`. После TTL 24 часа прежний ключ может быть обработан заново.

## SD-03. Отмена клиентом и освобождение слота

```mermaid
sequenceDiagram
    autonumber
    actor C as Клиент
    participant UI as Web UI
    participant API as Booking API
    participant DB as PostgreSQL

    C->>UI: Указывает причину отмены
    UI->>API: POST /appointments/{id}/cancel
    API->>API: Проверить JWT, subject и окно ≥ 2 часа
    API->>DB: BEGIN
    API->>DB: SELECT appointment FOR UPDATE
    DB-->>API: CONFIRMED, запись принадлежит C
    API->>DB: UPDATE status=CANCELLED\nсохранить cancelledAt/By/Reason
    API->>DB: COMMIT
    API-->>UI: 200 CANCELLED
    UI->>API: GET /slots
    API-->>UI: Слот X снова доступен
```

Если запись уже `CANCELLED`, API возвращает 200 с сохранёнными данными без изменения первоначальной причины. Если до начала менее двух часов, транзакция не изменяет запись и возвращается 409.

## SD-04. Административная отмена

```mermaid
sequenceDiagram
    autonumber
    actor O as Администратор
    participant API as Booking API
    participant DB as PostgreSQL

    O->>API: POST /appointments/{id}/cancel\nBearer role=admin
    API->>API: Проверить role=admin и startsAt > now
    API->>DB: BEGIN + lock appointment
    DB-->>API: CONFIRMED
    API->>DB: Сохранить CANCELLED, cancelledBy=O
    API->>DB: COMMIT
    API-->>O: 200 CANCELLED
```

## Соглашения

- `201` возвращается только после commit.
- `409` сообщает бизнес-конфликт и не раскрывает SQL-детали.
- `404` для чужой записи скрывает факт существования объекта.
- Серверное время и состояние после блокировки являются источниками решения; состояние, показанное в UI до POST, может устареть.
