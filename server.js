const express = require('express');
const cors = require('cors');
const sharp = require('sharp');
const fetch = require('node-fetch');
const path = require('path');
const mondaySdk = require('monday-sdk-js/dist/monday-sdk-js.node');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3001;

// Configure rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

// Track server health with more detailed status
let serverStatus = {
  isHealthy: true,
  vulcanInitialized: false,
  startTime: Date.now(),
  lastError: null,
  activeConnections: 0,
  totalRequests: 0,
  failedRequests: 0,
  lastSuccessfulRequest: null
};

// Enhanced health check middleware
const healthCheck = (req, res, next) => {
  const memoryUsage = process.memoryUsage();
  const highMemory = memoryUsage.heapUsed / memoryUsage.heapTotal > 0.9;
  
  // Update request metrics
  serverStatus.totalRequests++;
  serverStatus.activeConnections++;
  
  // Auto-heal if server has been stable
  const timeSinceLastError = serverStatus.lastError ? 
    Date.now() - new Date(serverStatus.lastError.timestamp).getTime() : 
    Infinity;
  
  if (timeSinceLastError > 5 * 60 * 1000) { // 5 minutes
    serverStatus.isHealthy = true;
  }
  
  if (!serverStatus.isHealthy || highMemory) {
    serverStatus.failedRequests++;
    res.status(503).json({
      error: 'Service temporarily unavailable',
      details: {
        status: serverStatus,
        memoryUsage,
        timestamp: new Date().toISOString()
      }
    });
    return;
  }
  
  // Clean up on request end
  res.on('finish', () => {
    serverStatus.activeConnections--;
    if (res.statusCode < 400) {
      serverStatus.lastSuccessfulRequest = new Date().toISOString();
    }
  });
  
  next();
};

