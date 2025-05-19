import React, { useEffect, useState } from 'react';
import './App.css';

function App() {
  const [context, setContext] = useState(null);
  const [itemData, setItemData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(800);
  const [sourceColumnId, setSourceColumnId] = useState(null);
  const [targetColumnId, setTargetColumnId] = useState(null);
  const [resizeMode, setResizeMode] = useState('square'); // 'square' or 'custom'
  const [squareMode, setSquareMode] = useState('crop'); // 'crop' or 'pad'
  const [padColor, setPadColor] = useState('white'); // 'white' or 'transparent'
  const dataFetchedRef = React.useRef({});

  const handleWidthChange = (value) => {
    // Allow empty string for typing
    if (value === '') {
      setWidth('');
      return;
    }
    // Parse the value and ensure it's a positive number
    const numValue = parseInt(value);
    if (!isNaN(numValue)) {
      setWidth(Math.max(1, numValue));
      if (resizeMode === 'square') {
        setHeight(numValue);
      }
    }
  };

  const handleHeightChange = (value) => {
    // Allow empty string for typing
    if (value === '') {
      setHeight('');
      return;
    }
    // Parse the value and ensure it's a positive number
    const numValue = parseInt(value);
    if (!isNaN(numValue)) {
      setHeight(Math.max(1, numValue));
    }
  };

  const handleResizeModeChange = (mode) => {
    setResizeMode(mode);
    if (mode === 'square') {
      setHeight(width);
    }
  };

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
        fileColumns: fileColumns
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

    if (!sourceColumnId || !targetColumnId) {
      setError('Please select both source and target columns');
      return;
    }

    // Validate dimensions before processing
    const numWidth = parseInt(width);
    const numHeight = parseInt(height);
    if (!numWidth || numWidth < 1) {
      setError('Please enter a valid width (minimum 1 pixel)');
      return;
    }
    if (!numHeight || numHeight < 1) {
      setError('Please enter a valid height (minimum 1 pixel)');
      return;
    }

    try {
      setLoading(true);
      setStatus('Starting image processing...');
      console.log('Current item data:', itemData);
      console.log('Selected dimensions:', { width: numWidth, height: numHeight });
      console.log('Resize mode:', resizeMode);
      console.log('Square mode:', squareMode);
      console.log('Pad color:', padColor);
      console.log('Selected columns:', { source: sourceColumnId, target: targetColumnId });
      
      // Get the session token for authentication
      const tokenResponse = await monday.get('sessionToken');
      const token = tokenResponse.data;
      console.log('Got session token:', token ? 'yes' : 'no');
      
      if (!token) {
        throw new Error('No session token available');
      }
      
      // Find the source file column using the selected ID
      const sourceColumn = itemData.item.column_values.find(cv => cv.column.id === sourceColumnId);
      console.log('Source column:', sourceColumn);
      
      if (!sourceColumn?.value) {
        throw new Error('No source file found - please add an image to the selected source column');
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
          'Authorization': `Bearer ${token}`,
          'Accept': 'image/jpeg'
        },
        body: JSON.stringify({
          fileUrl: fileUrl,
          width: numWidth.toString(),
          height: numHeight.toString(),
          resizeMode,
          squareMode,
          padColor
        })
      });

      if (!resizeResponse.ok) {
        const errorData = await resizeResponse.json();
        console.error('Resize error response:', errorData);
        throw new Error(`Failed to resize image: ${JSON.stringify(errorData)}`);
      }

      // Get image metadata from headers
      const imageWidth = resizeResponse.headers.get('X-Image-Width');
      const imageHeight = resizeResponse.headers.get('X-Image-Height');
      const originalSize = resizeResponse.headers.get('X-Original-Size');
      const contentType = resizeResponse.headers.get('Content-Type');

      console.log('Got resize result:', {
        width: imageWidth,
        height: imageHeight,
        originalSize: originalSize,
        contentLength: resizeResponse.headers.get('Content-Length'),
        contentType: contentType
      });

      // Get binary data directly with proper content type
      const imageBlob = await resizeResponse.blob();
      console.log('Received image blob:', {
        size: imageBlob.size,
        type: imageBlob.type
      });
      
      // Generate a more descriptive filename that includes original name
      const originalName = file.name.toLowerCase();
      const extension = originalName.substring(originalName.lastIndexOf('.') + 1);
      const baseName = originalName.substring(0, originalName.lastIndexOf('.'));
      const dimensionsText = resizeMode === 'square' ? `${width}px_${squareMode}` : `${width}x${height}`;
      const newFileName = `${baseName}_${dimensionsText}.${extension}`;

      try {
        setStatus('Uploading resized image...');
        
        // Create a File object from the blob
        const file = new File([imageBlob], newFileName, { type: 'image/jpeg' });
        
        // First, upload the file to Monday.com
        const uploadMutation = `mutation($file: File!) {
          add_file_to_column(item_id: ${context.itemId}, column_id: "${targetColumnId}", file: $file) {
            id
          }
        }`;

        const result = await monday.api(uploadMutation, { variables: { file } });
        console.log('File upload response:', result);

        if (result.data?.add_file_to_column?.id) {
          console.log('Successfully uploaded resized image');
          setStatus('Successfully resized and uploaded image!');
          await fetchItemData(context.boardId, context.itemId);
          setError(null);
        } else {
          throw new Error('Failed to upload file');
        }

      } catch (err) {
        console.error('Error during file upload:', err);
        setError('Failed to upload file: ' + err.message);
        setStatus('Error occurred while uploading image');
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

  const fileColumns = itemData.fileColumns || [];

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
        <p>Resize your images with precision</p>
      </header>
      <main className="App-main">
        <div className="status-section">
          <h3>Current Status</h3>
          <p>{status || 'Ready to process images'}</p>
          <div className="resize-controls">
            <div className="control-inputs">
              <div className="column-select-group">
                <label htmlFor="source-column">Source Column</label>
                <select
                  id="source-column"
                  value={sourceColumnId || ''}
                  onChange={(e) => setSourceColumnId(e.target.value)}
                  className="column-select"
                >
                  <option value="">Select source column</option>
                  {fileColumns.map(col => (
                    <option key={col.id} value={col.id}>
                      {col.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="column-select-group">
                <label htmlFor="target-column">Target Column</label>
                <select
                  id="target-column"
                  value={targetColumnId || ''}
                  onChange={(e) => setTargetColumnId(e.target.value)}
                  className="column-select"
                  disabled={!sourceColumnId}
                >
                  <option value="">Select target column</option>
                  {fileColumns
                    .filter(col => col.id !== sourceColumnId)
                    .map(col => (
                      <option key={col.id} value={col.id}>
                        {col.title}
                      </option>
                    ))}
                </select>
              </div>
              <div className="mode-input-group">
                <label htmlFor="resize-mode">Resize Mode</label>
                <select
                  id="resize-mode"
                  value={resizeMode}
                  onChange={(e) => handleResizeModeChange(e.target.value)}
                  className="mode-select"
                >
                  <option value="square">Square (Same width & height)</option>
                  <option value="custom">Custom (Different width & height)</option>
                </select>
              </div>
              <div className="dimension-input-group">
                <label htmlFor="width">Width (px)</label>
                <input
                  id="width"
                  type="number"
                  min="1"
                  value={width}
                  onChange={(e) => handleWidthChange(e.target.value)}
                  className="dimension-input"
                />
              </div>
              {resizeMode === 'custom' && (
                <div className="dimension-input-group">
                  <label htmlFor="height">Height (px)</label>
                  <input
                    id="height"
                    type="number"
                    min="1"
                    value={height}
                    onChange={(e) => handleHeightChange(e.target.value)}
                    className="dimension-input"
                  />
                </div>
              )}
              {resizeMode === 'square' && (
                <div className="mode-input-group">
                  <label htmlFor="square-mode">Square Method</label>
                  <select
                    id="square-mode"
                    value={squareMode}
                    onChange={(e) => setSquareMode(e.target.value)}
                    className="mode-select"
                  >
                    <option value="crop">Crop to Square</option>
                    <option value="pad">Add Padding</option>
                  </select>
                </div>
              )}
              {resizeMode === 'square' && squareMode === 'pad' && (
                <div className="mode-input-group">
                  <label htmlFor="pad-color">Padding Color</label>
                  <select
                    id="pad-color"
                    value={padColor}
                    onChange={(e) => setPadColor(e.target.value)}
                    className="mode-select"
                  >
                    <option value="white">White</option>
                    <option value="transparent">Transparent</option>
                  </select>
                </div>
              )}
            </div>
            <button
              onClick={handleImageResize}
              disabled={loading || !sourceColumnId || !targetColumnId}
              className="resize-button"
            >
              {loading ? 'Processing...' : 'Resize Image'}
            </button>
          </div>
        </div>
        <div className="instructions">
          <h3>How to use:</h3>
          <ol>
            <li>Select the source column containing your original image</li>
            <li>Select the target column where the resized image will be saved</li>
            <li>Choose your resize mode:
              <ul>
                <li><strong>Square:</strong> Same width and height with cropping or padding options</li>
                <li><strong>Custom:</strong> Set different width and height values</li>
              </ul>
            </li>
            <li>Enter your desired dimensions</li>
            <li>Click the "Resize Image" button</li>
            <li>Check the target column for your resized image</li>
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
