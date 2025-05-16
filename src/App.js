import React, { useEffect, useState } from 'react';
import mondaySdk from 'monday-sdk-js';
import './App.css';

// Initialize Monday SDK
const monday = mondaySdk();

// Global state to track initialization
let vulcanInitialized = false;
let mondayInitialized = false;

// Initialize the application with proper sequencing
const initializeApp = async () => {
  // Create Vulcan placeholder immediately if not exists
  if (!window.vulcan) {
    window.vulcan = {
      initialized: false,
      init: function() {
        this.initialized = true;
        vulcanInitialized = true;
        window.dispatchEvent(new Event('vulcan-loaded'));
      }
    };
  }

  // Function to check if Monday.com context is ready
  const checkMondayContext = async () => {
    try {
      const context = await monday.get('context');
      if (context.data) {
        mondayInitialized = true;
        return context.data;
      }
      return null;
    } catch (err) {
      console.warn('Failed to get Monday context:', err);
      return null;
    }
  };

  // Wait for both Vulcan and Monday.com to be ready
  const waitForInit = async () => {
    const maxAttempts = 50;
    const retryInterval = 100; // ms
    
    for (let attempts = 0; attempts < maxAttempts; attempts++) {
      // Check Vulcan status
      if (!vulcanInitialized && window.vulcan?.initialized) {
        vulcanInitialized = true;
        console.log('Vulcan initialized');
      }
      
      // Check Monday status
      if (!mondayInitialized) {
        const context = await checkMondayContext();
        if (context) {
          mondayInitialized = true;
          console.log('Monday.com initialized');
        }
      }
      
      // Both are ready
      if (vulcanInitialized && mondayInitialized) {
        return { success: true, vulcanReady: true, mondayReady: true };
      }
      
      // Wait before next attempt
      await new Promise(r => setTimeout(r, retryInterval));
    }
    
    // Return current status after max attempts
    return {
      success: false,
      vulcanReady: vulcanInitialized,
      mondayReady: mondayInitialized,
      error: 'Initialization timeout'
    };
  };

  // Start initialization process
  const result = await waitForInit();
  console.log('Initialization result:', result);
  return result;
};

