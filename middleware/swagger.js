const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('../config/swagger');

const setupSwagger = (app) => {
  // Swagger UI setup
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    explorer: true,
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui .info { margin: 20px 0; }
      .swagger-ui .info .title { color: #3b4151; }
    `,
    customSiteTitle: 'AfriMobile API Documentation',
    swaggerOptions: {
      docExpansion: 'none',
      filter: true,
      showRequestDuration: true,
      tryItOutEnabled: true
    }
  }));

  // Serve swagger.json directly
  app.get('/swagger.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  // Health check endpoint for Swagger
  app.get('/api-docs/health', (req, res) => {
    res.json({
      success: true,
      message: 'Swagger documentation is running',
      timestamp: new Date().toISOString(),
      version: swaggerSpec.info?.version || '1.0.0'
    });
  });

  console.log('✅ Swagger documentation available at /api-docs');
  console.log('📄 Swagger JSON available at /swagger.json');
  
  if (process.env.NODE_ENV === 'development') {
    console.log(`🌐 Access at: http://localhost:${process.env.PORT || 5000}/api-docs`);
  }
};

module.exports = setupSwagger;