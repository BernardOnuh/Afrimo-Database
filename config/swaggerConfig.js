const express = require('express');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

// Create router
const router = express.Router();

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'AfriMobile API',
      version: '1.0.0',
      description: 'AfriMobile share management and payment system API - A comprehensive platform for managing share investments, payments, referrals, and withdrawals.',
      contact: {
        name: 'AfriMobile Development Team',
        email: 'support@afrimobile.com',
        url: 'https://afrimobile.com'
      },
      license: {
        name: 'MIT',
        url: 'https://spdx.org/licenses/MIT.html',
      },
      termsOfService: 'https://afrimobile.com/terms'
    },
    servers: [
      {
        url: process.env.NODE_ENV === 'production' 
          ? 'https://api.afrimobile.com/api' 
          : 'http://localhost:5000/api',
        description: process.env.NODE_ENV === 'production' ? 'Production server' : 'Development server',
      },
      {
        url: 'https://staging.afrimobile.com/api',
        description: 'Staging server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token for user authentication. Format: Bearer <token>'
        },
        adminAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token with admin privileges. Format: Bearer <admin_token>'
        }
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            _id: {
              type: 'string',
              description: 'Unique user identifier',
              example: '60f7c6b4c8f1a2b3c4d5e6f7'
            },
            name: {
              type: 'string',
              description: 'Full name of the user',
              example: 'John Doe'
            },
            email: {
              type: 'string',
              format: 'email',
              description: 'User email address',
              example: 'john@example.com'
            },
            userName: {
              type: 'string',
              description: 'Unique username',
              example: 'johndoe'
            },
            phoneNumber: {
              type: 'string',
              description: 'User phone number with country code',
              example: '+2341234567890'
            },
            isAdmin: {
              type: 'boolean',
              description: 'Whether user has admin privileges',
              example: false
            },
            isBanned: {
              type: 'boolean',
              description: 'Whether user is banned from the platform',
              example: false
            },
            walletAddress: {
              type: 'string',
              description: 'Cryptocurrency wallet address',
              example: '0x742d35Cc6643C673532925e2aC5c48C0F30A37a0'
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
                },
                totalReferrals: {
                  type: 'number',
                  example: 5
                },
                totalEarnings: {
                  type: 'number',
                  example: 12500
                }
              }
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              example: '2023-12-01T10:30:00Z'
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              example: '2023-12-01T10:30:00Z'
            }
          }
        },
        ShareTransaction: {
          type: 'object',
          properties: {
            _id: {
              type: 'string',
              description: 'Unique transaction identifier',
              example: '60f7c6b4c8f1a2b3c4d5e6f7'
            },
            user: {
              type: 'string',
              description: 'User ID who made the transaction',
              example: '60f7c6b4c8f1a2b3c4d5e6f7'
            },
            paymentMethod: {
              type: 'string',
              enum: ['paystack', 'web3', 'manual'],
              description: 'Payment method used',
              example: 'paystack'
            },
            paymentReference: {
              type: 'string',
              description: 'Unique payment reference',
              example: 'tx_123456789'
            },
            amount: {
              type: 'number',
              description: 'Transaction amount in base currency',
              example: 50000
            },
            shares: {
              type: 'number',
              description: 'Number of shares purchased',
              example: 100
            },
            pricePerShare: {
              type: 'number',
              description: 'Price per share at time of purchase',
              example: 500
            },
            status: {
              type: 'string',
              enum: ['pending', 'completed', 'failed', 'cancelled'],
              description: 'Current transaction status',
              example: 'completed'
            },
            fees: {
              type: 'object',
              properties: {
                processing: {
                  type: 'number',
                  example: 150
                },
                platform: {
                  type: 'number',
                  example: 250
                }
              }
            },
            cryptoDetails: {
              type: 'object',
              properties: {
                symbol: {
                  type: 'string',
                  example: 'USDT'
                },
                amount: {
                  type: 'number',
                  example: 50.5
                },
                network: {
                  type: 'string',
                  example: 'BEP20'
                },
                transactionHash: {
                  type: 'string',
                  example: '0x123456789abcdef...'
                }
              }
            },
            manualPaymentDetails: {
              type: 'object',
              properties: {
                paymentMethod: {
                  type: 'string',
                  enum: ['bank_transfer', 'mobile_money', 'cash_deposit'],
                  example: 'bank_transfer'
                },
                paymentReference: {
                  type: 'string',
                  example: 'TXN123456789'
                },
                paymentProofUrl: {
                  type: 'string',
                  example: '/uploads/payment-proofs/payment-123456.jpg'
                },
                notes: {
                  type: 'string',
                  example: 'Payment made via GTBank mobile app'
                },
                reviewedBy: {
                  type: 'string',
                  example: '60f7c6b4c8f1a2b3c4d5e6f9'
                },
                reviewNotes: {
                  type: 'string',
                  example: 'Payment verified successfully'
                }
              }
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              example: '2023-12-01T10:30:00Z'
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              example: '2023-12-01T10:30:00Z'
            }
          }
        },
        ReferralTransaction: {
          type: 'object',
          properties: {
            _id: {
              type: 'string',
              example: '60f7c6b4c8f1a2b3c4d5e6f7'
            },
            beneficiary: {
              type: 'string',
              description: 'User who receives the referral commission',
              example: '60f7c6b4c8f1a2b3c4d5e6f7'
            },
            referredUser: {
              type: 'string',
              description: 'User who was referred',
              example: '60f7c6b4c8f1a2b3c4d5e6f8'
            },
            commissionAmount: {
              type: 'number',
              description: 'Commission amount earned',
              example: 2500
            },
            commissionRate: {
              type: 'number',
              description: 'Commission rate applied (percentage)',
              example: 5
            },
            sharesPurchased: {
              type: 'number',
              description: 'Number of shares purchased by referred user',
              example: 100
            },
            originalTransactionId: {
              type: 'string',
              description: 'ID of the original share purchase transaction',
              example: '60f7c6b4c8f1a2b3c4d5e6f9'
            },
            status: {
              type: 'string',
              enum: ['pending', 'completed', 'cancelled'],
              example: 'completed'
            },
            transactionDate: {
              type: 'string',
              format: 'date-time',
              example: '2023-12-01T10:30:00Z'
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
              description: 'User requesting the withdrawal',
              example: '60f7c6b4c8f1a2b3c4d5e6f7'
            },
            amount: {
              type: 'number',
              description: 'Withdrawal amount',
              example: 25000
            },
            withdrawalType: {
              type: 'string',
              enum: ['referral_earnings', 'share_dividends', 'other'],
              example: 'referral_earnings'
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
                bankName: {
                  type: 'string',
                  example: 'First Bank of Nigeria'
                },
                bankCode: {
                  type: 'string',
                  example: '011'
                },
                sortCode: {
                  type: 'string',
                  example: '011001'
                }
              }
            },
            status: {
              type: 'string',
              enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
              example: 'pending'
            },
            clientReference: {
              type: 'string',
              description: 'Unique withdrawal reference',
              example: 'WD_123456789'
            },
            providerReference: {
              type: 'string',
              description: 'Payment provider reference',
              example: 'LENCO_REF_123'
            },
            fees: {
              type: 'object',
              properties: {
                processingFee: {
                  type: 'number',
                  example: 100
                },
                bankFee: {
                  type: 'number',
                  example: 50
                }
              }
            },
            processedAt: {
              type: 'string',
              format: 'date-time',
              example: '2023-12-01T12:00:00Z'
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              example: '2023-12-01T10:30:00Z'
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
            shareTransactionId: {
              type: 'string',
              description: 'Related share purchase transaction',
              example: '60f7c6b4c8f1a2b3c4d5e6f8'
            },
            totalAmount: {
              type: 'number',
              description: 'Total installment amount',
              example: 50000
            },
            paidAmount: {
              type: 'number',
              description: 'Amount paid so far',
              example: 20000
            },
            remainingAmount: {
              type: 'number',
              description: 'Remaining amount to be paid',
              example: 30000
            },
            installmentPlan: {
              type: 'object',
              properties: {
                duration: {
                  type: 'number',
                  description: 'Duration in months',
                  example: 6
                },
                monthlyAmount: {
                  type: 'number',
                  example: 8333.33
                },
                interestRate: {
                  type: 'number',
                  example: 2.5
                }
              }
            },
            status: {
              type: 'string',
              enum: ['active', 'completed', 'defaulted', 'cancelled'],
              example: 'active'
            },
            nextPaymentDate: {
              type: 'string',
              format: 'date',
              example: '2024-01-01'
            },
            penalties: {
              type: 'number',
              description: 'Accumulated penalties for late payments',
              example: 500
            }
          }
        },
        Error: {
          type: 'object',
          required: ['success', 'message'],
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            message: {
              type: 'string',
              description: 'Error message',
              example: 'An error occurred'
            },
            error: {
              type: 'string',
              description: 'Detailed error information',
              example: 'Validation failed: email is required'
            },
            code: {
              type: 'string',
              description: 'Error code for client handling',
              example: 'VALIDATION_ERROR'
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              example: '2023-12-01T10:30:00Z'
            }
          }
        },
        Success: {
          type: 'object',
          required: ['success', 'message'],
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            message: {
              type: 'string',
              description: 'Success message',
              example: 'Operation completed successfully'
            },
            data: {
              type: 'object',
              description: 'Response data'
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              example: '2023-12-01T10:30:00Z'
            }
          }
        },
        PaginationMeta: {
          type: 'object',
          properties: {
            currentPage: {
              type: 'integer',
              minimum: 1,
              example: 1
            },
            totalPages: {
              type: 'integer',
              minimum: 0,
              example: 10
            },
            totalItems: {
              type: 'integer',
              minimum: 0,
              example: 100
            },
            itemsPerPage: {
              type: 'integer',
              minimum: 1,
              example: 10
            },
            hasNext: {
              type: 'boolean',
              example: true
            },
            hasPrev: {
              type: 'boolean',
              example: false
            }
          }
        }
      },
      responses: {
        UnauthorizedError: {
          description: 'Authentication token is missing or invalid',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                success: false,
                message: 'Not authorized, token failed',
                code: 'UNAUTHORIZED',
                timestamp: '2023-12-01T10:30:00Z'
              }
            }
          }
        },
        ForbiddenError: {
          description: 'Access forbidden - admin privileges required',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                success: false,
                message: 'Access denied - admin privileges required',
                code: 'FORBIDDEN',
                timestamp: '2023-12-01T10:30:00Z'
              }
            }
          }
        },
        ValidationError: {
          description: 'Request validation failed',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                success: false,
                message: 'Validation failed',
                error: 'Please provide all required fields',
                code: 'VALIDATION_ERROR',
                timestamp: '2023-12-01T10:30:00Z'
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
                message: 'Resource not found',
                code: 'NOT_FOUND',
                timestamp: '2023-12-01T10:30:00Z'
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
                message: 'Something went wrong!',
                code: 'INTERNAL_ERROR',
                timestamp: '2023-12-01T10:30:00Z'
              }
            }
          }
        },
        RateLimitError: {
          description: 'Too many requests',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                success: false,
                message: 'Too many requests from this IP, please try again after 15 minutes',
                code: 'RATE_LIMIT_EXCEEDED',
                timestamp: '2023-12-01T10:30:00Z'
              }
            }
          }
        }
      },
      parameters: {
        PageParam: {
          name: 'page',
          in: 'query',
          description: 'Page number for pagination',
          required: false,
          schema: {
            type: 'integer',
            minimum: 1,
            default: 1
          }
        },
        LimitParam: {
          name: 'limit',
          in: 'query',
          description: 'Number of items per page',
          required: false,
          schema: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 10
          }
        },
        UserIdParam: {
          name: 'userId',
          in: 'path',
          description: 'User identifier',
          required: true,
          schema: {
            type: 'string',
            pattern: '^[0-9a-fA-F]{24}$'
          },
          example: '60f7c6b4c8f1a2b3c4d5e6f7'
        }
      }
    },
    tags: [
      {
        name: 'Authentication',
        description: 'User authentication and authorization endpoints'
      },
      {
        name: 'Users',
        description: 'User management and profile operations'
      },
      {
        name: 'Shares',
        description: 'Share purchase and management operations'
      },
      {
        name: 'Payments',
        description: 'Payment processing (Paystack, Web3, Manual)'
      },
      {
        name: 'Referrals',
        description: 'Referral system and commission tracking'
      },
      {
        name: 'Withdrawals',
        description: 'Withdrawal requests and processing'
      },
      {
        name: 'Installments',
        description: 'Installment payment management'
      },
      {
        name: 'Admin',
        description: 'Administrative operations and management'
      },
      {
        name: 'System',
        description: 'System utilities, health checks, and debugging'
      }
    ],
    externalDocs: {
      description: 'Find out more about AfriMobile',
      url: 'https://afrimobile.com/docs'
    }
  },
  apis: [
    './routes/*.js', 
    './app.js',
    './models/*.js'
  ], // Paths to files containing OpenAPI definitions
};

