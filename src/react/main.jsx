import React from 'react';
import { createRoot } from 'react-dom/client';
import 'antd/dist/reset.css';
import './app.css';
import { App } from './App.jsx';

const container = document.getElementById('root');

if (!container) {
  throw new Error('React root container is missing.');
}

createRoot(container).render(<App />);
