import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class Database {
  constructor(dbPath = path.join(__dirname, '../../data/payment_terminal.db')) {
    this.dbPath = dbPath;
    this.db = null;
  }

  async initialize() {
    return new Promise((resolve, reject) => {
      // Ensure data directory exists
      const dataDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log('Connected to SQLite database');
          this.createTables().then(resolve).catch(reject);
        }
      });
    });
  }

  async createTables() {
    const tables = [
      // Terminals table
      `CREATE TABLE IF NOT EXISTS terminals (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        operator TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        location TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Payments table
      `CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        terminal_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        currency TEXT DEFAULT 'RUB',
        method TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        bank_transaction_id TEXT,
        error_code TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        FOREIGN KEY (terminal_id) REFERENCES terminals (id)
      )`,

      // QR Codes table
      `CREATE TABLE IF NOT EXISTS qr_codes (
        id TEXT PRIMARY KEY,
        payment_id TEXT NOT NULL,
        data TEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        used_at DATETIME,
        FOREIGN KEY (payment_id) REFERENCES payments (id)
      )`,

      // Payment Systems table
      `CREATE TABLE IF NOT EXISTS payment_systems (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        logo_url TEXT,
        is_active INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    for (const sql of tables) {
      await this.run(sql);
    }

    // Create indexes for better performance
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_payments_terminal_id ON payments(terminal_id)',
      'CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)',
      'CREATE INDEX IF NOT EXISTS idx_qr_codes_payment_id ON qr_codes(payment_id)',
      'CREATE INDEX IF NOT EXISTS idx_qr_codes_expires_at ON qr_codes(expires_at)',
      'CREATE INDEX IF NOT EXISTS idx_payment_systems_active ON payment_systems(is_active)',
      'CREATE INDEX IF NOT EXISTS idx_payment_systems_sort ON payment_systems(sort_order)'
    ];

    for (const sql of indexes) {
      await this.run(sql);
    }

    // Run migrations
    await this.runMigrations();

    // Insert default payment systems
    await this.insertDefaultPaymentSystems();

    console.log('Database tables created successfully');
  }

  async runMigrations() {
    // Migration 1: Add used_at column to qr_codes table
    try {
      await this.run('ALTER TABLE qr_codes ADD COLUMN used_at DATETIME');
      console.log('Migration: Added used_at column to qr_codes table');
    } catch (error) {
      // Column might already exist, ignore error
      if (!error.message.includes('duplicate column name')) {
        console.error('Migration error:', error.message);
      }
    }

    // Migration 2: Add password column to terminals table
    try {
      await this.run('ALTER TABLE terminals ADD COLUMN password TEXT');
      console.log('Migration: Added password column to terminals table');
    } catch (error) {
      // Column might already exist, ignore error
      if (!error.message.includes('duplicate column name')) {
        console.error('Migration error:', error.message);
      }
    }

    // Migration 3: Add is_locked column to terminals table
    try {
      await this.run('ALTER TABLE terminals ADD COLUMN is_locked INTEGER DEFAULT 0');
      console.log('Migration: Added is_locked column to terminals table');
    } catch (error) {
      // Column might already exist, ignore error
      if (!error.message.includes('duplicate column name')) {
        console.error('Migration error:', error.message);
      }
    }
  }

  async insertDefaultPaymentSystems() {
    try {
      // Check if payment systems already exist
      const existing = await this.get('SELECT COUNT(*) as count FROM payment_systems');
      if (existing.count > 0) {
        return; // Already have payment systems
      }

      // Insert default payment systems
      const defaultSystems = [
        {
          id: 'ovlpay',
          name: 'ovlpay',
          display_name: 'OVLPay',
          logo_url: '/images/payment-systems/ovlpay.svg',
          sort_order: 1
        },
        {
          id: 'visa',
          name: 'visa',
          display_name: 'Visa',
          logo_url: '/images/payment-systems/visa.svg',
          sort_order: 2
        },
        {
          id: 'mastercard',
          name: 'mastercard',
          display_name: 'Mastercard',
          logo_url: '/images/payment-systems/mastercard.svg',
          sort_order: 3
        },
        {
          id: 'mir',
          name: 'mir',
          display_name: 'МИР',
          logo_url: '/images/payment-systems/mir.svg',
          sort_order: 4
        }
      ];

      for (const system of defaultSystems) {
        await this.run(
          'INSERT INTO payment_systems (id, name, display_name, logo_url, sort_order) VALUES (?, ?, ?, ?, ?)',
          [system.id, system.name, system.display_name, system.logo_url, system.sort_order]
        );
      }

      console.log('Default payment systems inserted');
    } catch (error) {
      console.error('Error inserting default payment systems:', error);
    }
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            reject(err);
          } else {
            console.log('Database connection closed');
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}

export default Database;