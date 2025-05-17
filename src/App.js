import React, { useEffect, useState } from 'react';
import mondaySdk from 'monday-sdk-js';
import './App.css';

// Helper function to check if a file is an image
const isImageFile = (file) => {
  const imageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp'];
  return file && file.type && imageTypes.includes(file.type.toLowerCase());
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

    // Get the context
    const context = await mondayInstance.get('context');
    const itemId = context.data?.itemId;
    
    if (!itemId) {
      throw new Error('No item ID available in context');
    }

    // Query the item's column values to get the file
    const query = `query {
      items (ids: [${itemId}]) {
        column_values {
          id
          type
          value
          text
        }
      }
    }`;

    const response = await mondayInstance.api(query);
    
    if (!response.data?.items?.[0]) {
      throw new Error('Failed to fetch item data');
    }

    // Find the file column value that contains our asset
    const columnValues = response.data.items[0].column_values || [];
    let foundFile = null;

    for (const column of columnValues) {
      if (column.type === 'file' && column.value) {
        try {
          const value = JSON.parse(column.value);
          const files = value.files || [];
          foundFile = files.find(f => f.assetId === assetId);
          if (foundFile) {
            return foundFile.url;
          }
        } catch (err) {
          console.warn('Parse error:', err);
        }
      }
    }

    throw new Error('Asset not found in any column');
  } catch (err) {
    console.error('Error getting file URL:', err);
    throw err;
  }
};

