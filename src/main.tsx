import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/onest/cyrillic-300.css';
import '@fontsource/onest/cyrillic-400.css';
import '@fontsource/onest/cyrillic-500.css';
import '@fontsource/onest/cyrillic-600.css';
import '@fontsource/onest/latin-300.css';
import '@fontsource/onest/latin-400.css';
import '@fontsource/onest/latin-500.css';
import '@fontsource/onest/latin-600.css';
import App from './App';
import { DesignSystemPage } from './design-system/DesignSystemPage';
import './design-system/tokens.css';
import './design-system/motion.css';
import './styles.css';
import './design-system/components.css';
import './design-system/product.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{window.location.pathname.replace(/\/$/, '') === '/design-system' ? <DesignSystemPage /> : <App />}</React.StrictMode>);
