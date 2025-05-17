import React, { useEffect, useState } from 'react';
import mondaySdk from 'monday-sdk-js';
import './App.css';

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
      console.log("Fetching item data for item:", itemId, "board:", boardId);
      
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
      console.log("Columns Response:", columnsResponse);

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
      console.log("Item Response:", itemResponse);

      if (!itemResponse.data?.items?.[0]) {
        throw new Error('Failed to fetch item data');
      }

      setItemData({
        item: itemResponse.data.items[0],
        columns: columnsResponse.data.boards[0].columns
      });

      setError(null);
    } catch (err) {
      console.error("Error fetching data:", err);
      throw err;
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
