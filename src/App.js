import React, { useEffect, useState } from 'react';
import './App.css';
import LoadingIndicator from './LoadingIndicator';

function App() {
  const [userRole, setUserRole] = useState(null);
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
  const [cropPosition, setCropPosition] = useState('center'); // 'center', 'top', 'bottom'
  const dataFetchedRef = React.useRef({});
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [resizing, setResizing] = useState(false);

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

  // All useEffect hooks at the top
  useEffect(() => {
    const monday = window.monday;
    if (!monday) {
      setError('Monday SDK not available');
      setLoading(false);
      return;
    }
    monday.get('context').then(res => {
      setUserRole(res.data?.user?.kind);
      setContext(res.data);
      setLoading(false);
    }).catch(() => {
      setError('Failed to fetch context from Monday.com');
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (userRole && userRole !== 'viewer' && context && context.boardId && context.itemId) {
      const contextKey = `${context.boardId}-${context.itemId}`;
      if (!dataFetchedRef.current[contextKey]) {
        dataFetchedRef.current[contextKey] = true;
        fetchItemData(context.boardId, context.itemId);
      }
    }
    // eslint-disable-next-line
  }, [userRole, context]);

  useEffect(() => {
    const timer = setTimeout(() => setInitialLoadComplete(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (context && itemData) {
      setLoading(false);
    }
  }, [context, itemData]);

  // Now do all conditional rendering below
  if (userRole === 'viewer') {
    return (
      <div className="App">
        <div className="error">
          <h3>Access Denied</h3>
          <p>You cannot use this as a viewer please contact your system admin</p>
        </div>
      </div>
    );
  }

  if (userRole === null || loading || !initialLoadComplete) {
    return (
      <div className="App">
        <div className="loading">
          <div>Loading Image Resizer...</div>
          <div className="loading-bar">
            <div className="loading-bar-fill"></div>
          </div>
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
        setError('Please add two file columns to your board - one for original images and one for resized images.');
        setItemData(null);
        return;
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
      throw err;
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
        throw new Error('No source files found - please add images to the selected source column');
      }

      const fileValue = JSON.parse(sourceColumn.value);
      console.log('File value:', fileValue);
      
      const files = fileValue.files || [];
      console.log('Files to process:', files);
      
      if (files.length === 0) {
        throw new Error('No files found in source column');
      }

      // Filter for image files only
      const imageFiles = files.filter(file => isImageFile(file));
      if (imageFiles.length === 0) {
        throw new Error('No valid image files found - please add valid image files (JPEG, PNG, GIF, BMP, or WebP)');
      }

      setResizing(true);
      // Process each image file
      for (const file of imageFiles) {
        // Get the file URL
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
          console.error('No asset found with ID:', file.assetId);
          continue;
        }

        const asset = response.data.assets[0];
        if (!asset.url && !asset.public_url) {
          console.error('No URL available for asset:', file.assetId);
          continue;
        }

        // Prefer public_url if available, fall back to url
        const fileUrl = asset.public_url || asset.url;
        console.log('Selected URL for download:', fileUrl);
        
        if (!fileUrl) {
          console.error('Failed to get file URL for:', file.name);
          continue;
        }
        
        // Call our server endpoint to resize the image
        console.log('Sending resize request to server for:', file.name);
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
            padColor,
            cropPosition
          })
        });

        if (!resizeResponse.ok) {
          const errorData = await resizeResponse.json();
          console.error('Resize error response for', file.name, ':', errorData);
          continue;
        }

        // Get image metadata from headers
        const imageWidth = resizeResponse.headers.get('X-Image-Width');
        const imageHeight = resizeResponse.headers.get('X-Image-Height');
        const originalSize = resizeResponse.headers.get('X-Original-Size');
        const contentType = resizeResponse.headers.get('Content-Type');

        console.log('Got resize result for', file.name, ':', {
          width: imageWidth,
          height: imageHeight,
          originalSize: originalSize,
          contentLength: resizeResponse.headers.get('Content-Length'),
          contentType: contentType
        });

        // Get binary data directly with proper content type
        const imageBlob = await resizeResponse.blob();
        console.log('Received image blob for', file.name, ':', {
          size: imageBlob.size,
          type: imageBlob.type
        });
        
        // Generate a more descriptive filename that includes original name
        const originalName = file.name.toLowerCase();
        const extension = originalName.substring(originalName.lastIndexOf('.') + 1);
        const baseName = originalName.substring(0, originalName.lastIndexOf('.'));
        const dimensionsText = resizeMode === 'square' ? `${width}px_${squareMode}_${cropPosition}` : `${width}x${height}`;
        const newFileName = `${baseName}_${dimensionsText}.${extension}`;

        try {
          // Create a File object from the blob
          const file = new File([imageBlob], newFileName, { type: 'image/jpeg' });
          
          // Upload the file to Monday.com
          const uploadMutation = `mutation($file: File!) {
            add_file_to_column(item_id: ${context.itemId}, column_id: "${targetColumnId}", file: $file) {
              id
            }
          }`;

          console.log('Attempting to upload file:', {
            fileName: newFileName,
            fileSize: imageBlob.size,
            fileType: imageBlob.type,
            itemId: context.itemId,
            columnId: targetColumnId
          });

          const result = await monday.api(uploadMutation, { variables: { file } });
          console.log('File upload response for', newFileName, ':', result);

          if (!result.data?.add_file_to_column?.id) {
            console.error('Failed to upload file:', {
              fileName: newFileName,
              response: result,
              error: result.errors
            });
            throw new Error(`Failed to upload file: ${result.errors?.[0]?.message || 'Unknown error'}`);
          }
        } catch (err) {
          console.error('Error during file upload for', newFileName, ':', err);
        }
      }

      // Show success message after all files are processed
      setSuccessMessage('Successfully Resized!');
      setShowSuccess(true);
      setTimeout(() => {
        setShowSuccess(false);
        setSuccessMessage('');
      }, 3000);
      await fetchItemData(context.boardId, context.itemId);
      setError(null);

      // Track first value created event for Monday.com
      if (window.monday && window.monday.execute) {
        window.monday.execute('valueCreatedForUser');
      }
      console.clear();

    } catch (err) {
      console.error("Error during image resize:", err);
      setError('Failed to resize images: ' + err.message);
    } finally {
      setResizing(false);
    }
  };

  // Show loading or not ready state if context or itemData is not loaded
  if (!itemData) {
    return (
      <div className="App">
        <div className="loading">
          <div>Loading Image Resizer...</div>
        </div>
      </div>
    );
  }

  // Show a success message after resizing
  if (showSuccess) {
    return (
      <div className="App">
        <div className="success-message">
          <div className="success-icon">✓</div>
          <div className="success-text">{successMessage}</div>
        </div>
      </div>
    );
  }

  // Show spinner overlay during resizing
  if (resizing) {
    const message = `Resizing Image${itemData && itemData.item && itemData.item.column_values && itemData.item.column_values.find(cv => cv.column.id === sourceColumnId) ? (() => { try { const files = JSON.parse(itemData.item.column_values.find(cv => cv.column.id === sourceColumnId).value).files || []; return files.length > 1 ? 's' : ''; } catch { return ''; } })() : ''}...`;
    return <LoadingIndicator message={message} />;
  }

  return (
    <div className="App">
      <header className="App-header">
        <h1>Easy Image Resizer</h1>
        <p>Transform your images effortlessly - square or custom dimensions in seconds</p>
      </header>
      <main className="App-main">
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
                <option value="">Select source column{'     '}</option>
                {itemData && itemData.fileColumns.map(col => (
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
                <option value="">Select target column{'     '}</option>
                {itemData && itemData.fileColumns
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
                <option value="custom">Custom Size{'     '}</option>
                <option value="square">Square (Same width & height){'     '}</option>
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
                  <option value="crop">Crop to Square{'     '}</option>
                  <option value="pad">Pad to Square{'     '}</option>
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
            {resizeMode === 'square' && squareMode === 'crop' && (
              <div className="mode-input-group">
                <label htmlFor="crop-position">Crop Position</label>
                <select
                  id="crop-position"
                  value={cropPosition}
                  onChange={(e) => setCropPosition(e.target.value)}
                  className="crop-position-select"
                >
                  <option value="center">Center</option>
                  <option value="top">Top{'     '}</option>
                  <option value="bottom">Bottom{'     '}</option>
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
