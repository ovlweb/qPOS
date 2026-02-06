import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import QRGenerator from '../services/QRGenerator.js';
import Database from '../database/database.js';
import { QRCode as QRCodeModel } from '../models/index.js';

describe('QR Generator Property-Based Tests', () => {
  let qrGenerator;
  let db;

  beforeEach(async () => {
    qrGenerator = new QRGenerator({
      expirationMinutes: 15,
      secretKey: 'test-secret-key'
    });
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
    terminalId: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
    amount: fc.integer({ min: 1, max: 1000000 }),
    currency: fc.oneof(fc.constant('RUB'), fc.constant('USD'), fc.constant('EUR'))
  });

  const paymentDataArrayArbitrary = fc.array(paymentDataArbitrary, { minLength: 2, maxLength: 10 });

  // Feature: payment-terminal-system, Property 5: Генерация уникальных QR-кодов
  describe('Property 5: Generation of unique QR codes', () => {
    it('should generate unique QR codes for different payments', async () => {
      await fc.assert(fc.asyncProperty(
        paymentDataArrayArbitrary,
        async (paymentsData) => {
          // Generate QR codes for all payments
          const qrCodes = await Promise.all(
            paymentsData.map(paymentData => qrGenerator.generatePaymentQR(paymentData))
          );

          // Extract QR code IDs and data
          const qrIds = qrCodes.map(qr => qr.id);
          const qrDataStrings = qrCodes.map(qr => qr.data);

          // Verify all IDs are unique
          const uniqueIds = new Set(qrIds);
          expect(qrIds.length).toBe(uniqueIds.size);

          // Verify all data strings are unique
          const uniqueDataStrings = new Set(qrDataStrings);
          expect(qrDataStrings.length).toBe(uniqueDataStrings.size);

          // Verify each QR code has required properties
          qrCodes.forEach(qrCode => {
            expect(qrCode).toHaveProperty('id');
            expect(qrCode).toHaveProperty('data');
            expect(qrCode).toHaveProperty('image');
            expect(qrCode).toHaveProperty('expiresAt');
            expect(qrCode).toHaveProperty('paymentData');

            // Verify image is a data URL
            expect(qrCode.image).toMatch(/^data:image\/png;base64,/);

            // Verify expiration is in the future
            expect(new Date(qrCode.expiresAt)).toBeInstanceOf(Date);
            expect(new Date(qrCode.expiresAt).getTime()).toBeGreaterThan(Date.now());
          });

          return true;
        }
      ), { numRuns: 50 });
    });

    it('should generate unique QR codes even for identical payment data', async () => {
      await fc.assert(fc.asyncProperty(
        paymentDataArbitrary,
        async (paymentData) => {
          // Generate multiple QR codes for the same payment data
          const qrCodes = await Promise.all([
            qrGenerator.generatePaymentQR(paymentData),
            qrGenerator.generatePaymentQR(paymentData),
            qrGenerator.generatePaymentQR(paymentData)
          ]);

          // All QR codes should have unique IDs
          const qrIds = qrCodes.map(qr => qr.id);
          const uniqueIds = new Set(qrIds);
          expect(qrIds.length).toBe(uniqueIds.size);

          // All QR codes should have unique data (due to timestamps and IDs)
          const qrDataStrings = qrCodes.map(qr => qr.data);
          const uniqueDataStrings = new Set(qrDataStrings);
          expect(qrDataStrings.length).toBe(uniqueDataStrings.size);

          // But payment data should be the same
          qrCodes.forEach(qrCode => {
            expect(qrCode.paymentData.terminalId).toBe(paymentData.terminalId);
            expect(qrCode.paymentData.amount).toBe(paymentData.amount);
            expect(qrCode.paymentData.currency).toBe(paymentData.currency);
          });

          return true;
        }
      ), { numRuns: 30 });
    });

    it('should generate QR codes with valid signatures', async () => {
      await fc.assert(fc.asyncProperty(
        paymentDataArbitrary,
        async (paymentData) => {
          const qrCode = await qrGenerator.generatePaymentQR(paymentData);
          
          // Parse the QR data
          const qrData = JSON.parse(qrCode.data);
          
          // Verify signature exists
          expect(qrData).toHaveProperty('signature');
          expect(typeof qrData.signature).toBe('string');
          expect(qrData.signature.length).toBeGreaterThan(0);

          // Validate the QR code using the generator's validation method
          const validation = qrGenerator.validateQRCode(qrCode.data);
          expect(validation.valid).toBe(true);
          expect(validation).not.toHaveProperty('error');

          return true;
        }
      ), { numRuns: 50 });
    });

    it('should handle batch QR code generation correctly', async () => {
      await fc.assert(fc.asyncProperty(
        paymentDataArrayArbitrary,
        async (paymentsData) => {
          // Generate batch QR codes
          const batchQRCodes = await qrGenerator.generateBatchQRCodes(paymentsData);

          // Verify correct number of QR codes generated
          expect(batchQRCodes.length).toBe(paymentsData.length);

          // Verify all QR codes are unique
          const qrIds = batchQRCodes.map(qr => qr.id);
          const uniqueIds = new Set(qrIds);
          expect(qrIds.length).toBe(uniqueIds.size);

          // Verify each QR code corresponds to correct payment data
          batchQRCodes.forEach((qrCode, index) => {
            const originalPayment = paymentsData[index];
            expect(qrCode.paymentData.terminalId).toBe(originalPayment.terminalId);
            expect(qrCode.paymentData.amount).toBe(originalPayment.amount);
            expect(qrCode.paymentData.currency).toBe(originalPayment.currency);
          });

          return true;
        }
      ), { numRuns: 20 });
    });

    it('should generate QR codes with consistent expiration behavior', async () => {
      await fc.assert(fc.asyncProperty(
        fc.tuple(paymentDataArbitrary, fc.integer({ min: 1, max: 60 })),
        async ([paymentData, expirationMinutes]) => {
          const beforeGeneration = Date.now();
          const qrCode = await qrGenerator.generatePaymentQR(paymentData, expirationMinutes);
          const afterGeneration = Date.now();

          const expiresAt = new Date(qrCode.expiresAt);
          const expectedExpirationTime = beforeGeneration + (expirationMinutes * 60 * 1000);
          const maxExpectedExpirationTime = afterGeneration + (expirationMinutes * 60 * 1000);

          // Expiration should be within the expected range
          expect(expiresAt.getTime()).toBeGreaterThanOrEqual(expectedExpirationTime);
          expect(expiresAt.getTime()).toBeLessThanOrEqual(maxExpectedExpirationTime);

          // QR code should not be expired immediately after generation
          expect(qrGenerator.isExpired(qrCode.data)).toBe(false);

          return true;
        }
      ), { numRuns: 30 });
    });

    it('should extract payment information correctly from generated QR codes', async () => {
      await fc.assert(fc.asyncProperty(
        paymentDataArbitrary,
        async (paymentData) => {
          const qrCode = await qrGenerator.generatePaymentQR(paymentData);
          
          // Extract payment info from the generated QR code
          const extractedInfo = qrGenerator.extractPaymentInfo(qrCode.data);

          // Verify extracted information matches original
          expect(extractedInfo).not.toBeNull();
          expect(extractedInfo.terminalId).toBe(paymentData.terminalId);
          expect(extractedInfo.amount).toBe(paymentData.amount);
          expect(extractedInfo.currency).toBe(paymentData.currency);
          expect(extractedInfo).toHaveProperty('id');
          expect(extractedInfo).toHaveProperty('timestamp');
          expect(extractedInfo).toHaveProperty('expiresAt');

          return true;
        }
      ), { numRuns: 50 });
    });

    it('should handle invalid QR data gracefully', async () => {
      await fc.assert(fc.property(
        fc.oneof(
          fc.string(),
          fc.constant(''),
          fc.constant('invalid-json'),
          fc.constant('{"incomplete": "data"}'),
          fc.constant(null),
          fc.constant(undefined)
        ),
        (invalidData) => {
          // Validation should fail for invalid data
          const validation = qrGenerator.validateQRCode(invalidData);
          expect(validation.valid).toBe(false);
          expect(validation).toHaveProperty('error');
          expect(validation).toHaveProperty('message');

          // Extraction should return null for invalid data
          const extractedInfo = qrGenerator.extractPaymentInfo(invalidData);
          expect(extractedInfo).toBeNull();

          // Invalid data should be considered expired
          expect(qrGenerator.isExpired(invalidData)).toBe(true);

          return true;
        }
      ), { numRuns: 30 });
    });
  });

  // Additional property tests for QR code behavior
  describe('QR Code Validation Properties', () => {
    it('should detect expired QR codes', async () => {
      await fc.assert(fc.asyncProperty(
        paymentDataArbitrary,
        async (paymentData) => {
          // Generate QR code with very short expiration (0.1 seconds)
          const qrCode = await qrGenerator.generatePaymentQR(paymentData, 0.1/60);
          
          // Initially should not be expired
          expect(qrGenerator.isExpired(qrCode.data)).toBe(false);
          
          // Wait for expiration (200ms to be safe)
          await new Promise(resolve => setTimeout(resolve, 200));
          
          // Now should be expired
          expect(qrGenerator.isExpired(qrCode.data)).toBe(true);
          
          // Validation should fail for expired QR code
          const validation = qrGenerator.validateQRCode(qrCode.data);
          expect(validation.valid).toBe(false);
          expect(validation.error).toBe('QR_EXPIRED');

          return true;
        }
      ), { numRuns: 5 }); // Fewer runs due to timing
    }, 5000); // 5 second timeout

    it('should detect tampered QR codes', async () => {
      await fc.assert(fc.asyncProperty(
        paymentDataArbitrary,
        async (paymentData) => {
          const qrCode = await qrGenerator.generatePaymentQR(paymentData);
          const qrData = JSON.parse(qrCode.data);
          
          // Tamper with the amount
          qrData.amount = qrData.amount + 1000;
          const tamperedData = JSON.stringify(qrData);
          
          // Validation should fail for tampered data
          const validation = qrGenerator.validateQRCode(tamperedData);
          expect(validation.valid).toBe(false);
          expect(validation.error).toBe('INVALID_SIGNATURE');

          return true;
        }
      ), { numRuns: 30 });
    });
  });
});