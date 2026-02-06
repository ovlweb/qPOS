/**
 * ErrorHandler Class
 * Centralized error handling for the payment terminal system
 * Provides error classification, logging, and user-friendly error display
 */
class ErrorHandler {
  constructor(options = {}) {
    this.logLevel = options.logLevel || 'error';
    this.enableConsoleLogging = options.enableConsoleLogging !== false;
    this.enableFileLogging = options.enableFileLogging || false;
    this.logFilePath = options.logFilePath || './logs/errors.log';
    
    // Error type classifications
    this.errorTypes = {
      NFC_ERROR: 'nfc',
      QR_ERROR: 'qr', 
      BANK_ERROR: 'bank',
      NETWORK_ERROR: 'network',
      SYSTEM_ERROR: 'system',
      VALIDATION_ERROR: 'validation',
      TIMEOUT_ERROR: 'timeout'
    };

    // Error code mappings with user-friendly messages
    this.errorCodes = {
      // NFC Errors (Requirements 5.1)
      'NFC001': { message: 'NFC не поддерживается', type: 'nfc', timeout: 5000 },
      'NFC002': { message: 'Ошибка чтения NFC', type: 'nfc', timeout: 5000 },
      'NFC003': { message: 'Таймаут NFC операции', type: 'nfc', timeout: 5000 },
      
      // QR Errors (Requirements 5.1)
      'QR001': { message: 'Ошибка генерации QR-кода', type: 'qr', timeout: 5000 },
      'QR002': { message: 'Ошибка сети при генерации QR-кода', type: 'qr', timeout: 5000 },
      'QR003': { message: 'Ошибка QR платежа', type: 'qr', timeout: 5000 },
      'QR004': { message: 'Время ожидания QR платежа истекло', type: 'qr', timeout: 5000 },
      
      // Bank Errors (Requirements 5.1)
      'E001': { message: 'Недостаточно средств', type: 'bank', timeout: 5000 },
      'E002': { message: 'Карта заблокирована', type: 'bank', timeout: 5000 },
      'E003': { message: 'Ошибка сети', type: 'network', timeout: 5000 },
      'E004': { message: 'Неверные данные карты', type: 'bank', timeout: 5000 },
      'E005': { message: 'Карта просрочена', type: 'bank', timeout: 5000 },
      'E006': { message: 'Транзакция отклонена', type: 'bank', timeout: 5000 },
      'E007': { message: 'Ошибка подтверждения платежа', type: 'bank', timeout: 5000 },
      
      // System Errors (Requirements 5.1)
      'SYS001': { message: 'Потеря соединения с сервером', type: 'system', timeout: 5000 },
      'SYS002': { message: 'Ошибка базы данных', type: 'system', timeout: 5000 },
      'SYS003': { message: 'Внутренняя ошибка сервера', type: 'system', timeout: 5000 },
      
      // Timeout Errors (Requirements 5.3)
      'TIMEOUT001': { message: 'Время ожидания истекло', type: 'timeout', timeout: 5000 },
      'TIMEOUT002': { message: 'Таймаут банковского API', type: 'timeout', timeout: 5000 },
      
      // Default error
      'E000': { message: 'Неизвестная ошибка', type: 'system', timeout: 5000 }
    };
  }

  /**
   * Main error handling method
   * @param {Error|Object} error - Error object or error data
   * @param {Object} context - Additional context information
   * @returns {Object} Processed error information
   */
  handleError(error, context = {}) {
    // Classify the error
    const errorInfo = this.classifyError(error, context);
    
    // Log the error
    this.logError(errorInfo, context);
    
    // Return processed error for display
    return this.formatErrorForDisplay(errorInfo);
  }

  /**
   * Classify error type and extract relevant information
   * @param {Error|Object} error - Error to classify
   * @param {Object} context - Additional context
   * @returns {Object} Classified error information
   */
  classifyError(error, context = {}) {
    let errorCode = 'E000';
    let errorMessage = 'Неизвестная ошибка';
    let errorType = this.errorTypes.SYSTEM_ERROR;
    let originalError = error;

    // Handle different error input formats
    if (typeof error === 'string') {
      errorCode = error;
    } else if (error && typeof error === 'object') {
      if (error.code) {
        errorCode = error.code;
      } else if (error.errorCode) {
        errorCode = error.errorCode;
      } else if (error.message) {
        // Try to extract error code from message
        const codeMatch = error.message.match(/([A-Z]+\d+)/);
        if (codeMatch) {
          errorCode = codeMatch[1];
        }
      }
      
      if (error.message) {
        errorMessage = error.message;
      }
    }

    // Get error details from our error codes mapping
    const errorDetails = this.errorCodes[errorCode] || this.errorCodes['E000'];
    
    return {
      code: errorCode,
      message: errorDetails.message || errorMessage,
      type: errorDetails.type || errorType,
      timeout: errorDetails.timeout || 5000,
      timestamp: new Date().toISOString(),
      context: context,
      originalError: originalError
    };
  }

