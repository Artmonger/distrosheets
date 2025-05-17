import React, { useEffect, useState } from 'react';
import mondaySdk from 'monday-sdk-js';
import './App.css';

// Initialize Monday SDK
const monday = mondaySdk();

// Ensure SDK is initialized before use
const initializeMondaySdk = async () => {
  return new Promise((resolve, reject) => {
    try {
      // Check if window.mondaySDK is available
      if (window.mondaySDK) {
        resolve(monday);
        return;
      }

      // If not available, wait for it
      const checkInterval = setInterval(() => {
        if (window.mondaySDK) {
          clearInterval(checkInterval);
          resolve(monday);
        }
      }, 100);

      // Timeout after 10 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error('Monday SDK initialization timeout'));
      }, 10000);
    } catch (err) {
      reject(err);
    }
  });
};

// Helper function to check if a file is an image
const isImageFile = (file) => {
  // Check if the file has the isImage property from Monday.com
  if (file.isImage === 'true') {
    return true;
  }

  // Fallback check for file name extension
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
  const fileName = file.name.toLowerCase();
  return imageExtensions.some(ext => fileName.endsWith(ext));
};

// Helper function to get file URL from Monday.com
const getFileUrl = async (mondayInstance, assetId, fileName) => {
  try {
    // Get the session token for authentication
    const tokenResponse = await mondayInstance.get('sessionToken');
    const token = tokenResponse.data;
    
    if (!token) {
      throw new Error('No session token available');
    }

    // Get a direct download URL using Monday.com's API
    const query = `query {
      assets(ids: [${assetId}]) {
        url
        public_url
        name
        id
      }
    }`;

    console.log('Querying for asset URL:', { assetId, fileName });
    const response = await mondayInstance.api(query);
    console.log('Asset URL response:', JSON.stringify(response, null, 2));

    if (!response.data?.assets?.length) {
      throw new Error('No asset found with ID: ' + assetId);
    }

    const asset = response.data.assets[0];
    if (!asset.url && !asset.public_url) {
      throw new Error('No URL available for asset: ' + assetId);
    }

    // Prefer public_url if available, fall back to url
    const fileUrl = asset.public_url || asset.url;
    console.log('Selected URL for download:', fileUrl);
    
    // Return both URL and token for later use
    return {
      url: fileUrl,
      token: token
    };

  } catch (err) {
    console.error('Error getting file URL:', err);
    throw new Error(`Failed to get file URL: ${err.message}`);
  }
};

