import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import ErrorHandler from '../services/ErrorHandler.js';

describe('Error Handling Properties', () => {
  let errorHandler;

  beforeEach(() => {
    errorHandler = new ErrorHandler({
      enableConsoleLogging: false, // Disable console logging for tests
      enableFileLogging: false
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Feature: payment-terminal-system, Property 14: Отображение ошибок с кодом
  test('Property 14: Bank-declined payments display error cross with error code', () => {
    fc.assert(fc.property(
      fc.oneof(
        fc.constant('E001'), // Insufficient funds
        fc.constant('E002'), // Card blocked
        fc.constant('E003'), // Network error
        fc.constant('E004'), // Invalid card
        fc.constant('E005'), // Expired card
        fc.constant('E006'), // Transaction declined
        fc.constant('E007')  // Capture failed
      ),
      fc.record({
        terminalId: fc.string({ minLength: 1, maxLength: 10 }),
        paymentId: fc.string({ minLength: 1, maxLength: 20 }),
        amount: fc.integer({ min: 100, max: 100000 })
      }),
      (errorCode, context) => {
        // Property: For any bank-declined payment, error display should include error code
        const errorResult = errorHandler.handleError({ code: errorCode }, context);
        
        // Verify error code is displayed
        const hasErrorCode = errorResult.code === errorCode;
        
        // Verify error message is user-friendly
        const hasMessage = typeof errorResult.message === 'string' && errorResult.message.length > 0;
        
        // Verify error type is correctly classified
        const isBankOrNetworkError = ['bank', 'network'].includes(errorResult.type);
        
        // Verify timeout is set for auto-return (Requirements 5.4)
        const hasTimeout = typeof errorResult.timeout === 'number' && errorResult.timeout > 0;
        
        // Verify timestamp is present
        const hasTimestamp = typeof errorResult.timestamp === 'string';
        
        return hasErrorCode && hasMessage && isBankOrNetworkError && hasTimeout && hasTimestamp;
      }
    ), { numRuns: 100 });
  });

  // Feature: payment-terminal-system, Property 15: Предложение повтора при ошибке
  test('Property 15: Error display offers retry option when appropriate', () => {
    fc.assert(fc.property(
      fc.oneof(
        // Retryable errors
        fc.record({ code: fc.oneof(fc.constant('E001'), fc.constant('E002'), fc.constant('E003')), shouldRetry: fc.constant(true) }),
        fc.record({ code: fc.oneof(fc.constant('NFC001'), fc.constant('NFC002'), fc.constant('QR001')), shouldRetry: fc.constant(true) }),
        // Non-retryable errors
        fc.record({ code: fc.oneof(fc.constant('SYS001'), fc.constant('SYS002'), fc.constant('SYS003')), shouldRetry: fc.constant(false) })
      ),
      fc.record({
        terminalId: fc.string({ minLength: 1, maxLength: 10 }),
        paymentId: fc.string({ minLength: 1, maxLength: 20 })
      }),
      (errorData, context) => {
        // Property: For any error, retry option should be shown based on error type
        const errorResult = errorHandler.handleError({ code: errorData.code }, context);
        
        // Verify retry option matches expected behavior
        const retryOptionCorrect = errorResult.showRetry === errorData.shouldRetry;
        
        // Verify error is properly classified
        const hasValidType = typeof errorResult.type === 'string' && errorResult.type.length > 0;
        
        // Verify error code is preserved
        const hasCorrectCode = errorResult.code === errorData.code;
        
        // Verify message is present
        const hasMessage = typeof errorResult.message === 'string' && errorResult.message.length > 0;
        
        // Verify timeout is appropriate for error type
        const hasValidTimeout = typeof errorResult.timeout === 'number' && errorResult.timeout > 0;
        
        return retryOptionCorrect && hasValidType && hasCorrectCode && hasMessage && hasValidTimeout;
      }
    ), { numRuns: 100 });
  });

  // Feature: payment-terminal-system, Property 16: Обработка таймаута
  test('Property 16: Timeout errors are properly handled and displayed', () => {
    fc.assert(fc.property(
      fc.record({
        terminalId: fc.string({ minLength: 1, maxLength: 10 }),
        paymentId: fc.string({ minLength: 1, maxLength: 20 }),
        operation: fc.oneof(fc.constant('payment'), fc.constant('nfc'), fc.constant('qr'), fc.constant('bank'))
      }),
      (context) => {
        // Property: For any timeout scenario, appropriate timeout error should be displayed
        const timeoutError = errorHandler.handleTimeout(context);
        
        // Verify timeout error code
        const hasTimeoutCode = timeoutError.code === 'TIMEOUT001';
        
        // Verify timeout error message
        const hasTimeoutMessage = timeoutError.message === 'Время ожидания истекло';
        
        // Verify timeout error type
        const hasTimeoutType = timeoutError.type === 'timeout';
        
        // Verify retry is offered for timeout errors
        const offersRetry = timeoutError.showRetry === true;
        
        // Verify timeout duration is set (Requirements 5.3)
        const hasValidTimeout = typeof timeoutError.timeout === 'number' && timeoutError.timeout === 5000;
        
        // Verify timestamp is present
        const hasTimestamp = typeof timeoutError.timestamp === 'string';
        
        return hasTimeoutCode && hasTimeoutMessage && hasTimeoutType && 
               offersRetry && hasValidTimeout && hasTimestamp;
      }
    ), { numRuns: 100 });
  });

  // Feature: payment-terminal-system, Property 17: Автовозврат после ошибки
  test('Property 17: Error display auto-returns to waiting screen after 5 seconds', () => {
    fc.assert(fc.property(
      fc.oneof(
        fc.constant('E001'), fc.constant('E002'), fc.constant('E003'), fc.constant('E004'),
        fc.constant('NFC001'), fc.constant('NFC002'), fc.constant('QR001'), fc.constant('QR002'),
        fc.constant('TIMEOUT001'), fc.constant('SYS001')
      ),
      fc.record({
        terminalId: fc.string({ minLength: 1, maxLength: 10 }),
        paymentId: fc.string({ minLength: 1, maxLength: 20 }),
        amount: fc.integer({ min: 100, max: 100000 })
      }),
      (errorCode, context) => {
        // Property: For any error, auto-return timeout should be 5 seconds
        const errorResult = errorHandler.handleError({ code: errorCode }, context);
        
        // Verify auto-return timeout is exactly 5 seconds (Requirements 5.4)
        const hasCorrectTimeout = errorResult.timeout === 5000;
        
        // Verify error is properly processed
        const hasErrorCode = errorResult.code === errorCode;
        const hasMessage = typeof errorResult.message === 'string' && errorResult.message.length > 0;
        const hasType = typeof errorResult.type === 'string' && errorResult.type.length > 0;
        
        // Verify timestamp for tracking
        const hasTimestamp = typeof errorResult.timestamp === 'string';
        
        // Verify timeout is consistent across all error types
        const timeoutFromMethod = errorHandler.getErrorTimeout(errorCode);
        const timeoutConsistent = timeoutFromMethod === errorResult.timeout;
        
        return hasCorrectTimeout && hasErrorCode && hasMessage && hasType && 
               hasTimestamp && timeoutConsistent;
      }
    ), { numRuns: 100 });
  });

  // Additional property test for error classification consistency
  test('Property: Error classification is consistent and deterministic', () => {
    fc.assert(fc.property(
      fc.oneof(
        fc.constant('E001'), fc.constant('E002'), fc.constant('E003'),
        fc.constant('NFC001'), fc.constant('NFC002'), fc.constant('NFC003'),
        fc.constant('QR001'), fc.constant('QR002'), fc.constant('QR003'),
        fc.constant('SYS001'), fc.constant('SYS002'), fc.constant('TIMEOUT001')
      ),
      fc.record({
        terminalId: fc.string({ minLength: 1, maxLength: 10 }),
        operation: fc.oneof(fc.constant('payment'), fc.constant('nfc'), fc.constant('qr'))
      }),
      (errorCode, context) => {
        // Property: Error classification should be consistent across multiple calls
        const result1 = errorHandler.handleError({ code: errorCode }, context);
        const result2 = errorHandler.handleError({ code: errorCode }, context);
        
        // Verify consistency (excluding timestamp which should be different)
        const codeConsistent = result1.code === result2.code;
        const messageConsistent = result1.message === result2.message;
        const typeConsistent = result1.type === result2.type;
        const timeoutConsistent = result1.timeout === result2.timeout;
        const retryConsistent = result1.showRetry === result2.showRetry;
        
        // Verify error code is valid
        const hasValidCode = typeof result1.code === 'string' && result1.code.length > 0;
        
        // Verify error type is from valid set
        const validTypes = ['nfc', 'qr', 'bank', 'network', 'system', 'timeout'];
        const hasValidType = validTypes.includes(result1.type);
        
        // Verify timeout is positive
        const hasPositiveTimeout = result1.timeout > 0;
        
        return codeConsistent && messageConsistent && typeConsistent && 
               timeoutConsistent && retryConsistent && hasValidCode && 
               hasValidType && hasPositiveTimeout;
      }
    ), { numRuns: 100 });
  });

  // Property test for NFC error handling
  test('Property: NFC errors are properly classified and handled', () => {
    fc.assert(fc.property(
      fc.record({
        message: fc.oneof(
          fc.constant('NFC not supported'),
          fc.constant('NFC read failed'),
          fc.constant('NFC timeout occurred'),
          fc.constant('Unknown NFC error')
        ),
        terminalId: fc.string({ minLength: 1, maxLength: 10 })
      }),
      (errorData) => {
        // Property: NFC errors should be properly classified based on message content
        const nfcError = new Error(errorData.message);
        const result = errorHandler.handleNFCError(nfcError, { terminalId: errorData.terminalId });
        
        // Verify NFC error type
        const hasNFCType = result.type === 'nfc';
        
        // Verify appropriate NFC error code is assigned
        let expectedCode = 'NFC001'; // Default
        if (errorData.message.includes('not supported')) expectedCode = 'NFC001';
        else if (errorData.message.includes('read')) expectedCode = 'NFC002';
        else if (errorData.message.includes('timeout')) expectedCode = 'NFC003';
        
        const hasCorrectCode = result.code === expectedCode;
        
        // Verify NFC errors are retryable
        const isRetryable = result.showRetry === true;
        
        // Verify timeout is set
        const hasTimeout = result.timeout === 5000;
        
        // Verify message is user-friendly
        const hasUserFriendlyMessage = typeof result.message === 'string' && 
                                      result.message.length > 0 &&
                                      !result.message.includes('Error:');
        
        return hasNFCType && hasCorrectCode && isRetryable && hasTimeout && hasUserFriendlyMessage;
      }
    ), { numRuns: 100 });
  });

  // Property test for QR error handling
  test('Property: QR errors are properly classified and handled', () => {
    fc.assert(fc.property(
      fc.record({
        message: fc.oneof(
          fc.constant('QR generation failed'),
          fc.constant('Network error during QR generation'),
          fc.constant('QR payment failed'),
          fc.constant('QR timeout expired'),
          fc.constant('Unknown QR error')
        ),
        terminalId: fc.string({ minLength: 1, maxLength: 10 }),
        paymentId: fc.string({ minLength: 1, maxLength: 20 })
      }),
      (errorData) => {
        // Property: QR errors should be properly classified based on message content
        const qrError = new Error(errorData.message);
        const result = errorHandler.handleQRError(qrError, { 
          terminalId: errorData.terminalId,
          paymentId: errorData.paymentId 
        });
        
        // Verify QR error type
        const hasQRType = result.type === 'qr';
        
        // Verify appropriate QR error code is assigned
        let expectedCode = 'QR001'; // Default
        if (errorData.message.includes('network') || errorData.message.includes('fetch')) expectedCode = 'QR002';
        else if (errorData.message.includes('timeout') || errorData.message.includes('expired')) expectedCode = 'QR004';
        else if (errorData.message.includes('payment')) expectedCode = 'QR003';
        
        const hasCorrectCode = result.code === expectedCode;
        
        // Verify QR errors are retryable
        const isRetryable = result.showRetry === true;
        
        // Verify timeout is set
        const hasTimeout = result.timeout === 5000;
        
        // Verify message is user-friendly
        const hasUserFriendlyMessage = typeof result.message === 'string' && 
                                      result.message.length > 0 &&
                                      !result.message.includes('Error:');
        
        return hasQRType && hasCorrectCode && isRetryable && hasTimeout && hasUserFriendlyMessage;
      }
    ), { numRuns: 100 });
  });

  // Property test for bank error handling
  test('Property: Bank errors are properly classified and handled', () => {
    fc.assert(fc.property(
      fc.record({
        errorCode: fc.oneof(
          fc.constant('E001'), fc.constant('E002'), fc.constant('E003'),
          fc.constant('E004'), fc.constant('E005'), fc.constant('E006'), fc.constant('E007')
        ),
        errorMessage: fc.oneof(
          fc.constant('Insufficient funds'),
          fc.constant('Card is blocked'),
          fc.constant('Network connection error'),
          fc.constant('Invalid card data'),
          fc.constant('Card has expired'),
          fc.constant('Transaction declined by issuer'),
          fc.constant('Capture failed - authorization expired')
        ),
        transactionId: fc.string({ minLength: 10, maxLength: 36 })
      }),
      fc.record({
        terminalId: fc.string({ minLength: 1, maxLength: 10 }),
        paymentId: fc.string({ minLength: 1, maxLength: 20 })
      }),
      (bankResponse, context) => {
        // Property: Bank errors should be properly classified and handled
        const result = errorHandler.handleBankError(bankResponse, context);
        
        // Verify bank error code is preserved
        const hasCorrectCode = result.code === bankResponse.errorCode;
        
        // Verify bank error type (E003 is network, others are bank)
        const expectedType = bankResponse.errorCode === 'E003' ? 'network' : 'bank';
        const hasCorrectType = result.type === expectedType;
        
        // Verify bank errors are retryable (except system errors)
        const shouldBeRetryable = result.type !== 'system';
        const retryableCorrect = result.showRetry === shouldBeRetryable;
        
        // Verify timeout is set
        const hasTimeout = result.timeout === 5000;
        
        // Verify message is user-friendly
        const hasUserFriendlyMessage = typeof result.message === 'string' && 
                                      result.message.length > 0;
        
        // Verify timestamp is present
        const hasTimestamp = typeof result.timestamp === 'string';
        
        return hasCorrectCode && hasCorrectType && retryableCorrect && 
               hasTimeout && hasUserFriendlyMessage && hasTimestamp;
      }
    ), { numRuns: 100 });
  });
});