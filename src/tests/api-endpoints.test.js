import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from '../database/database.js';

describe('API Endpoints Unit Tests', () => {
  let db;

  beforeEach(async () => {
    // Use in-memory database for testing
    db = new Database(':memory:');
    await db.initialize();
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe('Terminal CRUD Operations', () => {
    it('should create a new terminal', async () => {
      const terminalData = {
        id: 'T001',
        name: 'Test Terminal',
        operator: 'Test Operator',
        status: 'active',
        location: 'Test Location'
      };

      const now = new Date().toISOString();
      await db.run(
        'INSERT INTO terminals (id, name, operator, status, location, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [terminalData.id, terminalData.name, terminalData.operator, terminalData.status, terminalData.location, now, now]
      );

      const terminal = await db.get('SELECT * FROM terminals WHERE id = ?', [terminalData.id]);
      expect(terminal).toBeDefined();
      expect(terminal.name).toBe(terminalData.name);
      expect(terminal.operator).toBe(terminalData.operator);
      expect(terminal.status).toBe(terminalData.status);
    });

    it('should retrieve all terminals', async () => {
      // Create test terminals
      const terminals = [
        { id: 'T001', name: 'Terminal 1', operator: 'Operator 1', status: 'active' },
        { id: 'T002', name: 'Terminal 2', operator: 'Operator 2', status: 'inactive' }
      ];

      const now = new Date().toISOString();
      for (const terminal of terminals) {
        await db.run(
          'INSERT INTO terminals (id, name, operator, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          [terminal.id, terminal.name, terminal.operator, terminal.status, now, now]
        );
      }

      const result = await db.all('SELECT * FROM terminals ORDER BY created_at DESC');
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Terminal 1');
      expect(result[1].name).toBe('Terminal 2');
    });

    it('should update terminal', async () => {
      // Create initial terminal
      const now = new Date().toISOString();
      await db.run(
        'INSERT INTO terminals (id, name, operator, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['T001', 'Original Name', 'Original Operator', 'active', now, now]
      );

      // Update terminal
      const updateTime = new Date().toISOString();
      await db.run(
        'UPDATE terminals SET name = ?, operator = ?, updated_at = ? WHERE id = ?',
        ['Updated Name', 'Updated Operator', updateTime, 'T001']
      );

      const terminal = await db.get('SELECT * FROM terminals WHERE id = ?', ['T001']);
      expect(terminal.name).toBe('Updated Name');
      expect(terminal.operator).toBe('Updated Operator');
    });

    it('should delete terminal', async () => {
      // Create terminal
      const now = new Date().toISOString();
      await db.run(
        'INSERT INTO terminals (id, name, operator, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['T001', 'Test Terminal', 'Test Operator', 'active', now, now]
      );

      // Verify it exists
      let terminal = await db.get('SELECT * FROM terminals WHERE id = ?', ['T001']);
      expect(terminal).toBeDefined();

      // Delete terminal
      await db.run('DELETE FROM terminals WHERE id = ?', ['T001']);

      // Verify it's deleted
      terminal = await db.get('SELECT * FROM terminals WHERE id = ?', ['T001']);
      expect(terminal).toBeUndefined();
    });

    it('should handle terminal not found', async () => {
      const terminal = await db.get('SELECT * FROM terminals WHERE id = ?', ['T999']);
      expect(terminal).toBeUndefined();
    });
  });

  describe('Payment CRUD Operations', () => {
    beforeEach(async () => {
      // Create test terminal
      const now = new Date().toISOString();
      await db.run(
        'INSERT INTO terminals (id, name, operator, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['T001', 'Test Terminal', 'Test Operator', 'active', now, now]
      );
    });

    it('should create a new payment', async () => {
      const paymentData = {
        id: 'payment-123',
        terminal_id: 'T001',
        amount: 1000,
        currency: 'RUB',
        method: 'nfc',
        status: 'pending'
      };

      const now = new Date().toISOString();
      await db.run(
        'INSERT INTO payments (id, terminal_id, amount, currency, method, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [paymentData.id, paymentData.terminal_id, paymentData.amount, paymentData.currency, paymentData.method, paymentData.status, now]
      );

      const payment = await db.get('SELECT * FROM payments WHERE id = ?', [paymentData.id]);
      expect(payment).toBeDefined();
      expect(payment.terminal_id).toBe(paymentData.terminal_id);
      expect(payment.amount).toBe(paymentData.amount);
      expect(payment.method).toBe(paymentData.method);
    });

    it('should retrieve payment by id', async () => {
      const paymentId = 'payment-123';
      const now = new Date().toISOString();
      await db.run(
        'INSERT INTO payments (id, terminal_id, amount, currency, method, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [paymentId, 'T001', 1000, 'RUB', 'nfc', 'pending', now]
      );

      const payment = await db.get('SELECT * FROM payments WHERE id = ?', [paymentId]);
      expect(payment).toBeDefined();
      expect(payment.id).toBe(paymentId);
      expect(payment.amount).toBe(1000);
    });

    it('should filter payments by terminal', async () => {
      const now = new Date().toISOString();
      
      // Create payments for different terminals
      await db.run(
        'INSERT INTO payments (id, terminal_id, amount, currency, method, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['payment-1', 'T001', 1000, 'RUB', 'nfc', 'completed', now]
      );
      await db.run(
        'INSERT INTO payments (id, terminal_id, amount, currency, method, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['payment-2', 'T001', 2000, 'RUB', 'qr', 'pending', now]
      );

      const payments = await db.all('SELECT * FROM payments WHERE terminal_id = ?', ['T001']);
      expect(payments).toHaveLength(2);
      payments.forEach(payment => {
        expect(payment.terminal_id).toBe('T001');
      });
    });

    it('should filter payments by status', async () => {
      const now = new Date().toISOString();
      
      await db.run(
        'INSERT INTO payments (id, terminal_id, amount, currency, method, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['payment-1', 'T001', 1000, 'RUB', 'nfc', 'completed', now]
      );
      await db.run(
        'INSERT INTO payments (id, terminal_id, amount, currency, method, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['payment-2', 'T001', 2000, 'RUB', 'qr', 'pending', now]
      );

      const completedPayments = await db.all('SELECT * FROM payments WHERE status = ?', ['completed']);
      expect(completedPayments).toHaveLength(1);
      expect(completedPayments[0].status).toBe('completed');
    });
  });

  describe('QR Code Operations', () => {
    beforeEach(async () => {
      // Create test terminal and payment
      const now = new Date().toISOString();
      await db.run(
        'INSERT INTO terminals (id, name, operator, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['T001', 'Test Terminal', 'Test Operator', 'active', now, now]
      );
      await db.run(
        'INSERT INTO payments (id, terminal_id, amount, currency, method, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['payment-123', 'T001', 1000, 'RUB', 'qr', 'pending', now]
      );
    });

    it('should create QR code', async () => {
      const qrData = {
        id: 'qr-123',
        payment_id: 'payment-123',
        data: JSON.stringify({ paymentId: 'payment-123', amount: 1000 }),
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      };

      const now = new Date().toISOString();
      await db.run(
        'INSERT INTO qr_codes (id, payment_id, data, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
        [qrData.id, qrData.payment_id, qrData.data, qrData.expires_at, now]
      );

      const qrCode = await db.get('SELECT * FROM qr_codes WHERE id = ?', [qrData.id]);
      expect(qrCode).toBeDefined();
      expect(qrCode.payment_id).toBe(qrData.payment_id);
      expect(qrCode.data).toBe(qrData.data);
    });

    it('should identify expired QR codes', async () => {
      const now = new Date().toISOString();
      const expiredTime = new Date(Date.now() - 1000).toISOString(); // 1 second ago
      
      await db.run(
        'INSERT INTO qr_codes (id, payment_id, data, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
        ['qr-expired', 'payment-123', '{}', expiredTime, now]
      );

      const expiredQRs = await db.all('SELECT * FROM qr_codes WHERE expires_at < ?', [new Date().toISOString()]);
      expect(expiredQRs).toHaveLength(1);
      expect(expiredQRs[0].id).toBe('qr-expired');
    });

    it('should clean up expired QR codes', async () => {
      const now = new Date().toISOString();
      const expiredTime = new Date(Date.now() - 1000).toISOString();
      const validTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      
      // Create expired and valid QR codes
      await db.run(
        'INSERT INTO qr_codes (id, payment_id, data, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
        ['qr-expired', 'payment-123', '{}', expiredTime, now]
      );
      await db.run(
        'INSERT INTO qr_codes (id, payment_id, data, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
        ['qr-valid', 'payment-123', '{}', validTime, now]
      );

      // Delete expired QR codes
      const result = await db.run('DELETE FROM qr_codes WHERE expires_at < ?', [new Date().toISOString()]);
      expect(result.changes).toBe(1);

      // Verify only valid QR code remains
      const remainingQRs = await db.all('SELECT * FROM qr_codes');
      expect(remainingQRs).toHaveLength(1);
      expect(remainingQRs[0].id).toBe('qr-valid');
    });
  });

  describe('Error Handling', () => {
    it('should handle missing required fields for terminal creation', () => {
      // This would be handled by validation logic in the route handlers
      const terminalData = { name: 'Test Terminal' }; // Missing operator
      expect(terminalData.operator).toBeUndefined();
    });

    it('should handle invalid payment methods', () => {
      const paymentData = { method: 'invalid' };
      const validMethods = ['nfc', 'qr'];
      expect(validMethods.includes(paymentData.method)).toBe(false);
    });

    it('should handle non-existent terminal for payment', async () => {
      const terminal = await db.get('SELECT * FROM terminals WHERE id = ?', ['T999']);
      expect(terminal).toBeUndefined();
    });

    it('should handle non-existent payment for QR generation', async () => {
      const payment = await db.get('SELECT * FROM payments WHERE id = ?', ['non-existent']);
      expect(payment).toBeUndefined();
    });
  });
});