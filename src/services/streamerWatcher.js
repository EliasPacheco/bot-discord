const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js'); // <-- ADICIONE ESTA LINHA
require('dotenv').config();

class StreamerWatcher {
    constructor(client) {
        this.client = client;
        this.streamers = [];
        this.checkInterval = 30000; // Check every 10 seconds
        this.notificacaoPath = path.join(__dirname, '../data/notificacao.json');
        
        // Sistema de controle de notificações já enviadas
        this.notifiedStreams = new Set(); // Guarda streamers que já foram notificados como ao vivo
    }

    async loadStreamers() {
        const data = require('../data/streamers.json');
        this.streamers = data.streamers || [];
    }

    getChannelId() {
        if (fs.existsSync(this.notificacaoPath)) {
            const data = JSON.parse(fs.readFileSync(this.notificacaoPath));
            return data.canalId;
        }
        return null;
    }

    async checkStreamers() {
        await this.loadStreamers();
        
        for (const streamer of this.streamers) {
            const streamKey = `${streamer.type}:${streamer.name}`;
            console.log(`[DEBUG] Checando streamer: ${streamer.name} (${streamer.type})`);
            
            const isLive = await this.checkIfLive(streamer);
            console.log(`[DEBUG] Status de ${streamer.name}: ${isLive ? 'AO VIVO' : 'offline'}`);
            
            if (isLive) {
                // Só notificar se ainda não foi notificado
                if (!this.notifiedStreams.has(streamKey)) {
                    console.log(`[INFO] ${streamer.name} entrou ao vivo! Enviando notificação...`);
                    this.notifyChannel(streamer);
                    this.notifiedStreams.add(streamKey);
                }
            } else {
                // Se estava ao vivo e agora está offline, remover da lista de notificados
                if (this.notifiedStreams.has(streamKey)) {
                    console.log(`[INFO] ${streamer.name} saiu do ar.`);
                    this.notifiedStreams.delete(streamKey);
                }
            }
        }
    }

    async checkIfLive(streamer) {
        if (streamer.type === 'twitch') {
            return this.checkTwitchLive(streamer.name);
        } else if (streamer.type === 'kick') {
            return this.checkKickLive(streamer.name);
        }
        return false;
    }

    async checkTwitchLive(username) {
        // Obter token de acesso
        if (!this.twitchToken || this.twitchTokenExpires < Date.now()) {
            const res = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`, { method: 'POST' });
            const data = await res.json();
            this.twitchToken = data.access_token;
            this.twitchTokenExpires = Date.now() + (data.expires_in * 1000);
        }
        // Checar live
        const res = await fetch(`https://api.twitch.tv/helix/streams?user_login=${username}`, {
            headers: {
                'Client-ID': process.env.TWITCH_CLIENT_ID,
                'Authorization': `Bearer ${this.twitchToken}`
            }
        });
        const data = await res.json();
        return data.data && data.data.length > 0 && data.data[0].type === 'live';
    }

    async checkKickLive(username) {
        try {
            console.log(`[DEBUG] Verificando Kick para ${username} via API v2`);
            
            // Usar endpoint v2 específico como indicado pelo usuário
            const res = await fetch(`https://kick.com/api/v2/channels/${username.toLowerCase()}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json',
                    'Referer': 'https://kick.com/'
                }
            });

            if (!res.ok) {
                console.log(`[WARNING] API v2 falhou (${res.status}) para ${username}`);
                return false;
            }

            const data = await res.json();
            console.log(`[DEBUG] Dados do canal ${username}:`, JSON.stringify({
                id: data.id,
                slug: data.slug,
                is_banned: data.is_banned,
                livestream: data.livestream ? 'presente' : 'ausente'
            }));

            // Verifica se o streamer está realmente ao vivo
            const isLive = data.livestream !== null && !data.is_banned;
            
            if (isLive) {
                console.log(`[LIVE] ${username} está AO VIVO no Kick!`);
                return true;
            } else {
                console.log(`[DEBUG] ${username} está offline no Kick`);
                return false;
            }

        } catch (err) {
            console.error(`[ERRO] Falha ao verificar ${username} no Kick:`, err.message);
            return false;
        }
    }



    // Adapte seu método notifyChannel:
    notifyChannel(streamer) {
        const channelId = this.getChannelId();
        if (!channelId) return;
        const channel = this.client.channels.cache.get(channelId);
        if (channel) {
            let url = streamer.type === 'twitch'
                ? `https://twitch.tv/${streamer.name}`
                : `https://kick.com/${streamer.name}`;

            // Para Twitch, tente buscar a thumbnail
            let embed = null;
            if (streamer.type === 'twitch') {
                const thumb = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${streamer.name.toLowerCase()}.jpg?width=640&height=360`;
                embed = {
                    title: `Twitch: ${streamer.name}`,
                    url: url,
                    image: { url: thumb }
                };
            } else {
                embed = {
                    title: `Kick: ${streamer.name}`,
                    url: url
                };
            }

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Acessar')
                    .setStyle(ButtonStyle.Link)
                    .setURL(url)
            );
            channel.send({
                content: `O ${streamer.name} está ao vivo! @everyone`,
                embeds: [embed],
                components: [row]
            });
        }
    }

    startWatching() {
        setInterval(() => this.checkStreamers(), this.checkInterval);
    }
}

module.exports = StreamerWatcher;