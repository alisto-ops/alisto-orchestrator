const { downloadServer, startMinecraftProcess, stopMinecraftProcess, readProperties, writeProperties, setupPlayit, startPlayit, stopPlayit, getPublicIP, sendCommand, forceOfflineMode, waitForPublicIP, backupWorldToDrive, readLogFile, shareLogToMclogs, getPlayerList, managePlayer, forceReauth, listDriveBackups, deleteDriveBackup, restoreDriveBackup, listFiles, deleteLocalFile, generateNewWorld, openFolderInWindows, exportLocalWorld, importLocalWorld } = require('./engine.js');
      
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn'); 
const reauthBtn = document.getElementById('reauth-btn');
const createBackupBtn = document.getElementById('create-backup-page-btn');
const ipDisplay = document.getElementById('ip-display');

const statusCircleUi = document.getElementById('status-circle-ui');
const statusTextUi = document.getElementById('status-text-ui');

const typeSelect = document.getElementById('server-type'); 
const versionSelect = document.getElementById('mc-version');
const ramSelect = document.getElementById('ram-select');
const consoleBoxUi = document.getElementById('console-box-ui');

function logToConsole(message) {
  consoleBoxUi.innerHTML += `<br>> ${message}`;
  consoleBoxUi.scrollTop = consoleBoxUi.scrollHeight;
}

function updateServerStatus(state) {
  if (state === 'booting') {
      statusCircleUi.style.backgroundColor = 'var(--aternos-orange)';
      statusCircleUi.style.boxShadow = '0 0 15px rgba(240, 173, 78, 0.4)';
      statusCircleUi.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      statusTextUi.innerText = 'Starting ...';
  } else if (state === 'online') {
      statusCircleUi.style.backgroundColor = 'var(--aternos-green)';
      statusCircleUi.style.boxShadow = '0 0 15px rgba(92, 184, 92, 0.4)';
      statusCircleUi.innerHTML = '<i class="fas fa-check"></i>';
      statusTextUi.innerText = 'Online';
  } else if (state === 'offline') {
      statusCircleUi.style.backgroundColor = 'var(--aternos-red)';
      statusCircleUi.style.boxShadow = '0 0 15px rgba(217, 83, 79, 0.4)';
      statusCircleUi.innerHTML = '<i class="fas fa-times"></i>';
      statusTextUi.innerText = 'Offline';
      ipDisplay.innerText = "network.magnesium.local";
  }
}

startBtn.addEventListener('click', async () => {
  startBtn.style.display = "none";
  stopBtn.style.display = "flex";
  updateServerStatus('booting');
  
  logToConsole(`Initializing setup for ${typeSelect.value.toUpperCase()} ${versionSelect.value}...`);
  const downloadedJarPath = await downloadServer(typeSelect.value, versionSelect.value);
  
  if (downloadedJarPath) {
      forceOfflineMode(document.getElementById('cracked-toggle').checked);

      if (document.getElementById('tunnel-toggle').checked) {
          ipDisplay.innerText = "Provisioning Network...";
          await setupPlayit();
          startPlayit();
          try {
              const ip = await waitForPublicIP(20000); 
              ipDisplay.innerText = ip;
          } catch (e) {
              ipDisplay.innerText = "Timeout. Check Console.";
          }
      }
      
      updateServerStatus('online');
      logToConsole(`Commencing boot sequence...`);
      
      startMinecraftProcess(downloadedJarPath, ramSelect.value, () => {
          stopBtn.style.display = "none";
          startBtn.style.display = "flex";
          updateServerStatus('offline');
      });
  } else {
      stopBtn.style.display = "none";
      startBtn.style.display = "flex";
      updateServerStatus('offline');
  }
});

stopBtn.addEventListener('click', () => { stopMinecraftProcess(); if (document.getElementById('tunnel-toggle').checked) stopPlayit(); });

reauthBtn.addEventListener('click', () => {
    reauthBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fixing...';
    forceReauth();
});

const originalLog = console.log;
console.log = function(message) { 
    if (typeof message === 'string' && message.includes('[Magnesium Network] IP Address:')) logToConsole(`<span style="color: var(--aternos-blue); font-weight: bold;">${message}</span>`);
    else logToConsole(message); 
    originalLog(message); 
};

const originalError = console.error;
console.error = function(message) { logToConsole(`<span style="color: var(--aternos-red);">${message}</span>`); originalError(message); };

