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

// Helper function to get file from Monday.com
async function downloadFileFromMonday(fileUrl, token) {
  // Initialize Monday SDK with token
  mondaySdk.setToken(token);
  
  // First try to download directly with token
  try {
    const response = await fetch(fileUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'image/*',
        'monday-api-token': token
      },
      redirect: 'follow'
    });

    if (response.ok) {
      return response;
    }

    console.log('Direct download failed, trying through Monday.com API');
    
    // If direct download fails, try to get a signed URL through the API
    const query = `query {
      assets(ids: [${fileUrl.match(/resources\/(\d+)/)[1]}]) {
        url
        public_url
      }
    }`;

    const result = await mondaySdk.api(query);
    console.log('API response:', result);

    if (!result.data?.assets?.[0]?.url) {
      throw new Error('Failed to get signed URL from Monday.com API');
    }

    // Try downloading with the signed URL
    const signedResponse = await fetch(result.data.assets[0].url, {
      headers: {
        'Accept': 'image/*'
      }
    });

    if (!signedResponse.ok) {
      throw new Error(`Failed to download with signed URL: ${signedResponse.status} ${signedResponse.statusText}`);
    }

    return signedResponse;
  } catch (error) {
    console.error('Error downloading file:', error);
    throw error;
  }
}

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
    
    // Download the image using our helper function
    const response = await downloadFileFromMonday(fileUrl, token);
    
    const contentType = response.headers.get('content-type');
    console.log('Response content type:', contentType);

    if (!contentType || !contentType.startsWith('image/')) {
      console.error('Invalid content type:', contentType);
      throw new Error('Invalid content type received');
    }

    const buffer = await response.buffer();
    console.log('Downloaded image, size:', buffer.length, 'bytes');

    if (buffer.length === 0) {
      throw new Error('Downloaded file is empty');
    }

    // Log first few bytes of buffer to check format
    console.log('First bytes of image:', buffer.slice(0, 16));

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
      // Try to identify the issue
      if (err.message.includes('Input buffer contains unsupported image format')) {
        throw new Error('Unsupported image format');
      } else {
        throw new Error('Invalid image file: ' + err.message);
      }
    }

    // Resize the image
    console.log('Resizing image to width:', width);
    const resizedBuffer = await sharp(buffer, {
      failOnError: true,
      pages: -1 // Include all pages for multi-page images
    })
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