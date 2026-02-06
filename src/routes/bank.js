import express from 'express';
import TestBankAPI from '../services/TestBankAPI.js';

const router = express.Router();
const bankAPI = new TestBankAPI();

// POST /api/bank/authorize - Authorize a payment
router.post('/authorize', async (req, res) => {
  try {
    const { amount, currency, terminalId, paymentId, cardData } = req.body;

    // Validate required fields
    if (!amount || !currency || !terminalId || !paymentId) {
      return res.status(400).json({ 
        error: 'Missing required fields: amount, currency, terminalId, paymentId' 
      });
    }

    // Validate amount is positive
    if (amount <= 0) {
      return res.status(400).json({ 
        error: 'Amount must be positive' 
      });
    }

    // Validate currency
    if (currency !== 'RUB') {
      return res.status(400).json({ 
        error: 'Only RUB currency is supported' 
      });
    }

    const paymentData = {
      amount,
      currency,
      terminalId,
      paymentId,
      cardData: cardData || {}
    };

    const result = await bankAPI.authorizePayment(paymentData);
    
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(402).json(result); // 402 Payment Required for declined transactions
    }
  } catch (error) {
    console.error('Bank authorization error:', error);
    res.status(500).json({ 
      error: 'Internal bank error',
      message: 'Authorization service temporarily unavailable'
    });
  }
});

// POST /api/bank/capture - Capture an authorized payment
router.post('/capture', async (req, res) => {
  try {
    const { transactionId, amount } = req.body;

    if (!transactionId) {
      return res.status(400).json({ 
        error: 'Transaction ID is required' 
      });
    }

    if (amount !== undefined && amount <= 0) {
      return res.status(400).json({ 
        error: 'Amount must be positive if specified' 
      });
    }

    const result = await bankAPI.capturePayment(transactionId, amount);
    
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Bank capture error:', error);
    res.status(500).json({ 
      error: 'Internal bank error',
      message: 'Capture service temporarily unavailable'
    });
  }
});

// POST /api/bank/void - Void an authorized payment
router.post('/void', async (req, res) => {
  try {
    const { transactionId } = req.body;

    if (!transactionId) {
      return res.status(400).json({ 
        error: 'Transaction ID is required' 
      });
    }

    const result = await bankAPI.voidPayment(transactionId);
    res.status(200).json(result);
  } catch (error) {
    console.error('Bank void error:', error);
    res.status(500).json({ 
      error: 'Internal bank error',
      message: 'Void service temporarily unavailable'
    });
  }
});

// GET /api/bank/transaction/:id - Get transaction status
router.get('/transaction/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ 
        error: 'Transaction ID is required' 
      });
    }

    const result = await bankAPI.getTransactionStatus(id);
    res.status(200).json(result);
  } catch (error) {
    console.error('Bank status check error:', error);
    res.status(500).json({ 
      error: 'Internal bank error',
      message: 'Status service temporarily unavailable'
    });
  }
});

// POST /api/bank/config - Configure bank simulator (for testing)
router.post('/config', (req, res) => {
  try {
    const { successRate, responseDelay } = req.body;

    if (successRate !== undefined) {
      if (successRate < 0 || successRate > 1) {
        return res.status(400).json({ 
          error: 'Success rate must be between 0 and 1' 
        });
      }
      bankAPI.setSuccessRate(successRate);
    }

    if (responseDelay !== undefined) {
      if (responseDelay < 0) {
        return res.status(400).json({ 
          error: 'Response delay must be non-negative' 
        });
      }
      bankAPI.setResponseDelay(responseDelay);
    }

    res.status(200).json({ 
      message: 'Bank simulator configuration updated',
      successRate: bankAPI.successRate,
      responseDelay: bankAPI.responseDelay
    });
  } catch (error) {
    console.error('Bank config error:', error);
    res.status(500).json({ 
      error: 'Failed to update configuration' 
    });
  }
});

export default router;