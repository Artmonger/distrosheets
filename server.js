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
  console.log('File URL:', fileUrl);
  console.log('Token available:', !!token);
  
  try {
    // Extract asset ID from URL first
    const assetIdMatch = fileUrl.match(/resources\/(\d+)/);
    if (!assetIdMatch) {
      throw new Error('Could not extract asset ID from URL');
    }
    const assetId = assetIdMatch[1];
    console.log('Extracted asset ID:', assetId);
    
    // Initialize Monday SDK with token
    mondaySdk.setToken(token);
    
    // Get signed URL through the API first
    const query = `query {
      assets(ids: [${assetId}]) {
        url
        public_url
      }
    }`;

    console.log('Querying Monday.com API for URL...');
    const result = await mondaySdk.api(query);
    console.log('API response:', JSON.stringify(result, null, 2));

    if (!result.data?.assets?.[0]?.url && !result.data?.assets?.[0]?.public_url) {
      console.error('API response missing URL:', result);
      throw new Error('Failed to get URL from Monday.com API');
    }

    // Try public_url first, then fall back to url
    const downloadUrl = result.data.assets[0].public_url || result.data.assets[0].url;
    console.log('Got download URL:', downloadUrl);

    // Try downloading with the URL and token in Authorization header
    console.log('Attempting download with token in Authorization header...');
    const response = await fetch(downloadUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': '*/*',
        'monday-api-token': token
      }
    });

    if (!response.ok) {
      // If first attempt fails, try without Authorization header
      console.log('First download attempt failed, trying without Authorization header...');
      const retryResponse = await fetch(downloadUrl);
      if (!retryResponse.ok) {
        throw new Error(`Failed to download file: ${retryResponse.status} ${retryResponse.statusText}`);
      }
      response = retryResponse;
    }

    console.log('Download response:', {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries())
    });

    // Get content type, with fallback to extension-based inference
    let contentType = response.headers.get('content-type');
    if (!contentType || contentType === 'application/octet-stream') {
      const fileExtension = fileUrl.split('.').pop().toLowerCase();
      const mimeTypes = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'bmp': 'image/bmp'
      };
      
      if (mimeTypes[fileExtension]) {
        console.log('Inferred content type from extension:', mimeTypes[fileExtension]);
        contentType = mimeTypes[fileExtension];
      }
    }

    // Create a new response with the proper content type
    const buffer = await response.arrayBuffer();
    return new Response(buffer, {
      headers: {
        'content-type': contentType || 'application/octet-stream'
      }
    });

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
    console.log('Downloaded file content type:', contentType);
    
    const buffer = await response.arrayBuffer();
    console.log('Downloaded image, size:', buffer.length, 'bytes');

    if (buffer.length === 0) {
      throw new Error('Downloaded file is empty');
    }

    // Log first few bytes of buffer to check format
    console.log('First bytes of image:', Buffer.from(buffer).slice(0, 16));

    // Get image metadata and validate it's an image
    let metadata;
    try {
      metadata = await sharp(Buffer.from(buffer)).metadata();
      console.log('Image metadata:', metadata);

      if (!metadata.format) {
        throw new Error('Invalid image format');
      }
    } catch (err) {
      console.error('Error reading image metadata:', err);
      throw new Error('Invalid image file: ' + err.message);
    }

    // Resize the image
    console.log('Resizing image to width:', width);
    const resizedBuffer = await sharp(Buffer.from(buffer), {
      failOnError: true
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

    // Send the resized image back
    res.set('Content-Type', contentType || `image/${metadata.format}`);
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