const cmdInput = document.getElementById('cmd-input');
document.getElementById('send-cmd-btn').addEventListener('click', () => {
  if (cmdInput.value.trim()) { sendCommand(cmdInput.value.trim()); cmdInput.value = ''; }
});
cmdInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') document.getElementById('send-cmd-btn').click(); });

document.getElementById('log-reload-btn').addEventListener('click', () => {
    const logContent = readLogFile();
    document.getElementById('log-viewer-box').innerText = logContent || "No log file found.";
});

document.getElementById('log-share-btn').addEventListener('click', async () => {
    const btn = document.getElementById('log-share-btn');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading';
    btn.disabled = true;
    const shareUrl = await shareLogToMclogs();
    if (shareUrl) {
        btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        require('electron').clipboard.writeText(shareUrl);
    } else {
        btn.innerHTML = '<i class="fas fa-times"></i> Failed';
    }
    setTimeout(() => { btn.innerHTML = '<i class="fas fa-share-alt"></i> Share'; btn.disabled = false; }, 3000);
});

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    if (item.classList.contains('disabled')) return;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    const target = item.getAttribute('data-target');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(target).classList.add('active');
    if(target === 'page-log') document.getElementById('log-reload-btn').click();
  });
});

const propsList = document.getElementById('props-list');
const savePropsBtn = document.getElementById('save-props-btn');

document.getElementById('load-props-btn').addEventListener('click', () => {
    const currentProps = readProperties();
    if (!currentProps) { logToConsole(`[Error] Boot server once to generate config!`); return; }
    propsList.innerHTML = ''; 
    for (const [key, value] of Object.entries(currentProps)) {
        const div = document.createElement('div');
        div.className = 'connect-bar';
        div.style.marginBottom = '10px';
        
        const label = document.createElement('div');
        label.innerText = key;
        label.style.fontWeight = "600";
        
        let input;
        if (value === 'true' || value === 'false') {
            input = document.createElement('select');
            input.innerHTML = `<option value="true" ${value === 'true' ? 'selected' : ''}>True</option><option value="false" ${value === 'false' ? 'selected' : ''}>False</option>`;
        } else {
            input = document.createElement('input');
            input.type = 'text';
            input.value = value;
        }
        input.dataset.key = key;
        input.style.width = '200px';
        input.style.marginTop = '0';
        
        div.appendChild(label); div.appendChild(input); propsList.appendChild(div);
    }
    savePropsBtn.style.display = 'flex';
});

savePropsBtn.addEventListener('click', () => {
    const newProps = {};
    propsList.querySelectorAll('input, select').forEach(input => newProps[input.dataset.key] = input.value);
    writeProperties(newProps);
    logToConsole(`Properties saved! Take effect on next boot.`);
    savePropsBtn.innerHTML = '<i class="fas fa-check"></i> Saved!';
    setTimeout(() => savePropsBtn.innerHTML = '<i class="fas fa-save"></i> Save Properties', 2000);
});

let currentPlayerListType = '';

document.getElementById('btn-back-players').addEventListener('click', () => {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-players').classList.add('active');
});

window.openPlayerList = function(listType, title) {
    currentPlayerListType = listType;
    document.getElementById('player-list-title').innerText = title;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-player-list').classList.add('active');
    refreshPlayerUI();
}

function refreshPlayerUI() {
    const container = document.getElementById('player-list-container');
    container.innerHTML = '<div style="color: var(--text-grey); padding: 20px;">Loading...</div>';
    try {
        const list = getPlayerList(currentPlayerListType);
        container.innerHTML = '';
        if (!list || list.length === 0) {
            container.innerHTML = '<div style="color: var(--text-grey); padding: 20px;">List is empty.</div>';
            return;
        }
        list.forEach(player => {
            const row = document.createElement('div');
            row.className = 'connect-bar';
            row.style.marginBottom = '0';
            row.innerHTML = `
                <div style="display:flex; align-items:center; gap:15px;">
                    <img src="https://minotar.net/helm/${player.name}/40.png" style="border-radius:4px; image-rendering:pixelated;" width="40" height="40">
                    <span style="font-size:1.1rem; font-weight:bold;">${player.name}</span>
                </div>
                <button style="background:var(--aternos-red); color:white; border:none; width:35px; height:35px; border-radius:4px; cursor:pointer;" onclick="removePlayer('${player.name}')"><i class="fas fa-trash"></i></button>
            `;
            container.appendChild(row);
        });
    } catch (e) {
        container.innerHTML = `<div style="color: var(--aternos-red); padding: 20px;">Error reading JSON. Start server first.</div>`;
    }
}

