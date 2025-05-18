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

    // Always convert to high-quality JPEG
    const resizedBuffer = await sharp(buffer)
      .resize({
        width: parsedWidth,
        height: null,
        fit: sharp.fit.inside,
        withoutEnlargement: true
      })
      .jpeg({
        quality: 100,
        chromaSubsampling: '4:4:4',
        mozjpeg: true
      })
      .toBuffer();

    // Get the final metadata
    const finalMetadata = await sharp(resizedBuffer).metadata();
    console.log('Final image metadata:', finalMetadata);

    // Send as JSON with base64 data
    res.json({
      data: resizedBuffer.toString('base64'),
      contentType: 'image/jpeg',
      size: resizedBuffer.length,
      info: {
        width: finalMetadata.width,
        height: finalMetadata.height,
        format: 'jpeg',
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