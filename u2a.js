import fs from 'fs';
import fetch from 'node-fetch';
import JSZip from 'jszip';

const DEFAULT_FILE_EXTENSIONS = ['.json', '.ttf', '.bin', '.png', '.jpg', '.bmp', '.jpeg', '.gif', '.ico', '.tiff', '.webp', '.image', '.pvr', '.pkm', '.mp3', '.ogg', '.wav', '.m4a'];
const CONCURRENT_DOWNLOADS = 400;

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadFile(url, timeout = 30000, delayMs = 5000) {
    let attempt = 1;
    while (true) {
        try {
            const response = await Promise.race([
                fetch(url),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Download timeout')), timeout)
                )
            ]);

            if (response.status === 404) return null;
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const buffer = Buffer.from(await response.arrayBuffer());
            return buffer;
        } catch (error) {
            console.error(`\nError downloading ${url}: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            attempt++;
        }
    }
}

async function timeoutProcessor(processor, item, timeout = 30000, delayMs = 5000) {
    let attempt = 1;
    while (true) {
        try {
            const result = await Promise.race([
                processor(item),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Download timeout')), timeout)
                )
            ]);
            return result;
        } catch (error) {
            await delay(delayMs);
            attempt++;
        }
    }
}

const BASE64_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
const values = new Array(123);
for (let i = 0; i < 123; ++i) { values[i] = 64; }
for (let i = 0; i < 64; ++i) { values[BASE64_KEYS.charCodeAt(i)] = i; }
const BASE64_VALUES = values;
const HexChars = '0123456789abcdef'.split('');
const _t = ['', '', '', ''];
const UuidTemplate = _t.concat(_t, '-', _t, '-', _t, '-', _t, '-', _t, _t, _t);
const Indices = UuidTemplate.map((x, i) => x === '-' ? NaN : i).filter(isFinite);

function decodeUuid(base64) {
    const strs = base64.split('@');
    const uuid = strs[0];
    if (uuid.length === 9) {
        return base64;
    }
    if (uuid.length !== 22) {
        return base64;
    }
    UuidTemplate[0] = base64[0];
    UuidTemplate[1] = base64[1];
    for (let i = 2, j = 2; i < 22; i += 2) {
        const lhs = BASE64_VALUES[base64.charCodeAt(i)];
        const rhs = BASE64_VALUES[base64.charCodeAt(i + 1)];
        UuidTemplate[Indices[j++]] = HexChars[lhs >> 2];
        UuidTemplate[Indices[j++]] = HexChars[((lhs & 3) << 2) | rhs >> 4];
        UuidTemplate[Indices[j++]] = HexChars[rhs & 0xF];
    }
    return base64.replace(uuid, UuidTemplate.join(''));
}

async function processInBatches(items, batchSize, processor) {
    const results = [];
    let processedCount = 0;
    let successCount = 0;
    let failureCount = 0;
    let retryCount = 0;
    let lastUpdateTime = Date.now();
    const totalItems = items.length;

    console.log(`\n> Starting batch processing of ${totalItems} items...`);

    const subBatchSize = 50;
    
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchPromises = [];
        
        for (let j = 0; j < batch.length; j += subBatchSize) {
            const subBatch = batch.slice(j, j + subBatchSize);
            const subBatchPromise = Promise.all(subBatch.map(item => 
                timeoutProcessor(processor, item, 30000, 5000)
            ));
            
            batchPromises.push(subBatchPromise.then(subResults => {
                const subBatchSuccess = subResults.filter(r => r !== null).length;
                successCount += subBatchSuccess;
                failureCount += subResults.length - subBatchSuccess;
                processedCount += subResults.length;
                
                const currentTime = Date.now();
                const timeDiff = (currentTime - lastUpdateTime) / 1000;
                const itemsPerSecond = subResults.length / timeDiff;
                lastUpdateTime = currentTime;
                
                process.stdout.write(
                    `\r> Progress: ${processedCount}/${totalItems} ` +
                    `(${Math.round((processedCount/totalItems)*100)}%)`
                );
                
                return subResults;
            }));
        }
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults.flat());
    }
    
    return results;
}

async function processBundleData(bundleData, serverName, activeExtensions) {
    const zip = new JSZip();
    let totalFiles = 0;
    let foundFiles = 0;

    if (!bundleData.uuids || !bundleData.versions) {
        console.error('\n[ERROR] Bundle data is missing required fields (uuids or versions)');
        return;
    }

    console.log('\n- Bundle Information:');
    console.log(`- Name: ${bundleData.name}`);
    console.log(`- Total UUIDs: ${bundleData.uuids.length}`);

    const processFile = async ({ url, filePath, baseType, fiveChar }) => {
        try {
            const data = await downloadFile(url);
            if (data) {
                zip.file(filePath, data);
                foundFiles++;
                return { success: true, filePath };
            }
            totalFiles++;
            return { success: false, filePath };
        } catch (error) {
            console.error(`Processing failed for ${filePath}: ${error.message}`);
            totalFiles++;
            return { success: false, filePath, error };
        }
    };

    const processBase = async (baseType) => {
        const base = bundleData[`${baseType}Base`];
        if (!base) {
            console.log(`\n${baseType} base not found in bundle data`);
            return;
        }
        
        const versions = bundleData.versions[baseType];
        if (!versions || !versions.length) {
            console.log(`\nNo versions found for ${baseType} base`);
            return;
        }

        console.log(`\n> Processing ${baseType} base`);

        const downloadTasks = [];

        for (let i = 0; i < versions.length; i += 2) {
            const entry = versions[i];
            const hash = versions[i + 1];
            
            if (typeof entry === 'number') {
                const encryptedUuid = bundleData.uuids[entry];
                const decryptedUuid = decodeUuid(encryptedUuid);
                const firstTwoChars = decryptedUuid.substring(0, 2);

                for (const ext of activeExtensions) {
                    const url = `${serverName}/assets/${bundleData.name}/${base}/${firstTwoChars}/${decryptedUuid}.${hash}${ext}`;
                    const filePath = `${bundleData.name}/${base}/${firstTwoChars}/${decryptedUuid}.${hash}${ext}`;
                    downloadTasks.push({ 
                        url, 
                        filePath,
                        baseType,
                        fiveChar: hash
                    });
                }
            } else {
                const firstTwoChars = entry.substring(0, 2);
                const groupedHash = `${firstTwoChars}/${entry}.${hash}`;

                for (const ext of activeExtensions) {
                    const url = `${serverName}/assets/${bundleData.name}/${base}/${groupedHash}${ext}`;
                    const filePath = `${bundleData.name}/${base}/${groupedHash}${ext}`;
                    downloadTasks.push({ 
                        url, 
                        filePath,
                        baseType,
                        fiveChar: hash
                    });
                }
            }
        }

        console.log(`\n> Created ${downloadTasks.length} download tasks for ${baseType} base`);
        const results = await processInBatches(downloadTasks, CONCURRENT_DOWNLOADS, processFile);    
    };

    await processBase('import');
    await processBase('native');

    if (foundFiles === 0) {
        console.log('\nNo files were found! This probably happened because the asset bundle structure is not compatible with the tool. Please create an issue on the GitHub repo so we can check out your game and support it!');
        return;
    }

    console.log('\nOperation completed, Creating bundle...');
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    fs.writeFileSync(`${bundleData.name}-bundle.zip`, zipBuffer);
    console.log(`Bundle created: ${bundleData.name}-bundle.zip`);
    console.log(`Total files included: ${foundFiles}`);
}

async function main() {
    if (process.argv.length < 4) {
        console.log('Usage: node u2a.js <server-name> <json-file-name> [<json-file-name>...]');
        console.log('Example:');
        console.log('  node u2a.js https://example.com/game/v1/ config.XXXX.json');
        process.exit(1);
    }

    console.log('\nUUID2Asset Started');

    try {
        const args = {
            serverName: process.argv[2],
            bundles: process.argv.slice(3).map(file => ({ file }))
        };

        console.log(`\nTarget Game:`, args.serverName);
        console.log(`\nBundles:`, args.bundles.map(b => b.file).join(', '));

        for (const bundle of args.bundles) {
            const jsonContent = fs.readFileSync(bundle.file, 'utf8');
            const bundleData = JSON.parse(jsonContent);
            await processBundleData(bundleData, args.serverName, DEFAULT_FILE_EXTENSIONS);
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
}

main();
