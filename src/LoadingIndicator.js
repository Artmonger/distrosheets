import React from 'react';

const LoadingIndicator = ({ message }) => (
  <div className="loading">
    <div className="loading-spinner"></div>
    <h3>Loading...</h3>
    {message && <p>{message}</p>}
  </div>
);

export default LoadingIndicator; 