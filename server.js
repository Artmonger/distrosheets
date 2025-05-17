const express = require('express');
const path = require('path');
const cors = require('cors');
const fetch = require('node-fetch');
const sharp = require('sharp');
const mondaySdk = require('monday-sdk-js')();
const multer = require('multer');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 3001;

// Configure multer for handling file uploads
const upload = multer({ storage: multer.memoryStorage() });

// CORS configuration
app.use(cors({
  origin: [
    'https://monday-img-app-aaca18d8516b.herokuapp.com',
    'http://localhost:3000',
    'http://localhost:3001',
    'https://artmonger.monday.com',
    'https://*.monday.com',
    'https://monday.com',
    'https://*.s3.amazonaws.com'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'monday-api-token', 'Accept', 'Content-Length'],
  exposedHeaders: ['Content-Type', 'Authorization', 'Content-Length', 'Cache-Control']
}));

// Parse JSON bodies with increased limit for large files
app.use(express.json({ limit: '50mb' }));

// Parse raw body for file uploads
app.use(express.raw({ type: 'multipart/form-data', limit: '50mb' }));

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

// New proxy endpoint for file uploads to Monday.com
app.post('/proxy-upload', upload.single('file'), async (req, res) => {
  try {
    const token = req.headers['authorization'];
    
    if (!token) {
      console.error('Missing token in headers:', req.headers);
      return res.status(400).json({ error: 'Missing token' });
    }

    if (!req.file) {
      console.error('No file received');
      return res.status(400).json({ error: 'No file received' });
    }

    console.log('Proxying file upload to Monday.com with token:', token ? 'present' : 'missing');
    
    // Create form data for Monday.com upload
    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });

    // Forward the file upload to Monday.com
    const uploadResponse = await fetch('https://files.monday.com/upload', {
      method: 'POST',
      headers: {
        'Authorization': token,
        ...form.getHeaders()
      },
      body: form
    });

    if (!uploadResponse.ok) {
      console.error('Upload failed:', {
        status: uploadResponse.status,
        statusText: uploadResponse.statusText,
        headers: uploadResponse.headers.raw()
      });
      
      let errorText;
      try {
        errorText = await uploadResponse.text();
        console.error('Error response body:', errorText);
      } catch (e) {
        console.error('Failed to read error response:', e);
        errorText = 'Unable to read error details';
      }

      return res.status(uploadResponse.status).json({ 
        error: 'Failed to upload file to Monday.com',
        details: errorText,
        status: uploadResponse.status
      });
    }

    const result = await uploadResponse.json();
    console.log('Upload successful:', result);
    res.json(result);
  } catch (error) {
    console.error('Error proxying file upload:', error);
    res.status(500).json({ 
      error: 'Failed to upload file',
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