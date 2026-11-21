#!/usr/bin/env node

/*
 * Generate File modules from a local server folder. This keeps distribution
 * metadata reproducible and removes the need to calculate MD5/URL by hand.
 *
 * Example:
 * node tools/generate-distribution.js \
 *   --distribution C:/path/distribution.json \
 *   --server Serveur-survie-modde-1.21.1 \
 *   --files C:/path/server-files \
 *   --base-url https://example.test/servers/Serveur-survie-modde-1.21.1/files
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

function readOption(args, name) {
    const index = args.indexOf(name)
    return index === -1 ? null : args[index + 1]
}

function usage(message) {
    if(message) console.error(`Error: ${message}\n`)
    console.error('Usage: node tools/generate-distribution.js --distribution <file> --server <id> --files <folder> --base-url <url>')
    process.exit(1)
}

function md5(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5')
        const stream = fs.createReadStream(filePath)
        stream.on('error', reject)
        stream.on('data', chunk => hash.update(chunk))
        stream.on('end', () => resolve(hash.digest('hex')))
    })
}

function walk(folder, relative = '') {
    const result = []
    for(const entry of fs.readdirSync(path.join(folder, relative), { withFileTypes: true })) {
        const next = path.join(relative, entry.name)
        if(entry.isDirectory()) {
            result.push(...walk(folder, next))
        } else if(entry.name !== 'distribution.json') {
            result.push(next)
        }
    }
    return result
}

function encodePath(relativePath) {
    return relativePath.split(/[\\/]/).map(encodeURIComponent).join('/')
}

async function main() {
    const args = process.argv.slice(2)
    const distributionPath = readOption(args, '--distribution')
    const serverId = readOption(args, '--server')
    const filesRoot = readOption(args, '--files')
    const baseUrl = readOption(args, '--base-url')

    if(!distributionPath || !serverId || !filesRoot || !baseUrl) {
        usage('All four options are required.')
    }

    const distribution = JSON.parse(fs.readFileSync(distributionPath, 'utf8'))
    const server = (distribution.servers || []).find(value => value.id === serverId)
    if(!server) usage(`Server not found: ${serverId}`)
    if(!fs.statSync(filesRoot).isDirectory()) usage(`Files folder not found: ${filesRoot}`)

    const files = walk(filesRoot)
    if(files.length === 0) usage('No files were found.')

    const generated = []
    for(const relativePath of files) {
        const absolutePath = path.join(filesRoot, relativePath)
        const normalizedPath = relativePath.split(path.sep).join('/')
        const relativeUrl = encodePath(normalizedPath)
        generated.push({
            id: normalizedPath,
            name: path.basename(relativePath),
            type: 'File',
            artifact: {
                MD5: await md5(absolutePath),
                url: `${baseUrl.replace(/\/$/, '')}/${relativeUrl}`,
                path: normalizedPath
            }
        })
    }

    const modTypes = new Set(['ForgeMod', 'LiteMod', 'FabricMod'])
    const preserved = (server.modules || [])
        .filter(module => module.type !== 'File' && !modTypes.has(module.type))
    server.modules = [...preserved, ...generated]
    const versionParts = String(server.version).match(/^(\d+)\.(\d+)\.(\d+)$/)
    if(versionParts) {
        server.version = `${versionParts[1]}.${versionParts[2]}.${Number(versionParts[3]) + 1}`
    }
    fs.writeFileSync(distributionPath, `${JSON.stringify(distribution, null, 2)}\n`, 'utf8')
    console.log(`Generated ${generated.length} file entries for ${serverId}.`)
}

main().catch(error => {
    console.error(error.stack || error.message)
    process.exitCode = 1
})
