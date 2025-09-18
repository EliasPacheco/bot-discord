const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js'); // <-- ADICIONE ESTA LINHA
require('dotenv').config();

class StreamerWatcher {
    constructor(client) {
        this.client = client;
        this.streamers = [];
        this.checkInterval = 60000; // Check every minute
        this.notificacaoPath = path.join(__dirname, '../data/notificacao.json');
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
            console.log(`[DEBUG] Checando streamer: ${streamer.name} (${streamer.type})`);
            const isLive = await this.checkIfLive(streamer);
            console.log(`[DEBUG] Status de ${streamer.name}: ${isLive ? 'AO VIVO' : 'offline'}`);
            if (isLive) {
                this.notifyChannel(streamer);
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
            const res = await fetch(`https://kick.com/api/v2/channels/${username.toLowerCase()}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
                    'Accept': 'application/json',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            });

            if (!res.ok) {
                console.log(`[DEBUG] Kick retornou status ${res.status} para ${username}`);
                return false;
            }

            const data = await res.json();
            console.log('[DEBUG] Resposta do Kick:', JSON.stringify(data));

            // Se houver livestream e ela estiver marcada como online
            if (data.livestream && data.livestream.is_live) {
                return true;
            }

            // Algumas vezes pode ter 'livestream' mas sem 'is_live', então também podemos checar a URL de playback
            if (data.playback_url) {
                return true;
            }

            return false;
        } catch (err) {
            console.error('[ERRO] Falha ao checar live no Kick:', err);
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