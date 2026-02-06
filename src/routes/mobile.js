import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware для проверки JWT токена
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// POST /api/mobile/auth - Аутентификация терминала для мобильного приложения
router.post('/auth', async (req, res) => {
  try {
    const db = req.db;
    const { terminalId, password } = req.body;

    if (!terminalId || !password) {
      return res.status(400).json({ 
        error: 'Terminal ID and password are required',
        code: 'MISSING_CREDENTIALS'
      });
    }

    // Проверяем терминал
    const terminal = await db.get('SELECT * FROM terminals WHERE id = ?', [terminalId]);
    if (!terminal) {
      return res.status(404).json({ 
        error: 'Terminal not found',
        code: 'TERMINAL_NOT_FOUND'
      });
    }

    // Проверяем пароль
    if (terminal.password !== password) {
      return res.status(401).json({ 
        error: 'Invalid password',
        code: 'INVALID_PASSWORD'
      });
    }

    // Проверяем статус терминала
    if (terminal.status !== 'active') {
      return res.status(403).json({ 
        error: 'Terminal is not active',
        code: 'TERMINAL_INACTIVE'
      });
    }

    // Разблокируем терминал
    await db.run('UPDATE terminals SET is_locked = 0 WHERE id = ?', [terminalId]);

    // Создаем JWT токен
    const token = jwt.sign(
      { 
        terminalId: terminal.id,
        name: terminal.name,
        operator: terminal.operator
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token: token,
      terminal: {
        id: terminal.id,
        name: terminal.name,
        operator: terminal.operator,
        location: terminal.location,
        status: terminal.status
      },
      expiresIn: '24h'
    });

  } catch (error) {
    console.error('Mobile auth error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

// POST /api/mobile/refresh - Обновление токена
router.post('/refresh', authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    const { terminalId } = req.user;

    // Проверяем, что терминал все еще активен
    const terminal = await db.get('SELECT * FROM terminals WHERE id = ?', [terminalId]);
    if (!terminal || terminal.status !== 'active') {
      return res.status(403).json({ 
        error: 'Terminal is no longer active',
        code: 'TERMINAL_INACTIVE'
      });
    }

    // Создаем новый токен
    const newToken = jwt.sign(
      { 
        terminalId: terminal.id,
        name: terminal.name,
        operator: terminal.operator
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token: newToken,
      expiresIn: '24h'
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

// GET /api/mobile/terminal/info - Получение информации о терминале
router.get('/terminal/info', authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    const { terminalId } = req.user;

    const terminal = await db.get('SELECT id, name, operator, location, status, is_locked FROM terminals WHERE id = ?', [terminalId]);
    if (!terminal) {
      return res.status(404).json({ 
        error: 'Terminal not found',
        code: 'TERMINAL_NOT_FOUND'
      });
    }

    // Проверяем подключение через WebSocket
    const isConnected = req.server ? req.server.isTerminalConnected(terminalId) : false;

    res.json({
      success: true,
      terminal: {
        ...terminal,
        connectionStatus: isConnected ? 'online' : 'offline',
        lastSeen: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Terminal info error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

// POST /api/mobile/payment/initiate - Инициация платежа
router.post('/payment/initiate', authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    const { terminalId } = req.user;
    const { amount, currency = 'RUB', method = 'nfc' } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ 
        error: 'Valid amount is required',
        code: 'INVALID_AMOUNT'
      });
    }

    // Validate amount (should be in kopecks, max 10,000,000 kopecks = 100,000 rubles)
    if (typeof amount !== 'number' || amount > 10000000) {
      return res.status(400).json({ 
        error: 'Amount must be between 1 and 10,000,000 kopecks (1 to 100,000 rubles)',
        code: 'AMOUNT_TOO_LARGE'
      });
    }

    if (!['nfc', 'qr'].includes(method)) {
      return res.status(400).json({ 
        error: 'Method must be either "nfc" or "qr"',
        code: 'INVALID_METHOD'
      });
    }

    // Проверяем терминал
    const terminal = await db.get('SELECT * FROM terminals WHERE id = ?', [terminalId]);
    if (!terminal || terminal.status !== 'active') {
      return res.status(403).json({ 
        error: 'Terminal is not active',
        code: 'TERMINAL_INACTIVE'
      });
    }

    // Создаем платеж
    const paymentId = randomUUID();
    const now = new Date().toISOString();

    await db.run(
      'INSERT INTO payments (id, terminal_id, amount, currency, method, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [paymentId, terminalId, amount, currency, method, 'pending', now]
    );

    const payment = await db.get('SELECT * FROM payments WHERE id = ?', [paymentId]);

    res.status(201).json({
      success: true,
      payment: {
        id: payment.id,
        terminalId: payment.terminal_id,
        amount: payment.amount,
        currency: payment.currency,
        method: payment.method,
        status: payment.status,
        createdAt: payment.created_at
      }
    });

  } catch (error) {
    console.error('Payment initiation error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

// GET /api/mobile/payment/:id - Получение статуса платежа
router.get('/payment/:id', authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    const { terminalId } = req.user;
    const paymentId = req.params.id;

    const payment = await db.get('SELECT * FROM payments WHERE id = ? AND terminal_id = ?', [paymentId, terminalId]);
    if (!payment) {
      return res.status(404).json({ 
        error: 'Payment not found',
        code: 'PAYMENT_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      payment: {
        id: payment.id,
        terminalId: payment.terminal_id,
        amount: payment.amount,
        currency: payment.currency,
        method: payment.method,
        status: payment.status,
        bankTransactionId: payment.bank_transaction_id,
        errorCode: payment.error_code,
        createdAt: payment.created_at,
        completedAt: payment.completed_at
      }
    });

  } catch (error) {
    console.error('Payment status error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

// POST /api/mobile/payment/:id/process - Обработка платежа (NFC данные)
router.post('/payment/:id/process', authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    const { terminalId } = req.user;
    const paymentId = req.params.id;
    const { cardData, nfcData } = req.body;

    // Проверяем платеж
    const payment = await db.get('SELECT * FROM payments WHERE id = ? AND terminal_id = ?', [paymentId, terminalId]);
    if (!payment) {
      return res.status(404).json({ 
        error: 'Payment not found',
        code: 'PAYMENT_NOT_FOUND'
      });
    }

    if (payment.status !== 'pending') {
      return res.status(400).json({ 
        error: 'Payment is not in pending status',
        code: 'INVALID_PAYMENT_STATUS'
      });
    }

    // Обновляем статус на обработку
    await db.run('UPDATE payments SET status = ? WHERE id = ?', ['processing', paymentId]);

    // Если есть сервер, отправляем через WebSocket для обработки банком
    if (req.server && req.server.isTerminalConnected(terminalId)) {
      // Эмулируем обработку NFC через WebSocket
      const mockNfcData = {
        cardNumber: cardData?.cardNumber || '**** **** **** ****',
        cardType: cardData?.cardType || 'unknown',
        amount: payment.amount,
        timestamp: new Date().toISOString(),
        ...nfcData
      };

      // Отправляем на обработку через существующую систему
      setTimeout(async () => {
        try {
          await req.server.processNFCPaymentWithBank(
            null, // WebSocket не нужен для мобильного API
            terminalId,
            { 
              id: payment.id, 
              amount: payment.amount, 
              currency: payment.currency,
              terminalId: payment.terminal_id,
              update: async (db, data) => {
                const updates = [];
                const params = [];
                
                Object.keys(data).forEach(key => {
                  if (key === 'completedAt') {
                    updates.push('completed_at = ?');
                    params.push(data[key].toISOString());
                  } else if (key === 'bankTransactionId') {
                    updates.push('bank_transaction_id = ?');
                    params.push(data[key]);
                  } else if (key === 'errorCode') {
                    updates.push('error_code = ?');
                    params.push(data[key]);
                  } else if (key === 'status') {
                    updates.push('status = ?');
                    params.push(data[key]);
                  }
                });
                
                if (updates.length > 0) {
                  params.push(payment.id);
                  await db.run(`UPDATE payments SET ${updates.join(', ')} WHERE id = ?`, params);
                }
              }
            },
            mockNfcData
          );
        } catch (error) {
          console.error('Mobile payment processing error:', error);
          await db.run('UPDATE payments SET status = ?, error_code = ? WHERE id = ?', ['failed', 'E003', paymentId]);
        }
      }, 100);
    }

    res.json({
      success: true,
      message: 'Payment processing started',
      paymentId: paymentId,
      status: 'processing'
    });

  } catch (error) {
    console.error('Payment processing error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

// GET /api/mobile/payments - Получение истории платежей терминала
router.get('/payments', authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    const { terminalId } = req.user;
    const { limit = 50, offset = 0, status } = req.query;

    let sql = 'SELECT * FROM payments WHERE terminal_id = ?';
    const params = [terminalId];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const payments = await db.all(sql, params);

    const formattedPayments = payments.map(payment => ({
      id: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      method: payment.method,
      status: payment.status,
      bankTransactionId: payment.bank_transaction_id,
      errorCode: payment.error_code,
      createdAt: payment.created_at,
      completedAt: payment.completed_at
    }));

    res.json({
      success: true,
      payments: formattedPayments,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: payments.length
      }
    });

  } catch (error) {
    console.error('Payments history error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

// POST /api/mobile/qr/generate - Генерация QR кода для мобильного приложения
router.post('/qr/generate', authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    const { terminalId } = req.user;
    const { amount, currency = 'RUB' } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ 
        error: 'Valid amount is required',
        code: 'INVALID_AMOUNT'
      });
    }

    // Создаем платеж
    const paymentId = randomUUID();
    const now = new Date().toISOString();

    await db.run(
      'INSERT INTO payments (id, terminal_id, amount, currency, method, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [paymentId, terminalId, amount, currency, 'qr', 'pending', now]
    );

    // Генерируем QR код (используем существующую логику)
    const qrId = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 минут

    const qrData = JSON.stringify({
      paymentId: paymentId,
      terminalId: terminalId,
      amount: amount,
      currency: currency,
      timestamp: now
    });

    await db.run(
      'INSERT INTO qr_codes (id, payment_id, data, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      [qrId, paymentId, qrData, expiresAt, now]
    );

    // Генерируем QR код изображение (базовая реализация)
    const qrCodeDataURL = `data:image/svg+xml;base64,${Buffer.from(`
      <svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
        <rect width="200" height="200" fill="white"/>
        <text x="100" y="100" text-anchor="middle" font-family="monospace" font-size="12">
          QR: ${paymentId.substring(0, 8)}
        </text>
      </svg>
    `).toString('base64')}`;

    res.json({
      success: true,
      qrCode: qrCodeDataURL,
      paymentId: paymentId,
      expiresAt: expiresAt,
      amount: amount,
      currency: currency
    });

  } catch (error) {
    console.error('QR generation error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

// POST /api/mobile/terminal/lock - Блокировка терминала
router.post('/terminal/lock', authenticateToken, async (req, res) => {
  try {
    const db = req.db;
    const { terminalId } = req.user;

    await db.run('UPDATE terminals SET is_locked = 1 WHERE id = ?', [terminalId]);

    res.json({
      success: true,
      message: 'Terminal locked successfully'
    });

  } catch (error) {
    console.error('Terminal lock error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

// GET /api/mobile/health - Проверка здоровья мобильного API
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'Mobile Payment Terminal API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    status: 'healthy'
  });
});

export default router;