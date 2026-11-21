const path = require('path')
const got = require('got')
const { DistributionAPI, HeliosDistribution } = require('helios-core/common')

const ConfigManager = require('./configmanager')

const DISTRO_SERVERS = {
    overnode: {
        name: 'Serveur américain',
        url: 'http://us-chi-1.overnode.fr:25565/distribution.json'
    },
    direct: {
        name: 'Serveur européen',
        url: 'http://151.240.30.11:10034/distribution.json'
    }
}

exports.DISTRO_SERVERS = DISTRO_SERVERS

exports.getSelectedDistroServer = function(){
    const selected = ConfigManager.getDistroServer()
    return DISTRO_SERVERS[selected] != null ? selected : ConfigManager.getDistroServer(true)
}

exports.getSelectedDistroURL = function(){
    return DISTRO_SERVERS[exports.getSelectedDistroServer()].url
}

exports.REMOTE_DISTRO_URL = exports.getSelectedDistroURL()

function normalizePath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

function joinUrlPath(...parts) {
    return parts.map(normalizePath).filter(Boolean).join('/')
}

async function expandDirectoryModule(module) {
    const artifact = module.artifact || {}
    if(!artifact.url) {
        throw new Error(`Directory module ${module.id || module.name} is missing artifact.url`)
    }

    let response
    try {
        response = await got.get(artifact.url, { responseType: 'json' })
    } catch(err) {
        console.warn(`Unable to list directory module ${module.id || module.name}: ${artifact.url}`, err.message)
        return []
    }
    const files = response.body.files || []
    const installRoot = normalizePath(artifact.path || module.id || '')

    return files.map(file => {
        const sourcePath = normalizePath(file.path || file.name)
        const installPath = joinUrlPath(installRoot, sourcePath)
        const fileUrl = new URL(file.url, artifact.url).toString()

        return {
            id: installPath,
            name: file.name || path.basename(sourcePath),
            type: 'File',
            artifact: {
                size: file.size,
                MD5: file.MD5 || file.md5,
                url: fileUrl,
                path: installPath
            }
        }
    })
}

async function expandDirectoryModules(modules) {
    const expanded = []

    for(const module of modules || []) {
        if(module.type === 'Directory') {
            expanded.push(...await expandDirectoryModule(module))
            continue
        }

        if(module.subModules != null) {
            module.subModules = await expandDirectoryModules(module.subModules)
        }
        expanded.push(module)
    }

    return expanded
}

async function expandDistributionDirectories(distribution) {
    const expanded = JSON.parse(JSON.stringify(distribution))
    for(const server of expanded.servers || []) {
        server.modules = await expandDirectoryModules(server.modules)
    }
    return expanded
}

class DirectoryAwareDistributionAPI extends DistributionAPI {

    async _loadDistributionExpandedNullable() {
        const distribution = await this._loadDistributionNullable()
        if(distribution == null) {
            return null
        }
        const expanded = await expandDistributionDirectories(distribution)
        // Le ReceiverExecutor (processus enfant) relit distribution.json depuis le disque
        // avec le DistributionAPI de base, qui ne sait pas gérer les modules "Directory".
        // On réécrit donc la version déjà développée dans le cache.
        if(!this.devMode) {
            try {
                await this.writeDistributionToDisk(expanded)
            } catch(err) {
                console.warn('Unable to cache expanded distribution', err.message)
            }
        }
        return expanded
    }

    async getDistribution() {
        if(this.rawDistribution == null) {
            this.rawDistribution = await this.loadDistribution()
            this.distribution = new HeliosDistribution(this.rawDistribution, this.commonDir, this.instanceDir)
        }
        return this.distribution
    }

    async getDistributionLocalLoadOnly() {
        if(this.rawDistribution == null) {
            const distribution = await this.pullLocal()
            if(distribution == null) {
                throw new Error('FATAL: Unable to load distribution from local disk.')
            }
            this.rawDistribution = await expandDistributionDirectories(distribution)
            this.distribution = new HeliosDistribution(this.rawDistribution, this.commonDir, this.instanceDir)
        }
        return this.distribution
    }

    async loadDistribution() {
        const distribution = await this._loadDistributionExpandedNullable()
        if(distribution == null) {
            throw new Error('FATAL: Unable to load distribution from remote server or local disk.')
        }
        return distribution
    }

    async refreshDistributionOrFallback() {
        const distribution = await this._loadDistributionExpandedNullable()
        if(distribution == null) {
            return this.distribution
        }
        this.rawDistribution = distribution
        this.distribution = new HeliosDistribution(distribution, this.commonDir, this.instanceDir)
        return this.distribution
    }

}

const api = new DirectoryAwareDistributionAPI(
    ConfigManager.getLauncherDirectory(),
    null, // Injected forcefully by the preloader.
    null, // Injected forcefully by the preloader.
    exports.REMOTE_DISTRO_URL,
    false
)

exports.DistroAPI = api
