import React from 'react';
import ReactDOM from 'react-dom/client';
import './app/globals.css';
import WorldExplorer from './components/WorldExplorer';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <WorldExplorer enableTerrain enable3DTiles />
  </React.StrictMode>
);
