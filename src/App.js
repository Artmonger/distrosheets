import React, { useEffect, useState } from 'react';
import './App.css';

function App() {
  const [context, setContext] = useState(null);
  const [itemData, setItemData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  const dataFetchedRef = React.useRef({});

  useEffect(() => {
    let mounted = true;
    const monday = window.monday;

    if (!monday) {
      setError('Monday SDK not available');
      setLoading(false);
      return;
    }

    const initializeApp = async () => {
      try {
        // Get initial context
        const contextRes = await monday.get('context');
        console.log('Initial context response:', contextRes);
        
        if (!mounted) return;

        if (contextRes.data) {
          const contextKey = `${contextRes.data.boardId}-${contextRes.data.itemId}`;
          if (!dataFetchedRef.current[contextKey]) {
            setContext(contextRes.data);
            if (contextRes.data.boardId && contextRes.data.itemId) {
              console.log('Valid initial context, fetching data...');
              dataFetchedRef.current[contextKey] = true;
              await fetchItemData(contextRes.data.boardId, contextRes.data.itemId);
            } else {
              console.log('Initial context missing boardId or itemId:', contextRes.data);
              setError('Please open this app in a board item view');
            }
          }
        } else {
          console.log('Empty initial context');
          setError('No context available. Please refresh the page.');
        }

        setLoading(false);
      } catch (err) {
        console.error("Initialization error:", err);
        if (mounted) {
          setError(err.message);
          setLoading(false);
        }
      }
    };

    // Set up context listener
    const unsubscribeContext = monday.listen('context', (res) => {
      console.log('Context event received:', res);
      if (!mounted) return;
      
      if (res.data) {
        const contextKey = `${res.data.boardId}-${res.data.itemId}`;
        if (!dataFetchedRef.current[contextKey]) {
          console.log('New context received, fetching data...');
          setContext(res.data);
          if (res.data.boardId && res.data.itemId) {
            dataFetchedRef.current[contextKey] = true;
            fetchItemData(res.data.boardId, res.data.itemId);
          }
        } else {
          console.log('Data already fetched for this context');
        }
      }
    });

    initializeApp();

    return () => {
      mounted = false;
      unsubscribeContext();
    };
  }, []);

  const fetchItemData = async (boardId, itemId) => {
    const monday = window.monday;
    if (!boardId || !itemId || !monday) {
      console.log('Missing required data:', { boardId, itemId, hasMonday: !!monday });
      setError('Missing board or item information');
      return;
    }

    try {
      setStatus('Fetching board data...');
      console.log('Fetching board data for:', { boardId, itemId });
      
      // Get the board columns
      const columnsQuery = `query {
        boards (ids: ${boardId}) {
          id
          name
          columns {
            id
            title
            type
            settings_str
          }
        }
      }`;

      console.log('Executing columns query:', columnsQuery);
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
          board {
            id
          }
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

      console.log('Executing item query:', itemQuery);
      const itemResponse = await monday.api(itemQuery);
      console.log("Item data response:", itemResponse);

      if (!itemResponse.data?.items?.[0]) {
        throw new Error('Failed to fetch item data');
      }

      // Find the file columns
      const columns = columnsResponse.data.boards[0].columns;
      const fileColumns = columns.filter(col => col.type === 'file');
      console.log('Found file columns:', fileColumns);
      
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
    const monday = window.monday;
    if (!monday) {
      setError('Monday SDK not available');
      return;
    }

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
      
      const query = `query {
        assets(ids: [${file.assetId}]) {
          url
          public_url
          name
          id
        }
      }`;

      console.log('Querying for asset URL:', { assetId: file.assetId });
      const response = await monday.api(query);
      console.log('Asset URL response:', JSON.stringify(response, null, 2));

      if (!response.data?.assets?.length) {
        throw new Error('No asset found with ID: ' + file.assetId);
      }

      const asset = response.data.assets[0];
      if (!asset.url && !asset.public_url) {
        throw new Error('No URL available for asset: ' + file.assetId);
      }

      // Prefer public_url if available, fall back to url
      const fileUrl = asset.public_url || asset.url;
      console.log('Selected URL for download:', fileUrl);
      
      if (!fileUrl) {
        throw new Error('Failed to get file URL');
      }
      
      // Call our server endpoint to resize the image
      setStatus('Resizing image...');
      console.log('Sending resize request to server');
      const resizeResponse = await fetch('/resize-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          fileUrl: fileUrl,
          width: '800'
        })
      });

      if (!resizeResponse.ok) {
        const errorData = await resizeResponse.json();
        console.error('Resize error response:', errorData);
        throw new Error(`Failed to resize image: ${JSON.stringify(errorData)}`);
      }

      const resizeResult = await resizeResponse.json();
      console.log('Got resize result:', resizeResult);

      // Create a file object from the base64 data
      const binaryData = atob(resizeResult.data);
      const bytes = new Uint8Array(binaryData.length);
      for (let i = 0; i < binaryData.length; i++) {
        bytes[i] = binaryData.charCodeAt(i);
      }
      
      const blob = new Blob([bytes], { type: resizeResult.contentType });
      const fileToUpload = new File([blob], 'resized_image.jpg', { type: resizeResult.contentType });

      // Upload directly using Monday's SDK
      setStatus('Uploading resized image...');
      console.log('Starting upload via Monday SDK');

      // Create a new mutation for file upload
      const uploadMutation = `mutation($file: File!) {
        add_file_to_column(file: $file) {
          url
          id
        }
      }`;

      // Use the SDK's built-in file upload method
      const uploadResponse = await monday.api(uploadMutation, {
        variables: {
          file: fileToUpload
        }
      });

      console.log('Upload response:', uploadResponse);

      if (uploadResponse.errors) {
        throw new Error('Upload failed: ' + JSON.stringify(uploadResponse.errors));
      }

      if (!uploadResponse.data?.add_file_to_column?.url) {
        throw new Error('Invalid upload response: ' + JSON.stringify(uploadResponse));
      }

      // Now create the mutation to link the file
      const mutation = `mutation {
        change_column_value(
          board_id: ${context.boardId}, 
          item_id: ${context.itemId}, 
          column_id: "${itemData.targetFileColumnId}", 
          value: ${JSON.stringify(JSON.stringify({
            files: [{
              url: uploadResponse.data.add_file_to_column.url,
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

    } catch (err) {
      console.error("Error during image resize:", err);
      setError('Failed to resize image: ' + err.message);
      setStatus('Error occurred while processing image');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="App">
        <div className="loading">
          <div className="loading-spinner"></div>
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

export default App;