document.getElementById('player-add-btn').addEventListener('click', async () => {
    const input = document.getElementById('player-add-input');
    const username = input.value.trim();
    if (!username) return;
    const btn = document.getElementById('player-add-btn');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;
    const result = await managePlayer('add', currentPlayerListType, username);
    if (result && result.success) { input.value = ''; refreshPlayerUI(); } 
    else { alert(result ? result.error : "Failed."); }
    btn.innerHTML = '<i class="fas fa-plus"></i> Add';
    btn.disabled = false;
});

window.removePlayer = async function(username) {
    await managePlayer('remove', currentPlayerListType, username);
    refreshPlayerUI();
}

// --- CLOUD BACKUP MANAGER LOGIC ---
document.querySelector('[data-target="page-backups"]').addEventListener('click', () => { refreshBackupList(); });

if (createBackupBtn) {
    createBackupBtn.addEventListener('click', async () => {
        createBackupBtn.disabled = true;
        createBackupBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Zipping...';
        logToConsole(`[System] Compressing world data...`);
        
        const success = await backupWorldToDrive(5); 
        
        if (success) {
            createBackupBtn.innerHTML = '<i class="fas fa-check"></i> Saved';
            setTimeout(() => { refreshBackupList(); }, 2000); // 2 second delay for Google Index
        } else {
            createBackupBtn.innerHTML = '<i class="fas fa-times"></i> Failed';
        }
        setTimeout(() => {
            createBackupBtn.disabled = false;
            createBackupBtn.innerHTML = '<i class="fas fa-plus"></i> Create backup';
        }, 4000);
    });
}

