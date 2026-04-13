const os = require('os');
const { shell } = require('electron'); 
const http = require('http'); 
const path = require('path');
const archiver = require('archiver');
const FormData = require('form-data');
require('dotenv').config({ path: path.join(__dirname, '.env') }); 

const fs = require('fs');
const axios = require('axios');
const { spawn } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

let currentMcProcess = null;
let currentPlayitProcess = null;
let currentPlayitIP = null;
let pendingClaimUrl = null; 
let authServer = null; 

// THE TOKENS
let googleDriveToken = null; 
let googleRefreshToken = null; 

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function getPlayitConfigPath() {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const pathGG = path.join(localAppData, 'playit_gg', 'playit.toml');
    const pathNormal = path.join(localAppData, 'playit', 'playit.toml');

    if (fs.existsSync(pathGG)) return pathGG;
    if (fs.existsSync(pathNormal)) return pathNormal;
    return pathGG; 
}

// --- CLOUD ARCHITECTURE & VAULT ---
async function testCloudConnection() {
    console.log("[Cloud] Establishing uplink to Supabase...");
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
        console.error("[Cloud Critical] Vault is empty! .env file not loaded properly.");
        return;
    }
    try {
        const { error } = await supabase.from('alisto_connection_test').select('*').limit(1);
        if (error && (error.code === '42P01' || error.code === 'PGRST205'))  {
            console.log("[Cloud Success] Database uplink established and keys verified!");
        } else if (error) {
            console.error("[Cloud Error] Connection failed: " + JSON.stringify(error));
        } else {
            console.log("[Cloud Success] Database uplink established!");
        }
    } catch (err) {
        console.error("[Cloud Critical Error] Network block or invalid URL: " + err.message);
    }
}
testCloudConnection();

async function syncNetworkToCloud(ip) {
    console.log(`[Cloud Vault] Initiating secure network sync...`);
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("No active user session.");
        const userId = session.user.id;

        const configPath = getPlayitConfigPath();
        let rawKeyText = null;
        if (fs.existsSync(configPath)) {
            rawKeyText = fs.readFileSync(configPath, 'utf8');
        }

        const { data: existing } = await supabase.from('server_ips')
            .select('id').eq('server_name', 'Magnesium Main').eq('user_id', userId).single();

        if (existing) {
            const { error } = await supabase.from('server_ips')
                .update({ 
                    playit_ip: ip, 
                    playit_secret_key: rawKeyText,
                    google_refresh_token: googleRefreshToken, // SAVING THE PERMANENT TOKEN!
                    last_updated: new Date().toISOString() 
                })
                .eq('id', existing.id);
            if (error) throw error;
        } else {
            const { error } = await supabase.from('server_ips')
                .insert({ 
                    server_name: 'Magnesium Main', 
                    playit_ip: ip, 
                    playit_secret_key: rawKeyText,
                    google_refresh_token: googleRefreshToken, // SAVING THE PERMANENT TOKEN!
                    user_id: userId, 
                    last_updated: new Date().toISOString() 
                });
            if (error) throw error;
        }
        
        console.log(`[Cloud Vault Success] IP, Network Key, and Ghost Tokens securely locked in the vault!`);
    } catch (err) {
        console.error(`[Cloud Vault Critical] Sync crashed: ` + err.message);
    }
}

async function restoreNetworkKey() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return false;

        console.log("[Cloud Vault] Searching for existing network key in the cloud...");
        const { data, error } = await supabase.from('server_ips')
            .select('playit_secret_key')
            .eq('server_name', 'Magnesium Main')
            .eq('user_id', session.user.id)
            .single();

        if (error || !data || !data.playit_secret_key) {
            console.log("[Cloud Vault] No backup found. First-time setup required.");
            return false; 
        }

        const configPath = getPlayitConfigPath();
        const folderPath = path.dirname(configPath);
        
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }

        fs.writeFileSync(configPath, data.playit_secret_key);
        console.log("[Cloud Vault Success] Network key restored from cloud! Bypassing login screen.");
        return true;
    } catch (err) {
        console.error("[Cloud Vault Critical] Restore crashed: " + err.message);
        return false;
    }
}

