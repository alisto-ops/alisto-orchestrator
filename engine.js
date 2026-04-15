const http = require('http'); 
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const extract = require('extract-zip');
const axios = require('axios');
const { shell } = require('electron'); 
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.join(__dirname, '.env') }); 

// THE IMPORTS (The modules you segregated!)
const mc = require('./minecraft.js');
const net = require('./network.js');

let authServer = null; 
let googleDriveToken = null; 
let googleRefreshToken = null; 

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- CLOUD AUTHENTICATION ---
async function testCloudConnection() {
    console.log("[Cloud] Establishing uplink to Supabase...");
    try {
        const { error } = await supabase.from('alisto_connection_test').select('*').limit(1);
        if (!error || error.code === '42P01' || error.code === 'PGRST205') console.log("[Cloud Success] Database uplink established!");
    } catch (err) { console.error("[Cloud Error] Connection failed."); }
}
testCloudConnection();

async function syncNetworkToCloud(ip) {
    console.log(`[Cloud Vault] Initiating secure network sync...`);
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const userId = session.user.id;

        const configPath = net.getPlayitConfigPath();
        let rawKeyText = null;
        if (fs.existsSync(configPath)) rawKeyText = fs.readFileSync(configPath, 'utf8');

        const { data: existing } = await supabase.from('server_ips').select('id').eq('server_name', 'Magnesium Main').eq('user_id', userId).single();

        if (existing) {
            await supabase.from('server_ips').update({ playit_ip: ip, playit_secret_key: rawKeyText, google_refresh_token: googleRefreshToken, last_updated: new Date().toISOString() }).eq('id', existing.id);
        } else {
            await supabase.from('server_ips').insert({ server_name: 'Magnesium Main', playit_ip: ip, playit_secret_key: rawKeyText, google_refresh_token: googleRefreshToken, user_id: userId, last_updated: new Date().toISOString() });
        }
        console.log(`[Cloud Vault Success] IP, Network Key, and Ghost Tokens securely locked in the vault!`);
    } catch (err) { console.error(`[Cloud Vault Critical] Sync crashed: ` + err.message); }
}

async function restoreNetworkKey() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return false;

        const { data, error } = await supabase.from('server_ips').select('playit_secret_key').eq('server_name', 'Magnesium Main').eq('user_id', session.user.id).single();
        if (error || !data || !data.playit_secret_key) return false; 

        const configPath = net.getPlayitConfigPath();
        if (!fs.existsSync(path.dirname(configPath))) fs.mkdirSync(path.dirname(configPath), { recursive: true });

        fs.writeFileSync(configPath, data.playit_secret_key);
        console.log("[Cloud Vault Success] Network key restored from cloud! Bypassing login screen.");
        return true;
    } catch (err) { return false; }
}

