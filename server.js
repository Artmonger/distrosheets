const express = require('express');
const path = require('path');
const cors = require('cors');
const fetch = require('node-fetch');
const sharp = require('sharp');
const mondaySdk = require('monday-sdk-js')();
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');
const os = require('os');
const stream = require('stream');
const { promisify } = require('util');
const pipeline = promisify(stream.pipeline);

// Initialize Monday SDK with better error handling
const initializeMondaySdk = (token) => {
  if (token) {
    mondaySdk.setToken(token);
  }
  return mondaySdk;
};

const app = express();
const PORT = process.env.PORT || 3001;

// Configure multer with strict limits
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 1
  }
});

// Increase the request size limit for express
app.use(express.json({ limit: '5mb' }));
app.use(express.raw({ limit: '5mb' }));

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
    // First try to download directly from the provided URL
    console.log('Attempting direct download...');
    let response = await fetch(fileUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'monday-api-token': token,
        'Accept': '*/*'
      }
    });

    // If direct download fails, try without auth headers
    if (!response.ok) {
      console.log('Direct download failed, trying without auth headers...');
      response = await fetch(fileUrl);
    }

    if (!response.ok) {
      console.error('Download failed:', {
        status: response.status,
        statusText: response.statusText
      });
      throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
    }

    console.log('Download successful:', {
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type')
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
    if (buffer.byteLength === 0) {
      throw new Error('Downloaded file is empty');
    }

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
    
    // Validate required parameters
    if (!fileUrl || !width || !token) {
      console.error('Missing parameters:', { 
        hasFileUrl: !!fileUrl, 
        hasWidth: !!width, 
        hasToken: !!token 
      });
      return res.status(400).json({ 
        error: 'Missing required parameters',
        details: {
          fileUrl: !fileUrl ? 'Missing file URL' : null,
          width: !width ? 'Missing width' : null,
          token: !token ? 'Missing token' : null
        }
      });
    }

    // Validate width is a reasonable number
    const parsedWidth = parseInt(width);
    if (isNaN(parsedWidth) || parsedWidth < 1 || parsedWidth > 5000) {
      return res.status(400).json({ 
        error: 'Invalid width parameter',
        details: 'Width must be a number between 1 and 5000'
      });
    }

    console.log('Downloading image from:', fileUrl);
    
    // Download the image using our helper function
    let response;
    try {
      response = await downloadFileFromMonday(fileUrl, token);
    } catch (downloadError) {
      console.error('Error downloading file:', downloadError);
      return res.status(502).json({ 
        error: 'Failed to download image from Monday.com',
        details: downloadError.message
      });
    }

    const contentType = response.headers.get('content-type');
    console.log('Downloaded file content type:', contentType);
    
    let buffer;
    try {
      buffer = await response.arrayBuffer();
      console.log('Downloaded image, size:', buffer.length, 'bytes');

      if (buffer.length === 0) {
        throw new Error('Downloaded file is empty');
      }
    } catch (bufferError) {
      console.error('Error reading file buffer:', bufferError);
      return res.status(502).json({ 
        error: 'Failed to read image data',
        details: bufferError.message
      });
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
      return res.status(400).json({ 
        error: 'Invalid image file',
        details: err.message
      });
    }

    // Resize the image
    console.log('Resizing image to width:', parsedWidth);
    let resizedBuffer;
    try {
      resizedBuffer = await sharp(Buffer.from(buffer), {
        failOnError: true
      })
      .resize(parsedWidth, null, { 
        fit: 'contain',
        withoutEnlargement: true
      })
      .toFormat('jpeg', {
        quality: 85,
        chromaSubsampling: '4:4:4'
      })
      .toBuffer();

      console.log('Resized image, new size:', resizedBuffer.length, 'bytes');
      
      // Convert to base64
      const base64Image = resizedBuffer.toString('base64');
      console.log('Converted to base64, length:', base64Image.length);

      // Return base64 data and content type
      res.json({
        data: base64Image,
        contentType: 'image/jpeg',
        size: resizedBuffer.length
      });

    } catch (resizeError) {
      console.error('Error resizing image:', resizeError);
      return res.status(500).json({ 
        error: 'Failed to resize image',
        details: resizeError.message
      });
    }
  } catch (error) {
    console.error('Error processing image:', error);
    res.status(500).json({ 
      error: 'Failed to process image',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Simple health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/proxy-upload', express.raw({ type: 'multipart/form-data', limit: '5mb' }), async (req, res) => {
  try {
    console.log('Starting file upload process');
    const token = req.headers['authorization'];
    
    if (!token) {
      console.log('Missing token in request');
      return res.status(400).json({ error: 'Missing token' });
    }

    // Create a readable stream from the request body
    const readable = new stream.Readable();
    readable._read = () => {}; // Required but noop
    readable.push(req.body);
    readable.push(null);

    // Upload directly to Monday.com
    console.log('Uploading to Monday.com');
    const uploadResponse = await fetch('https://files.monday.com/upload', {
      method: 'POST',
      headers: {
        'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
        'Content-Type': 'multipart/form-data'
      },
      body: readable,
      timeout: 10000 // 10 second timeout
    });

    console.log('Monday.com response status:', uploadResponse.status);
    const responseText = await uploadResponse.text();
    console.log('Monday.com response text:', responseText);

    if (!uploadResponse.ok) {
      return res.status(uploadResponse.status).json({
        error: 'Monday.com upload failed',
        details: responseText
      });
    }

    try {
      const result = JSON.parse(responseText);
      console.log('Successfully parsed response');
      res.json(result);
    } catch (parseError) {
      console.error('Failed to parse Monday.com response:', parseError);
      res.status(500).json({
        error: 'Invalid response from Monday.com',
        details: responseText
      });
    }
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      error: 'Server error',
      message: error.message,
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