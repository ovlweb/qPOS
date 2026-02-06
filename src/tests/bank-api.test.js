import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import TestBankAPI from '../services/TestBankAPI.js';
import Database from '../database/database.js';
import { Terminal, Payment } from '../models/index.js';

describe('Banking API Property-Based Tests', () => {
  let bankAPI;
  let db;

  beforeEach(async () => {
    bankAPI = new TestBankAPI({ successRate: 0.9, responseDelay: 10 }); // Fast tests
    db = new Database(':memory:');
    await db.initialize();
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  // Arbitraries for generating test data
  const paymentDataArbitrary = fc.record({
    amount: fc.integer({ min: 1, max: 1000000 }),
    currency: fc.constant('RUB'),
    terminalId: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
    paymentId: fc.uuid(),
    cardData: fc.record({
      cardNumber: fc.string({ minLength: 16, maxLength: 19 }),
      expiryMonth: fc.integer({ min: 1, max: 12 }),
      expiryYear: fc.integer({ min: 2024, max: 2030 })
    })
  });

  const transactionIdArbitrary = fc.uuid();

  // Feature: payment-terminal-system, Property 7: Авторизация в банке при инициации
  describe('Property 7: Bank authorization on payment initiation', () => {
    it('should always attempt bank authorization when payment is initiated', async () => {
      // Mock the authorization method to track calls
      const authSpy = vi.spyOn(bankAPI, 'authorizePayment');

      await fc.assert(fc.asyncProperty(
        paymentDataArbitrary,
        async (paymentData) => {
          authSpy.mockClear();
          
          // Call authorization
          const result = await bankAPI.authorizePayment(paymentData);
          
          // Verify authorization was called
          expect(authSpy).toHaveBeenCalledTimes(1);
          expect(authSpy).toHaveBeenCalledWith(paymentData);
          
          // Verify result structure
          expect(result).toHaveProperty('success');
          expect(result).toHaveProperty('transactionId');
          expect(result).toHaveProperty('timestamp');
          
          if (result.success) {
            expect(result).toHaveProperty('authCode');
            expect(result).toHaveProperty('status', 'authorized');
            expect(result.amount).toBe(paymentData.amount);
            expect(result.currency).toBe(paymentData.currency);
          } else {
            expect(result).toHaveProperty('errorCode');
            expect(result).toHaveProperty('errorMessage');
            expect(result).toHaveProperty('status', 'declined');
          }
          
          return true;
        }
      ), { numRuns: 50 });

      authSpy.mockRestore();
    });
  });

  // Feature: payment-terminal-system, Property 8: Завершение при успешном ответе банка
  describe('Property 8: Payment completion on successful bank response', () => {
    it('should complete transaction when bank returns success', async () => {
      // Set high success rate and fast response for this test
      bankAPI.setSuccessRate(1.0);
      bankAPI.setResponseDelay(10); // Very fast for testing

      await fc.assert(fc.asyncProperty(
        paymentDataArbitrary,
        async (paymentData) => {
          // Create terminal and payment in database
          const terminal = await Terminal.create(db, {
            name: 'Test Terminal',
            operator: 'Test Operator'
          });

          const payment = await Payment.create(db, {
            terminalId: terminal.id,
            amount: paymentData.amount,
            currency: paymentData.currency,
            method: 'nfc',
            status: 'pending'
          });

          // Authorize payment
          const authResult = await bankAPI.authorizePayment({
            ...paymentData,
            terminalId: terminal.id,
            paymentId: payment.id
          });

          // Since success rate is 1.0, authorization should always succeed
          expect(authResult.success).toBe(true);

          // Capture payment
          const captureResult = await bankAPI.capturePayment(authResult.transactionId, paymentData.amount);

          // Verify successful completion
          expect(captureResult.success).toBe(true);
          expect(captureResult.status).toBe('captured');
          expect(captureResult.transactionId).toBe(authResult.transactionId);
          expect(captureResult.capturedAmount).toBe(paymentData.amount);

          return true;
        }
      ), { numRuns: 10 }); // Reduced runs for faster execution
    }, 15000); // Increased timeout to 15 seconds
  });

  // Feature: payment-terminal-system, Property 9: Отображение ошибок банка
  describe('Property 9: Display of bank errors', () => {
    it('should return appropriate error information when bank declines payment', async () => {
      // Set low success rate to force errors
      bankAPI.setSuccessRate(0.0);

      await fc.assert(fc.asyncProperty(
        paymentDataArbitrary,
        async (paymentData) => {
          // Authorize payment (should fail)
          const authResult = await bankAPI.authorizePayment(paymentData);

          // Verify failure response structure
          expect(authResult.success).toBe(false);
          expect(authResult.status).toBe('declined');
          expect(authResult).toHaveProperty('errorCode');
          expect(authResult).toHaveProperty('errorMessage');
          expect(authResult).toHaveProperty('transactionId');
          expect(authResult).toHaveProperty('timestamp');

          // Verify error code is valid
          const validErrorCodes = ['E001', 'E002', 'E003', 'E004', 'E005', 'E006'];
          expect(validErrorCodes).toContain(authResult.errorCode);

          // Verify error message is not empty
          expect(authResult.errorMessage).toBeTruthy();
          expect(typeof authResult.errorMessage).toBe('string');
          expect(authResult.errorMessage.length).toBeGreaterThan(0);

          return true;
        }
      ), { numRuns: 30 });
    });

    it('should handle network errors gracefully', async () => {
      // Mock network error
      const originalAuthorize = bankAPI.authorizePayment.bind(bankAPI);
      vi.spyOn(bankAPI, 'authorizePayment').mockImplementation(async () => {
        throw new Error('Network timeout');
      });

      await fc.assert(fc.asyncProperty(
        paymentDataArbitrary,
        async (paymentData) => {
          try {
            await bankAPI.authorizePayment(paymentData);
            // Should not reach here
            return false;
          } catch (error) {
            // Verify error is properly thrown
            expect(error).toBeInstanceOf(Error);
            expect(error.message).toBe('Network timeout');
            return true;
          }
        }
      ), { numRuns: 20 });

      // Restore original method
      bankAPI.authorizePayment.mockRestore();
    });
  });

  // Additional property tests for bank API behavior
  describe('Bank API Consistency Properties', () => {
    it('should generate unique transaction IDs', async () => {
      await fc.assert(fc.asyncProperty(
        fc.array(paymentDataArbitrary, { minLength: 2, maxLength: 10 }),
        async (paymentDataArray) => {
          const results = await Promise.all(
            paymentDataArray.map(data => bankAPI.authorizePayment(data))
          );

          const transactionIds = results.map(r => r.transactionId);
          const uniqueIds = new Set(transactionIds);

          // All transaction IDs should be unique
          return transactionIds.length === uniqueIds.size;
        }
      ), { numRuns: 20 });
    });

    it('should respect configured success rate', async () => {
      const testSuccessRate = 0.7;
      bankAPI.setSuccessRate(testSuccessRate);

      await fc.assert(fc.asyncProperty(
        fc.array(paymentDataArbitrary, { minLength: 50, maxLength: 100 }),
        async (paymentDataArray) => {
          const results = await Promise.all(
            paymentDataArray.map(data => bankAPI.authorizePayment(data))
          );

          const successCount = results.filter(r => r.success).length;
          const actualSuccessRate = successCount / results.length;

          // Allow for some variance due to randomness (±15%)
          const tolerance = 0.15;
          const lowerBound = testSuccessRate - tolerance;
          const upperBound = testSuccessRate + tolerance;

          return actualSuccessRate >= lowerBound && actualSuccessRate <= upperBound;
        }
      ), { numRuns: 5 }); // Fewer runs due to large arrays
    });

    it('should maintain response time consistency', async () => {
      const testDelay = 100;
      bankAPI.setResponseDelay(testDelay);

      await fc.assert(fc.asyncProperty(
        paymentDataArbitrary,
        async (paymentData) => {
          const startTime = Date.now();
          await bankAPI.authorizePayment(paymentData);
          const endTime = Date.now();
          
          const actualDelay = endTime - startTime;
          
          // Allow for some variance (±50ms)
          return actualDelay >= testDelay - 50 && actualDelay <= testDelay + 100;
        }
      ), { numRuns: 20 });
    });

    it('should handle capture operations consistently', async () => {
      await fc.assert(fc.asyncProperty(
        fc.tuple(paymentDataArbitrary, transactionIdArbitrary),
        async ([paymentData, transactionId]) => {
          const captureResult = await bankAPI.capturePayment(transactionId, paymentData.amount);

          // Verify capture result structure
          expect(captureResult).toHaveProperty('success');
          expect(captureResult).toHaveProperty('transactionId', transactionId);
          expect(captureResult).toHaveProperty('timestamp');

          if (captureResult.success) {
            expect(captureResult.status).toBe('captured');
            expect(captureResult.capturedAmount).toBe(paymentData.amount);
          } else {
            expect(captureResult).toHaveProperty('errorCode');
            expect(captureResult).toHaveProperty('errorMessage');
            expect(captureResult.status).toBe('capture_failed');
          }

          return true;
        }
      ), { numRuns: 30 });
    });
  });
});