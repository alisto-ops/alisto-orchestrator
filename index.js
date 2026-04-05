const { app, BrowserWindow } = require('electron');

function createWindow () {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Load the UI we just made
  mainWindow.loadFile('index.html');
}

// When Electron is fully loaded, spawn the window
app.whenReady().then(createWindow);

// Quit the app when all windows are closed (standard Windows behavior)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});