function App() {
  const [context, setContext] = useState(null);
  const [itemData, setItemData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  const [sdkReady, setSdkReady] = useState(false);

  useEffect(() => {
    // Initialize Monday SDK
    const initMondaySdk = async () => {
      try {
        // Set up context listener
        monday.listen('context', (res) => {
          if (res.data) {
            console.log('Context updated:', res.data);
            setContext(res.data);
            if (res.data.boardId && res.data.itemId) {
              fetchItemData(res.data.boardId, res.data.itemId);
            }
          }
        });

        // Get initial context
        const contextRes = await monday.get('context');
        console.log('Initial context:', contextRes);
        
        if (contextRes.data) {
          setContext(contextRes.data);
          if (contextRes.data.boardId && contextRes.data.itemId) {
            await fetchItemData(contextRes.data.boardId, contextRes.data.itemId);
          }
        }

        setLoading(false);
      } catch (err) {
        console.error("Initialization error:", err);
        setError(err.message);
        setLoading(false);
      }
    };

    initMondaySdk();

    // Cleanup
    return () => {
      monday.removeEventListener('context');
    };
  }, []);

  // Prevent any API calls if SDK is not ready
  const ensureSdkReady = async (callback) => {
    if (!sdkReady) {
      setError('Monday SDK is not ready yet. Please wait...');
      return false;
    }
    return callback();
  };

  const fetchItemData = async (boardId, itemId) => {
    if (!boardId || !itemId) {
      console.log('Missing boardId or itemId:', { boardId, itemId });
      return;
    }

    try {
      setStatus('Fetching board data...');
      // Get the board columns
      const columnsQuery = `query {
        boards (ids: ${boardId}) {
          columns {
            id
            title
            type
            settings_str
          }
        }
      }`;

      const columnsResponse = await monday.api(columnsQuery);
      console.log("Board columns response:", columnsResponse);

      if (!columnsResponse.data?.boards?.[0]) {
        throw new Error('Failed to fetch board columns');
      }

      // Get the item data
      const itemQuery = `query {
        items (ids: ${itemId}) {
          id
          name
          column_values {
            id
            column {
              id
              title
              type
            }
            value
            text
          }
        }
      }`;

      const itemResponse = await monday.api(itemQuery);
      console.log("Item data response:", itemResponse);

      if (!itemResponse.data?.items?.[0]) {
        throw new Error('Failed to fetch item data');
      }

      // Find the file columns
      const columns = columnsResponse.data.boards[0].columns;
      const fileColumns = columns.filter(col => col.type === 'file');
      
      if (fileColumns.length < 2) {
        throw new Error('Please add two file columns to your board - one for original images and one for resized images.');
      }

      setItemData({
        item: itemResponse.data.items[0],
        columns: columns,
        sourceFileColumnId: fileColumns[0]?.id,
        targetFileColumnId: fileColumns[1]?.id
      });

      setStatus('Ready to resize images');
      setError(null);
    } catch (err) {
      console.error("Error fetching data:", err);
      setError(err.message);
    }
  };

  const handleImageResize = async () => {
    return ensureSdkReady(async () => {
      try {
        setLoading(true);
        setStatus('Starting image resize process...');
        console.log('Current item data:', itemData);
        
        // Get the session token for authentication
        const tokenResponse = await monday.get('sessionToken');
        const token = tokenResponse.data;
        console.log('Got session token:', token ? 'yes' : 'no');
        
        if (!token) {
          throw new Error('No session token available');
        }
        
        // Find the source file column using the stored ID
        const sourceColumn = itemData.item.column_values.find(cv => cv.column.id === itemData.sourceFileColumnId);
        console.log('Source column:', sourceColumn);
        
        if (!sourceColumn?.value) {
          throw new Error('No source file found - please add an image to the first file column');
        }

        const fileValue = JSON.parse(sourceColumn.value);
        console.log('File value:', fileValue);
        
        const file = fileValue.files[0];
        console.log('File to process:', file);
        
        if (!file) {
          throw new Error('No file found in source column');
        }
        
        if (!isImageFile(file)) {
          throw new Error('Source file is not an image - please add a valid image file (JPEG, PNG, GIF, BMP, or WebP)');
        }

        // Get the file URL
        setStatus('Getting file URL...');
        console.log('Getting file URL for asset:', file.assetId);
        const { url } = await getFileUrl(monday, file.assetId, file.name);
        
        if (!url) {
          throw new Error('Failed to get file URL');
        }
        
        console.log('Got file URL:', url);
        
        // Call our server endpoint to resize the image
        setStatus('Resizing image...');
        console.log('Sending resize request to server');
        const resizeResponse = await fetch('/resize-image', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            fileUrl: url,
            token: token,
            width: '800'
          })
        });

        if (!resizeResponse.ok) {
          const errorData = await resizeResponse.json();
          console.error('Resize error response:', errorData);
          throw new Error(`Failed to resize image: ${JSON.stringify(errorData)}`);
        }

        const resizeResult = await resizeResponse.json();
        console.log('Got resize result:', {
          contentType: resizeResult.contentType,
          size: resizeResult.size
        });

        // Create a file object from the base64 data
        const binaryData = atob(resizeResult.data);
        const bytes = new Uint8Array(binaryData.length);
        for (let i = 0; i < binaryData.length; i++) {
          bytes[i] = binaryData.charCodeAt(i);
        }
        
        const blob = new Blob([bytes], { type: resizeResult.contentType });
        const fileToUpload = new File([blob], 'resized_image.jpg', { type: resizeResult.contentType });

        const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

        if (blob.size > MAX_FILE_SIZE) {
          throw new Error(`File size exceeds limit of ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
        }

        // Create form data for file upload
        const formData = new FormData();
        formData.append('file', fileToUpload);

        // Upload to our proxy endpoint
        setStatus('Uploading resized image...');
        console.log('Starting upload to proxy endpoint');
        
        try {
          // First check server health
          const healthCheck = await fetch('/health');
          if (!healthCheck.ok) {
            throw new Error('Server is not responding');
          }

          // Now do the upload
          const uploadResponse = await fetch('/proxy-upload', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'multipart/form-data'
            },
            body: await fileToUpload.arrayBuffer()
          });

          console.log('Upload response status:', uploadResponse.status);
          const responseText = await uploadResponse.text();
          console.log('Upload response text:', responseText);

          if (!uploadResponse.ok) {
            throw new Error(`Upload failed (${uploadResponse.status}): ${responseText}`);
          }

          let uploadResult;
          try {
            uploadResult = JSON.parse(responseText);
            console.log('Parsed upload result:', uploadResult);
          } catch (err) {
            console.error('Failed to parse upload response:', err);
            throw new Error(`Invalid response from server: ${responseText}`);
          }

          if (!uploadResult.data || !uploadResult.data.id) {
            console.error('Invalid upload result:', uploadResult);
            throw new Error('Invalid upload response from Monday.com');
          }

          // Now create the mutation to link the file
          const mutation = `mutation {
            change_column_value(
              board_id: ${context.boardId}, 
              item_id: ${context.itemId}, 
              column_id: "${itemData.targetFileColumnId}", 
              value: ${JSON.stringify(JSON.stringify({
                files: [{
                  assetId: uploadResult.data.id,
                  name: fileToUpload.name
                }]
              }))}
            ) {
              id
            }
          }`;

          // Link the file to the column
          console.log('Linking file to column with mutation:', mutation);
          const linkResult = await monday.api(mutation);
          console.log("Link response:", linkResult);

          if (linkResult.data?.change_column_value?.id) {
            console.log('Successfully uploaded and linked resized image');
            setStatus('Successfully resized and uploaded image!');
            await fetchItemData(context.boardId, context.itemId);
            setError(null);
          } else {
            throw new Error('Failed to link file to column: ' + JSON.stringify(linkResult.errors || linkResult));
          }
        } catch (uploadError) {
          console.error('Upload error:', uploadError);
          throw new Error(`Upload failed: ${uploadError.message}`);
        }
      } catch (err) {
        console.error("Error during image resize:", err);
        setError('Failed to resize image: ' + err.message);
        setStatus('Error occurred while processing image');
      } finally {
        setLoading(false);
      }
    });
  };

  const handleFileTransfer = async (fromColumnId, toColumnId) => {
    if (!context?.boardId || !context?.itemId || !monday) {
      setError('Missing required data');
      return;
    }

    try {
      setLoading(true);
      
      // Get the current file value
      const fileValue = itemData.item.column_values.find(cv => cv.id === fromColumnId)?.value;
      if (!fileValue) {
        throw new Error('No file found in source column');
      }

      // Parse the file value
      const parsedValue = typeof fileValue === 'string' ? JSON.parse(fileValue) : fileValue;
      
      // Copy the file using Monday SDK
      const transferMutation = `mutation {
        change_column_value (
          board_id: ${context.boardId}
          item_id: ${context.itemId}
          column_id: "${toColumnId}"
          value: ${JSON.stringify(JSON.stringify(parsedValue))}
        ) {
          id
        }
      }`;

      console.log("Transfer mutation:", transferMutation);
      const transferResponse = await monday.api(transferMutation);
      console.log("Transfer response:", transferResponse);

      if (transferResponse.data?.change_column_value?.id) {
        await fetchItemData(context.boardId, context.itemId);
        setError(null);
      } else {
        throw new Error('Failed to copy file - no confirmation received');
      }
    } catch (err) {
      console.error("Error during file transfer:", err);
      setError('Failed to transfer file: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="App">
        <div className="loading">
          <h3>Loading...</h3>
          <p>{status}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="App">
        <div className="error">
          <h3>Error</h3>
          <p>{error}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  if (!context || !itemData) {
    return (
      <div className="App">
        <div className="error">
          <h3>Not Ready</h3>
          <p>Please run this app in a Monday.com item view</p>
        </div>
      </div>
    );
  }

  const fileColumns = itemData.columns.filter(col => col.type === 'file');

  if (fileColumns.length < 2) {
    return (
      <div className="App">
        <div className="error">
          <h3>Not Enough File Columns</h3>
          <p>Please add at least two file columns to your board to use this app.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="App">
      <header className="App-header">
        <h1>Image Resizer</h1>
        <p>Click the button below to resize your image to 800px width</p>
      </header>
      <main className="App-main">
        <div className="status-section">
          <h3>Current Status</h3>
          <p>{status || 'Ready to resize images'}</p>
          <button 
            onClick={handleImageResize}
            disabled={loading}
            className="resize-button"
          >
            {loading ? 'Processing...' : 'Resize Image'}
          </button>
        </div>
        <div className="instructions">
          <h3>How to use:</h3>
          <ol>
            <li>Add an image to the first file column</li>
            <li>Click the "Resize Image" button</li>
            <li>Wait for the image to be processed</li>
            <li>Check the second file column for the resized image</li>
          </ol>
        </div>
      </main>
    </div>
  );
}

export default App;
