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
app.use(express.json({ limit: '5mb' }));
app.use(express.raw({ limit: '5mb' }));

// Serve static files from the React app
app.use(express.static(path.join(__dirname, 'build')));

// Helper function to download file from Monday.com
async function downloadFileFromMonday(fileUrl, token) {
  console.log('Starting file download process...');
  
  try {
    let response = await fetch(fileUrl, {
      headers: {
        'Authorization': token ? `Bearer ${token}` : '',
        'Accept': '*/*'
      }
    });

    if (!response.ok) {
      console.log('Direct download failed, trying without auth headers...');
      response = await fetch(fileUrl);
    }

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
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
    const { fileUrl, width } = req.body;
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!fileUrl || !width) {
      return res.status(400).json({ 
        error: 'Missing required parameters'
      });
    }

    const parsedWidth = parseInt(width);
    if (isNaN(parsedWidth) || parsedWidth < 1 || parsedWidth > 5000) {
      return res.status(400).json({ 
        error: 'Invalid width parameter'
      });
    }

    console.log('Downloading image from:', fileUrl);
    const buffer = await downloadFileFromMonday(fileUrl, token);

    console.log('Original buffer size:', buffer.byteLength);

    // Detect input format
    const metadata = await sharp(buffer).metadata();
    console.log('Input image metadata:', metadata);

    console.log('Resizing image to width:', parsedWidth);
    let resizedBuffer;
    
    // Process based on input format
    if (metadata.format === 'jpeg' || metadata.format === 'jpg') {
      resizedBuffer = await sharp(buffer)
        .resize(parsedWidth, null, { 
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({
          quality: 90,
          chromaSubsampling: '4:4:4'
        })
        .toBuffer({ resolveWithObject: true });
    } else if (metadata.format === 'png') {
      resizedBuffer = await sharp(buffer)
        .resize(parsedWidth, null, { 
          fit: 'inside',
          withoutEnlargement: true
        })
        .png({
          quality: 90
        })
        .toBuffer({ resolveWithObject: true });
    } else {
      // For all other formats, convert to JPEG
      resizedBuffer = await sharp(buffer)
        .resize(parsedWidth, null, { 
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({
          quality: 90,
          chromaSubsampling: '4:4:4'
        })
        .toBuffer({ resolveWithObject: true });
    }

    console.log('Image resized successfully:', {
      format: resizedBuffer.info.format,
      width: resizedBuffer.info.width,
      height: resizedBuffer.info.height,
      size: resizedBuffer.data.length,
      originalSize: buffer.byteLength
    });

    // Convert to base64 without any truncation
    const base64Data = Buffer.from(resizedBuffer.data).toString('base64');
    console.log('Base64 data length:', base64Data.length);

    res.json({
      data: base64Data,
      contentType: `image/${resizedBuffer.info.format}`,
      size: resizedBuffer.data.length,
      info: {
        width: resizedBuffer.info.width,
        height: resizedBuffer.info.height,
        format: resizedBuffer.info.format,
        originalSize: buffer.byteLength
      }
    });

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

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 