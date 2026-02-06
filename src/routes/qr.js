import express from 'express';
import QRCode from 'qrcode';
import Database from '../database/database.js';
import TestBankAPI from '../services/TestBankAPI.js';
import { Payment } from '../models/index.js';
import { randomUUID } from 'crypto';

const router = express.Router();
const bankAPI = new TestBankAPI();

// POST /api/qr/generate - Generate QR code for payment
router.post('/generate', async (req, res) => {
  try {
    const db = req.db; // Use database instance from server
    const { terminalId, amount, currency = 'RUB', expiresInMinutes = 5, paymentId } = req.body;

    if (!terminalId || !amount) {
      return res.status(400).json({ error: 'Terminal ID and amount are required' });
    }

    // Validate amount (should be in kopecks, max 10,000,000 kopecks = 100,000 rubles)
    if (typeof amount !== 'number' || amount <= 0 || amount > 10000000) {
      return res.status(400).json({ 
        error: 'Amount must be between 1 and 10,000,000 kopecks (1 to 100,000 rubles)' 
      });
    }

    // Verify terminal exists
    const terminal = await db.get('SELECT * FROM terminals WHERE id = ?', [terminalId]);
    if (!terminal) {
      return res.status(404).json({ error: 'Terminal not found' });
    }

    let payment;
    
    // If paymentId is provided, use existing payment, otherwise create new one
    if (paymentId) {
      payment = await Payment.findById(db, paymentId);
      if (!payment) {
        return res.status(404).json({ error: 'Payment not found' });
      }
      
      // Update payment method to QR
      await payment.update(db, {
        method: 'qr'
      });
    } else {
      // Create payment record for QR payment (Requirements 2.1)
      payment = await Payment.create(db, {
        terminalId: terminalId,
        amount: amount,
        currency: currency,
        method: 'qr',
        status: 'pending'
      });
    }

    // Log payment creation or update
    await Payment.logTransaction(db, payment, paymentId ? 'qr_method_updated' : 'qr_payment_created');

    // Create QR code data
    const qrData = {
      paymentId: payment.id,
      terminalId: payment.terminalId,
      amount: payment.amount,
      currency: payment.currency,
      timestamp: Date.now(),
      signature: generateSignature(payment)
    };

    // Generate QR code image
    const qrCodeDataURL = await QRCode.toDataURL(JSON.stringify(qrData), {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      quality: 0.92,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    // Save QR code to database
    const qrId = randomUUID();
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    await db.run(
      'INSERT INTO qr_codes (id, payment_id, data, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      [qrId, payment.id, JSON.stringify(qrData), expiresAt, now]
    );

    res.json({
      success: true,
      id: qrId,
      paymentId: payment.id,
      qrCode: qrCodeDataURL,
      data: qrData,
      expiresAt,
      createdAt: now
    });
  } catch (error) {
    console.error('Error generating QR code:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// GET /api/qr/:id - Get QR code details
router.get('/:id', async (req, res) => {
  try {
    const db = req.db; // Use database instance from server
    const qrCode = await db.get('SELECT * FROM qr_codes WHERE id = ?', [req.params.id]);
    if (!qrCode) {
      return res.status(404).json({ error: 'QR code not found' });
    }

    // Check if QR code has expired
    const now = new Date();
    const expiresAt = new Date(qrCode.expires_at);
    if (now > expiresAt) {
      return res.status(410).json({ error: 'QR code has expired' });
    }

    res.json({
      id: qrCode.id,
      paymentId: qrCode.payment_id,
      data: JSON.parse(qrCode.data),
      expiresAt: qrCode.expires_at,
      createdAt: qrCode.created_at
    });
  } catch (error) {
    console.error('Error fetching QR code:', error);
    res.status(500).json({ error: 'Failed to fetch QR code' });
  }
});

// POST /api/qr/process - Process QR payment
router.post('/process', async (req, res) => {
  try {
    const db = req.db; // Use database instance from server
    const { qrId, paymentConfirmation } = req.body;

    if (!qrId) {
      return res.status(400).json({ error: 'QR ID is required' });
    }

    // Get QR code
    const qrCode = await db.get('SELECT * FROM qr_codes WHERE id = ?', [qrId]);
    if (!qrCode) {
      return res.status(404).json({ error: 'QR code not found' });
    }

    // Check if QR code has expired
    const now = new Date();
    const expiresAt = new Date(qrCode.expires_at);
    if (now > expiresAt) {
      return res.status(410).json({ error: 'QR code has expired' });
    }

    // Get associated payment
    const payment = await Payment.findById(db, qrCode.payment_id);
    if (!payment) {
      return res.status(404).json({ error: 'Associated payment not found' });
    }

    if (payment.status !== 'pending') {
      return res.status(400).json({ error: 'Payment is not in pending status' });
    }

    // Update payment status to processing
    await payment.update(db, {
      method: 'qr',
      status: 'processing'
    });

    // Log QR payment processing
    await Payment.logTransaction(db, payment, 'qr_processing');

    try {
      // Prepare payment data for bank API
      const bankPaymentData = {
        amount: payment.amount,
        currency: payment.currency,
        terminalId: payment.terminalId,
        paymentId: payment.id,
        qrData: JSON.parse(qrCode.data),
        paymentConfirmation: paymentConfirmation || {}
      };

      // Step 1: Authorize payment with bank (Requirements 3.1)
      console.log(`Authorizing QR payment ${payment.id} with bank...`);
      const authResult = await bankAPI.authorizePayment(bankPaymentData);

      if (authResult.success) {
        // Update payment with bank transaction ID
        await payment.update(db, {
          bankTransactionId: authResult.transactionId,
          status: 'authorized'
        });

        // Log authorization
        await Payment.logTransaction(db, payment, 'bank_authorized');

        // Step 2: Capture payment immediately for QR (Requirements 3.2)
        console.log(`Capturing QR payment ${payment.id}...`);
        const captureResult = await bankAPI.capturePayment(authResult.transactionId, payment.amount);

        if (captureResult.success) {
          // Payment successful (Requirements 3.2)
          await payment.update(db, {
            status: 'completed',
            completedAt: new Date()
          });

          // Log completion
          await Payment.logTransaction(db, payment, 'completed');

          // Mark QR code as used
          await db.run('UPDATE qr_codes SET used_at = ? WHERE id = ?', [new Date().toISOString(), qrId]);

          res.json({
            success: true,
            payment: {
              id: payment.id,
              status: 'completed',
              amount: payment.amount,
              currency: payment.currency,
              transactionId: authResult.transactionId,
              authCode: authResult.authCode,
              completedAt: payment.completedAt
            }
          });

          console.log(`QR payment ${payment.id} completed successfully`);
        } else {
          // Capture failed
          await payment.update(db, {
            status: 'failed',
            errorCode: captureResult.errorCode
          });

          // Log failure
          await Payment.logTransaction(db, payment, 'capture_failed');

          res.status(402).json({
            success: false,
            error: {
              code: captureResult.errorCode,
              message: captureResult.errorMessage
            },
            payment: {
              id: payment.id,
              status: 'failed'
            }
          });

          console.log(`QR payment ${payment.id} capture failed: ${captureResult.errorCode}`);
        }
      } else {
        // Authorization failed (Requirements 3.3)
        await payment.update(db, {
          status: 'failed',
          errorCode: authResult.errorCode,
          bankTransactionId: authResult.transactionId
        });

        // Log authorization failure
        await Payment.logTransaction(db, payment, 'auth_failed');

        res.status(402).json({
          success: false,
          error: {
            code: authResult.errorCode,
            message: authResult.errorMessage
          },
          payment: {
            id: payment.id,
            status: 'failed'
          }
        });

        console.log(`QR payment ${payment.id} authorization failed: ${authResult.errorCode}`);
      }
    } catch (bankError) {
      // Bank API error
      console.error('Bank API error for QR payment:', bankError);
      await payment.update(db, {
        status: 'failed',
        errorCode: 'E003'
      });

      // Log error
      await Payment.logTransaction(db, payment, 'bank_error');

      res.status(500).json({
        success: false,
        error: {
          code: 'E003',
          message: 'Network connection error'
        },
        payment: {
          id: payment.id,
          status: 'failed'
        }
      });
    }
  } catch (error) {
    console.error('Error processing QR payment:', error);
    res.status(500).json({ error: 'Failed to process QR payment' });
  }
});

// DELETE /api/qr/expired - Clean up expired QR codes
router.delete('/expired', async (req, res) => {
  try {
    const db = req.db; // Use database instance from server
    const now = new Date().toISOString();
    const result = await db.run('DELETE FROM qr_codes WHERE expires_at < ?', [now]);
    
    res.json({ 
      message: 'Expired QR codes cleaned up',
      deletedCount: result.changes
    });
  } catch (error) {
    console.error('Error cleaning up expired QR codes:', error);
    res.status(500).json({ error: 'Failed to clean up expired QR codes' });
  }
});

function generateSignature(payment) {
  // Simple signature generation for demo purposes
  // In production, use proper cryptographic signing
  const data = `${payment.id}${payment.terminal_id}${payment.amount}${payment.currency}`;
  return Buffer.from(data).toString('base64').substring(0, 16);
}

export default router;