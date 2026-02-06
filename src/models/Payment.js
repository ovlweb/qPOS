import { v4 as uuidv4 } from 'uuid';

class Payment {
  constructor(data = {}) {
    this.id = data.id || uuidv4();
    this.terminalId = data.terminal_id || data.terminalId || '';
    this.amount = data.amount || 0;
    this.currency = data.currency || 'RUB';
    this.method = data.method || '';
    this.status = data.status || 'pending';
    this.bankTransactionId = data.bank_transaction_id || data.bankTransactionId || null;
    this.errorCode = data.error_code || data.errorCode || null;
    this.createdAt = data.created_at || data.createdAt || new Date();
    this.completedAt = data.completed_at || data.completedAt || null;
  }

  static async create(db, paymentData) {
    const payment = new Payment(paymentData);
    
    const sql = `
      INSERT INTO payments (id, terminal_id, amount, currency, method, status, bank_transaction_id, error_code, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const params = [
      payment.id,
      payment.terminalId,
      payment.amount,
      payment.currency,
      payment.method,
      payment.status,
      payment.bankTransactionId,
      payment.errorCode,
      payment.createdAt.toISOString(),
      payment.completedAt ? payment.completedAt.toISOString() : null
    ];

    await db.run(sql, params);
    return payment;
  }

  static async findById(db, id) {
    const sql = 'SELECT * FROM payments WHERE id = ?';
    const row = await db.get(sql, [id]);
    
    if (!row) {
      return null;
    }
    
    return new Payment(row);
  }

  static async findByTerminalId(db, terminalId) {
    const sql = 'SELECT * FROM payments WHERE terminal_id = ? ORDER BY created_at DESC';
    const rows = await db.all(sql, [terminalId]);
    
    return rows.map(row => new Payment(row));
  }

  static async findAll(db) {
    const sql = 'SELECT * FROM payments ORDER BY created_at DESC';
    const rows = await db.all(sql);
    
    return rows.map(row => new Payment(row));
  }

  async update(db, updateData) {
    // Update instance properties
    Object.keys(updateData).forEach(key => {
      if (key !== 'id' && key !== 'createdAt' && key !== 'created_at') {
        if (key === 'terminal_id') {
          this.terminalId = updateData[key];
        } else if (key === 'bank_transaction_id') {
          this.bankTransactionId = updateData[key];
        } else if (key === 'error_code') {
          this.errorCode = updateData[key];
        } else if (key === 'completed_at') {
          this.completedAt = updateData[key] ? new Date(updateData[key]) : null;
        } else {
          this[key] = updateData[key];
        }
      }
    });

    const sql = `
      UPDATE payments 
      SET terminal_id = ?, amount = ?, currency = ?, method = ?, status = ?, 
          bank_transaction_id = ?, error_code = ?, completed_at = ?
      WHERE id = ?
    `;
    
    const params = [
      this.terminalId,
      this.amount,
      this.currency,
      this.method,
      this.status,
      this.bankTransactionId,
      this.errorCode,
      this.completedAt ? this.completedAt.toISOString() : null,
      this.id
    ];

    const result = await db.run(sql, params);
    return result.changes > 0;
  }

  async delete(db) {
    const sql = 'DELETE FROM payments WHERE id = ?';
    const result = await db.run(sql, [this.id]);
    return result.changes > 0;
  }

  // Log transaction for audit purposes (Requirements 3.4)
  static async logTransaction(db, paymentData, action = 'created') {
    const logEntry = {
      paymentId: paymentData.id || paymentData.paymentId,
      terminalId: paymentData.terminalId || paymentData.terminal_id,
      amount: paymentData.amount,
      method: paymentData.method,
      status: paymentData.status,
      action: action,
      timestamp: new Date().toISOString()
    };

    console.log('Transaction Log:', JSON.stringify(logEntry));
    
    // In a production system, this would write to a separate audit log table
    // For now, we'll use console logging as specified in requirements
    return logEntry;
  }

  toJSON() {
    return {
      id: this.id,
      terminalId: this.terminalId,
      amount: this.amount,
      currency: this.currency,
      method: this.method,
      status: this.status,
      bankTransactionId: this.bankTransactionId,
      errorCode: this.errorCode,
      createdAt: this.createdAt,
      completedAt: this.completedAt
    };
  }
}

export default Payment;