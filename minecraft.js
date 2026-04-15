const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');

let currentMcProcess = null;

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

function startMinecraftProcess(jarPath, ram, onExitCallback) {
    const serverFolder = path.dirname(jarPath);
    const jarName = path.basename(jarPath);
    fs.writeFileSync(path.join(serverFolder, 'eula.txt'), 'eula=true');
    console.log(`[System] Booting ${jarName} with ${ram}GB of RAM...`);
    
    currentMcProcess = spawn('java', ['-Xmx' + ram + 'G', '-Dterminal.jline=false', '-jar', jarName, 'nogui'], { cwd: serverFolder });
    
    currentMcProcess.stdout.on('data', (data) => console.log(data.toString().trim()));
    currentMcProcess.stderr.on('data', (data) => console.error(`[Server Error] ${data.toString().trim()}`));
    
    currentMcProcess.on('exit', (code) => { console.log(`[System] Java process terminated with code ${code}`); });
    currentMcProcess.on('close', () => { 
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

function readLogFile() {
    const logPath = path.join(__dirname, 'servers', 'logs', 'latest.log');
    if (fs.existsSync(logPath)) return fs.readFileSync(logPath, 'utf8');
    return null;
}

async function shareLogToMclogs() {
    console.log("[System] Packaging log for mclo.gs API upload...");
    const logContent = readLogFile();
    if (!logContent) { console.error("[System Error] No log file to share."); return null; }
    try {
        const response = await axios.post('https://api.mclo.gs/1/log', `content=${encodeURIComponent(logContent)}`, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        if (response.data && response.data.success) {
            console.log(`[System Success] Log uploaded to: ${response.data.url}`);
            return response.data.url;
        } else {
            throw new Error(response.data.error || "Unknown API error");
        }
    } catch (err) {
        console.error("[System Error] Failed to upload to mclo.gs: " + err.message);
        return null;
    }
}

function getPlayerList(listType) {
    const filePath = path.join(__dirname, 'servers', `${listType}.json`);
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return [];
}

async function managePlayer(action, listType, username) {
    try {
        let uuid = "";
        if (action === 'add') {
            const response = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${username}`);
            if (response.data && response.data.id) {
                const rawId = response.data.id;
                uuid = `${rawId.substr(0,8)}-${rawId.substr(8,4)}-${rawId.substr(12,4)}-${rawId.substr(16,4)}-${rawId.substr(20)}`;
            } else {
                return { success: false, error: "Player not found in Mojang database." };
            }
        }
        const filePath = path.join(__dirname, 'servers', `${listType}.json`);
        let list = [];
        if (fs.existsSync(filePath)) list = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        if (action === 'add') {
            if (!list.some(p => p.name.toLowerCase() === username.toLowerCase())) {
                let entry = { uuid: uuid, name: username };
                if (listType === 'ops') { entry.level = 4; entry.bypassesPlayerLimit = false; }
                list.push(entry);
            }
        } else if (action === 'remove') {
            list = list.filter(p => p.name.toLowerCase() !== username.toLowerCase());
        }

        const serverFolder = path.join(__dirname, 'servers');
        if (!fs.existsSync(serverFolder)) fs.mkdirSync(serverFolder);
        fs.writeFileSync(filePath, JSON.stringify(list, null, 2));

        if (currentMcProcess) {
            let cmd = '';
            if (listType === 'whitelist') cmd = `whitelist ${action} ${username}`;
            if (listType === 'ops' && action === 'add') cmd = `op ${username}`;
            if (listType === 'ops' && action === 'remove') cmd = `deop ${username}`;
            if (listType === 'banned-players' && action === 'add') cmd = `ban ${username}`;
            if (listType === 'banned-players' && action === 'remove') cmd = `pardon ${username}`;
            if (cmd) currentMcProcess.stdin.write(cmd + '\n');
        }
        return { success: true, list: list };
    } catch (err) {
        console.error("[Player Manager Error] " + err.message);
        return { success: false, error: "Failed to connect to Mojang API." };
    }
}

async function exportLocalWorld() {
    if (currentMcProcess) return null;
    const worldFolder = path.join(__dirname, 'servers', 'world');
    if (!fs.existsSync(worldFolder)) return null;

    const os = require('os');
    const archiver = require('archiver');
    
    // Saves it right to the user's Downloads folder
    const downloadsFolder = path.join(os.homedir(), 'Downloads');
    const zipPath = path.join(downloadsFolder, `Magnesium_World_${Date.now()}.zip`);

    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    await new Promise((resolve, reject) => {
        output.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(output);
        archive.directory(worldFolder, 'world');
        archive.finalize();
    });

    return zipPath;
}

async function importLocalWorld(sourcePath, isZip) {
    if (currentMcProcess) return false;
    const worldFolder = path.join(__dirname, 'servers', 'world');
    
    try {
        if (fs.existsSync(worldFolder)) fs.rmSync(worldFolder, { recursive: true, force: true });
        
        if (isZip) {
            const tempDir = path.join(__dirname, 'servers', 'temp_extract');
            if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
            fs.mkdirSync(tempDir);
            
            await require('extract-zip')(sourcePath, { dir: tempDir });
            
            // THE FIX: Give Windows 1 second to release the file lock
            await new Promise(res => setTimeout(res, 1000));
            
            const items = fs.readdirSync(tempDir);
            // THE FIX: Use cpSync instead of rename to avoid Cross-Device/Lock crashes
            if (items.length === 1 && fs.statSync(path.join(tempDir, items[0])).isDirectory()) {
                fs.cpSync(path.join(tempDir, items[0]), worldFolder, { recursive: true });
            } else {
                fs.cpSync(tempDir, worldFolder, { recursive: true });
            }
            fs.rmSync(tempDir, { recursive: true, force: true });
        } else {
            // THE FIX: Wait 1 second and use cpSync
            await new Promise(res => setTimeout(res, 1000));
            fs.cpSync(sourcePath, worldFolder, { recursive: true });
        }
        return true;
    } catch (err) {
        console.error("[Import Error] Failed to process world file: ", err.message);
        return false;
    }
}

// Safely expose the process state for the Cloud Vault to read
function getMcProcess() { return currentMcProcess; }

// --- FILES & WORLDS ARCHITECTURE ---
function listFiles(subPath = '') {
    const targetDir = path.join(__dirname, 'servers', subPath);
    if (!fs.existsSync(targetDir)) return [];
    
    const items = fs.readdirSync(targetDir);
    return items.map(item => {
        const itemPath = path.join(targetDir, item);
        const stat = fs.statSync(itemPath);
        return {
            name: item,
            isDirectory: stat.isDirectory(),
            size: stat.size,
            path: path.join(subPath, item).replace(/\\/g, '/') // Normalized path
        };
    }).sort((a, b) => {
        if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
        return a.isDirectory ? -1 : 1; // Folders at the top
    });
}

function deleteLocalFile(subPath) {
    try {
        const target = path.join(__dirname, 'servers', subPath);
        if (fs.existsSync(target)) {
            if (fs.statSync(target).isDirectory()) {
                fs.rmSync(target, { recursive: true, force: true });
            } else {
                fs.unlinkSync(target);
            }
            return true;
        }
        return false;
    } catch (e) {
        console.error("Delete failed: ", e);
        return false;
    }
}

function generateNewWorld(options) {
    if (currentMcProcess) return false; // Prevent wipe while running!
    
    const worldDir = path.join(__dirname, 'servers', options.levelName || 'world');
    if (fs.existsSync(worldDir)) {
        fs.rmSync(worldDir, { recursive: true, force: true });
    }

    const propsPath = path.join(__dirname, 'servers', 'server.properties');
    let props = {};
    if (fs.existsSync(propsPath)) {
        fs.readFileSync(propsPath, 'utf8').split('\n').forEach(line => {
            if (line.trim() && !line.startsWith('#')) {
                const [key, ...val] = line.split('=');
                props[key.trim()] = val.join('=').trim();
            }
        });
    }

    props['level-name'] = options.levelName || 'world';
    props['level-seed'] = options.seed || '';
    props['generator-settings'] = options.generator || '';
    props['level-type'] = options.worldType || 'minecraft:normal';
    props['generate-structures'] = options.structures ? 'true' : 'false';
    props['hardcore'] = options.hardcore ? 'true' : 'false';

    let content = '# Minecraft server properties\n';
    for (const [key, value] of Object.entries(props)) content += `${key}=${value}\n`;
    fs.writeFileSync(propsPath, content);
    return true;
}

function openFolderInWindows(folderName = '') {
    const { shell } = require('electron');
    const targetPath = path.join(__dirname, 'servers', folderName);
    if (!fs.existsSync(targetPath)) fs.mkdirSync(targetPath, { recursive: true });
    shell.openPath(targetPath);
}

module.exports = {
    downloadServer, startMinecraftProcess, stopMinecraftProcess, sendCommand,
    readProperties, writeProperties, forceOfflineMode,
    readLogFile, shareLogToMclogs, getPlayerList, managePlayer, getMcProcess , listFiles, deleteLocalFile, generateNewWorld, 
    openFolderInWindows , exportLocalWorld , importLocalWorld
};