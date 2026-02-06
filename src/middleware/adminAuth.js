/**
 * Admin Authentication Middleware for Payment Terminal System
 * 
 * Provides secure admin authentication for the terminal system itself
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

// Admin credentials (in production, store in environment variables or database)
const ADMIN_CREDENTIALS = {
  username: process.env.ADMIN_USERNAME || 'admin',
  password: process.env.ADMIN_PASSWORD || 'admin123', // Should be hashed in production
  email: process.env.ADMIN_EMAIL || 'admin@terminal-system.local'
};

const JWT_SECRET = process.env.JWT_SECRET || 'terminal-system-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

// In-memory session storage (in production, use Redis or database)
const activeSessions = new Map();

/**
 * Middleware to verify admin JWT token
 */
export const verifyAdminToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      error: 'Admin access token required',
      code: 'NO_TOKEN'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, admin) => {
    if (err) {
      return res.status(403).json({ 
        success: false, 
        error: 'Invalid or expired admin token',
        code: 'INVALID_TOKEN'
      });
    }

    // Check if session is still active
    if (!activeSessions.has(admin.sessionId)) {
      return res.status(403).json({
        success: false,
        error: 'Session expired or invalid',
        code: 'SESSION_EXPIRED'
      });
    }

    req.admin = admin;
    next();
  });
};

/**
 * Admin authentication functions
 */
export class AdminAuth {
  /**
   * Authenticate admin user
   */
  static async authenticate(username, password) {
    try {
      // Validate credentials
      if (username !== ADMIN_CREDENTIALS.username) {
        return {
          success: false,
          error: 'Invalid username',
          code: 'INVALID_USERNAME'
        };
      }

      // In production, use bcrypt.compare for hashed passwords
      if (password !== ADMIN_CREDENTIALS.password) {
        return {
          success: false,
          error: 'Invalid password',
          code: 'INVALID_PASSWORD'
        };
      }

      // Generate session ID
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Create JWT token
      const tokenPayload = {
        username: username,
        email: ADMIN_CREDENTIALS.email,
        role: 'admin',
        sessionId: sessionId,
        loginTime: new Date().toISOString()
      };

      const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

      // Store session
      activeSessions.set(sessionId, {
        username: username,
        loginTime: new Date(),
        lastActivity: new Date(),
        ipAddress: null, // Will be set by the route handler
        userAgent: null  // Will be set by the route handler
      });

      return {
        success: true,
        token: token,
        expiresIn: JWT_EXPIRES_IN,
        admin: {
          username: username,
          email: ADMIN_CREDENTIALS.email,
          role: 'admin',
          sessionId: sessionId
        }
      };

    } catch (error) {
      console.error('Admin authentication error:', error);
      return {
        success: false,
        error: 'Internal authentication error',
        code: 'AUTH_ERROR'
      };
    }
  }

  /**
   * Refresh admin token
   */
  static async refreshToken(currentToken) {
    try {
      const decoded = jwt.verify(currentToken, JWT_SECRET);
      
      // Check if session exists
      if (!activeSessions.has(decoded.sessionId)) {
        return {
          success: false,
          error: 'Session not found',
          code: 'SESSION_NOT_FOUND'
        };
      }

      // Update last activity
      const session = activeSessions.get(decoded.sessionId);
      session.lastActivity = new Date();
      activeSessions.set(decoded.sessionId, session);

      // Generate new token with same session ID
      const newTokenPayload = {
        ...decoded,
        refreshTime: new Date().toISOString()
      };

      const newToken = jwt.sign(newTokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

      return {
        success: true,
        token: newToken,
        expiresIn: JWT_EXPIRES_IN
      };

    } catch (error) {
      return {
        success: false,
        error: 'Invalid token for refresh',
        code: 'INVALID_REFRESH_TOKEN'
      };
    }
  }

  /**
   * Logout admin user
   */
  static async logout(sessionId) {
    try {
      if (activeSessions.has(sessionId)) {
        activeSessions.delete(sessionId);
        return {
          success: true,
          message: 'Logged out successfully'
        };
      }

      return {
        success: false,
        error: 'Session not found',
        code: 'SESSION_NOT_FOUND'
      };

    } catch (error) {
      return {
        success: false,
        error: 'Logout error',
        code: 'LOGOUT_ERROR'
      };
    }
  }

  /**
   * Get active sessions
   */
  static getActiveSessions() {
    const sessions = [];
    for (const [sessionId, session] of activeSessions.entries()) {
      sessions.push({
        sessionId: sessionId,
        username: session.username,
        loginTime: session.loginTime,
        lastActivity: session.lastActivity,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent
      });
    }
    return sessions;
  }

  /**
   * Clean expired sessions
   */
  static cleanExpiredSessions() {
    const now = new Date();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    for (const [sessionId, session] of activeSessions.entries()) {
      if (now - session.lastActivity > maxAge) {
        activeSessions.delete(sessionId);
        console.log(`Cleaned expired session: ${sessionId}`);
      }
    }
  }

  /**
   * Update session activity
   */
  static updateSessionActivity(sessionId, ipAddress, userAgent) {
    if (activeSessions.has(sessionId)) {
      const session = activeSessions.get(sessionId);
      session.lastActivity = new Date();
      if (ipAddress) session.ipAddress = ipAddress;
      if (userAgent) session.userAgent = userAgent;
      activeSessions.set(sessionId, session);
    }
  }

  /**
   * Get admin dashboard stats
   */
  static async getDashboardStats(db) {
    try {
      // Get terminal statistics
      const totalTerminals = await db.get('SELECT COUNT(*) as count FROM terminals');
      const activeTerminals = await db.get('SELECT COUNT(*) as count FROM terminals WHERE status = "active"');
      const lockedTerminals = await db.get('SELECT COUNT(*) as count FROM terminals WHERE is_locked = 1');

      // Get payment statistics
      const totalPayments = await db.get('SELECT COUNT(*) as count FROM payments');
      const todayPayments = await db.get(`
        SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total_amount 
        FROM payments 
        WHERE DATE(created_at) = DATE('now')
      `);
      const completedPayments = await db.get('SELECT COUNT(*) as count FROM payments WHERE status = "completed"');

      // Get recent activity
      const recentPayments = await db.all(`
        SELECT p.*, t.name as terminal_name 
        FROM payments p 
        LEFT JOIN terminals t ON p.terminal_id = t.id 
        ORDER BY p.created_at DESC 
        LIMIT 10
      `);

      return {
        success: true,
        stats: {
          terminals: {
            total: totalTerminals.count,
            active: activeTerminals.count,
            locked: lockedTerminals.count,
            inactive: totalTerminals.count - activeTerminals.count
          },
          payments: {
            total: totalPayments.count,
            today: todayPayments.count,
            todayAmount: todayPayments.total_amount || 0,
            completed: completedPayments.count,
            successRate: totalPayments.count > 0 ? 
              Math.round((completedPayments.count / totalPayments.count) * 100) : 0
          },
          sessions: {
            active: activeSessions.size,
            list: this.getActiveSessions()
          },
          recentActivity: recentPayments
        }
      };

    } catch (error) {
      console.error('Dashboard stats error:', error);
      return {
        success: false,
        error: 'Failed to get dashboard statistics',
        code: 'STATS_ERROR'
      };
    }
  }
}

// Clean expired sessions every hour
setInterval(() => {
  AdminAuth.cleanExpiredSessions();
}, 60 * 60 * 1000);

export default AdminAuth;