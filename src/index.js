import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import reportWebVitals from './reportWebVitals';
import mondaySdk from 'monday-sdk-js';

// Initialize Monday SDK at the application root
const initMondayClient = async () => {
  try {
    const monday = mondaySdk();
    window.monday = monday;
    
    // Initialize without waiting for script
    monday.setToken('');
    
    // Listen for init event
    monday.listen('init', (res) => {
      console.log('Monday Init Event:', res);
    });
    
    // Listen for context changes
    monday.listen('context', (res) => {
      console.log('Monday Context Event:', res);
    });

    return monday;
  } catch (err) {
    console.error('Failed to initialize Monday client:', err);
    throw err;
  }
};

// Initialize before rendering
initMondayClient().then(() => {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}).catch(err => {
  console.error('Failed to start app:', err);
  // Render error state
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(
    <div className="error">
      <h3>Failed to Initialize</h3>
      <p>Please refresh the page to try again.</p>
    </div>
  );
});

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
