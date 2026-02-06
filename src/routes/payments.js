import express from 'express';
import TestBankAPI from '../services/TestBankAPI.js';
import { randomUUID } from 'crypto';

const router = express.Router();
const bankAPI = new TestBankAPI();

// GET /api/payments/stats - Get payment statistics
router.get('/stats', async (req, res) => {
  try {
    const db = req.db; // Use database instance from server
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = Math.floor(today.getTime() / 1000);

    const payments = await db.all('SELECT * FROM payments');
    const todayPayments = payments.filter(p => {
      const paymentDate = new Date(p.created_at);
      return paymentDate >= today;
    });
    
    const todayCount = todayPayments.length;
    const todayAmount = todayPayments.reduce((sum, p) => sum + p.amount, 0);

    res.json({
      todayCount,
      todayAmount,
      totalPayments: payments.length,
      totalAmount: payments.reduce((sum, p) => sum + p.amount, 0)
    });
  } catch (error) {
    console.error('Error getting payment stats:', error);
    res.json({ todayCount: 0, todayAmount: 0, totalPayments: 0, totalAmount: 0 });
  }
});

// POST /api/payments/initiate - Initiate a new payment
router.post('/initiate', async (req, res) => {
  try {
    const db = req.db; // Use passed database instance
    const { terminalId, amount, currency = 'RUB', method } = req.body;

    if (!terminalId || !amount || !method) {
      return res.status(400).json({ error: 'Terminal ID, amount, and method are required' });
    }

    // Validate amount (should be in kopecks, max 10,000,000 kopecks = 100,000 rubles)
    if (typeof amount !== 'number' || amount <= 0 || amount > 10000000) {
      return res.status(400).json({ 
        error: 'Amount must be between 1 and 10,000,000 kopecks (1 to 100,000 rubles)' 
      });
    }

    if (!['nfc', 'qr'].includes(method)) {
      return res.status(400).json({ error: 'Method must be either "nfc" or "qr"' });
    }

    // Verify terminal exists
    const terminal = await db.get('SELECT * FROM terminals WHERE id = ?', [terminalId]);
    if (!terminal) {
      return res.status(404).json({ error: 'Terminal not found' });
    }

    const paymentId = randomUUID();
    const now = new Date().toISOString();

    await db.run(
      'INSERT INTO payments (id, terminal_id, amount, currency, method, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [paymentId, terminalId, amount, currency, method, 'pending', now]
    );

    const payment = await db.get('SELECT * FROM payments WHERE id = ?', [paymentId]);
    res.status(201).json(payment);
  } catch (error) {
    console.error('Error initiating payment:', error);
    res.status(500).json({ error: 'Failed to initiate payment' });
  }
});

