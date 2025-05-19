const express = require('express');
const path = require('path');
const cors = require('cors');
const fetch = require('node-fetch');
const sharp = require('sharp');
const mondaySdk = require('monday-sdk-js')();

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration with Monday.com domains
app.use(cors({
  origin: [
    'https://monday-img-app-aaca18d8516b.herokuapp.com',
    'http://localhost:3000',
    'http://localhost:3001',
    'https://artmonger.monday.com',
    'https://*.monday.com',
    'https://monday.com'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'monday-api-token']
}));

// Increase the request size limit for express
app.use(express.json({ limit: '50mb' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '50mb' }));

// Serve static files from the React app
app.use(express.static(path.join(__dirname, 'build')));

// Helper function to download file from Monday.com
async function downloadFileFromMonday(fileUrl, token) {
  console.log('Starting file download process...');
  
  try {
    let response = await fetch(fileUrl, {
      headers: {
        'Authorization': token ? `Bearer ${token}` : '',
        'Accept': 'image/*'
      }
    });

    if (!response.ok) {
      console.log('Direct download failed, trying without auth headers...');
      response = await fetch(fileUrl);
    }

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
    }

    const buffer = await response.buffer();
    if (buffer.byteLength === 0) {
      throw new Error('Downloaded file is empty');
    }

    return buffer;
  } catch (error) {
    console.error('Error downloading file:', error);
    throw error;
  }
}

// Endpoint to resize images
app.post('/resize-image', async (req, res) => {
  try {
    console.log('Received resize request');
    const { fileUrl, size, squareMode, padColor } = req.body;
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!fileUrl || !size) {
      return res.status(400).json({ 
        error: 'Missing required parameters'
      });
    }

    const parsedSize = parseInt(size);
    if (isNaN(parsedSize) || parsedSize < 1 || parsedSize > 5000) {
      return res.status(400).json({ 
        error: 'Invalid size. Size must be between 1 and 5000 pixels.'
      });
    }

    console.log('Processing image with settings:', { size: parsedSize, squareMode, padColor });
    console.log('Downloading image from:', fileUrl);
    const buffer = await downloadFileFromMonday(fileUrl, token);
    console.log('Original buffer size:', buffer.byteLength);

    // Detect input format and metadata
    const metadata = await sharp(buffer).metadata();
    console.log('Input image metadata:', metadata);

    // Initialize sharp pipeline
    let pipeline = sharp(buffer, { failOnError: false });

    if (squareMode === 'crop') {
      // Crop to square and resize
      pipeline = pipeline
        .resize(parsedSize, parsedSize, {
          fit: 'cover',
          position: 'center'
        });
    } else {
      // Pad to square
      // First resize to fit within the square while maintaining aspect ratio
      pipeline = pipeline
        .resize(parsedSize, parsedSize, {
          fit: 'contain',
          background: padColor === 'transparent' ? { r: 0, g: 0, b: 0, alpha: 0 } : { r: 255, g: 255, b: 255, alpha: 1 }
        });
    }

    // Apply high quality settings
    if (padColor === 'transparent') {
      // Use PNG for transparent backgrounds
      pipeline = pipeline
        .png({
          quality: 100,
          compressionLevel: 9
        });
    } else {
      // Use JPEG for white backgrounds
      pipeline = pipeline
        .jpeg({
          quality: 95,
          chromaSubsampling: '4:4:4',
          mozjpeg: true
        });
    }

    // Generate final image
    const resizedBuffer = await pipeline
      .withMetadata()
      .toBuffer();

    // Get the final metadata
    const finalMetadata = await sharp(resizedBuffer).metadata();
    console.log('Final image metadata:', {
      format: finalMetadata.format,
      width: finalMetadata.width,
      height: finalMetadata.height,
      space: finalMetadata.space,
      channels: finalMetadata.channels,
      depth: finalMetadata.depth,
      density: finalMetadata.density,
      size: resizedBuffer.length
    });

    // Set proper headers for binary response
    res.set({
      'Content-Type': padColor === 'transparent' ? 'image/png' : 'image/jpeg',
      'Content-Length': resizedBuffer.length,
      'Content-Disposition': 'attachment',
      'Cache-Control': 'no-cache',
      'X-Image-Width': finalMetadata.width,
      'X-Image-Height': finalMetadata.height,
      'X-Original-Size': buffer.byteLength
    });
    
    // Send binary data directly
    res.send(resizedBuffer);

  } catch (error) {
    console.error('Error processing image:', error);
    res.status(500).json({ 
      error: 'Failed to process image',
      details: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Privacy Policy endpoint
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy-policy.html'));
});

// Terms and Conditions endpoint
app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});

// Pricing endpoint
app.get('/pricing', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pricing.html'));
});

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 