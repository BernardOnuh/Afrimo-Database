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
  },

    // Admin Leaderboard Schemas
  LeaderboardUser: {
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
      userName: {
        type: 'string',
        example: 'johndoe'
      },
      rank: {
        type: 'integer',
        example: 1
      },
      totalEarnings: {
        type: 'number',
        example: 218500,
        description: 'Total earnings (only visible if admin allows)'
      },
      availableBalance: {
        type: 'number',
        example: 197000,
        description: 'Available balance (only visible if admin allows)'
      },
      totalShares: {
        type: 'number',
        example: 150
      },
      totalReferrals: {
        type: 'number',
        example: 25
      },
      totalCofounders: {
        type: 'number',
        example: 5
      },
      location: {
        type: 'object',
        properties: {
          state: {
            type: 'string',
            example: 'Lagos'
          },
          city: {
            type: 'string',
            example: 'Ikeja'
          },
          country: {
            type: 'string',
            example: 'Nigeria'
          }
        }
      },
      isActive: {
        type: 'boolean',
        example: true
      },
      createdAt: {
        type: 'string',
        format: 'date-time',
        example: '2023-01-01T00:00:00.000Z'
      }
    }
  },

  LeaderboardResponse: {
    type: 'object',
    properties: {
      success: {
        type: 'boolean',
        example: true
      },
      data: {
        type: 'array',
        items: {
          $ref: '#/components/schemas/LeaderboardUser'
        }
      },
      pagination: {
        $ref: '#/components/schemas/PaginationMeta'
      },
      filters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['earners', 'shares', 'referrals', 'cofounders'],
            example: 'earners'
          },
          period: {
            type: 'string',
            enum: ['all_time', 'monthly', 'weekly', 'daily'],
            example: 'all_time'
          },
          state: {
            type: 'string',
            example: 'Lagos'
          },
          city: {
            type: 'string',
            example: 'Ikeja'
          },
          show_earnings: {
            type: 'boolean',
            example: true
          },
          show_balance: {
            type: 'boolean',
            example: true
          }
        }
      }
    }
  },

  LocationStats: {
    type: 'object',
    properties: {
      _id: {
        type: 'string',
        example: 'Lagos'
      },
      name: {
        type: 'string',
        example: 'Lagos'
      },
      totalUsers: {
        type: 'integer',
        example: 1250
      },
      totalEarnings: {
        type: 'number',
        example: 5500000
      },
      averageEarnings: {
        type: 'number',
        example: 4400
      },
      topEarner: {
        type: 'number',
        example: 218500
      },
      rank: {
        type: 'integer',
        example: 1
      }
    }
  },

  TopStatesResponse: {
    type: 'object',
    properties: {
      success: {
        type: 'boolean',
        example: true
      },
      data: {
        type: 'array',
        items: {
          $ref: '#/components/schemas/LocationStats'
        }
      }
    }
  },

  CityStats: {
    type: 'object',
    properties: {
      _id: {
        type: 'object',
        properties: {
          state: {
            type: 'string',
            example: 'Lagos'
          },
          city: {
            type: 'string',
            example: 'Ikeja'
          }
        }
      },
      totalUsers: {
        type: 'integer',
        example: 350
      },
      totalEarnings: {
        type: 'number',
        example: 1200000
      },
      averageEarnings: {
        type: 'number',
        example: 3428
      },
      rank: {
        type: 'integer',
        example: 1
      }
    }
  },

  TopCitiesResponse: {
    type: 'object',
    properties: {
      success: {
        type: 'boolean',
        example: true
      },
      data: {
        type: 'array',
        items: {
          $ref: '#/components/schemas/CityStats'
        }
      }
    }
  },

  UserVisibilityUpdate: {
    type: 'object',
    properties: {
      field: {
        type: 'string',
        enum: ['earnings', 'balance'],
        example: 'earnings'
      },
      visible: {
        type: 'boolean',
        example: true
      }
    },
    required: ['field', 'visible']
  },

  BulkUpdateRequest: {
    type: 'object',
    properties: {
      user_ids: {
        type: 'array',
        items: {
          type: 'string'
        },
        example: ['60f7c6b4c8f1a2b3c4d5e6f7', '60f7c6b4c8f1a2b3c4d5e6f8']
      },
      updates: {
        type: 'object',
        properties: {
          'earnings.visible': {
            type: 'boolean',
            example: false
          },
          'available_balance.visible': {
            type: 'boolean',
            example: true
          },
          'status.is_active': {
            type: 'boolean',
            example: true
          }
        }
      }
    },
    required: ['user_ids', 'updates']
  },

  BulkUpdateResponse: {
    type: 'object',
    properties: {
      success: {
        type: 'boolean',
        example: true
      },
      data: {
        type: 'object',
        properties: {
          matchedCount: {
            type: 'integer',
            example: 2
          },
          modifiedCount: {
            type: 'integer',
            example: 2
          },
          acknowledged: {
            type: 'boolean',
            example: true
          }
        }
      }
    }
  },

  LeaderboardFilters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['earners', 'shares', 'referrals', 'cofounders'],
        description: 'Type of leaderboard to display',
        example: 'earners'
      },
      period: {
        type: 'string',
        enum: ['all_time', 'monthly', 'weekly', 'daily'],
        description: 'Time period for the leaderboard',
        example: 'all_time'
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 1000,
        description: 'Number of users to return',
        example: 50
      },
      offset: {
        type: 'integer',
        minimum: 0,
        description: 'Number of users to skip for pagination',
        example: 0
      },
      state: {
        type: 'string',
        description: 'Filter by state',
        example: 'Lagos'
      },
      city: {
        type: 'string',
        description: 'Filter by city',
        example: 'Ikeja'
      },
      top_states: {
        type: 'boolean',
        description: 'Return top performing states',
        example: false
      },
      top_cities: {
        type: 'boolean',
        description: 'Return top performing cities',
        example: false
      },
      search: {
        type: 'string',
        description: 'Search by username or name',
        example: 'john'
      },
      show_earnings: {
        type: 'boolean',
        description: 'Include earnings in response',
        example: true
      },
      show_balance: {
        type: 'boolean',
        description: 'Include available balance in response',
        example: true
      }
    }
  },

  AdminAuditLog: {
    type: 'object',
    properties: {
      _id: {
        type: 'string',
        example: '60f7c6b4c8f1a2b3c4d5e6f7'
      },
      admin_id: {
        type: 'string',
        example: '60f7c6b4c8f1a2b3c4d5e6f7'
      },
      action: {
        type: 'string',
        example: 'TOGGLE_USER_VISIBILITY'
      },
      target_user_id: {
        type: 'string',
        example: '60f7c6b4c8f1a2b3c4d5e6f8'
      },
      details: {
        type: 'object',
        properties: {
          field: {
            type: 'string',
            example: 'earnings'
          },
          old_value: {
            type: 'boolean',
            example: true
          },
          new_value: {
            type: 'boolean',
            example: false
          }
        }
      },
      ip_address: {
        type: 'string',
        example: '192.168.1.1'
      },
      user_agent: {
        type: 'string',
        example: 'Mozilla/5.0...'
      },
      timestamp: {
        type: 'string',
        format: 'date-time',
        example: '2023-01-01T00:00:00.000Z'
      }
    }
  },

  ExportRequest: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        enum: ['csv', 'excel', 'json'],
        example: 'csv'
      },
      filters: {
        $ref: '#/components/schemas/LeaderboardFilters'
      },
      fields: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['name', 'userName', 'earnings', 'balance', 'shares', 'referrals', 'location', 'createdAt']
        },
        example: ['name', 'userName', 'earnings', 'location']
      }
    }
  },

  ExportResponse: {
    type: 'object',
    properties: {
      success: {
        type: 'boolean',
        example: true
      },
      download_url: {
        type: 'string',
        example: 'https://api.example.com/exports/leaderboard_20230101.csv'
      },
      expires_at: {
        type: 'string',
        format: 'date-time',
        example: '2023-01-01T01:00:00.000Z'
      },
      total_records: {
        type: 'integer',
        example: 1250
      }
    }
  }
};