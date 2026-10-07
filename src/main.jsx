import React from 'react';
import { createRoot } from 'react-dom/client';
import { IconContext } from '@phosphor-icons/react';
import '@fontsource/geist/latin-400.css';
import '@fontsource/geist/latin-500.css';
import '@fontsource/geist/latin-600.css';
import '@fontsource/geist/latin-700.css';
import '@radix-ui/themes/styles.css';
import '@xyflow/react/dist/style.css';
import 'katex/dist/katex.min.css';
import App from './App.jsx';
import './styles.css';
import './markdown.css';

createRoot(document.getElementById('root')).render(
  <IconContext.Provider value={{ size: 18, weight: 'regular' }}><App /></IconContext.Provider>
);
