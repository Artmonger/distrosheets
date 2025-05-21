import React from 'react';

const LoadingIndicator = ({ message }) => (
  <div className="loading">
    <div className="loader-spinner"></div>
    {message && <p>{message}</p>}
  </div>
);

export default LoadingIndicator; 