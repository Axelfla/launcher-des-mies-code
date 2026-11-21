// Work in progress
const { LoggerUtil } = require('helios-core')

const logger = LoggerUtil.getLogger('DiscordWrapper')

const { Client } = require('discord-rpc-patch')

const Lang = require('./langloader')

let client
let activity

const DEFAULT_RPC_SETTINGS = {
    clientId: '1548667315288150038',
    details: 'Lance {serverName}',
    state: 'Serveur : {shortId}',
    largeImageKey: 'launcher',
    largeImageText: 'Launcher des Mies Craft',
    smallImageKey: 'minecraft',
    smallImageText: 'Minecraft {minecraftVersion}'
}

function isPlaceholder(value){
    return typeof value === 'string' && (/^<.*>$/.test(value.trim()) || value.includes('REPLACE_WITH'))
}

function pick(...values){
    for(const value of values){
        if(value != null && value !== '' && !isPlaceholder(value)){
            return value
        }
    }
    return undefined
}

function formatPresenceText(value, context){
    if(typeof value !== 'string'){
        return value
    }

    return value.replace(/\{(\w+)\}/g, (_match, key) => context[key] ?? '')
}

exports.initRPC = function(genSettings = {}, server, initialDetails = Lang.queryJS('discord.waiting')){
    genSettings = {
        ...DEFAULT_RPC_SETTINGS,
        ...(genSettings || {})
    }
    const servSettings = server.discord || server
    const context = {
        serverId: server.id || '',
        serverName: pick(server.name, servSettings.shortId) || '',
        shortId: pick(servSettings.shortId, server.name) || '',
        minecraftVersion: server.minecraftVersion || ''
    }
    const clientId = pick(genSettings.clientId)

    if(clientId == null){
        logger.info('Unable to initialize Discord Rich Presence, no client ID configured.')
        return false
    }

    client = new Client({ transport: 'ipc' })

    activity = {
        details: formatPresenceText(pick(servSettings.details, genSettings.details, initialDetails), context),
        state: formatPresenceText(pick(servSettings.state, genSettings.state, Lang.queryJS('discord.state', {shortId: context.shortId})), context),
        largeImageKey: pick(servSettings.largeImageKey, genSettings.largeImageKey),
        largeImageText: formatPresenceText(pick(servSettings.largeImageText, genSettings.largeImageText), context),
        smallImageKey: pick(servSettings.smallImageKey, genSettings.smallImageKey),
        smallImageText: formatPresenceText(pick(servSettings.smallImageText, genSettings.smallImageText), context),
        startTimestamp: new Date().getTime(),
        instance: false
    }

    client.on('ready', () => {
        logger.info('Discord RPC Connected')
        client.setActivity(activity)
    })
    
    client.login({clientId}).catch(error => {
        if(error.message.includes('ENOENT')) {
            logger.info('Unable to initialize Discord Rich Presence, no client detected.')
        } else {
            logger.info('Unable to initialize Discord Rich Presence: ' + error.message, error)
        }
    })

    return true
}

exports.updateDetails = function(details){
    if(client == null || activity == null) return
    activity.details = details
    client.setActivity(activity)
}

exports.shutdownRPC = function(){
    if(!client) return
    client.clearActivity()
    client.destroy()
    client = null
    activity = null
}
