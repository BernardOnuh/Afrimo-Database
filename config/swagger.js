const swaggerJsdoc = require('swagger-jsdoc');

// Helper function to get the base URL
const getBaseUrl = () => {
  if (process.env.NODE_ENV === 'production') {
    // Priority: Custom BASE_URL > Render URL > fallback
    return process.env.BASE_URL || 
           process.env.RENDER_EXTERNAL_URL || 
           `https://afrimo-database-1.onrender.com`;
  }
  return `http://localhost:${process.env.PORT || 5000}`;
};

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'AfriMobile API',
      version: '1.0.0',
      description: 'AfriMobile API documentation with comprehensive endpoints for user management, shares, payments, withdrawals, and more.',
      contact: {
        name: 'AfriMobile Team',
        email: 'support@afrimobile.com'
      },
    },
    servers: [
      {
        url: 'https://afrimo-database-1.onrender.com/api',
        description: 'Production server'
      },
      {
        url: 'http://localhost:5000/api',
        description: 'Development server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter JWT token for authentication'
        },
        adminAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Admin JWT token required'
        }
      },
      schemas: {
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
      },

      responses: {
        ValidationError: {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: {
                    type: 'boolean',
                    example: false
                  },
                  message: {
                    type: 'string',
                    example: 'Validation failed'
                  },
                  errors: {
                    type: 'array',
                    items: {
                      type: 'string'
                    },
                    example: ['Field is required', 'Invalid email format']
                  }
                }
              }
            }
          }
        },

        UnauthorizedError: {
          description: 'Unauthorized - Invalid or missing token',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                success: false,
                message: 'Access denied. No token provided.'
              }
            }
          }
        },

        ForbiddenError: {
          description: 'Forbidden - Insufficient permissions',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                success: false,
                message: 'Access denied. Admin privileges required.'
              }
            }
          }
        },

        NotFoundError: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                success: false,
                message: 'Resource not found'
              }
            }
          }
        },

        ServerError: {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                success: false,
                message: 'Internal server error'
              }
            }
          }
        },

        ConflictError: {
          description: 'Conflict - Resource already exists',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                success: false,
                message: 'Resource already exists'
              }
            }
          }
        },

        BadRequestError: {
          description: 'Bad request - Invalid input',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                success: false,
                message: 'Invalid request data'
              }
            }
          }
        }
      }
    },
    security: [
      {
        bearerAuth: []
      }
    ]
  },
  apis: [
    './routes/*.js',
    './controller/*.js',
    './models/*.js'
  ]
};

// Function to get swagger spec with multiple server options
const getSwaggerSpec = () => {
  const swaggerSpec = swaggerJsdoc(swaggerOptions);
  
  // Provide multiple server options for easy switching
  const servers = [
    {
      url: 'https://afrimo-database-1.onrender.com/api',
      description: 'Production server (Live)'
    },
    {
      url: 'http://localhost:5000/api',
      description: 'Development server (Local)'
    }
  ];

  // Add staging server if available
  if (process.env.STAGING_URL) {
    servers.splice(1, 0, {
      url: `${process.env.STAGING_URL}/api`,
      description: 'Staging server (Test)'
    });
  }

  // Add custom server if BASE_URL is different from production
  if (process.env.BASE_URL && process.env.BASE_URL !== 'https://afrimo-database-1.onrender.com') {
    servers.unshift({
      url: `${process.env.BASE_URL}/api`,
      description: 'Custom server'
    });
  }
  
  swaggerSpec.servers = servers;
  return swaggerSpec;
};

module.exports = getSwaggerSpec();