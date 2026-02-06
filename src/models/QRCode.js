import { v4 as uuidv4 } from 'uuid';

class QRCode {
  constructor(data = {}) {
    this.id = data.id || uuidv4();
    this.paymentId = data.payment_id || data.paymentId || '';
    this.data = data.data || '';
    this.expiresAt = data.expires_at || data.expiresAt || null;
    this.createdAt = data.created_at || data.createdAt || new Date();
  }

  static async create(db, qrCodeData) {
    const qrCode = new QRCode(qrCodeData);
    
    const sql = `
      INSERT INTO qr_codes (id, payment_id, data, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `;
    
    const params = [
      qrCode.id,
      qrCode.paymentId,
      qrCode.data,
      qrCode.expiresAt ? qrCode.expiresAt.toISOString() : null,
      qrCode.createdAt.toISOString()
    ];

    await db.run(sql, params);
    return qrCode;
  }

  static async findById(db, id) {
    const sql = 'SELECT * FROM qr_codes WHERE id = ?';
    const row = await db.get(sql, [id]);
    
    if (!row) {
      return null;
    }
    
    return new QRCode(row);
  }

  static async findByPaymentId(db, paymentId) {
    const sql = 'SELECT * FROM qr_codes WHERE payment_id = ? ORDER BY created_at DESC';
    const rows = await db.all(sql, [paymentId]);
    
    return rows.map(row => new QRCode(row));
  }

  static async findAll(db) {
    const sql = 'SELECT * FROM qr_codes ORDER BY created_at DESC';
    const rows = await db.all(sql);
    
    return rows.map(row => new QRCode(row));
  }

  static async findActive(db) {
    const sql = 'SELECT * FROM qr_codes WHERE expires_at > datetime("now") ORDER BY created_at DESC';
    const rows = await db.all(sql);
    
    return rows.map(row => new QRCode(row));
  }

  static async cleanupExpired(db) {
    const sql = 'DELETE FROM qr_codes WHERE expires_at <= datetime("now")';
    const result = await db.run(sql);
    return result.changes;
  }

  async update(db, updateData) {
    // Update instance properties
    Object.keys(updateData).forEach(key => {
      if (key !== 'id' && key !== 'createdAt' && key !== 'created_at') {
        if (key === 'payment_id') {
          this.paymentId = updateData[key];
        } else if (key === 'expires_at') {
          this.expiresAt = updateData[key] ? new Date(updateData[key]) : null;
        } else {
          this[key] = updateData[key];
        }
      }
    });

    const sql = `
      UPDATE qr_codes 
      SET payment_id = ?, data = ?, expires_at = ?
      WHERE id = ?
    `;
    
    const params = [
      this.paymentId,
      this.data,
      this.expiresAt ? this.expiresAt.toISOString() : null,
      this.id
    ];

    const result = await db.run(sql, params);
    return result.changes > 0;
  }

  async delete(db) {
    const sql = 'DELETE FROM qr_codes WHERE id = ?';
    const result = await db.run(sql, [this.id]);
    return result.changes > 0;
  }

  isExpired() {
    if (!this.expiresAt) {
      return false;
    }
    return new Date() > new Date(this.expiresAt);
  }

  toJSON() {
    return {
      id: this.id,
      paymentId: this.paymentId,
      data: this.data,
      expiresAt: this.expiresAt,
      createdAt: this.createdAt,
      isExpired: this.isExpired()
    };
  }
}

export default QRCode;