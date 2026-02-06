# Mobile Payment Terminal (POS) API

Смешнявая документация для мобильного API системы эквайринга, для тех кто готов писать полную оболочку под Android.

## Базовый URL
```
http://localhost:3030/api/mobile
```

## Аутентификация

API использует JWT токены для аутентификации. Токен должен быть включен в заголовок `Authorization`:
```
Authorization: Bearer <your-jwt-token>
```

## Эндпоинты

### 1. Аутентификация

#### POST /auth
Аутентификация терминала и получение JWT токена.

**Запрос:**
```json
{
  "terminalId": "MOBILE001",
  "password": "mobile123"
}
```

**Ответ (успех):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "terminal": {
    "id": "MOBILE001",
    "name": "Мобильный терминал",
    "operator": "Тест Банк",
    "location": "Мобильное приложение",
    "status": "active"
  },
  "expiresIn": "24h"
}
```

**Коды ошибок:**
- `MISSING_CREDENTIALS` - Отсутствуют terminalId или password
- `TERMINAL_NOT_FOUND` - Терминал не найден
- `INVALID_PASSWORD` - Неверный пароль
- `TERMINAL_INACTIVE` - Терминал неактивен

### 2. Обновление токена

#### POST /refresh
Обновление JWT токена (требует аутентификации).

**Ответ:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": "24h"
}
```

### 3. Информация о терминале

#### GET /terminal/info
Получение информации о терминале (требует аутентификации).

**Ответ:**
```json
{
  "success": true,
  "terminal": {
    "id": "MOBILE001",
    "name": "Мобильный терминал",
    "operator": "Тест Банк",
    "location": "Мобильное приложение",
    "status": "active",
    "is_locked": 0,
    "connectionStatus": "online",
    "lastSeen": "2026-01-20T02:35:19.709Z"
  }
}
```

### 4. Управление платежами

#### POST /payment/initiate
Инициация нового платежа.

**Запрос:**
```json
{
  "amount": 10000,
  "currency": "RUB",
  "method": "nfc"
}
```

**Ответ:**
```json
{
  "success": true,
  "payment": {
    "id": "uuid-payment-id",
    "terminalId": "MOBILE001",
    "amount": 10000,
    "currency": "RUB",
    "method": "nfc",
    "status": "pending",
    "createdAt": "2026-01-20T02:35:00.000Z"
  }
}
```

#### GET /payment/:id
Получение статуса платежа.

**Ответ:**
```json
{
  "success": true,
  "payment": {
    "id": "uuid-payment-id",
    "terminalId": "MOBILE001",
    "amount": 10000,
    "currency": "RUB",
    "method": "nfc",
    "status": "completed",
    "bankTransactionId": "bank-tx-123",
    "errorCode": null,
    "createdAt": "2026-01-20T02:35:00.000Z",
    "completedAt": "2026-01-20T02:35:05.000Z"
  }
}
```

#### POST /payment/:id/process
Обработка платежа с NFC данными.

**Запрос:**
```json
{
  "cardData": {
    "cardNumber": "**** **** **** 1234",
    "cardType": "visa"
  },
  "nfcData": {
    "uid": "04:12:34:56",
    "atqa": "0400",
    "sak": "08"
  }
}
```

**Ответ:**
```json
{
  "success": true,
  "message": "Payment processing started",
  "paymentId": "uuid-payment-id",
  "status": "processing"
}
```

### 5. История платежей

#### GET /payments
Получение истории платежей терминала.

**Параметры запроса:**
- `limit` (опционально) - количество записей (по умолчанию 50)
- `offset` (опционально) - смещение (по умолчанию 0)
- `status` (опционально) - фильтр по статусу

**Ответ:**
```json
{
  "success": true,
  "payments": [
    {
      "id": "uuid-payment-id",
      "amount": 10000,
      "currency": "RUB",
      "method": "nfc",
      "status": "completed",
      "bankTransactionId": "bank-tx-123",
      "errorCode": null,
      "createdAt": "2026-01-20T02:35:00.000Z",
      "completedAt": "2026-01-20T02:35:05.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "total": 1
  }
}
```

### 6. QR коды

#### POST /qr/generate
Генерация QR кода для платежа.

**Запрос:**
```json
{
  "amount": 10000,
  "currency": "RUB"
}
```

**Ответ:**
```json
{
  "success": true,
  "qrCode": "data:image/svg+xml;base64,...",
  "paymentId": "uuid-payment-id",
  "expiresAt": "2026-01-20T02:40:00.000Z",
  "amount": 10000,
  "currency": "RUB"
}
```

### 7. Управление терминалом

#### POST /terminal/lock
Блокировка терминала.

**Ответ:**
```json
{
  "success": true,
  "message": "Terminal locked successfully"
}
```

### 8. Проверка здоровья

#### GET /health
Проверка состояния мобильного API.

**Ответ:**
```json
{
  "success": true,
  "service": "Mobile Payment Terminal API",
  "version": "1.0.0",
  "timestamp": "2026-01-20T02:35:00.000Z",
  "status": "healthy"
}
```

## Статусы платежей

- `pending` - Ожидает обработки
- `processing` - Обрабатывается
- `completed` - Завершен успешно
- `failed` - Завершен с ошибкой

## Методы оплаты

- `nfc` - NFC/бесконтактная оплата
- `qr` - QR код оплата

## Коды ошибок

- `MISSING_CREDENTIALS` - Отсутствуют учетные данные
- `TERMINAL_NOT_FOUND` - Терминал не найден
- `INVALID_PASSWORD` - Неверный пароль
- `TERMINAL_INACTIVE` - Терминал неактивен
- `INVALID_AMOUNT` - Неверная сумма
- `INVALID_METHOD` - Неверный метод оплаты
- `PAYMENT_NOT_FOUND` - Платеж не найден
- `INVALID_PAYMENT_STATUS` - Неверный статус платежа
- `SERVER_ERROR` - Внутренняя ошибка сервера

## Примеры использования

### Полный цикл NFC платежа

1. **Аутентификация:**
```bash
curl -X POST http://localhost:3030/api/mobile/auth \
  -H "Content-Type: application/json" \
  -d '{"terminalId":"MOBILE001","password":"mobile123"}'
```

2. **Инициация платежа:**
```bash
curl -X POST http://localhost:3030/api/mobile/payment/initiate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount":10000,"method":"nfc"}'
```

3. **Обработка NFC данных:**
```bash
curl -X POST http://localhost:3030/api/mobile/payment/PAYMENT_ID/process \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"cardData":{"cardNumber":"**** **** **** 1234","cardType":"visa"}}'
```

4. **Проверка статуса:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3030/api/mobile/payment/PAYMENT_ID
```

### Генерация QR кода

```bash
curl -X POST http://localhost:3030/api/mobile/qr/generate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount":5000}'
```