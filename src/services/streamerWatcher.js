const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
require("dotenv").config();
const puppeteer = require("puppeteer");

class StreamerWatcher {
    constructor(client) {
        this.client = client;
        this.streamers = [];
        this.checkInterval = 60000; // 1 minuto
        this.notificacaoPath = path.join(__dirname, "../data/notificacao.json");
        this.notifiedStreams = new Set();
        this.kickBrowser = null;
    }

    // Inicializa o browser do Kick
    async initKickBrowser() {
        if (!this.kickBrowser) {
            this.kickBrowser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--single-process',
                    '--no-zygote',
                    '--disable-background-networking',
                    '--disable-default-apps',
                    '--disable-extensions',
                    '--disable-sync',
                    '--metrics-recording-only',
                    '--no-first-run',
                ],
            });
            console.log("[INFO] Puppeteer (Kick) iniciado!");
        }
    }

    // Checa se o streamer Kick está ao vivo
    async checkKickLive(username) {
        await this.initKickBrowser();
        let page;
        try {
            page = await this.kickBrowser.newPage();
            await page.goto(`https://kick.com/${username}`, { waitUntil: "networkidle2", timeout: 30000 });

            const isLive = (await page.$('[data-test-selector="live-badge"]')) !== null;

            return isLive
                ? { session_title: `${username} ao vivo`, thumbnail: { url: "https://kick.com/favicon.ico" } }
                : null;
        } catch (err) {
            console.log(`[ERRO] Falha ao checar Kick para ${username}: ${err.message}`);
            return null;
        } finally {
            if (page) await page.close().catch(() => {});
        }
    }

    // Fecha o browser do Kick
    async closeKickBrowser() {
        if (this.kickBrowser) {
            await this.kickBrowser.close().catch(() => {});
            this.kickBrowser = null;
            console.log("[INFO] Puppeteer (Kick) fechado!");
        }
    }

    // Carrega a lista de streamers
    async loadStreamers() {
        const data = require("../data/streamers.json");
        this.streamers = data.streamers || [];
    }

    // Retorna os canais que receberão notificação
    getChannelIds() {
        if (fs.existsSync(this.notificacaoPath)) {
            const data = JSON.parse(fs.readFileSync(this.notificacaoPath));
            if (Array.isArray(data.canais)) return data.canais;
            if (Array.isArray(data.canalIds)) return data.canalIds;
            if (data.canalId) return [data.canalId];
        }
        return [];
    }

    // Checa todos os streamers
    async checkStreamers() {
        await this.loadStreamers();

        for (const streamer of this.streamers) {
            const streamKey = `${streamer.type}:${streamer.name}`;
            console.log(`[DEBUG] Checando streamer: ${streamer.name} (${streamer.type})`);

            const liveData = await this.checkIfLive(streamer);
            console.log(`[DEBUG] Status de ${streamer.name}: ${liveData ? "AO VIVO" : "offline"}`);

            if (liveData) {
                if (!this.notifiedStreams.has(streamKey)) {
                    console.log(`[INFO] ${streamer.name} entrou ao vivo! Enviando notificação...`);
                    await this.notifyChannel(streamer, liveData);
                    await this.updateLiveRole(streamer.name, true);
                    this.notifiedStreams.add(streamKey);
                }
            } else {
                if (this.notifiedStreams.has(streamKey)) {
                    console.log(`[INFO] ${streamer.name} saiu do ar.`);
                    await this.updateLiveRole(streamer.name, false);
                    this.notifiedStreams.delete(streamKey);
                }
            }
        }
    }

    async checkIfLive(streamer) {
        if (streamer.type === "twitch") {
            return this.checkTwitchLive(streamer.name);
        } else if (streamer.type === "kick") {
            return this.checkKickLive(streamer.name);
        }
        return null;
    }

    async checkTwitchLive(username) {
        if (!this.twitchToken || this.twitchTokenExpires < Date.now()) {
            const res = await fetch(
                `https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
                { method: "POST" },
            );
            const data = await res.json();
            this.twitchToken = data.access_token;
            this.twitchTokenExpires = Date.now() + data.expires_in * 1000;
        }

        const res = await fetch(
            `https://api.twitch.tv/helix/streams?user_login=${username}`,
            {
                headers: {
                    "Client-ID": process.env.TWITCH_CLIENT_ID,
                    Authorization: `Bearer ${this.twitchToken}`,
                },
            },
        );
        const data = await res.json();
        if (data.data && data.data.length > 0 && data.data[0].type === "live") {
            return data.data[0];
        }
        return null;
    }

    async notifyChannel(streamer, liveData) {
        const channelIds = this.getChannelIds();
        if (!channelIds.length) return;

        const url = streamer.type === "twitch"
            ? `https://twitch.tv/${streamer.name}`
            : `https://kick.com/${streamer.name}`;

        let embed;
        if (streamer.type === "twitch") {
            const thumb = liveData.thumbnail_url.replace("{width}", "640").replace("{height}", "360");
            embed = {
                title: liveData.title,
                url,
                image: { url: thumb },
                author: {
                    name: `${streamer.name} - Twitch`,
                    icon_url: "https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png",
                },
                color: 0x6441a5,
            };
        } else {
            const thumb = liveData?.thumbnail?.url || "https://kick.com/favicon.ico";
            embed = {
                title: liveData?.session_title || "Live na Kick",
                url,
                image: { url: thumb },
                author: {
                    name: `${streamer.name} - Kick`,
                    icon_url: "https://kick.com/favicon.ico",
                },
                color: 0x53fc18,
            };
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel("Acessar").setStyle(ButtonStyle.Link).setURL(url),
        );

        for (const channelId of channelIds) {
            try {
                const channel = this.client.channels.cache.get(channelId);
                if (channel) {
                    await channel.send({
                        content: `O ${streamer.name} está ao vivo! @everyone`,
                        embeds: [embed],
                        components: [row],
                    });
                    console.log(`[INFO] Notificação enviada para o canal ${channelId}`);
                }
            } catch (error) {
                console.log(`[ERRO] Erro ao enviar notificação para o canal ${channelId}: ${error.message}`);
            }
        }
    }

    async updateLiveRole(streamerName, isLive) {
        const configPath = path.join(__dirname, "../data/server_config.json");
        let config = { servers: {} };
        if (fs.existsSync(configPath)) config = JSON.parse(fs.readFileSync(configPath));

        for (const [guildId, guild] of this.client.guilds.cache) {
            if (!config.servers[guildId]?.streamerRoles?.[streamerName]) continue;

            try {
                const { userId, roleId } = config.servers[guildId].streamerRoles[streamerName];
                const member = await guild.members.fetch(userId).catch(() => null);
                if (!member) continue;

                const role = guild.roles.cache.get(roleId);
                if (!role) continue;

                if (isLive) {
                    if (!member.roles.cache.has(roleId)) await member.roles.add(role);
                } else {
                    if (member.roles.cache.has(roleId)) await member.roles.remove(role);
                }
            } catch (error) {
                console.log(`[ERRO] Erro ao atualizar cargo no servidor ${guild.name}: ${error.message}`);
            }
        }
    }

    startWatching() {
        this.checkStreamers();
        setInterval(() => this.checkStreamers(), this.checkInterval);
    }
}

module.exports = StreamerWatcher;