function App() {
  const [context, setContext] = useState(null);
  const [itemData, setItemData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [monday, setMonday] = useState(null);

  useEffect(() => {
    // Initialize Monday SDK
    const initMondaySdk = async () => {
      try {
        const mondayInstance = mondaySdk();
        setMonday(mondayInstance);

        // Get context
        const contextRes = await mondayInstance.get("context");
        if (!contextRes.data) {
          throw new Error('No context data received');
        }
        console.log('Context data received:', contextRes.data);
        setContext(contextRes.data);

        // If we have both boardId and itemId, fetch the item data
        if (contextRes.data.boardId && contextRes.data.itemId) {
          await fetchItemData(contextRes.data.itemId, contextRes.data.boardId, mondayInstance);
        }

        setLoading(false);
      } catch (err) {
        console.error("Initialization error:", err);
        setError('Failed to initialize: ' + err.message);
        setLoading(false);
      }
    };

    initMondaySdk();
  }, []);

  const fetchItemData = async (itemId, boardId, mondayInstance) => {
    try {
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

      const columnsResponse = await mondayInstance.api(columnsQuery);
      console.log("All board columns:", columnsResponse.data?.boards?.[0]?.columns);

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

      const itemResponse = await mondayInstance.api(itemQuery);
      console.log("Item column values:", itemResponse.data?.items?.[0]?.column_values);

      if (!itemResponse.data?.items?.[0]) {
        throw new Error('Failed to fetch item data');
      }

      // Find the status and file columns
      const columns = columnsResponse.data.boards[0].columns;
      const statusColumn = columns.find(col => col.type === 'status');
      const fileColumns = columns.filter(col => col.type === 'file');
      
      console.log('Status column:', statusColumn);
      console.log('File columns:', fileColumns);

      setItemData({
        item: itemResponse.data.items[0],
        columns: columnsResponse.data.boards[0].columns,
        statusColumnId: statusColumn?.id,
        sourceFileColumnId: fileColumns[0]?.id,
        targetFileColumnId: fileColumns[1]?.id
      });

      // Subscribe to item changes
      await mondayInstance.listen(['item_updated'], res => {
        console.log('Item updated event:', res.data);
        
        // Extract the column ID and value
        const columnId = res.data.value.column_id;
        const value = res.data.value.value;
        
        console.log('Column changed:', columnId, 'New value:', value);
        
        // Check if it's the status column
        if (columnId === statusColumn?.id) {
          try {
            const statusValue = JSON.parse(value);
            console.log('Parsed status value:', statusValue);
            
            if (statusValue.label?.toLowerCase() === 'resize') {
              console.log('Status changed to Resize - starting image processing');
              handleImageResize();
            }
          } catch (err) {
            console.error('Error parsing status value:', err);
          }
        }
      });

      setError(null);
    } catch (err) {
      console.error("Error fetching data:", err);
      throw err;
    }
  };

  const handleImageResize = async () => {
    try {
      setLoading(true);
      console.log('Starting image resize process');
      console.log('Current item data:', itemData);
      
      // Find the source file column using the stored ID
      const sourceColumn = itemData.item.column_values.find(cv => cv.column.id === itemData.sourceFileColumnId);
      console.log('Source column:', sourceColumn);
      
      if (!sourceColumn?.value) {
        throw new Error('No source file found');
      }

      const fileValue = JSON.parse(sourceColumn.value);
      console.log('File value:', fileValue);
      
      const file = fileValue.files[0];
      console.log('File to process:', file);
      
      if (!file) {
        throw new Error('No file found in source column');
      }
      
      if (!isImageFile(file)) {
        throw new Error('Source file is not an image');
      }

      // Get the file URL
      console.log('Getting file URL for asset:', file.assetId);
      const fileUrl = await getFileUrl(monday, file.assetId, file.name);
      console.log('Got file URL:', fileUrl);
      
      // Call our server endpoint to resize the image
      console.log('Sending resize request to server');
      const resizeResponse = await fetch('/resize-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileUrl,
          width: 800 // Desired width in pixels
        })
      });

      if (!resizeResponse.ok) {
        const errorText = await resizeResponse.text();
        throw new Error(`Failed to resize image: ${errorText}`);
      }

      // Get the resized image as a blob
      const resizedBlob = await resizeResponse.blob();
      console.log('Got resized image blob:', resizedBlob.size, 'bytes');
      
      // Create a File object from the blob
      const resizedFile = new File([resizedBlob], 
        file.name.replace(/\.[^/.]+$/, '') + '_resized.jpg', 
        { type: 'image/jpeg' }
      );
      console.log('Created resized file:', resizedFile);

      // Create form data for the upload
      const formData = new FormData();
      formData.append('query', `mutation($file: File!) {
        add_file_to_column(
          item_id: ${context.itemId},
          column_id: "${itemData.targetFileColumnId}",
          file: $file
        ) {
          id
        }
      }`);
      formData.append('variables', JSON.stringify({ file: null }));
      formData.append('map', JSON.stringify({ "0": ["variables.file"] }));
      formData.append('0', resizedFile);

      // Upload the resized image
      console.log('Uploading resized file to Monday.com');
      const uploadResponse = await fetch('https://api.monday.com/v2/file', {
        method: 'POST',
        headers: {
          'Authorization': await monday.get('sessionToken').then(res => res.data)
        },
        body: formData
      });

      const uploadResult = await uploadResponse.json();
      console.log("Upload response:", uploadResult);

      if (uploadResult.data?.add_file_to_column?.id) {
        console.log('Successfully uploaded resized image');
        await fetchItemData(context.itemId, context.boardId, monday);
        setError(null);
      } else {
        throw new Error('Failed to upload resized image: ' + JSON.stringify(uploadResult.errors || uploadResult));
      }
    } catch (err) {
      console.error("Error during image resize:", err);
      setError('Failed to resize image: ' + err.message);
    } finally {
      setLoading(false);
    }
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
        await fetchItemData(context.itemId, context.boardId, monday);
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
        <div className="loading">Loading...</div>
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
        <h1>File Copy</h1>
        <p>Copy files between columns for this item</p>
      </header>
      <main className="App-main">
        <div className="column-values">
          {itemData.item.column_values
            .filter(col => fileColumns.some(fc => fc.id === col.column.id))
            .map(col => (
              <div key={col.column.id} className="column-value">
                <h4>{col.column.title}</h4>
                {col.value ? (
                  <>
                    <p className="file-name">{JSON.parse(col.value).name}</p>
                    <div className="transfer-buttons">
                      {fileColumns
                        .filter(targetCol => targetCol.id !== col.column.id)
                        .map(targetCol => (
                          <button
                            key={targetCol.id}
                            onClick={() => handleFileTransfer(
                              col.column.id,
                              targetCol.id
                            )}
                          >
                            Copy to {targetCol.title}
                          </button>
                        ))}
                    </div>
                  </>
                ) : (
                  <p className="no-file">No file</p>
                )}
              </div>
            ))}
        </div>
      </main>
    </div>
  );
}

export default App;
