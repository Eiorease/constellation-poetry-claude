import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

// NOTE: no <StrictMode> — react-force-graph-3d's imperative WebGL instance is
// destroyed by StrictMode's simulated unmount/remount and never recovers
// (frozen render loop, disposed controls).
createRoot(document.getElementById('root')!).render(<App />);
