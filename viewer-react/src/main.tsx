import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/theme.css';
import { AtlasApp } from './AtlasApp.js';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <StrictMode>
    <AtlasApp />
  </StrictMode>,
);