// --- 1. THE MEGA ROUTER & DOWNLOADER ---
async function downloadServer(type, version) {
    try {
        const serverFolder = path.join(__dirname, 'servers');
        if (!fs.existsSync(serverFolder)) fs.mkdirSync(serverFolder);

        let downloadUrl = "";
        let fileName = `${type}-${version}.jar`;
        const filePath = path.join(serverFolder, fileName);

        if (['paper', 'folia', 'velocity', 'waterfall'].includes(type)) {
            const { data } = await axios.get(`https://api.papermc.io/v2/projects/${type}/versions/${version}/builds`);
            const latestBuild = data.builds[data.builds.length - 1];
            downloadUrl = `https://api.papermc.io/v2/projects/${type}/versions/${version}/builds/${latestBuild.build}/downloads/${latestBuild.downloads.application.name}`;
        } else if (type === 'purpur') {
            downloadUrl = `https://api.purpurmc.org/v2/purpur/${version}/latest/download`;
        } else if (type === 'vanilla' || type === 'snapshot') {
            const { data: manifest } = await axios.get('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
            const versionData = manifest.versions.find(v => v.id === version);
            const { data: versionMeta } = await axios.get(versionData.url);
            downloadUrl = versionMeta.downloads.server.url;
        } else if (type === 'fabric') {
            const { data: loaderData } = await axios.get(`https://meta.fabricmc.net/v2/versions/loader/${version}`);
            const { data: installerData } = await axios.get('https://meta.fabricmc.net/v2/versions/installer');
            downloadUrl = `https://meta.fabricmc.net/v2/versions/loader/${version}/${loaderData[0].loader.version}/${installerData[0].version}/server/jar`;
        } else {
            return null;
        }

        if (fs.existsSync(filePath)) return filePath; 

        console.log(`[System] Downloading ${fileName}... Please wait.`);
        const response = await axios({ url: downloadUrl, method: 'GET', responseType: 'arraybuffer' });
        fs.writeFileSync(filePath, Buffer.from(response.data));
        return filePath;
    } catch (error) {
        return null;
    }
}

// --- 2. THE BOOT PROCESS ---
function startMinecraftProcess(jarPath, ram, onExitCallback) {
    const serverFolder = path.dirname(jarPath);
    const jarName = path.basename(jarPath);
    fs.writeFileSync(path.join(serverFolder, 'eula.txt'), 'eula=true');
    console.log(`[System] Booting ${jarName} with ${ram}GB of RAM...`);
    
    currentMcProcess = spawn('java', ['-Xmx' + ram + 'G', '-Dterminal.jline=false', '-jar', jarName, 'nogui'], { cwd: serverFolder });
    
    currentMcProcess.stdout.on('data', (data) => console.log(data.toString().trim()));
    currentMcProcess.stderr.on('data', (data) => console.error(`[Server Error] ${data.toString().trim()}`));
    
    currentMcProcess.on('exit', (code) => {
        console.log(`[System] Java process terminated with exit code ${code}`);
    });

    currentMcProcess.on('close', (code) => { 
        console.log(`[System] Server stream closed securely.`);
        currentMcProcess = null; 
        if (onExitCallback) onExitCallback(); 
    });
}

function stopMinecraftProcess() {
    if (currentMcProcess) currentMcProcess.stdin.write('stop\n'); 
}

function sendCommand(cmd) {
    if (currentMcProcess) currentMcProcess.stdin.write(cmd + '\n');
}

function readProperties() {
    const propsPath = path.join(__dirname, 'servers', 'server.properties');
    if (!fs.existsSync(propsPath)) return null;
    const properties = {};
    fs.readFileSync(propsPath, 'utf8').split('\n').forEach(line => {
        if (line.trim() && !line.startsWith('#')) {
            const [key, ...val] = line.split('=');
            properties[key.trim()] = val.join('=').trim();
        }
    });
    return properties;
}

function writeProperties(newProps) {
    const propsPath = path.join(__dirname, 'servers', 'server.properties');
    let content = '# Minecraft server properties\n';
    for (const [key, value] of Object.entries(newProps)) content += `${key}=${value}\n`;
    fs.writeFileSync(propsPath, content);
}

function forceOfflineMode(isCracked) {
    const propsPath = path.join(__dirname, 'servers', 'server.properties');
    const serverFolder = path.dirname(propsPath);
    if (!fs.existsSync(serverFolder)) fs.mkdirSync(serverFolder, { recursive: true });

    let props = {};
    if (fs.existsSync(propsPath)) {
        fs.readFileSync(propsPath, 'utf8').split('\n').forEach(line => {
            if (line.trim() && !line.startsWith('#')) {
                const [key, ...val] = line.split('=');
                props[key.trim()] = val.join('=').trim();
            }
        });
    }
    
    props['online-mode'] = isCracked ? 'false' : 'true';
    
    let content = '# Minecraft server properties\n';
    for (const [key, value] of Object.entries(props)) content += `${key}=${value}\n`;
    fs.writeFileSync(propsPath, content);
}

// --- 4. PLAYIT.GG INTEGRATION ---
function showSetupScreen() {
    if (document.getElementById('alisto-setup-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'alisto-setup-overlay';
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(17, 17, 27, 0.95); backdrop-filter: blur(10px);
        display: flex; flex-direction: column; align-items: center; justify-content: center; 
        z-index: 9999; color: white; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    `;
    
    overlay.innerHTML = `
        <div style="background: #1e1e2e; padding: 50px; border-radius: 16px; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.5); border: 1px solid #313244;">
            <h1 style="margin: 0 0 10px 0; color: #cba6f7; font-size: 32px;">Magnesium Network</h1>
            <h3 style="margin: 0 0 20px 0; color: #a6adc8; font-weight: 400;">Powered by Playit.gg</h3>
            <p style="color: #bac2de; margin-bottom: 30px; max-width: 380px; line-height: 1.5;">
                Link your account to provision a permanent, static IP address. <br><br>
                <span style="font-size: 13px; color: #f38ba8;">*If the browser asks you to "Create a tunnel" after logging in, please select <b>Minecraft Java</b>.</span>
            </p>
            <button id="playit-signin-btn" disabled style="
                background: #45475a; color: #a6adc8; border: none; padding: 14px 30px;
                font-size: 16px; font-weight: bold; border-radius: 8px; cursor: not-allowed;
                transition: all 0.3s ease; box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            ">Connecting to network...</button>
        </div>
    `;
    document.body.appendChild(overlay);
}

async function setupPlayit() {
    try {
        const binFolder = path.join(__dirname, 'bin');
        if (!fs.existsSync(binFolder)) fs.mkdirSync(binFolder);
        const playitPath = path.join(binFolder, 'playit.exe');
        if (fs.existsSync(playitPath)) return playitPath;

        console.log(`[System] Downloading Playit.gg Windows Agent...`);
        const response = await axios({ url: 'https://github.com/playit-cloud/playit-agent/releases/latest/download/playit-windows-x86_64.exe', method: 'GET', responseType: 'arraybuffer' });
        fs.writeFileSync(playitPath, Buffer.from(response.data));
        return playitPath;
    } catch (error) {
        return null;
    }
}

function startPlayit() {
    if (currentPlayitProcess) return; 

    const playitPath = path.join(__dirname, 'bin', 'playit.exe');
    if (!fs.existsSync(playitPath)) return;

    currentPlayitProcess = spawn(playitPath, [], { cwd: path.join(__dirname, 'bin') });

    let playitBuffer = '';
    let ipClaimed = false;
    let claimLock = false; 

    const handleData = (data) => {
        const cleanText = data.toString().replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
        playitBuffer += cleanText;

        const claimMatch = playitBuffer.match(/(https:\/\/playit\.gg\/claim\/[a-zA-Z0-9]+)/);
        if (claimMatch && !claimLock) {
            claimLock = true;
            pendingClaimUrl = claimMatch[1];
            
            const signInBtn = document.getElementById('playit-signin-btn');
            if (signInBtn) {
                signInBtn.innerText = "Sign in via Web Browser";
                signInBtn.style.background = "#89b4fa"; 
                signInBtn.style.color = "#11111b";
                signInBtn.style.cursor = "pointer";
                signInBtn.disabled = false;
                
                signInBtn.onclick = () => {
                    shell.openExternal(pendingClaimUrl);
                    signInBtn.innerText = "Waiting for authorization...";
                    signInBtn.style.background = "#a6e3a1"; 
                    signInBtn.disabled = true;
                    signInBtn.style.cursor = "wait";

                    const playitConfigPath = getPlayitConfigPath();

                    const checkClaim = setInterval(() => {
                        if (fs.existsSync(playitConfigPath)) {
                            clearInterval(checkClaim); 
                            const overlay = document.getElementById('alisto-setup-overlay');
                            if (overlay) overlay.remove(); 
                        }
                    }, 1000); 
                };
            }
            playitBuffer = ''; 
            return;
        }

        const ipMatch = playitBuffer.match(/([a-zA-Z0-9-]+\.(?:gl\.joinmc\.link|auto\.playit\.gg)(?::\d+)?)/);
        if (ipMatch && !ipClaimed) {
            currentPlayitIP = ipMatch[1]; 
            console.log(`[Magnesium Network] IP Address: ${currentPlayitIP}`);
            ipClaimed = true; 
            syncNetworkToCloud(currentPlayitIP); 
        }

        if (playitBuffer.includes("0 tunnels") && !claimLock) {
            console.log(`[System Warning] Agent connected, but no tunnel exists! Please click 'Create a tunnel' -> 'Minecraft Java' on the Playit website.`);
            playitBuffer = playitBuffer.replace("0 tunnels", "waiting..."); 
        }

        if (playitBuffer.length > 500) playitBuffer = playitBuffer.slice(-500);
    };

    currentPlayitProcess.stdout.on('data', handleData);
    currentPlayitProcess.stderr.on('data', handleData);
    currentPlayitProcess.on('close', () => { currentPlayitProcess = null; });
}

function stopPlayit() {
    if (currentPlayitProcess) {
        currentPlayitProcess.kill();
        currentPlayitProcess = null;
        currentPlayitIP = null;
        console.log(`[System] Network tunnel safely closed.`);
    }
}

async function resetNetworkAccount() {
    console.warn("[WARNING] Initiating Network Account Reset.");
    stopPlayit();
    
    const playitConfigPath = getPlayitConfigPath();
    if (fs.existsSync(playitConfigPath)) {
        fs.unlinkSync(playitConfigPath);
        console.log("[System] Local network keys destroyed.");
    }

    await supabase.from('server_ips').update({ playit_secret_key: null }).eq('server_name', 'Magnesium Main');
    console.log("[Cloud Vault] Cloud backup purged. App will ask for login on next boot.");
}

function getPublicIP() {
    return currentPlayitIP; 
}

// === PHASE 1: IDENTITY ===

function showGoogleLoginScreen() {
    if (document.getElementById('alisto-login-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'alisto-login-overlay';
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(17, 17, 27, 0.85); backdrop-filter: blur(5px);
        display: flex; flex-direction: column; align-items: center; justify-content: center; 
        z-index: 10000; color: white; font-family: 'Segoe UI', Tahoma, sans-serif;
    `;
    
    overlay.innerHTML = `
        <div style="background: #1e1e2e; padding: 50px; border-radius: 16px; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.5); border: 1px solid #313244;">
            <h1 style="margin: 0 0 10px 0; color: #89b4fa; font-size: 32px;">Magnesium Identity</h1>
            <p style="color: #bac2de; margin-bottom: 30px; max-width: 380px; line-height: 1.5;">
                Secure your server infrastructure. Sign in with Google to access your Cloud Vault and World Backups.
            </p>
            <button id="google-signin-btn" style="
                background: white; color: #11111b; border: none; padding: 14px 30px;
                font-size: 16px; font-weight: bold; border-radius: 8px; cursor: pointer;
                transition: all 0.3s ease; box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                display: flex; align-items: center; justify-content: center; gap: 10px; margin: 0 auto;
            ">
                <img src="https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg" width="20" height="20">
                Sign in with Google
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
        if (authServer) {
            authServer.close();
            authServer = null;
        }

        authServer = http.createServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');

            if (req.method === 'GET' && req.url.startsWith('/auth')) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`
                    <html>
                    <body style="background: #1e1e2e; color: #cdd6f4; font-family: sans-serif; display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh;">
                        <h1 style="color: #a6e3a1;">Authentication Successful!</h1>
                        <p>You can close this tab and return to Magnesium.</p>
                        <script>
                            fetch('http://127.0.0.1:3000/token', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ hash: window.location.hash })
                            }).then(() => {
                                setTimeout(() => window.close(), 1000); 
                            }).catch(err => console.error("Token send failed:", err));
                        </script>
                    </body>
                    </html>
                `);
            } 
            else if (req.method === 'POST' && req.url === '/token') {
                let body = '';
                req.on('data', chunk => { body += chunk.toString(); });
                req.on('end', async () => {
                    const data = JSON.parse(body);
                    const hash = data.hash;

                    res.writeHead(200);
                    res.end('OK');

                    authServer.close(); 
                    authServer = null;

                    const params = new URLSearchParams(hash.replace('#', '?'));
                    const accessToken = params.get('access_token');
                    const refreshToken = params.get('refresh_token');
                    
                    const providerToken = params.get('provider_token');
                    const providerRefreshToken = params.get('provider_refresh_token');
                    
                    if (providerToken) {
                        googleDriveToken = providerToken;
                    }
                    if (providerRefreshToken) {
                        googleRefreshToken = providerRefreshToken;
                        console.log("[Identity] Google Permanent Refresh Token captured!");
                    }

                    if (accessToken && refreshToken) {
                        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
                            access_token: accessToken,
                            refresh_token: refreshToken
                        });

                        if (!sessionError) {
                            console.log(`[Identity] Successfully authenticated as: ${sessionData.user.email}`);
                            const overlay = document.getElementById('alisto-login-overlay');
                            if (overlay) overlay.remove();
                            
                            // Immediately force a sync to save the tokens to the database
                            const currentIp = getPublicIP();
                            if (currentIp) syncNetworkToCloud(currentIp);

                            autoProvisionNetwork();
                        } else {
                            console.error("[Identity Error] Failed to verify Google session.");
                        }
                    }
                });
            }
        });

        authServer.on('error', (e) => {
            console.error("[Identity Server Error] Port crash: " + e.message);
            if (btn) {
                btn.innerText = "Error: " + (e.code || "UNKNOWN");
                btn.style.background = "#f38ba8";
            }
        });

       authServer.listen(3000, '127.0.0.1', async () => {
            console.log("[Identity] Awaiting secure callback from Web Browser...");
            
            const { data, error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: { 
                    redirectTo: 'http://127.0.0.1:3000/auth',
                    skipBrowserRedirect: true,
                    scopes: 'https://www.googleapis.com/auth/drive.file',
                    queryParams: {
                        access_type: 'offline',
                        prompt: 'consent'
                    }
                }
            });

            if (error) {
                console.error("[Identity Error] " + error.message);
                if (btn) {
                    btn.innerText = "Supabase Auth Error!";
                    btn.style.background = "#f38ba8";
                }
                return; 
            }

            if (btn) {
                btn.innerText = "Check your browser!";
                btn.style.background = "#a6e3a1";
            }
            
            try {
                shell.openExternal(data.url); 
            } catch (shellErr) {
                if (btn) {
                    btn.innerText = "Cannot open browser!";
                    btn.style.background = "#f38ba8";
                }
            }
        });

    } catch (err) {
        console.error("[Identity Error] " + err.message);
        if (btn) {
            btn.innerText = "Fatal Error!";
            btn.style.background = "#f38ba8";
        }
    }
}

async function autoProvisionNetwork() {
    const playitConfigPath = getPlayitConfigPath();

    if (!fs.existsSync(playitConfigPath)) {
        const restored = await restoreNetworkKey();
        if (restored) {
            console.log("[System] Network is securely linked via Cloud Vault. Ready for launch.");
            startPlayit(); 
        } else {
            console.log("[System] No Network Key Found. Displaying Setup Screen...");
            showSetupScreen(); 
            startPlayit();     
        }
    } else {
        console.log("[System] Network is securely linked locally. Ready for launch.");
        startPlayit(); 
    }
}

// --- THE NEW GHOST BOOT SEQUENCE ---
async function checkIdentityAndBoot() {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
        console.log("[System] No active identity session. Requesting authentication...");
        showGoogleLoginScreen();
    } else {
        console.log(`[Identity] Welcome back, ${session.user.email}`);
        
        // 1. THE GHOST BOOT: Silently pull the permanent token from Supabase
        try {
            console.log("[Cloud Vault] Attempting Ghost Boot for Google Drive...");
            const { data, error } = await supabase.from('server_ips')
                .select('google_refresh_token')
                .eq('server_name', 'Magnesium Main')
                .eq('user_id', session.user.id)
                .single();

            if (data && data.google_refresh_token) {
                // 2. Ping Google in the background to get a fresh 1-hour token!
                if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
                    throw new Error("Missing GOOGLE_CLIENT_ID or SECRET in .env file.");
                }
                
                const response = await axios.post('https://oauth2.googleapis.com/token', {
                    client_id: process.env.GOOGLE_CLIENT_ID,
                    client_secret: process.env.GOOGLE_CLIENT_SECRET,
                    refresh_token: data.google_refresh_token,
                    grant_type: 'refresh_token'
                });
                
                googleDriveToken = response.data.access_token;
                console.log("[Cloud Vault] Ghost Boot Successful! Google Drive token restored silently.");
            } else {
                console.log("[Cloud Vault] No permanent token found. You may need to click 'Sign Out' and log in again.");
            }
        } catch (e) {
            console.error("[Cloud Vault Warning] Ghost Boot failed: " + e.message);
        }

        autoProvisionNetwork();
    }
}

setTimeout(checkIdentityAndBoot, 100);

async function waitForPublicIP(timeoutMs = 20000) {
    if (currentPlayitIP) return currentPlayitIP; 
    
    const startTime = Date.now();
    return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
            if (currentPlayitIP) {
                clearInterval(checkInterval);
                resolve(currentPlayitIP);
            } else if (Date.now() - startTime > timeoutMs) {
                clearInterval(checkInterval);
                reject(new Error("Network timeout"));
            }
        }, 500); 
    });
}

async function backupWorldToDrive() {
    console.log("[Cloud Vault] Initiating World Backup to Google Drive...");
    try {
        if (!googleDriveToken) {
            throw new Error("No Drive Token in RAM. You must clear cache, log out and log back in to get a fresh token.");
        }

        const worldFolder = path.join(__dirname, 'servers', 'world');
        if (!fs.existsSync(worldFolder)) {
            console.log("[Cloud Warning] No world folder found. You must start the server at least once to generate a world.");
            return false;
        }

        const zipPath = path.join(__dirname, 'servers', 'backup.zip');
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        await new Promise((resolve, reject) => {
            output.on('close', resolve);
            archive.on('error', reject);
            archive.pipe(output);
            archive.directory(worldFolder, 'world');
            archive.finalize();
        });
        console.log("[Cloud Vault] World compressed successfully! Beaming to Google Drive...");

        const form = new FormData();
        form.append('metadata', JSON.stringify({
            name: `Magnesium_World_${Date.now()}.zip`
        }), { contentType: 'application/json' });
        
        form.append('file', fs.createReadStream(zipPath));

        await axios.post('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', form, {
            headers: {
                ...form.getHeaders(),
                'Authorization': `Bearer ${googleDriveToken}` 
            }
        });

        fs.unlinkSync(zipPath);
        console.log("[Cloud Vault Success] World securely backed up to Google Drive!");
        return true;

    } catch (err) {
        let errorMsg = err.message;
        if (err.response && err.response.data && err.response.data.error) {
            errorMsg = err.response.data.error.message || JSON.stringify(err.response.data.error);
        }
        console.error("[Cloud Vault Error] Backup Failed: " + errorMsg);
        return false;
    }
}

module.exports = { 
    downloadServer, startMinecraftProcess, stopMinecraftProcess, readProperties, 
    writeProperties, setupPlayit, startPlayit, stopPlayit, getPublicIP, 
    sendCommand, resetNetworkAccount, forceOfflineMode, waitForPublicIP, backupWorldToDrive
};