import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import Database from '../database/database.js';
import { Terminal, Payment, QRCode } from '../models/index.js';

describe('Models', () => {
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

  describe('Terminal Model', () => {
    it('should create and retrieve terminal', async () => {
      const terminalData = {
        name: 'Test Terminal',
        operator: 'Test Operator',
        status: 'active',
        location: 'Test Location'
      };

      const terminal = await Terminal.create(db, terminalData);
      expect(terminal.id).toBeDefined();
      expect(terminal.name).toBe(terminalData.name);
      expect(terminal.operator).toBe(terminalData.operator);

      const retrieved = await Terminal.findById(db, terminal.id);
      expect(retrieved).toBeDefined();
      expect(retrieved.name).toBe(terminalData.name);
    });

    it('should update terminal', async () => {
      const terminal = await Terminal.create(db, {
        name: 'Original Name',
        operator: 'Original Operator'
      });

      const updated = await terminal.update(db, {
        name: 'Updated Name',
        operator: 'Updated Operator'
      });

      expect(updated).toBe(true);
      expect(terminal.name).toBe('Updated Name');
      expect(terminal.operator).toBe('Updated Operator');
    });
  });

  describe('Payment Model', () => {
    it('should create and retrieve payment', async () => {
      // First create a terminal
      const terminal = await Terminal.create(db, {
        name: 'Test Terminal',
        operator: 'Test Operator'
      });

      const paymentData = {
        terminalId: terminal.id,
        amount: 10000,
        currency: 'RUB',
        method: 'nfc',
        status: 'pending'
      };

      const payment = await Payment.create(db, paymentData);
      expect(payment.id).toBeDefined();
      expect(payment.terminalId).toBe(paymentData.terminalId);
      expect(payment.amount).toBe(paymentData.amount);

      const retrieved = await Payment.findById(db, payment.id);
      expect(retrieved).toBeDefined();
      expect(retrieved.amount).toBe(paymentData.amount);
    });
  });

  describe('QRCode Model', () => {
    it('should create and retrieve QR code', async () => {
      // First create terminal and payment
      const terminal = await Terminal.create(db, {
        name: 'Test Terminal',
        operator: 'Test Operator'
      });

      const payment = await Payment.create(db, {
        terminalId: terminal.id,
        amount: 5000,
        method: 'qr'
      });

      const qrCodeData = {
        paymentId: payment.id,
        data: 'test-qr-data',
        expiresAt: new Date(Date.now() + 300000) // 5 minutes from now
      };

      const qrCode = await QRCode.create(db, qrCodeData);
      expect(qrCode.id).toBeDefined();
      expect(qrCode.paymentId).toBe(payment.id);
      expect(qrCode.data).toBe(qrCodeData.data);

      const retrieved = await QRCode.findById(db, qrCode.id);
      expect(retrieved).toBeDefined();
      expect(retrieved.paymentId).toBe(payment.id);
    });

    it('should detect expired QR codes', async () => {
      const terminal = await Terminal.create(db, {
        name: 'Test Terminal',
        operator: 'Test Operator'
      });

      const payment = await Payment.create(db, {
        terminalId: terminal.id,
        amount: 5000,
        method: 'qr'
      });

      const expiredQRCode = await QRCode.create(db, {
        paymentId: payment.id,
        data: 'expired-qr-data',
        expiresAt: new Date(Date.now() - 1000) // 1 second ago
      });

      expect(expiredQRCode.isExpired()).toBe(true);

      const activeQRCode = await QRCode.create(db, {
        paymentId: payment.id,
        data: 'active-qr-data',
        expiresAt: new Date(Date.now() + 300000) // 5 minutes from now
      });

      expect(activeQRCode.isExpired()).toBe(false);
    });
  });

  // Feature: payment-terminal-system, Property 10: Логирование всех транзакций
  describe('Property-Based Tests', () => {
    it('Property 10: All payment transactions are logged for audit', async () => {
      // Mock console.log to capture log entries
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await fc.assert(fc.asyncProperty(
        fc.record({
          terminalId: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
          amount: fc.integer({ min: 1, max: 1000000 }),
          method: fc.oneof(fc.constant('nfc'), fc.constant('qr')),
          status: fc.oneof(
            fc.constant('pending'),
            fc.constant('processing'),
            fc.constant('completed'),
            fc.constant('failed')
          ),
          currency: fc.constant('RUB')
        }),
        fc.oneof(
          fc.constant('created'),
          fc.constant('updated'),
          fc.constant('completed'),
          fc.constant('failed')
        ),
        async (paymentData, action) => {
          // Clear previous logs
          logSpy.mockClear();

          // Call the logging function
          const logEntry = await Payment.logTransaction(db, paymentData, action);

          // Verify that console.log was called
          if (logSpy.mock.calls.length === 0) {
            return false;
          }

          // Verify log entry structure
          if (!logEntry || 
              logEntry.terminalId !== paymentData.terminalId ||
              logEntry.amount !== paymentData.amount ||
              logEntry.method !== paymentData.method ||
              logEntry.status !== paymentData.status ||
              logEntry.action !== action ||
              !logEntry.timestamp) {
            return false;
          }

          // Verify the logged message contains transaction details
          const logCalls = logSpy.mock.calls;
          if (logCalls.length === 0) {
            return false;
          }
          
          try {
            const logMessage = logCalls[0][1]; // Second argument of console.log call
            const parsedLog = JSON.parse(logMessage);
            
            return parsedLog.terminalId === paymentData.terminalId &&
                   parsedLog.amount === paymentData.amount &&
                   parsedLog.method === paymentData.method &&
                   parsedLog.action === action;
          } catch (e) {
            return false;
          }
        }
      ), { numRuns: 100 });

      // Restore console.log
      logSpy.mockRestore();
    });
  });
});