function App() {
  const [context, setContext] = useState(null);
  const [itemData, setItemData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sessionToken, setSessionToken] = useState(null);

  const initializeToken = async () => {
    try {
      // Get token from URL first
      const urlParams = new URLSearchParams(window.location.search);
      let token = urlParams.get('sessionToken');

      // If no token in URL, try Monday SDK
      if (!token) {
        const tokenResponse = await monday.get('sessionToken');
        token = tokenResponse.data;
      }

      if (!token) {
        throw new Error('No session token available');
      }

      // Clean and validate token
      token = token.replace(/^Bearer\s+/i, '');
      if (token.length < 10) {
        throw new Error('Invalid token format');
      }

      // Set token
      setSessionToken(token);
      monday.setToken(token);
      return token;
    } catch (err) {
      console.error('Token initialization failed:', err);
      setError('Failed to initialize session token: ' + err.message);
      return null;
    }
  };

  const fetchItemData = async (itemId, boardId, token) => {
    try {
      if (!token) {
        token = await initializeToken();
        if (!token) return;
      }

      console.log("Fetching item data for item:", itemId, "board:", boardId);
      
      // First, try to get the board columns
      const columnsQuery = `query {
        boards (ids: [${boardId}]) {
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

      const columnsResponse = await monday.api(columnsQuery);
      console.log("Columns Response:", columnsResponse);

      if (!columnsResponse.data?.boards?.[0]) {
        throw new Error('Failed to fetch board columns');
      }

      // Then, get the item data
      const itemQuery = `query {
        items (ids: [${itemId}]) {
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

      const itemResponse = await monday.api(itemQuery);
      console.log("Item Response:", itemResponse);

      if (!itemResponse.data?.items?.[0]) {
        throw new Error('Failed to fetch item data');
      }

      setItemData({
        item: itemResponse.data.items[0],
        columns: columnsResponse.data.boards[0].columns
      });
      setError(null);
      setLoading(false);
    } catch (err) {
      console.error("Error fetching data:", err);
      if (err.response) {
        console.error("Error response:", err.response);
      }
      if (err.data) {
        console.error("Error data:", err.data);
      }
      setError('Failed to fetch item data: ' + (err.message || 'Unknown error'));
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    const initialize = async () => {
      try {
        setLoading(true);
        setError(null);

        // Wait for app initialization
        const { vulcanReady, mondayReady } = await initializeApp();
        
        if (!mounted) return;

        if (!vulcanReady || !mondayReady) {
          throw new Error('Failed to initialize application components');
        }

        // Initialize token
        const token = await initializeToken();
        if (!mounted) return;
        
        if (!token) {
          throw new Error('Failed to initialize token');
        }

        // Set up context listener
        monday.listen("context", res => {
          if (!mounted) return;
          
          console.log("Context received:", res.data);
          if (res.data) {
            setContext(res.data);
            if (res.data.itemId && res.data.boardId) {
              fetchItemData(res.data.itemId, res.data.boardId, token);
            } else {
              setError('Missing item ID or board ID in context');
              setLoading(false);
            }
          }
        });

        // Get initial context
        const contextRes = await monday.get("context");
        if (!mounted) return;

        console.log("Initial context:", contextRes.data);
        if (contextRes.data) {
          setContext(contextRes.data);
          if (contextRes.data.itemId && contextRes.data.boardId) {
            fetchItemData(contextRes.data.itemId, contextRes.data.boardId, token);
          } else {
            setError('Missing item ID or board ID in context');
            setLoading(false);
          }
        }
      } catch (err) {
        if (!mounted) return;
        console.error("Initialization error:", err);
        setError('Failed to initialize application: ' + err.message);
        setLoading(false);
      }
    };

    initialize();

    return () => {
      mounted = false;
    };
  }, []);

  const handleFileTransfer = async (fromColumnId, toColumnId) => {
    if (!context?.boardId || !context?.itemId) {
      setError('Missing board ID or item ID');
      return;
    }

    if (!sessionToken) {
      setError('No valid session token available');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      console.log("Transferring file:", { fromColumnId, toColumnId });
      
      // Get the current file value
      const fileValue = itemData.item.column_values.find(col => col.id === fromColumnId)?.value;
      
      if (!fileValue) {
        throw new Error('No file found in source column');
      }

      console.log("File value to transfer:", fileValue);
      
      // Parse the file value if it's a string
      const parsedValue = typeof fileValue === 'string' ? JSON.parse(fileValue) : fileValue;
      
      try {
        let finalValue = parsedValue;

        // Check if it's an image
        if (parsedValue.files?.[0]?.isImage === "true") {
          const file = parsedValue.files[0];
          
          // Get the image URL from Monday.com
          const viewQuery = `query {
            assets(ids: [${file.assetId}]) {
              url
            }
          }`;
          
          const viewResponse = await monday.api(viewQuery);
          const imageUrl = viewResponse.data?.assets?.[0]?.url;
          
          if (imageUrl) {
            // Send to our server for resizing
            const resizeResponse = await fetch('/api/resize', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${sessionToken}`,
                'X-Monday-Authorization': sessionToken
              },
              body: JSON.stringify({ 
                imageUrl,
                boardId: context.boardId,
                itemId: context.itemId,
                sessionToken
              }),
            });
            
            if (!resizeResponse.ok) {
              const errorData = await resizeResponse.json();
              throw new Error(errorData.details || errorData.error || 'Failed to resize image');
            }
            
            const { resizedImage, requestId } = await resizeResponse.json();
            console.log("Resize completed with requestId:", requestId);
            
            // Upload resized image to Monday.com
            const uploadMutation = `mutation($file: File!) {
              add_file_to_column(file: $file, item_id: ${context.itemId}, column_id: "${toColumnId}") {
                id
              }
            }`;
            
            // Convert base64 to file
            const binaryString = atob(resizedImage);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: 'image/jpeg' });
            const resizedFile = new File([blob], `${file.name.replace(/\.[^/.]+$/, '')}_200x200.jpg`, { type: 'image/jpeg' });
            
            // Upload the resized file
            const uploadResponse = await monday.api(uploadMutation, { variables: { file: resizedFile } });
            console.log("Upload response:", uploadResponse);
            
            if (!uploadResponse.data?.add_file_to_column?.id) {
              throw new Error('Failed to upload resized image');
            }
            
            // Refresh to show the new image
            await fetchItemData(context.itemId, context.boardId, sessionToken);
            setError(null);
            return;
          }
        }
        
        // If not an image or resize failed, proceed with normal copy
        const transferMutation = `mutation {
          change_column_value (
            board_id: ${context.boardId}
            item_id: ${context.itemId}
            column_id: "${toColumnId}"
            value: ${JSON.stringify(JSON.stringify(finalValue))}
          ) {
            id
          }
        }`;

        console.log("Transfer mutation:", transferMutation);
        const transferResponse = await monday.api(transferMutation);
        console.log("Transfer response:", transferResponse);

        if (transferResponse.data?.change_column_value?.id) {
          await fetchItemData(context.itemId, context.boardId, sessionToken);
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
    } catch (err) {
      console.error("Error parsing file value:", err);
      setError('Failed to parse file data');
      setLoading(false);
    }
  };

  if (loading) return (
    <div className="App">
      <div className="loading">Loading...</div>
    </div>
  );

  if (error) return (
    <div className="App">
      <div className="error">
        <h3>Error</h3>
        <p>{error}</p>
        <button onClick={() => window.location.reload()}>Retry</button>
        <div className="debug-info">
          <p>Context: {JSON.stringify(context, null, 2)}</p>
          <p>Please make sure you have granted the following permissions:</p>
          <ul>
            <li>boards:read</li>
            <li>boards:write</li>
          </ul>
        </div>
      </div>
    </div>
  );

  if (!context || !itemData) return (
    <div className="App">
      <div className="error">
        <h3>Not Ready</h3>
        <p>Please run this app in a Monday.com item view</p>
        <div className="debug-info">
          <p>Context: {JSON.stringify(context, null, 2)}</p>
        </div>
      </div>
    </div>
  );

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
            .filter(col => fileColumns.some(fc => fc.id === col.id))
            .map(col => (
              <div key={col.id} className="column-value">
                <h4>{col.title}</h4>
                {col.value ? (
                  <>
                    <p className="file-name">{JSON.parse(col.value).name}</p>
                    <div className="transfer-buttons">
                      {fileColumns
                        .filter(targetCol => targetCol.id !== col.id)
                        .map(targetCol => (
                          <button
                            key={targetCol.id}
                            onClick={() => handleFileTransfer(
                              col.id,
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
