import React from 'react';

const LoadingIndicator = ({ message }) => (
  <div className="loading">
    <img src="/monday-spinner.gif" alt="Loading..." style={{ width: 80, height: 80, marginBottom: 24 }} />
    {message && <p>{message}</p>}
  </div>
);

export default LoadingIndicator; 