// Request timeout middleware
const timeout = (req, res, next) => {
  const timeoutDuration = 30000; // 30 seconds
  req.setTimeout(timeoutDuration, () => {
    res.status(503).json({
      error: 'Request timeout',
      timestamp: new Date().toISOString()
    });
  });
  next();
};

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'build')));
app.use(limiter);
app.use(timeout);
app.use(healthCheck);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error({
    message: 'Unhandled error',
    error: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString()
  });
  
  serverStatus.failedRequests++;
  serverStatus.lastError = {
    type: 'unhandled_error',
    message: err.message,
    timestamp: new Date().toISOString()
  };
  
  res.status(500).json({
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// Enhanced token validation with caching
const tokenCache = new Map();

const validateToken = (token) => {
  if (!token) return false;
  
  // Check cache first
  if (tokenCache.has(token)) {
    const cached = tokenCache.get(token);
    if (Date.now() < cached.expiresAt) {
      return true;
    }
    tokenCache.delete(token);
  }
  
  // Check JWT format
  const jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
  if (!jwtRegex.test(token)) {
    console.warn('Invalid JWT format');
    return false;
  }
  
  try {
    // Basic JWT structure validation
    const [header, payload] = token.split('.');
    const decodedHeader = JSON.parse(Buffer.from(header, 'base64').toString());
    const decodedPayload = JSON.parse(Buffer.from(payload, 'base64').toString());
    
    // Check required fields
    if (!decodedPayload.dat || !decodedPayload.exp) {
      console.warn('Missing required JWT fields');
      return false;
    }
    
    // Check expiration
    const expiresAt = decodedPayload.exp * 1000;
    if (expiresAt < Date.now()) {
      console.warn('Token expired');
      return false;
    }
    
    // Cache valid token
    tokenCache.set(token, {
      expiresAt,
      validatedAt: Date.now()
    });
    
    return true;
  } catch (err) {
    console.error('Token validation error:', err);
    return false;
  }
};

// Enhanced token extraction with detailed logging
const getToken = (req) => {
  const sources = {
    authorization: req.headers.authorization,
    mondayAuth: req.headers['x-monday-authorization'],
    queryToken: req.query.sessionToken,
    bodyToken: req.body?.sessionToken
  };
  
  const availableSources = Object.entries(sources)
    .filter(([_, value]) => value)
    .map(([key]) => key);
  
  console.log('Available token sources:', availableSources);
  
  // Try each source
  for (const [source, value] of Object.entries(sources)) {
    if (!value) continue;
    
    const token = value.replace(/^Bearer\s+/i, '').trim();
    if (validateToken(token)) {
      console.log(`Valid token found in ${source}`);
      return token;
    } else {
      console.warn(`Invalid token in ${source}`);
    }
  }
  
  return null;
};

// Enhanced authentication middleware with retries
const authenticate = async (req, res, next) => {
  const maxRetries = 2;
  let attempts = 0;
  
  const attemptAuth = async () => {
    try {
      const token = getToken(req);
      
      if (!token) {
        throw new Error('No valid token found in request');
      }
      
      const monday = mondaySdk();
      monday.setToken(token);
      
      const response = await monday.api(`
        query {
          me {
            id
            name
            account {
              id
              name
            }
          }
        }
      `);
      
      if (response.errors || !response.data?.me?.id) {
        throw new Error(response.errors?.[0]?.message || 'API verification failed');
      }
      
      // Store user info in request
      req.user = response.data.me;
      req.token = token;
      return true;
    } catch (err) {
      console.error(`Authentication attempt ${attempts + 1} failed:`, err);
      return false;
    }
  };
  
  while (attempts < maxRetries) {
    if (await attemptAuth()) {
      return next();
    }
    attempts++;
    if (attempts < maxRetries) {
      await new Promise(r => setTimeout(r, 1000)); // Wait 1s between retries
    }
  }
  
  // All attempts failed
  serverStatus.failedRequests++;
  serverStatus.lastError = {
    type: 'auth_error',
    message: 'Authentication failed after multiple attempts',
    timestamp: new Date().toISOString()
  };
  
  res.status(401).json({
    error: 'Authentication failed',
    details: 'Failed to authenticate after multiple attempts',
    timestamp: new Date().toISOString()
  });
};

// Health check endpoint
app.get('/health', (req, res) => {
  const memoryUsage = process.memoryUsage();
  const healthStatus = {
    status: serverStatus.isHealthy ? 'ok' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    metrics: {
      memory: {
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        memoryUsagePercent: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100)
      },
      requests: {
        total: serverStatus.totalRequests,
        failed: serverStatus.failedRequests,
        active: serverStatus.activeConnections,
        successRate: serverStatus.totalRequests ? 
          Math.round(((serverStatus.totalRequests - serverStatus.failedRequests) / serverStatus.totalRequests) * 100) : 
          100
      },
      vulcan: {
        initialized: serverStatus.vulcanInitialized,
        status: serverStatus.vulcanInitialized ? 'ready' : 'not_ready'
      },
      lastError: serverStatus.lastError,
      lastSuccessfulRequest: serverStatus.lastSuccessfulRequest
    }
  };

  // Auto-heal if metrics are good
  if (healthStatus.metrics.requests.successRate > 90 && 
      healthStatus.metrics.memory.memoryUsagePercent < 90 &&
      (!serverStatus.lastError || 
       Date.now() - new Date(serverStatus.lastError.timestamp).getTime() > 5 * 60 * 1000)) {
    serverStatus.isHealthy = true;
  }

  res.json(healthStatus);
});

// Protected endpoints
app.post('/api/resize', authenticate, async (req, res) => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl) {
      return res.status(400).json({ error: 'No image URL provided' });
    }

    // Fetch the image
    const response = await fetch(imageUrl, {
      headers: {
        'Authorization': `Bearer ${req.token}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }
    
    const buffer = await response.buffer();

    // Resize the image
    const resizedBuffer = await sharp(buffer)
      .resize(200, 200, {
        fit: 'cover',
        position: 'center'
      })
      .toBuffer();

    // Convert to base64
    const base64Image = resizedBuffer.toString('base64');
    
    res.json({ 
      resizedImage: base64Image,
      success: true
    });
    
  } catch (error) {
    console.error('Error processing image:', error);
    res.status(500).json({ 
      error: 'Failed to process image',
      details: error.message
    });
  }
});

// Serve React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Performing graceful shutdown...');
  serverStatus.isHealthy = false;
  
  // Stop accepting new requests
  server.close(() => {
    console.log('Server closed. Exiting process.');
    process.exit(0);
  });
});

const server = app.listen(PORT, () => {
  console.log({
    message: 'Server started',
    port: PORT,
    nodeVersion: process.version,
    timestamp: new Date().toISOString()
  });
}); 