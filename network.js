const os = require('os');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');
const { shell } = require('electron');

let currentPlayitProcess = null;
let currentPlayitIP = null;

function getPlayitConfigPath() {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const pathGG = path.join(localAppData, 'playit_gg', 'playit.toml');
    const pathNormal = path.join(localAppData, 'playit', 'playit.toml');
    if (fs.existsSync(pathGG)) return pathGG;
    if (fs.existsSync(pathNormal)) return pathNormal;
    return pathGG;
}

function showSetupScreen() {
    if (document.getElementById('alisto-setup-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'alisto-setup-overlay';
    overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(17, 17, 27, 0.95); backdrop-filter: blur(10px); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 9999; color: white; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;`;
    
    overlay.innerHTML = `
        <div style="background: #1e1e2e; padding: 50px; border-radius: 16px; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.5); border: 1px solid #313244;">
            <h1 style="margin: 0 0 10px 0; color: #cba6f7; font-size: 32px;">Magnesium Network</h1>
            <h3 style="margin: 0 0 20px 0; color: #a6adc8; font-weight: 400;">Powered by Playit.gg</h3>
            <p style="color: #bac2de; margin-bottom: 30px; max-width: 380px; line-height: 1.5;">Link your account to provision a permanent, static IP address. <br><br><span style="font-size: 13px; color: #f38ba8;">*If the browser asks you to "Create a tunnel", please select <b>Minecraft Java</b>.</span></p>
            <button id="playit-signin-btn" disabled style="background: #45475a; color: #a6adc8; border: none; padding: 14px 30px; font-size: 16px; font-weight: bold; border-radius: 8px; cursor: not-allowed; transition: all 0.3s ease; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">Connecting to network...</button>
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
    } catch (error) { return null; }
}

// NOTICE: We added a "callback" so this file can pass the IP back to the Cloud engine!
function startPlayit(onIpClaimedCallback) {
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
            const pendingClaimUrl = claimMatch[1];
            
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

                    const checkClaim = setInterval(() => {
                        if (fs.existsSync(getPlayitConfigPath())) {
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
            // Send the IP back to the main engine to save to Supabase!
            if (onIpClaimedCallback) onIpClaimedCallback(currentPlayitIP);
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

function getPublicIP() { return currentPlayitIP; }

async function waitForPublicIP(timeoutMs = 20000) {
    if (currentPlayitIP) return currentPlayitIP; 
    const startTime = Date.now();
    return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
            if (currentPlayitIP) { clearInterval(checkInterval); resolve(currentPlayitIP); } 
            else if (Date.now() - startTime > timeoutMs) { clearInterval(checkInterval); reject(new Error("Network timeout")); }
        }, 500); 
    });
}

module.exports = {
    getPlayitConfigPath, showSetupScreen, setupPlayit, startPlayit, stopPlayit, getPublicIP, waitForPublicIP
};