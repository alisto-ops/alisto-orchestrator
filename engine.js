const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');

let currentMcProcess = null;
let currentPlayitProcess = null;
let currentPlayitIP = null; // <-- The new passage memory!

// --- 1. THE MEGA ROUTER & DOWNLOADER ---
async function downloadServer(type, version) {
    try {
        console.log(`[System] Locating ${type.toUpperCase()} version ${version}...`);
        
        const serverFolder = path.join(__dirname, 'servers');
        if (!fs.existsSync(serverFolder)) fs.mkdirSync(serverFolder);

        let downloadUrl = "";
        let fileName = `${type}-${version}.jar`;
        const filePath = path.join(serverFolder, fileName);

        const paperFamily = ['paper', 'folia', 'velocity', 'waterfall'];

        if (paperFamily.includes(type)) {
            const { data } = await axios.get(`https://api.papermc.io/v2/projects/${type}/versions/${version}/builds`);
            const latestBuild = data.builds[data.builds.length - 1];
            downloadUrl = `https://api.papermc.io/v2/projects/${type}/versions/${version}/builds/${latestBuild.build}/downloads/${latestBuild.downloads.application.name}`;
        } else if (type === 'purpur') {
            downloadUrl = `https://api.purpurmc.org/v2/purpur/${version}/latest/download`;
        } else if (type === 'vanilla' || type === 'snapshot') {
            const { data: manifest } = await axios.get('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
            const versionData = manifest.versions.find(v => v.id === version);
            if (!versionData) throw new Error(`Mojang version ${version} not found!`);
            const { data: versionMeta } = await axios.get(versionData.url);
            downloadUrl = versionMeta.downloads.server.url;
        } else if (type === 'fabric') {
            console.log(`[System] Negotiating with Fabric API...`);
            const { data: loaderData } = await axios.get(`https://meta.fabricmc.net/v2/versions/loader/${version}`);
            const { data: installerData } = await axios.get('https://meta.fabricmc.net/v2/versions/installer');
            downloadUrl = `https://meta.fabricmc.net/v2/versions/loader/${version}/${loaderData[0].loader.version}/${installerData[0].version}/server/jar`;
        }  else if (['quilt', 'forge', 'neoforge', 'spigot', 'modpacks', 'arclight', 'glowstone'].includes(type)) {
            console.error(`[System Block] ${type.toUpperCase()} requires a custom installer bridge. Module not yet built.`);
            return null;
        }  else {
            console.error(`[Error] Unknown server type: ${type}`);
            return null;
        }

        if (fs.existsSync(filePath)) {
            console.log(`[System] ${fileName} already exists. Skipping download!`);
            return filePath; 
        }

        console.log(`[System] Downloading ${fileName}... Please wait.`);
        const response = await axios({ url: downloadUrl, method: 'GET', responseType: 'arraybuffer' });
        fs.writeFileSync(filePath, Buffer.from(response.data));
        
        console.log(`[Success] ${fileName} downloaded successfully!`);
        return filePath;

    } catch (error) {
        console.error(`[Error] Download Failed: ${error.message}`);
        return null;
    }
}

// --- 2. THE BOOT PROCESS ---
function startMinecraftProcess(jarPath, ram) {
    const serverFolder = path.dirname(jarPath);
    const jarName = path.basename(jarPath);

    fs.writeFileSync(path.join(serverFolder, 'eula.txt'), 'eula=true');
    console.log(`[System] Booting ${jarName} with ${ram}GB of RAM...`);

    currentMcProcess = spawn('java', ['-Xmx' + ram + 'G', '-Dterminal.jline=false', '-jar', jarName, 'nogui'], { cwd: serverFolder });

    currentMcProcess.stdout.on('data', (data) => console.log(data.toString().trim()));
    currentMcProcess.stderr.on('data', (data) => console.error(`[Server Error] ${data.toString().trim()}`));
    currentMcProcess.on('close', (code) => {
        console.log(`[System] Server process exited with code ${code}`);
        currentMcProcess = null; 
    });
}

function stopMinecraftProcess() {
    if (currentMcProcess) {
        console.log(`[System] Sending safe shutdown command...`);
        currentMcProcess.stdin.write('stop\n'); 
    } else {
        console.log(`[System] No server is currently running.`);
    }
}

function sendCommand(cmd) {
    if (!currentMcProcess) {
        console.error(`[Error] Server is not currently running.`);
        return;
    }
    currentMcProcess.stdin.write(cmd + '\n');
    console.log(`[Command Sent] ${cmd}`);
}

// --- 3. NATIVE PROPERTIES EDITOR ---
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
    let content = '# Minecraft server properties\n# Generated by Alisto Orchestrator\n';
    for (const [key, value] of Object.entries(newProps)) {
        content += `${key}=${value}\n`;
    }
    fs.writeFileSync(propsPath, content);
    console.log(`[System] server.properties successfully saved!`);
}