// POST /api/payments/process - Process a payment
router.post('/process', async (req, res) => {
  try {
    const db = req.db; // Use database instance from server
    const { paymentId, cardData } = req.body;

    if (!paymentId) {
      return res.status(400).json({ error: 'Payment ID is required' });
    }

    // Get payment
    const payment = await db.get('SELECT * FROM payments WHERE id = ?', [paymentId]);
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    if (payment.status !== 'pending') {
      return res.status(400).json({ error: 'Payment is not in pending status' });
    }

    // Update payment status to processing
    await db.run(
      'UPDATE payments SET status = ? WHERE id = ?',
      ['processing', paymentId]
    );

    try {
      // Authorize payment with bank
      const authResult = await bankAPI.authorizePayment({
        amount: payment.amount,
        currency: payment.currency,
        terminalId: payment.terminal_id,
        paymentId: payment.id,
        cardData: cardData || {}
      });

      if (authResult.success) {
        // Capture the payment immediately (for simplicity)
        const captureResult = await bankAPI.capturePayment(authResult.transactionId, payment.amount);
        
        if (captureResult.success) {
          // Payment successful
          const now = new Date().toISOString();
          await db.run(
            'UPDATE payments SET status = ?, bank_transaction_id = ?, completed_at = ? WHERE id = ?',
            ['completed', authResult.transactionId, now, paymentId]
          );

          const updatedPayment = await db.get('SELECT * FROM payments WHERE id = ?', [paymentId]);
          res.json({
            ...updatedPayment,
            bankResponse: {
              authCode: authResult.authCode,
              transactionId: authResult.transactionId
            }
          });
        } else {
          // Capture failed
          await db.run(
            'UPDATE payments SET status = ?, error_code = ?, bank_transaction_id = ? WHERE id = ?',
            ['failed', captureResult.errorCode, authResult.transactionId, paymentId]
          );

          const updatedPayment = await db.get('SELECT * FROM payments WHERE id = ?', [paymentId]);
          res.status(402).json({
            ...updatedPayment,
            bankError: {
              code: captureResult.errorCode,
              message: captureResult.errorMessage
            }
          });
        }
      } else {
        // Authorization failed
        await db.run(
          'UPDATE payments SET status = ?, error_code = ?, bank_transaction_id = ? WHERE id = ?',
          ['failed', authResult.errorCode, authResult.transactionId, paymentId]
        );

        const updatedPayment = await db.get('SELECT * FROM payments WHERE id = ?', [paymentId]);
        res.status(402).json({
          ...updatedPayment,
          bankError: {
            code: authResult.errorCode,
            message: authResult.errorMessage
          }
        });
      }
    } catch (bankError) {
      // Bank API error
      console.error('Bank API error:', bankError);
      await db.run(
        'UPDATE payments SET status = ?, error_code = ? WHERE id = ?',
        ['failed', 'E003', paymentId]
      );

      const updatedPayment = await db.get('SELECT * FROM payments WHERE id = ?', [paymentId]);
      res.status(500).json({
        ...updatedPayment,
        bankError: {
          code: 'E003',
          message: 'Network connection error'
        }
      });
    }
  } catch (error) {
    console.error('Error processing payment:', error);
    res.status(500).json({ error: 'Failed to process payment' });
  }
});

// GET /api/payments/:id - Get payment status
router.get('/:id', async (req, res) => {
  try {
    const db = req.db; // Use database instance from server
    const payment = await db.get('SELECT * FROM payments WHERE id = ?', [req.params.id]);
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    res.json(payment);
  } catch (error) {
    console.error('Error fetching payment:', error);
    res.status(500).json({ error: 'Failed to fetch payment' });
  }
});

// GET /api/payments - Get all payments (with optional terminal filter)
router.get('/', async (req, res) => {
  try {
    const db = req.db; // Use database instance from server
    const { terminalId, status, limit = 50 } = req.query;
    let sql = 'SELECT * FROM payments';
    const params = [];

    const conditions = [];
    if (terminalId) {
      conditions.push('terminal_id = ?');
      params.push(terminalId);
    }
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    const payments = await db.all(sql, params);
    res.json(payments);
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// DELETE /api/payments/cleanup - Clean up old pending payments
router.delete('/cleanup', async (req, res) => {
  try {
    const db = req.db; // Use database instance from server
    const { olderThanMinutes = 60 } = req.query; // Default: older than 1 hour
    
    const cutoffTime = new Date(Date.now() - olderThanMinutes * 60 * 1000).toISOString();
    
    // Get old pending payments
    const oldPayments = await db.all(
      'SELECT * FROM payments WHERE status = ? AND created_at < ?',
      ['pending', cutoffTime]
    );
    
    if (oldPayments.length === 0) {
      return res.json({ 
        message: 'No old pending payments to clean up',
        cleanedCount: 0 
      });
    }
    
    // Mark old payments as expired
    const result = await db.run(
      'UPDATE payments SET status = ?, error_code = ? WHERE status = ? AND created_at < ?',
      ['failed', 'EXPIRED', 'pending', cutoffTime]
    );
    
    res.json({ 
      message: `Cleaned up ${result.changes} old pending payments`,
      cleanedCount: result.changes,
      cutoffTime: cutoffTime
    });
  } catch (error) {
    console.error('Error cleaning up payments:', error);
    res.status(500).json({ error: 'Failed to clean up payments' });
  }
});

export default router;