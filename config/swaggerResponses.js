module.exports = {
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
            type: 'object',
            properties: {
              success: {
                type: 'boolean',
                example: false
              },
              message: {
                type: 'string',
                example: 'Access denied. No token provided.'
              }
            }
          }
        }
      }
    },
  
    ForbiddenError: {
      description: 'Forbidden - Insufficient permissions',
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
                example: 'Access denied. Admin privileges required.'
              }
            }
          }
        }
      }
    },
  
    NotFoundError: {
      description: 'Resource not found',
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
                example: 'Resource not found'
              }
            }
          }
        }
      }
    },
  
    ServerError: {
      description: 'Internal server error',
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
                example: 'Internal server error'
              }
            }
          }
        }
      }
    },
  
    ConflictError: {
      description: 'Conflict - Resource already exists',
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
                example: 'Resource already exists'
              }
            }
          }
        }
      }
    },
  
    BadRequestError: {
      description: 'Bad request - Invalid input',
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
                example: 'Invalid request data'
              }
            }
          }
        }
      }
    }
  };