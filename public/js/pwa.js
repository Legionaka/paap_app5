const connectionStatus = document.createElement('div');
connectionStatus.className = 'connection-status';
connectionStatus.setAttribute('role', 'status');
connectionStatus.setAttribute('aria-live', 'polite');
connectionStatus.hidden = true;
document.body.prepend(connectionStatus);

function updateConnectionStatus() {
  connectionStatus.hidden = navigator.onLine;
  connectionStatus.textContent = navigator.onLine
    ? ''
    : 'You’re offline. Previously opened public guides may be available; forecasts and discussions need a connection.';
}

window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);
updateConnectionStatus();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.info('Offline guide is unavailable in this browser session.', error);
    });
  });
}