// --- 4. PLAYIT.GG INTEGRATION (WINDOWS ONLY) ---
async function setupPlayit() {
    try {
        const binFolder = path.join(__dirname, 'bin');
        if (!fs.existsSync(binFolder)) fs.mkdirSync(binFolder);

        const playitPath = path.join(binFolder, 'playit.exe');
        if (fs.existsSync(playitPath)) {
            console.log(`[System] playit.exe agent found.`);
            return playitPath;
        }

        console.log(`[System] Downloading Playit.gg Windows Agent... Please wait.`);
        const downloadUrl = 'https://github.com/playit-cloud/playit-agent/releases/latest/download/playit-windows-x86_64.exe';
        
        const response = await axios({ url: downloadUrl, method: 'GET', responseType: 'arraybuffer' });
        fs.writeFileSync(playitPath, Buffer.from(response.data));
        
        console.log(`[Success] playit.exe downloaded successfully!`);
        return playitPath;
    } catch (error) {
        console.error(`[Error] Playit Download Failed: ${error.message}`);
        return null;
    }
}

function startPlayit() {
    const playitPath = path.join(__dirname, 'bin', 'playit.exe');
    if (!fs.existsSync(playitPath)) {
        console.error(`[Error] playit.exe not found! Please run setupPlayit first.`);
        return;
    }

    console.log(`[System] Booting Playit.gg Tunnel in the background...`);
    currentPlayitProcess = spawn(playitPath, [], { cwd: path.join(__dirname, 'bin') });

    let playitBuffer = '';
    let ipClaimed = false;

    const handleData = (data) => {
        const cleanText = data.toString().replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
        playitBuffer += cleanText;

        const claimMatch = playitBuffer.match(/(https:\/\/playit\.gg\/claim\/[a-zA-Z0-9]+)/);
        if (claimMatch) {
            console.log(`[System] TUNNEL ACTION REQUIRED: <a href="${claimMatch[1]}" target="_blank" style="color: #89b4fa;">Click here to authenticate</a>`);
            playitBuffer = ''; 
            return;
        }

        const ipMatch = playitBuffer.match(/([a-zA-Z0-9-]+\.(?:gl\.joinmc\.link|auto\.playit\.gg)(?::\d+)?)/);
        if (ipMatch && !ipClaimed) {
            currentPlayitIP = ipMatch[1]; // <-- SAVE IT TO MEMORY HERE!
            console.log(`[System] Public IP Ready! Friends can join using: <span style="color: #a6e3a1; font-weight: bold;">${currentPlayitIP}</span>`);
            ipClaimed = true; 
        }

        if (playitBuffer.length > 500) {
            playitBuffer = playitBuffer.slice(-500);
        }
    };

    currentPlayitProcess.stdout.on('data', handleData);
    currentPlayitProcess.stderr.on('data', handleData);

    currentPlayitProcess.on('close', (code) => {
        currentPlayitProcess = null;
    });
}

function stopPlayit() {
    if (currentPlayitProcess) {
        currentPlayitProcess.kill();
        currentPlayitProcess = null;
        currentPlayitIP = null; // <-- CLEAR MEMORY ON SHUTDOWN
        console.log(`[System] Network tunnel safely closed.`);
    }
}

// --- THE PASSAGE (For Future API/Database Routing) ---
function getPublicIP() {
    return currentPlayitIP; 
}

// Don't forget to export the new getPublicIP function!
module.exports = { downloadServer, startMinecraftProcess, stopMinecraftProcess, readProperties, writeProperties, setupPlayit, startPlayit, stopPlayit, getPublicIP, sendCommand };