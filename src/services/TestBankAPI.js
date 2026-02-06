import { randomUUID } from 'crypto';

/**
 * Test Bank API Simulator
 * Simulates banking operations for payment processing
 * Provides configurable success/failure rates for testing
 */
class TestBankAPI {
  constructor(options = {}) {
    this.successRate = options.successRate || 0.9; // 90% success rate by default
    this.responseDelay = options.responseDelay || 500; // 500ms delay by default
    this.errorCodes = {
      INSUFFICIENT_FUNDS: 'E001',
      CARD_BLOCKED: 'E002',
      NETWORK_ERROR: 'E003',
      INVALID_CARD: 'E004',
      EXPIRED_CARD: 'E005',
      TRANSACTION_DECLINED: 'E006'
    };
  }

  /**
   * Simulate network delay
   */
  async delay(ms = this.responseDelay) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate a random error for failed transactions
   */
  generateRandomError() {
    const errorKeys = Object.keys(this.errorCodes);
    const randomKey = errorKeys[Math.floor(Math.random() * errorKeys.length)];
    return {
      code: this.errorCodes[randomKey],
      message: this.getErrorMessage(this.errorCodes[randomKey])
    };
  }

  /**
   * Get human-readable error message for error code
   */
  getErrorMessage(errorCode) {
    const messages = {
      'E001': 'Insufficient funds',
      'E002': 'Card is blocked',
      'E003': 'Network connection error',
      'E004': 'Invalid card data',
      'E005': 'Card has expired',
      'E006': 'Transaction declined by issuer'
    };
    return messages[errorCode] || 'Unknown error';
  }

  /**
   * Authorize a payment transaction
   * @param {Object} paymentData - Payment information
   * @param {string} paymentData.amount - Amount in kopecks
   * @param {string} paymentData.currency - Currency code (RUB)
   * @param {string} paymentData.terminalId - Terminal identifier
   * @param {string} paymentData.paymentId - Payment identifier
   * @param {Object} paymentData.cardData - Card information (for NFC/QR)
   * @returns {Promise<Object>} Authorization result
   */
  async authorizePayment(paymentData) {
    await this.delay();

    const isSuccess = Math.random() < this.successRate;
    const transactionId = randomUUID();
    const timestamp = new Date().toISOString();

    if (isSuccess) {
      return {
        success: true,
        transactionId,
        authCode: this.generateAuthCode(),
        amount: paymentData.amount,
        currency: paymentData.currency,
        timestamp,
        status: 'authorized'
      };
    } else {
      const error = this.generateRandomError();
      return {
        success: false,
        transactionId,
        errorCode: error.code,
        errorMessage: error.message,
        timestamp,
        status: 'declined'
      };
    }
  }

  /**
   * Capture (confirm) an authorized payment
   * @param {string} transactionId - Bank transaction ID from authorization
   * @param {number} amount - Amount to capture (optional, defaults to full amount)
   * @returns {Promise<Object>} Capture result
   */
  async capturePayment(transactionId, amount = null) {
    await this.delay(200); // Shorter delay for capture

    // Simulate very high success rate for capture (99%)
    const isSuccess = Math.random() < 0.99;
    const timestamp = new Date().toISOString();

    if (isSuccess) {
      return {
        success: true,
        transactionId,
        capturedAmount: amount,
        timestamp,
        status: 'captured'
      };
    } else {
      return {
        success: false,
        transactionId,
        errorCode: 'E007',
        errorMessage: 'Capture failed - authorization expired',
        timestamp,
        status: 'capture_failed'
      };
    }
  }

  /**
   * Void (cancel) an authorized payment
   * @param {string} transactionId - Bank transaction ID from authorization
   * @returns {Promise<Object>} Void result
   */
  async voidPayment(transactionId) {
    await this.delay(300);

    return {
      success: true,
      transactionId,
      timestamp: new Date().toISOString(),
      status: 'voided'
    };
  }

  /**
   * Generate a random authorization code
   */
  generateAuthCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  /**
   * Check transaction status
   * @param {string} transactionId - Bank transaction ID
   * @returns {Promise<Object>} Transaction status
   */
  async getTransactionStatus(transactionId) {
    await this.delay(100);

    // For simulation, we'll return a random status
    const statuses = ['authorized', 'captured', 'declined', 'voided'];
    const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];

    return {
      transactionId,
      status: randomStatus,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Set success rate for testing purposes
   * @param {number} rate - Success rate between 0 and 1
   */
  setSuccessRate(rate) {
    this.successRate = Math.max(0, Math.min(1, rate));
  }

  /**
   * Set response delay for testing purposes
   * @param {number} delay - Delay in milliseconds
   */
  setResponseDelay(delay) {
    this.responseDelay = Math.max(0, delay);
  }
}

export default TestBankAPI;