async function refreshBackupList() {
    const container = document.getElementById('backup-list-container');
    container.innerHTML = '<div style="color: var(--text-grey); padding: 20px; text-align: center;"><i class="fas fa-spinner fa-spin"></i> Fetching from Google Drive...</div>';
    
    const files = await listDriveBackups();
    
    if (files.length === 0) {
        container.innerHTML = '<div style="color: var(--text-grey); padding: 20px; text-align: center;">No backups found in Vault.</div>';
        return;
    }

    container.innerHTML = '';
    files.forEach(file => {
        const dateObj = new Date(file.createdTime);
        const formattedDate = `${dateObj.toLocaleDateString()} ${dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
        const sizeMB = (file.size / (1024 * 1024)).toFixed(2);

        const row = document.createElement('div');
        row.className = 'backup-row';
        row.innerHTML = `
            <div style="display:flex; align-items:center; gap:15px; color:white;">
                <i class="fas fa-globe" style="font-size:1.5rem; color:#9daab6;"></i>
                <div style="display:flex; flex-direction:column;">
                    <span style="font-weight:600; font-size:1.1rem;">Magnesium_World</span>
                    <span style="color:#9daab6; font-size:0.9rem;">${formattedDate} • ${sizeMB} MB</span>
                </div>
            </div>
            <div style="display:flex; gap:10px;">
                <button class="btn-connect" style="width:40px; height:40px; justify-content:center; padding:0;" title="Download ZIP" onclick="require('electron').shell.openExternal('https://drive.google.com/uc?export=download&id=${file.id}')"><i class="fas fa-download"></i></button>
                <button class="btn-connect" style="width:40px; height:40px; justify-content:center; padding:0;" id="restore-${file.id}" title="Restore World" onclick="triggerRestore('${file.id}')"><i class="fas fa-undo"></i></button>
                <button class="btn-connect" style="width:40px; height:40px; justify-content:center; padding:0; background: #d9534f; border-color: #d9534f;" id="delete-${file.id}" title="Delete Backup" onclick="triggerDelete('${file.id}')"><i class="fas fa-trash"></i></button>
            </div>
        `;
        container.appendChild(row);
    });
}

window.triggerDelete = async function(fileId) {
    if (!confirm("Are you sure you want to permanently delete this cloud backup?")) return;
    const btn = document.getElementById(`delete-${fileId}`);
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;
    
    await deleteDriveBackup(fileId);
    refreshBackupList();
};

window.triggerRestore = async function(fileId) {
    if (!confirm("WARNING: This will erase your current world and replace it with this backup. Have you stopped the server?")) return;
    
    const btn = document.getElementById(`restore-${fileId}`);
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;
    
    logToConsole("[System] Halting processes to begin World Restoration...");
    
    // Give the UI a tiny moment to render the console text before locking up the thread
    setTimeout(async () => {
        const success = await restoreDriveBackup(fileId);
        
        if (success) {
            btn.innerHTML = '<i class="fas fa-check" style="color:var(--aternos-green);"></i>';
            logToConsole("<span style='color: #5cb85c;'>[System] Restoration Complete! You may start the server.</span>");
        } else {
            btn.innerHTML = '<i class="fas fa-times" style="color:var(--aternos-red);"></i>';
            logToConsole("<span style='color: #d9534f;'>[System] Restoration failed. Check logs above.</span>");
        }
        setTimeout(() => { btn.innerHTML = '<i class="fas fa-undo"></i>'; btn.disabled = false; }, 3000);
    }, 100);
};

// --- FILES EXPLORER LOGIC ---
let currentExplorerPath = '';

// --- WORLD UPLOAD LISTENERS (WITH SILENT BUG FIX) ---
document.getElementById('hidden-zip-upload').addEventListener('change', async (e) => {
    if (!e.target.files.length) return;
    if (confirm("Are you absolutely sure? This will permanently delete your current world and replace it with the uploaded ZIP.")) {
        logToConsole("[System] Uploading and extracting ZIP...");
        const { importLocalWorld } = require('./engine.js');
        
        // THE FIX: Let the UI breathe for 100ms before locking the thread so it doesn't freeze!
        setTimeout(async () => {
            const success = await importLocalWorld(e.target.files[0].path, true);
            if (success) {
                alert("World successfully uploaded!");
                logToConsole("<span style='color: var(--aternos-green);'>[System] World uploaded successfully.</span>");
            } else {
                alert("Upload failed. Make sure the server is fully stopped.");
                logToConsole("<span style='color: var(--aternos-red);'>[System] Upload failed. Check logs.</span>");
            }
        }, 100);
    }
    e.target.value = ''; // Reset input
});

document.getElementById('hidden-folder-upload').addEventListener('change', async (e) => {
    if (!e.target.files.length) return;
    const firstFile = e.target.files[0];
    const baseFolder = firstFile.path.substring(0, firstFile.path.length - firstFile.webkitRelativePath.length);
    const actualFolder = require('path').join(baseFolder, firstFile.webkitRelativePath.split('/')[0]);
    
    if (confirm("Are you absolutely sure? This will permanently delete your current world and replace it with the selected Folder.")) {
        logToConsole("[System] Uploading and copying Folder...");
        const { importLocalWorld } = require('./engine.js');
        
        // THE FIX: Let the UI breathe!
        setTimeout(async () => {
            const success = await importLocalWorld(actualFolder, false);
            if (success) {
                alert("World folder successfully uploaded!");
                logToConsole("<span style='color: var(--aternos-green);'>[System] World uploaded successfully.</span>");
            } else {
                alert("Upload failed. Make sure the server is fully stopped.");
            }
        }, 100);
    }
    e.target.value = ''; 
});

// --- FILES EXPLORER LOGIC ---
function renderFileExplorer() {
    const { listFiles } = require('./engine.js');
    const container = document.getElementById('file-list-container');
    const pathDisplay = document.getElementById('current-file-path');
    const countDisplay = document.getElementById('file-count-display'); // New Counter!
    
    pathDisplay.innerText = '/' + currentExplorerPath;
    container.innerHTML = '';

    const files = listFiles(currentExplorerPath);
    countDisplay.innerText = files.length; // Update the Aternos UI counter

    if (currentExplorerPath !== '') {
        const backRow = document.createElement('div');
        backRow.className = 'file-row';
        backRow.innerHTML = `<div class="file-info"><i class="fas fa-level-up-alt"></i> ..</div>`;
        backRow.onclick = () => {
            const parts = currentExplorerPath.split('/');
            parts.pop();
            currentExplorerPath = parts.join('/');
            renderFileExplorer();
        };
        container.appendChild(backRow);
    }

    files.forEach(f => {
        const row = document.createElement('div');
        row.className = 'file-row';
        
        const sizeStr = f.isDirectory ? '--' : (f.size > 1024*1024 ? (f.size/(1024*1024)).toFixed(2) + ' MB' : (f.size/1024).toFixed(2) + ' kB');
        const icon = f.isDirectory ? 'fa-folder' : (f.name.endsWith('.json') ? 'fa-file-code' : 'fa-file-alt');

        row.innerHTML = `
            <div class="file-info" onclick="${f.isDirectory ? `openFolder('${f.path}')` : ''}">
                <i class="fas ${icon}"></i> ${f.name}
            </div>
            <div class="file-actions">
                <span class="file-size">${sizeStr}</span>
                ${!f.isDirectory ? `<button class="file-btn download-btn" title="Open File Locally" onclick="openFolderInExplorer('${f.path}')"><i class="fas fa-download"></i></button>` : ''}
                <button class="file-btn del-btn" title="Delete" onclick="deleteLocal('${f.path}')"><i class="fas fa-trash"></i></button>
            </div>
        `;
        container.appendChild(row);
    });
}

// --- GLOBAL HELPERS FOR HTML BUTTONS ---
window.openFolderInExplorer = function(folderPath) {
    openFolderInWindows(folderPath);
};

window.navToPage = function(pageId) {
    document.querySelector(`[data-target="${pageId}"]`).click();
};

window.openFolder = function(path) {
    currentExplorerPath = path;
    renderFileExplorer();
}

window.deleteLocal = function(path) {
    if(!confirm(`Are you sure you want to delete ${path}?`)) return;
    deleteLocalFile(path);
    renderFileExplorer();
}

// --- GENERATE WORLD LOGIC ---
document.getElementById('btn-confirm-generate').addEventListener('click', () => {
    if(!confirm("Are you absolutely sure? This will delete your current world and cannot be undone unless you have a backup!")) return;
    
    const options = {
        levelName: document.getElementById('gen-name').value,
        seed: document.getElementById('gen-seed').value,
        generator: document.getElementById('gen-generator').value,
        worldType: document.getElementById('gen-type').value,
        structures: document.getElementById('gen-structs').checked,
        hardcore: document.getElementById('gen-hardcore').checked
    };

    const success = generateNewWorld(options);
    
    if(success) {
        alert("World reset successfully! The new world will generate the next time you click Start.");
        document.getElementById('generate-modal').style.display = 'none';
    } else {
        alert("Failed. Make sure the server is STOPPED before generating a new world.");
    }
});

// --- WORLD DOWNLOAD/UPLOAD LOGIC ---
window.downloadWorldZip = async function() {
    const btn = document.getElementById('btn-download-world');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Zipping...';
    btn.disabled = true;

    logToConsole("[System] Compressing world into a standard ZIP archive...");
    const { exportLocalWorld } = require('./engine.js');
    const zipPath = await exportLocalWorld();
    
    if (zipPath) {
        btn.innerHTML = '<i class="fas fa-check"></i> Saved';
        logToConsole("[System] World successfully saved to your Downloads folder!");
        require('electron').shell.showItemInFolder(zipPath); // Opens Windows Explorer highlighting the file!
    } else {
        btn.innerHTML = '<i class="fas fa-times"></i> Failed';
        alert("Ensure the server is stopped before downloading!");
    }
    
    setTimeout(() => { btn.innerHTML = originalText; btn.disabled = false; }, 3000);
}

document.getElementById('hidden-zip-upload').addEventListener('change', async (e) => {
    if (!e.target.files.length) return;
    if (confirm("Are you absolutely sure? This will permanently delete your current world and replace it with the uploaded ZIP.")) {
        logToConsole("[System] Uploading and extracting ZIP...");
        const { importLocalWorld } = require('./engine.js');
        const success = await importLocalWorld(e.target.files[0].path, true);
        
        if (success) {
            alert("World successfully uploaded!");
            logToConsole("<span style='color: var(--aternos-green);'>[System] World uploaded successfully.</span>");
        } else {
            alert("Upload failed. Make sure the server is fully stopped.");
        }
    }
    e.target.value = ''; // Reset input
});

document.getElementById('hidden-folder-upload').addEventListener('change', async (e) => {
    if (!e.target.files.length) return;
    
    // In Electron, webkitdirectory grabs all files recursively. We extract the root folder path.
    const firstFile = e.target.files[0];
    const baseFolder = firstFile.path.substring(0, firstFile.path.length - firstFile.webkitRelativePath.length);
    const actualFolder = require('path').join(baseFolder, firstFile.webkitRelativePath.split('/')[0]);
    
    if (confirm("Are you absolutely sure? This will permanently delete your current world and replace it with the selected Folder.")) {
        logToConsole("[System] Uploading and copying Folder...");
        const { importLocalWorld } = require('./engine.js');
        const success = await importLocalWorld(actualFolder, false);
        
        if (success) {
            alert("World folder successfully uploaded!");
            logToConsole("<span style='color: var(--aternos-green);'>[System] World uploaded successfully.</span>");
        } else {
            alert("Upload failed. Make sure the server is fully stopped.");
        }
    }
    e.target.value = ''; // Reset input
});

window.addEventListener('beforeunload', () => { stopMinecraftProcess(); stopPlayit(); });