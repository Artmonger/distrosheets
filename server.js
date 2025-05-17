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
    const { fileUrl, width } = req.body;
    
    if (!fileUrl || !width) {
      console.error('Missing parameters:', { fileUrl: !!fileUrl, width: !!width });
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    console.log('Downloading image from:', fileUrl);
    
    // Download the image with proper headers for Monday.com's protected files
    const response = await fetch(fileUrl, {
      headers: {
        'Accept': 'image/*',
        'Cache-Control': 'no-cache'
      }
    });

    if (!response.ok) {
      console.error('Download failed:', response.status, response.statusText);
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }
    
    const buffer = await response.buffer();
    console.log('Downloaded image, size:', buffer.length, 'bytes');

    // Get image metadata
    const metadata = await sharp(buffer).metadata();
    console.log('Image metadata:', metadata);

    // Resize the image
    console.log('Resizing image to width:', width);
    const resizedBuffer = await sharp(buffer)
      .resize(parseInt(width), null, { 
        fit: 'contain',
        withoutEnlargement: true
      })
      .jpeg({ quality: 85 })
      .toBuffer();

    console.log('Resized image, new size:', resizedBuffer.length, 'bytes');

    // Send the resized image back
    res.set('Content-Type', 'image/jpeg');
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