function showGoogleLoginScreen() {
    if (document.getElementById('alisto-login-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'alisto-login-overlay';
    overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(17, 17, 27, 0.85); backdrop-filter: blur(5px); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 10000; color: white; font-family: 'Segoe UI', Tahoma, sans-serif;`;
    overlay.innerHTML = `
        <div style="background: #1e1e2e; padding: 50px; border-radius: 16px; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.5); border: 1px solid #313244;">
            <h1 style="margin: 0 0 10px 0; color: #89b4fa; font-size: 32px;">Magnesium Identity</h1>
            <p style="color: #bac2de; margin-bottom: 30px; max-width: 380px; line-height: 1.5;">Secure your server infrastructure. Sign in with Google to access your Cloud Vault and World Backups.</p>
            <button id="google-signin-btn" style="background: white; color: #11111b; border: none; padding: 14px 30px; font-size: 16px; font-weight: bold; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; margin: 0 auto;">
                <img src="https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg" width="20" height="20"> Sign in with Google
            </button>
        </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('google-signin-btn').onclick = async () => {
        const btn = document.getElementById('google-signin-btn');
        btn.innerText = "Connecting...";
        btn.style.background = "#f9e2af";
        await executeGoogleAuth(btn);
    };
}

async function executeGoogleAuth(btn) {
    try {
        if (authServer) { authServer.close(); authServer = null; }
        authServer = http.createServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            if (req.method === 'GET' && req.url.startsWith('/auth')) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`<html><body style="background: #1e1e2e; color: #cdd6f4; font-family: sans-serif; display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh;"><h1 style="color: #a6e3a1;">Authentication Successful!</h1><p>You can close this tab.</p><script>fetch('http://127.0.0.1:3000/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hash: window.location.hash }) }).then(() => setTimeout(() => window.close(), 1000));</script></body></html>`);
            } else if (req.method === 'POST' && req.url === '/token') {
                let body = '';
                req.on('data', chunk => { body += chunk.toString(); });
                req.on('end', async () => {
                    const data = JSON.parse(body);
                    res.writeHead(200); res.end('OK');
                    authServer.close(); authServer = null;

                    const params = new URLSearchParams(data.hash.replace('#', '?'));
                    if (params.get('provider_token')) googleDriveToken = params.get('provider_token');
                    if (params.get('provider_refresh_token')) googleRefreshToken = params.get('provider_refresh_token');

                    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({ access_token: params.get('access_token'), refresh_token: params.get('refresh_token') });
                    if (!sessionError) {
                        const overlay = document.getElementById('alisto-login-overlay');
                        if (overlay) overlay.remove();
                        if (net.getPublicIP()) syncNetworkToCloud(net.getPublicIP());
                        autoProvisionNetwork();
                    }
                });
            }
        });

       authServer.listen(3000, '127.0.0.1', async () => {
            const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: 'http://127.0.0.1:3000/auth', skipBrowserRedirect: true, scopes: 'https://www.googleapis.com/auth/drive.file', queryParams: { access_type: 'offline', prompt: 'consent' } } });
            if (error) { if (btn) { btn.innerText = "Auth Error!"; btn.style.background = "#f38ba8"; } return; }
            if (btn) { btn.innerText = "Check your browser!"; btn.style.background = "#a6e3a1"; }
            try { shell.openExternal(data.url); } catch (e) { }
        });
    } catch (err) {}
}

async function autoProvisionNetwork() {
    if (!fs.existsSync(net.getPlayitConfigPath())) {
        const restored = await restoreNetworkKey();
        if (restored) { net.startPlayit(syncNetworkToCloud); } 
        else { net.showSetupScreen(); net.startPlayit(syncNetworkToCloud); }
    } else { net.startPlayit(syncNetworkToCloud); }
}

async function checkIdentityAndBoot() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        showGoogleLoginScreen();
    } else {
        console.log(`[Identity] Welcome back, ${session.user.email}`);
        try {
            const { data } = await supabase.from('server_ips').select('google_refresh_token').eq('server_name', 'Magnesium Main').eq('user_id', session.user.id).single();
            if (data && data.google_refresh_token) {
                const response = await axios.post('https://oauth2.googleapis.com/token', {
                    client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: data.google_refresh_token, grant_type: 'refresh_token'
                });
                googleDriveToken = response.data.access_token;
                console.log("[Cloud Vault] Ghost Boot Successful! Google Drive token restored silently.");
            }
        } catch (e) { console.error("[Cloud Vault Warning] Ghost Boot failed."); }
        autoProvisionNetwork();
    }
}
setTimeout(checkIdentityAndBoot, 100);

async function resetNetworkAccount() {
    console.warn("[WARNING] Initiating Network Account Reset.");
    net.stopPlayit();
    if (fs.existsSync(net.getPlayitConfigPath())) fs.unlinkSync(net.getPlayitConfigPath());
    await supabase.from('server_ips').update({ playit_secret_key: null }).eq('server_name', 'Magnesium Main');
    console.log("[Cloud Vault] Cloud backup purged.");
}

async function forceReauth() {
    console.log("[Identity] Forcing session wipe...");
    await supabase.auth.signOut();
    googleDriveToken = null;
    googleRefreshToken = null;
    showGoogleLoginScreen();
}

