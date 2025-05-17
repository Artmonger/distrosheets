const express = require('express');
const path = require('path');
const cors = require('cors');
const fetch = require('node-fetch');
const sharp = require('sharp');
const mondaySdk = require('monday-sdk-js')();

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration
app.use(cors({
  origin: [
    'https://monday-img-app.herokuapp.com',
    'http://localhost:3000',
    'http://localhost:3001',
    'https://artmonger.monday.com',
    'https://*.monday.com'
  ],
  credentials: true,
  exposedHeaders: ['Content-Type', 'Authorization', 'Content-Length', 'Cache-Control']
}));

// Parse JSON bodies with increased limit for large files
app.use(express.json({ limit: '50mb' }));

// Serve static files from the React app
app.use(express.static(path.join(__dirname, 'build')));

// Endpoint to resize images
app.post('/resize-image', async (req, res) => {
  try {
    console.log('Received resize request');
    const { fileUrl, width, token } = req.body;
    
    if (!fileUrl || !width || !token) {
      console.error('Missing parameters:', { fileUrl: !!fileUrl, width: !!width, token: !!token });
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    console.log('Downloading image from:', fileUrl);
    
    // Download the image with proper headers for Monday.com's protected files
    const response = await fetch(fileUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': '*/*',
        'Cache-Control': 'no-cache'
      },
      redirect: 'follow',
      follow: 5
    });

    if (!response.ok) {
      console.error('Download failed:', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        url: response.url
      });
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    console.log('Response content type:', contentType);

    const buffer = await response.buffer();
    console.log('Downloaded image, size:', buffer.length, 'bytes');

    if (buffer.length === 0) {
      throw new Error('Downloaded file is empty');
    }

    // Get image metadata and validate it's an image
    let metadata;
    try {
      metadata = await sharp(buffer).metadata();
      console.log('Image metadata:', metadata);

      if (!metadata.format) {
        throw new Error('Invalid image format');
      }
    } catch (err) {
      console.error('Error reading image metadata:', err);
      throw new Error('Invalid image file');
    }

    // Resize the image
    console.log('Resizing image to width:', width);
    const resizedBuffer = await sharp(buffer)
      .resize(parseInt(width), null, { 
        fit: 'contain',
        withoutEnlargement: true
      })
      .toFormat(metadata.format, {
        quality: 85,
        chromaSubsampling: '4:4:4'
      })
      .toBuffer();

    console.log('Resized image, new size:', resizedBuffer.length, 'bytes');

    // Send the resized image back with the correct content type
    const outputContentType = `image/${metadata.format}`;
    res.set('Content-Type', outputContentType);
    res.set('Cache-Control', 'no-cache');
    res.send(resizedBuffer);
    console.log('Successfully sent resized image');
  } catch (error) {
    console.error('Error resizing image:', error);
    res.status(500).json({ 
      error: 'Failed to resize image',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 