const specs = swaggerJsdoc(options);

// Custom CSS for better styling
const customCss = `
  .swagger-ui .topbar { 
    display: none 
  }
  .swagger-ui .info .title {
    color: #2c5aa0;
  }
  .swagger-ui .scheme-container {
    background: #f7f7f7;
    border-radius: 4px;
    padding: 10px;
  }
  .swagger-ui .btn.authorize {
    background-color: #49cc90;
    border-color: #49cc90;
  }
  .swagger-ui .btn.authorize:hover {
    background-color: #3ba67c;
    border-color: #3ba67c;
  }
`;

// Enhanced Swagger UI options
const swaggerUiOptions = {
  explorer: true,
  customCss: customCss,
  customSiteTitle: 'AfriMobile API Documentation',
  customfavIcon: '/favicon.ico',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    tryItOutEnabled: true,
    requestInterceptor: (req) => {
      // Add custom headers or modify requests if needed
      console.log('API Request:', req.method, req.url);
      return req;
    },
    responseInterceptor: (res) => {
      // Log responses for debugging
      console.log('API Response:', res.status, res.url);
      return res;
    },
    docExpansion: 'list', // 'list', 'full', 'none'
    defaultModelExpandDepth: 2,
    defaultModelsExpandDepth: 1,
    displayOperationId: false,
    showExtensions: true,
    showCommonExtensions: true,
    tagsSorter: 'alpha',
    operationsSorter: 'alpha'
  }
};

// Add route for Swagger documentation
router.use('/docs', swaggerUi.serve);
router.get('/docs', swaggerUi.setup(specs, swaggerUiOptions));

// Add a redirect from /api-docs to /docs for convenience
router.get('/api-docs', (req, res) => {
  res.redirect('/api/docs');
});

// Add JSON endpoint for the OpenAPI spec
router.get('/swagger.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(specs);
});

// Export the router (this fixes the original error)
module.exports = router;