// --- GOOGLE DRIVE VAULT ---
async function backupWorldToDrive(maxBackups = 5) {
    console.log("[Cloud Vault] Initiating World Backup to Google Drive...");
    try {
        if (!googleDriveToken) throw new Error("No Drive Token. Click Re-link Drive.");

        const worldFolder = path.join(__dirname, 'servers', 'world');
        if (!fs.existsSync(worldFolder)) return false;

        const zipPath = path.join(__dirname, 'servers', 'backup.zip');
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        await new Promise((resolve, reject) => {
            output.on('close', resolve); archive.on('error', reject);
            archive.pipe(output); archive.directory(worldFolder, 'world'); archive.finalize();
        });

        const initRes = await axios.post('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', 
            { name: `Magnesium_World_${Date.now()}.zip`, mimeType: 'application/zip' }, 
            { headers: { 'Authorization': `Bearer ${googleDriveToken}`, 'Content-Type': 'application/json', 'X-Upload-Content-Type': 'application/zip' } }
        );

        const fileSize = fs.statSync(zipPath).size;
        const fileBuffer = fs.readFileSync(zipPath); 
        
        await axios.put(initRes.headers.location, fileBuffer, {
            headers: { 'Content-Length': fileSize, 'Content-Type': 'application/zip' }, maxContentLength: Infinity, maxBodyLength: Infinity
        });

        fs.unlinkSync(zipPath);
        console.log("[Cloud Vault Success] World securely backed up as a perfect ZIP!");

        const backups = await listDriveBackups();
        if (backups.length > maxBackups) {
            const toDelete = backups.slice(maxBackups);
            for (const file of toDelete) await deleteDriveBackup(file.id);
        }
        return true;
    } catch (err) { return false; }
}

async function listDriveBackups() {
    if (!googleDriveToken) return [];
    try {
        const response = await axios.get("https://www.googleapis.com/drive/v3/files", {
            params: { q: "trashed=false", fields: "files(id, name, createdTime, size, mimeType)", orderBy: "createdTime desc" },
            headers: { 'Authorization': `Bearer ${googleDriveToken}` }
        });
        return (response.data.files || []).filter(f => f.name && f.name.includes('Magnesium_World_'));
    } catch (e) { return []; }
}

async function deleteDriveBackup(fileId) {
    if (!googleDriveToken) return false;
    try {
        await axios.delete(`https://www.googleapis.com/drive/v3/files/${fileId}`, { headers: { 'Authorization': `Bearer ${googleDriveToken}` } });
        return true;
    } catch (e) { return false; }
}

async function restoreDriveBackup(fileId) {
    if (!googleDriveToken) return false;
    if (mc.getMcProcess()) return false;

    const restoreZipPath = path.join(__dirname, 'servers', 'restore_temp.zip');
    const worldFolder = path.join(__dirname, 'servers', 'world');

    try {
        const response = await axios({ url: `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, method: 'GET', responseType: 'arraybuffer', headers: { 'Authorization': `Bearer ${googleDriveToken}` } });
        fs.writeFileSync(restoreZipPath, Buffer.from(response.data));

        if (fs.existsSync(worldFolder)) fs.rmSync(worldFolder, { recursive: true, force: true });
        await new Promise(res => setTimeout(res, 1000));
        await extract(restoreZipPath, { dir: path.join(__dirname, 'servers') });
        fs.unlinkSync(restoreZipPath);
        return true;
    } catch (err) {
        if (fs.existsSync(restoreZipPath)) fs.unlinkSync(restoreZipPath);
        return false;
    }
}

// --- THE FACADE EXPORTS ---
module.exports = { 
    downloadServer: mc.downloadServer, 
    startMinecraftProcess: mc.startMinecraftProcess, 
    stopMinecraftProcess: mc.stopMinecraftProcess, 
    readProperties: mc.readProperties, 
    writeProperties: mc.writeProperties, 
    forceOfflineMode: mc.forceOfflineMode, 
    sendCommand: mc.sendCommand, 
    readLogFile: mc.readLogFile, 
    shareLogToMclogs: mc.shareLogToMclogs, 
    getPlayerList: mc.getPlayerList, 
    managePlayer: mc.managePlayer, 
    setupPlayit: net.setupPlayit, 
    startPlayit: () => net.startPlayit(syncNetworkToCloud), // Passes the Cloud Sync callback seamlessly!
    stopPlayit: net.stopPlayit, 
    getPublicIP: net.getPublicIP, 
    waitForPublicIP: net.waitForPublicIP, 
    resetNetworkAccount, forceReauth, backupWorldToDrive, listDriveBackups, deleteDriveBackup, restoreDriveBackup ,
    listFiles: mc.listFiles, 
    deleteLocalFile: mc.deleteLocalFile, 
    generateNewWorld: mc.generateNewWorld,
    openFolderInWindows: mc.openFolderInWindows,
    exportLocalWorld: mc.exportLocalWorld,
    importLocalWorld: mc.importLocalWorld
};