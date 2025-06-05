// swagger/schemas.js - Your existing schemas
module.exports = {
  User: {
    type: 'object',
    properties: {
      _id: {
        type: 'string',
        example: '60f7c6b4c8f1a2b3c4d5e6f7'
      },
      name: {
        type: 'string',
        example: 'John Doe'
      },
      email: {
        type: 'string',
        format: 'email',
        example: 'john@example.com'
      },
      phoneNumber: {
        type: 'string',
        example: '+2341234567890'
      },
      userName: {
        type: 'string',
        example: 'johndoe'
      },
      isAdmin: {
        type: 'boolean',
        example: false
      },
      isBanned: {
        type: 'boolean',
        example: false
      },
      referralInfo: {
        type: 'object',
        properties: {
          referralCode: {
            type: 'string',
            example: 'REF123456'
          },
          referredBy: {
            type: 'string',
            example: '60f7c6b4c8f1a2b3c4d5e6f8'
          }
        }
      },
      createdAt: {
        type: 'string',
        format: 'date-time',
        example: '2023-01-01T00:00:00.000Z'
      },
      updatedAt: {
        type: 'string',
        format: 'date-time',
        example: '2023-01-01T00:00:00.000Z'
      }
    }
  },

  UserShare: {
    type: 'object',
    properties: {
      _id: {
        type: 'string',
        example: '60f7c6b4c8f1a2b3c4d5e6f7'
      },
      user: {
        type: 'string',
        example: '60f7c6b4c8f1a2b3c4d5e6f7'
      },
      totalShares: {
        type: 'number',
        example: 100
      },
      totalInvestment: {
        type: 'number',
        example: 50000
      },
      transactions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            shares: {
              type: 'number',
              example: 50
            },
            amount: {
              type: 'number',
              example: 25000
            },
            status: {
              type: 'string',
              enum: ['pending', 'completed', 'failed'],
              example: 'completed'
            },
            transactionDate: {
              type: 'string',
              format: 'date-time',
              example: '2023-01-01T00:00:00.000Z'
            }
          }
        }
      }
    }
  },

  Payment: {
    type: 'object',
    properties: {
      _id: {
        type: 'string',
        example: '60f7c6b4c8f1a2b3c4d5e6f7'
      },
      user: {
        type: 'string',
        example: '60f7c6b4c8f1a2b3c4d5e6f7'
      },
      amount: {
        type: 'number',
        example: 25000
      },
      shares: {
        type: 'number',
        example: 50
      },
      status: {
        type: 'string',
        enum: ['pending', 'completed', 'failed'],
        example: 'pending'
      },
      paymentMethod: {
        type: 'string',
        example: 'bank_transfer'
      },
      reference: {
        type: 'string',
        example: 'PAY_123456789'
      },
      createdAt: {
        type: 'string',
        format: 'date-time',
        example: '2023-01-01T00:00:00.000Z'
      }
    }
  },

  Withdrawal: {
    type: 'object',
    properties: {
      _id: {
        type: 'string',
        example: '60f7c6b4c8f1a2b3c4d5e6f7'
      },
      user: {
        type: 'string',
        example: '60f7c6b4c8f1a2b3c4d5e6f7'
      },
      amount: {
        type: 'number',
        example: 10000
      },
      bankDetails: {
        type: 'object',
        properties: {
          accountName: {
            type: 'string',
            example: 'John Doe'
          },
          accountNumber: {
            type: 'string',
            example: '1234567890'
          },
          bankCode: {
            type: 'string',
            example: '044'
          }
        }
      },
      status: {
        type: 'string',
        enum: ['pending', 'processing', 'completed', 'failed'],
        example: 'pending'
      },
      clientReference: {
        type: 'string',
        example: 'WTH_123456789'
      },
      createdAt: {
        type: 'string',
        format: 'date-time',
        example: '2023-01-01T00:00:00.000Z'
      }
    }
  },

  Referral: {
    type: 'object',
    properties: {
      _id: {
        type: 'string',
        example: '60f7c6b4c8f1a2b3c4d5e6f7'
      },
      user: {
        type: 'string',
        example: '60f7c6b4c8f1a2b3c4d5e6f7'
      },
      totalEarnings: {
        type: 'number',
        example: 5000
      },
      totalReferrals: {
        type: 'number',
        example: 10
      },
      activeReferrals: {
        type: 'number',
        example: 8
      }
    }
  },

  Installment: {
    type: 'object',
    properties: {
      _id: {
        type: 'string',
        example: '60f7c6b4c8f1a2b3c4d5e6f7'
      },
      user: {
        type: 'string',
        example: '60f7c6b4c8f1a2b3c4d5e6f7'
      },
      totalAmount: {
        type: 'number',
        example: 100000
      },
      monthlyPayment: {
        type: 'number',
        example: 10000
      },
      remainingBalance: {
        type: 'number',
        example: 50000
      },
      status: {
        type: 'string',
        enum: ['active', 'completed', 'defaulted'],
        example: 'active'
      },
      nextDueDate: {
        type: 'string',
        format: 'date',
        example: '2023-02-01'
      }
    }
  },

  Success: {
    type: 'object',
    properties: {
      success: {
        type: 'boolean',
        example: true
      },
      message: {
        type: 'string',
        example: 'Operation completed successfully'
      }
    }
  },

  Error: {
    type: 'object',
    properties: {
      success: {
        type: 'boolean',
        example: false
      },
      message: {
        type: 'string',
        example: 'An error occurred'
      },
      error: {
        type: 'string',
        example: 'Detailed error message'
      }
    }
  },

  PaginationMeta: {
    type: 'object',
    properties: {
      currentPage: {
        type: 'integer',
        example: 1
      },
      totalPages: {
        type: 'integer',
        example: 5
      },
      totalItems: {
        type: 'integer',
        example: 50
      },
      hasNext: {
        type: 'boolean',
        example: true
      },
      hasPrev: {
        type: 'boolean',
        example: false
      },
      limit: {
        type: 'integer',
        example: 10
      }
    }
  }
};