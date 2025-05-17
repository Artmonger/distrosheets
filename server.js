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

// Helper function to validate and normalize content type
function validateContentType(contentType) {
  if (!contentType) {
    throw new Error('No content type provided');
  }

  // Normalize content type to lowercase and remove parameters
  const normalizedType = contentType.toLowerCase().split(';')[0].trim();
  
  // List of valid image content types
  const validTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/tiff',
    'image/bmp',
    'application/octet-stream' // Some servers send binary data with this type
  ];

  if (!validTypes.includes(normalizedType)) {
    console.error('Invalid content type:', normalizedType);
    throw new Error(`Invalid content type: ${normalizedType}`);
  }

  return normalizedType;
}

// Helper function to get file from Monday.com
async function downloadFileFromMonday(fileUrl, token) {
  console.log('Starting file download process...');
  
  // Initialize Monday SDK with token
  mondaySdk.setToken(token);
  
  // First try to download directly with token
  try {
    console.log('Attempting direct download...');
    const response = await fetch(fileUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'image/*',
        'monday-api-token': token
      },
      redirect: 'follow'
    });

    console.log('Direct download response:', {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries())
    });

    if (response.ok) {
      // Validate content type before returning
      const contentType = validateContentType(response.headers.get('content-type'));
      console.log('Valid content type received:', contentType);
      return response;
    }

    console.log('Direct download failed, trying through Monday.com API');
    
    // Extract asset ID from URL
    const assetIdMatch = fileUrl.match(/resources\/(\d+)/);
    if (!assetIdMatch) {
      throw new Error('Could not extract asset ID from URL');
    }
    const assetId = assetIdMatch[1];
    
    // Get signed URL through the API
    const query = `query {
      assets(ids: [${assetId}]) {
        url
        public_url
      }
    }`;

    console.log('Querying Monday.com API for signed URL...');
    const result = await mondaySdk.api(query);
    console.log('API response:', result);

    if (!result.data?.assets?.[0]?.url) {
      throw new Error('Failed to get signed URL from Monday.com API');
    }

    const signedUrl = result.data.assets[0].url;
    console.log('Got signed URL:', signedUrl);

    // Try downloading with the signed URL
    console.log('Attempting download with signed URL...');
    const signedResponse = await fetch(signedUrl, {
      headers: {
        'Accept': 'image/*'
      }
    });

    console.log('Signed URL download response:', {
      status: signedResponse.status,
      statusText: signedResponse.statusText,
      headers: Object.fromEntries(signedResponse.headers.entries())
    });

    if (!signedResponse.ok) {
      throw new Error(`Failed to download with signed URL: ${signedResponse.status} ${signedResponse.statusText}`);
    }

    // Validate content type before returning
    const contentType = validateContentType(signedResponse.headers.get('content-type'));
    console.log('Valid content type received from signed URL:', contentType);
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