  /**
   * Log error information
   * @param {Object} errorInfo - Processed error information
   * @param {Object} context - Additional context
   */
  logError(errorInfo, context = {}) {
    const logEntry = {
      timestamp: errorInfo.timestamp,
      level: 'ERROR',
      code: errorInfo.code,
      message: errorInfo.message,
      type: errorInfo.type,
      context: context,
      stack: errorInfo.originalError?.stack
    };

    // Console logging
    if (this.enableConsoleLogging) {
      console.error(`[${errorInfo.timestamp}] ERROR ${errorInfo.code}: ${errorInfo.message}`, {
        type: errorInfo.type,
        context: context,
        stack: errorInfo.originalError?.stack
      });
    }

    // File logging (if enabled)
    if (this.enableFileLogging) {
      this.writeToLogFile(logEntry);
    }
  }

  /**
   * Write log entry to file (placeholder implementation)
   * @param {Object} logEntry - Log entry to write
   */
  writeToLogFile(logEntry) {
    // In a real implementation, this would write to a file
    // For now, we'll just use console as a fallback
    console.log('LOG FILE:', JSON.stringify(logEntry, null, 2));
  }

  /**
   * Format error for display to user
   * @param {Object} errorInfo - Processed error information
   * @returns {Object} Display-ready error information
   */
  formatErrorForDisplay(errorInfo) {
    return {
      code: errorInfo.code,
      message: errorInfo.message,
      type: errorInfo.type,
      timeout: errorInfo.timeout,
      showRetry: this.shouldShowRetry(errorInfo.type),
      timestamp: errorInfo.timestamp
    };
  }

  /**
   * Determine if retry option should be shown for error type
   * @param {string} errorType - Type of error
   * @returns {boolean} Whether to show retry option
   */
  shouldShowRetry(errorType) {
    // Show retry for most errors except system errors (Requirements 5.2)
    const noRetryTypes = ['system'];
    return !noRetryTypes.includes(errorType);
  }

  /**
   * Handle timeout errors specifically (Requirements 5.3)
   * @param {Object} context - Context information
   * @returns {Object} Timeout error information
   */
  handleTimeout(context = {}) {
    const timeoutError = {
      code: 'TIMEOUT001',
      message: 'Время ожидания истекло',
      type: 'timeout'
    };

    return this.handleError(timeoutError, {
      ...context,
      errorType: 'timeout'
    });
  }

  /**
   * Handle NFC-specific errors
   * @param {Error} error - NFC error
   * @param {Object} context - Context information
   * @returns {Object} Processed NFC error
   */
  handleNFCError(error, context = {}) {
    let nfcErrorCode = 'NFC001';
    
    if (error.message?.includes('not supported')) {
      nfcErrorCode = 'NFC001';
    } else if (error.message?.includes('read')) {
      nfcErrorCode = 'NFC002';
    } else if (error.message?.includes('timeout')) {
      nfcErrorCode = 'NFC003';
    }

    return this.handleError({
      code: nfcErrorCode,
      message: error.message
    }, {
      ...context,
      errorType: 'nfc'
    });
  }

  /**
   * Handle QR-specific errors
   * @param {Error} error - QR error
   * @param {Object} context - Context information
   * @returns {Object} Processed QR error
   */
  handleQRError(error, context = {}) {
    let qrErrorCode = 'QR001';
    
    if (error.message?.includes('network') || error.message?.includes('fetch')) {
      qrErrorCode = 'QR002';
    } else if (error.message?.includes('timeout') || error.message?.includes('expired')) {
      qrErrorCode = 'QR004';
    } else if (error.message?.includes('payment')) {
      qrErrorCode = 'QR003';
    }

    return this.handleError({
      code: qrErrorCode,
      message: error.message
    }, {
      ...context,
      errorType: 'qr'
    });
  }

  /**
   * Handle bank API errors
   * @param {Object} bankResponse - Bank API response with error
   * @param {Object} context - Context information
   * @returns {Object} Processed bank error
   */
  handleBankError(bankResponse, context = {}) {
    const errorCode = bankResponse.errorCode || 'E000';
    
    return this.handleError({
      code: errorCode,
      message: bankResponse.errorMessage || bankResponse.message
    }, {
      ...context,
      errorType: 'bank',
      bankTransactionId: bankResponse.transactionId
    });
  }

  /**
   * Get error timeout for auto-return to waiting screen (Requirements 5.4)
   * @param {string} errorCode - Error code
   * @returns {number} Timeout in milliseconds
   */
  getErrorTimeout(errorCode) {
    const errorDetails = this.errorCodes[errorCode] || this.errorCodes['E000'];
    return errorDetails.timeout;
  }

  /**
   * Check if error is retryable (Requirements 5.2)
   * @param {string} errorCode - Error code
   * @returns {boolean} Whether error is retryable
   */
  isRetryable(errorCode) {
    const errorDetails = this.errorCodes[errorCode] || this.errorCodes['E000'];
    return this.shouldShowRetry(errorDetails.type);
  }

  /**
   * Get all error codes for testing purposes
   * @returns {Object} All error codes and their details
   */
  getAllErrorCodes() {
    return { ...this.errorCodes };
  }

  /**
   * Add custom error code
   * @param {string} code - Error code
   * @param {Object} details - Error details
   */
  addErrorCode(code, details) {
    this.errorCodes[code] = {
      message: details.message || 'Неизвестная ошибка',
      type: details.type || 'system',
      timeout: details.timeout || 5000
    };
  }
}

export default ErrorHandler;