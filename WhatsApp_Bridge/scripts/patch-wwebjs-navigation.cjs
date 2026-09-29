const fs = require('fs');
const path = require('path');

const bridgeRoot = path.resolve(__dirname, '..');
const clientPath = path.join(bridgeRoot, 'node_modules', 'whatsapp-web.js', 'src', 'Client.js');
const packagePath = path.join(bridgeRoot, 'node_modules', 'whatsapp-web.js', 'package.json');
const marker = 'FIREBLADE_NAVIGATION_FIX_2026_09_11_V2';

function die(message) {
  console.error(`[Fireblade patch] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(clientPath)) die(`Client.js not found: ${clientPath}. Run npm.cmd install first.`);
if (!fs.existsSync(packagePath)) die(`whatsapp-web.js package.json not found: ${packagePath}`);

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
if (pkg.version !== '1.34.7') {
  die(`Expected whatsapp-web.js 1.34.7, found ${pkg.version}. Refusing to patch an unknown version.`);
}

const raw = fs.readFileSync(clientPath, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let src = raw.replace(/\r\n/g, '\n');

if (src.includes(marker)) {
  console.log('[Fireblade patch] Navigation fix already applied.');
  process.exit(0);
}

const originalNormalized = src;
let changes = 0;

const debugPolling = `        let start = Date.now();
        let timeout = this.options.authTimeoutMs;
        let res = false;
        while (start > Date.now() - timeout) {
            res = await this.pupPage.evaluate(
                'window.Debug?.VERSION != undefined',
            );
            if (res) {
                break;
            }
            await new Promise((r) => setTimeout(r, 200));
        }
        if (!res) {
            throw 'auth timeout';
        }`;

const debugWait = `        try {
            await this.pupPage.waitForFunction(
                'window.Debug?.VERSION != undefined',
                { timeout: this.options.authTimeoutMs, polling: 200 },
            );
        } catch (error) {
            if (error && error.name === 'TimeoutError') {
                throw 'auth timeout';
            }
            throw error;
        }`;

if (!src.includes(debugPolling)) {
  die('Could not find the Debug.VERSION polling block; refusing to make a partial patch.');
}
src = src.replace(debugPolling, debugWait);
changes++;

const readyPolling = `                    let start = Date.now();
                    let res = false;
                    while (start > Date.now() - 30000) {
                        // Check window.WWebJS Injection
                        res = await this.pupPage.evaluate(
                            'window.WWebJS != undefined',
                        );
                        if (res) {
                            break;
                        }
                        await new Promise((r) => setTimeout(r, 200));
                    }
                    if (!res) {
                        throw 'ready timeout';
                    }`;

const readyWait = `                    try {
                        await this.pupPage.waitForFunction(
                            'window.WWebJS != undefined',
                            { timeout: 30000, polling: 200 },
                        );
                    } catch (error) {
                        if (error && error.name === 'TimeoutError') {
                            throw 'ready timeout';
                        }
                        throw error;
                    }`;

if (!src.includes(readyPolling)) {
  die('Could not find the WWebJS readiness polling block; refusing to make a partial patch.');
}
src = src.replace(readyPolling, readyWait);
changes++;

// npm's 1.34.7 package has a blank line between the initial inject() and
// framenavigated registration. Match the exact installed layout reported by
// Fireblade's Windows staging machine, but tolerate either zero or one blank line.
const initPattern = /        await this\.inject\(\);\n(?:[ \t]*\n)?        this\.pupPage\.on\('framenavigated', async \(frame\) => \{\n            if \(frame\.url\(\)\.includes\('post_logout=1'\) \|\| this\.lastLoggedOut\) \{\n                this\.emit\(Events\.DISCONNECTED, 'LOGOUT'\);\n                await this\.authStrategy\.logout\(\);\n                await this\.authStrategy\.beforeBrowserInitialized\(\);\n                await this\.authStrategy\.afterBrowserInitialized\(\);\n                this\.lastLoggedOut = false;\n            \}\n            await this\.inject\(\);\n        \}\);/;

if (!initPattern.test(src)) {
  die('Could not find the initialize()/framenavigated block in the installed 1.34.7 Client.js; refusing to make a partial patch.');
}

const initFixed = `        // ${marker}: register navigation recovery before the first injection.
        this.pupPage.on('framenavigated', async (frame) => {
            if (frame.url().includes('post_logout=1') || this.lastLoggedOut) {
                this.emit(Events.DISCONNECTED, 'LOGOUT');
                await this.authStrategy.logout();
                await this.authStrategy.beforeBrowserInitialized();
                await this.authStrategy.afterBrowserInitialized();
                this.lastLoggedOut = false;
            }
            await this.inject();
        });

        await this.inject();`;

src = src.replace(initPattern, initFixed);
changes++;

if (changes !== 3) die(`Expected 3 navigation-safety changes, prepared ${changes}. Refusing to write.`);

const backupPath = `${clientPath}.fireblade-original`;
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, raw, 'utf8');
}

const output = eol === '\r\n' ? src.replace(/\n/g, '\r\n') : src;
fs.writeFileSync(clientPath, output, 'utf8');

console.log('[Fireblade patch] Applied WhatsApp Web navigation resilience fix to whatsapp-web.js 1.34.7.');
console.log('[Fireblade patch] Changes: Debug.VERSION waitForFunction; WWebJS readiness waitForFunction; framenavigated registered before first inject.');
console.log(`[Fireblade patch] Backup: ${backupPath}`);
