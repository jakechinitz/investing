import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles/index.css';
import './styles/app.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return React.createElement('div', {
        style: { padding: '2rem', fontFamily: 'monospace' }
      },
        React.createElement('h1', null, 'Something went wrong'),
        React.createElement('pre', { style: { color: 'red', whiteSpace: 'pre-wrap' } },
          String(this.state.error))
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById('root');
// Clear the loading fallback
root.innerHTML = '';

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
