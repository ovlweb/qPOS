import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

class QRGenerator {
  constructor(options = {}) {
    this.defaultExpirationMinutes = options.expirationMinutes || 15;
    this.secretKey = options.secretKey || 'default-secret-key';
  }

  /**
   * Generate a unique QR code for a payment
   * @param {Object} paymentData - Payment information
   * @param {string} paymentData.terminalId - Terminal identifier
   * @param {number} paymentData.amount - Payment amount in kopecks
   * @param {string} paymentData.currency - Currency code (default: RUB)
   * @param {number} expirationMinutes - QR code expiration time in minutes
   * @returns {Promise<Object>} QR code data with image and metadata
   */
  async generatePaymentQR(paymentData, expirationMinutes = null) {
    const expirationTime = expirationMinutes || this.defaultExpirationMinutes;
    const expiresAt = new Date(Date.now() + expirationTime * 60 * 1000);
    
    // Create unique QR data payload
    const qrPayload = {
      id: uuidv4(),
      terminalId: paymentData.terminalId,
      amount: paymentData.amount,
      currency: paymentData.currency || 'RUB',
      timestamp: Date.now(),
      expiresAt: expiresAt.toISOString(),
      signature: this.generateSignature(paymentData, expiresAt)
    };

    // Generate QR code image as data URL
    const qrCodeImage = await QRCode.toDataURL(JSON.stringify(qrPayload), {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      quality: 0.92,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      },
      width: 256
    });

    return {
      id: qrPayload.id,
      data: JSON.stringify(qrPayload),
      image: qrCodeImage,
      expiresAt: expiresAt,
      paymentData: {
        terminalId: paymentData.terminalId,
        amount: paymentData.amount,
        currency: paymentData.currency || 'RUB'
      }
    };
  }

  /**
   * Generate a cryptographic signature for QR code data
   * @param {Object} paymentData - Payment data
   * @param {Date} expiresAt - Expiration timestamp
   * @returns {string} HMAC signature
   */
  generateSignature(paymentData, expiresAt) {
    const dataToSign = `${paymentData.terminalId}:${paymentData.amount}:${paymentData.currency || 'RUB'}:${expiresAt.toISOString()}`;
    return crypto
      .createHmac('sha256', this.secretKey)
      .update(dataToSign)
      .digest('hex');
  }

  /**
   * Verify QR code signature and expiration
   * @param {Object} qrData - Parsed QR code data
   * @returns {Object} Validation result
   */
  validateQRCode(qrData) {
    try {
      const parsedData = typeof qrData === 'string' ? JSON.parse(qrData) : qrData;
      
      // Check expiration
      const now = new Date();
      const expiresAt = new Date(parsedData.expiresAt);
      
      if (now > expiresAt) {
        return {
          valid: false,
          error: 'QR_EXPIRED',
          message: 'QR code has expired'
        };
      }

      // Verify signature
      const expectedSignature = this.generateSignature(
        {
          terminalId: parsedData.terminalId,
          amount: parsedData.amount,
          currency: parsedData.currency
        },
        expiresAt
      );

      if (parsedData.signature !== expectedSignature) {
        return {
          valid: false,
          error: 'INVALID_SIGNATURE',
          message: 'QR code signature is invalid'
        };
      }

      return {
        valid: true,
        data: parsedData
      };
    } catch (error) {
      return {
        valid: false,
        error: 'INVALID_FORMAT',
        message: 'QR code format is invalid'
      };
    }
  }

  /**
   * Generate multiple unique QR codes for batch processing
   * @param {Array<Object>} paymentsData - Array of payment data objects
   * @param {number} expirationMinutes - QR code expiration time in minutes
   * @returns {Promise<Array<Object>>} Array of QR code data
   */
  async generateBatchQRCodes(paymentsData, expirationMinutes = null) {
    const qrCodes = [];
    
    for (const paymentData of paymentsData) {
      const qrCode = await this.generatePaymentQR(paymentData, expirationMinutes);
      qrCodes.push(qrCode);
    }

    return qrCodes;
  }

  /**
   * Check if a QR code is expired
   * @param {Object} qrData - QR code data
   * @returns {boolean} True if expired
   */
  isExpired(qrData) {
    try {
      if (!qrData || typeof qrData !== 'string') {
        return true; // Consider invalid data as expired
      }
      
      const parsedData = JSON.parse(qrData);
      
      // If no expiresAt field, consider it expired
      if (!parsedData.expiresAt) {
        return true;
      }
      
      const now = new Date();
      const expiresAt = new Date(parsedData.expiresAt);
      return now > expiresAt;
    } catch (error) {
      return true; // Consider invalid data as expired
    }
  }

  /**
   * Extract payment information from QR code data
   * @param {string} qrData - QR code data string
   * @returns {Object|null} Payment information or null if invalid
   */
  extractPaymentInfo(qrData) {
    try {
      if (!qrData || typeof qrData !== 'string') {
        return null;
      }
      
      const parsedData = JSON.parse(qrData);
      
      // Validate that required fields exist
      if (!parsedData.id || !parsedData.terminalId || 
          parsedData.amount === undefined || !parsedData.currency ||
          !parsedData.timestamp || !parsedData.expiresAt) {
        return null;
      }
      
      return {
        id: parsedData.id,
        terminalId: parsedData.terminalId,
        amount: parsedData.amount,
        currency: parsedData.currency,
        timestamp: parsedData.timestamp,
        expiresAt: parsedData.expiresAt
      };
    } catch (error) {
      return null;
    }
  }
}

export default QRGenerator;