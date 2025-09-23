const fs = require("fs");
const path = require("path");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
require("dotenv").config();
const puppeteer = require("puppeteer");
const fetch = require("node-fetch");

class StreamerWatcher {
    constructor(client) {
        this.client = client;
        this.streamers = [];
        this.checkInterval = 60000; // 1 minuto
        this.notificacaoPath = path.join(__dirname, "../data/notificacao.json");
        this.notifiedStreams = new Set();

        this.browser = null;
        this.page = null;

        // Twitch token
        this.twitchToken = null;
        this.twitchTokenExpires = 0;
    }

    async initBrowser() {
        if (!this.browser) {
            try {
                this.browser = await puppeteer.launch({
                    headless: true, // modo sem interface
                    args: [
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-web-security",
                        "--disable-features=VizDisplayCompositor"
                    ],
                    defaultViewport: null
                    // removido "channel: 'chrome'" para usar Chromium embutido
                });
                this.page = await this.browser.newPage();
                await this.page.setUserAgent(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
                );
                console.log("[INFO] Puppeteer iniciado com sucesso usando Chromium embutido.");
            } catch (err) {
                console.error("[ERRO] Falha ao inicializar Puppeteer:", err.message);
            }
        }
    }

    async loadStreamers() {
        try {
            const data = require("../data/streamers.json");
            this.streamers = data.streamers || [];
        } catch (error) {
            console.error("[ERRO] Falha ao carregar lista de streamers:", error.message);
            this.streamers = [];
        }
    }

    getChannelIds() {
        try {
            if (fs.existsSync(this.notificacaoPath)) {
                const data = JSON.parse(fs.readFileSync(this.notificacaoPath));
                if (Array.isArray(data.canais)) return data.canais;
                if (Array.isArray(data.canalIds)) return data.canalIds;
                if (data.canalId) return [data.canalId];
            }
        } catch (error) {
            console.error("[ERRO] Falha ao ler canais de notificação:", error.message);
        }
        return [];
    }

    async checkStreamers() {
        await this.loadStreamers();
        await this.initBrowser();

        for (const streamer of this.streamers) {
            const streamKey = `${streamer.type}:${streamer.name}`;
            console.log(`[DEBUG] Checando streamer: ${streamer.name} (${streamer.type})`);

            try {
                const liveData = await this.checkIfLive(streamer);
                console.log(`[DEBUG] Status de ${streamer.name}: ${liveData ? "AO VIVO" : "offline"}`);

                if (liveData) {
                    if (!this.notifiedStreams.has(streamKey)) {
                        console.log(`[INFO] ${streamer.name} entrou ao vivo!`);
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
            } catch (error) {
                console.error(`[ERRO] Falha ao processar streamer ${streamer.name}:`, error.message);
            }
        }
    }

    async checkIfLive(streamer) {
        if (streamer.type === "kick") return await this.checkKickLive(streamer.name);
        if (streamer.type === "twitch") return await this.checkTwitchLive(streamer.name);
        return null;
    }

    // ===================== TWITCH =====================
    async checkTwitchLive(username) {
        try {
            if (!this.twitchToken || this.twitchTokenExpires < Date.now()) {
                const res = await fetch(
                    `https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
                    { method: "POST" }
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
                        Authorization: `Bearer ${this.twitchToken}`
                    }
                }
            );
            const data = await res.json();
            if (data.data && data.data.length > 0 && data.data[0].type === "live") {
                return data.data[0];
            }
            return null;
        } catch (err) {
            console.error(`[ERRO] Falha ao consultar Twitch para ${username}:`, err.message);
            return null;
        }
    }

    // ===================== KICK =====================
    async checkKickLive(username) {
        try {
            // Tenta usar a API v2 primeiro
            const url = `https://kick.com/api/v2/channels/${username.toLowerCase()}`;
            console.log(`[DEBUG] Consultando Kick API v2 para ${username}: ${url}`);

            const res = await fetch(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                    Accept: "application/json",
                    Referer: "https://kick.com/"
                }
            });

            if (res.ok) {
                const data = await res.json();
                const isLive = data.livestream !== null && !data.is_banned;

                if (isLive) {
                    return {
                        session_title: data.livestream.session_title || "Live na Kick",
                        thumbnail: data.livestream.thumbnail?.url || data.user.profile_pic,
                        viewers: data.livestream.viewer_count || 0,
                        channel_image: data.user.profile_pic,
                        category: data.livestream.categories?.[0]?.name || "Just Chatting"
                    };
                }
            }

            // Se API falhar ou não estiver ao vivo, tenta Puppeteer
            console.log(`[INFO] Tentando verificar ${username} usando Puppeteer...`);
            return await this.checkKickLiveWithPuppeteer(username);

        } catch (err) {
            console.error(`[ERRO] Falha ao consultar Kick para ${username}:`, err.message);
            return null;
        }
    }

    // Função Puppeteer já fornecida
    async checkKickLiveWithPuppeteer(username) {
        try {
            if (!this.browser) await this.initBrowser();

            const url = `https://kick.com/${username}`;
            console.log(`[INFO] Acessando página do streamer ${username} via Puppeteer: ${url}`);

            const page = await this.browser.newPage();
            await page.setUserAgent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
            );

            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

            const isLive = await page.evaluate(() => {
                const liveBadge = document.querySelector('[data-test-id="live-indicator"]');
                const videoPlayer = document.querySelector('video');
                return liveBadge !== null || videoPlayer !== null;
            });

            if (!isLive) {
                console.log(`[INFO] ${username} não está ao vivo.`);
                await page.close();
                return null;
            }

            // Extrair título, espectadores, categoria e banner
            const liveInfo = await page.evaluate(() => {
                const title = document.querySelector('h1')?.textContent || "Live na Kick";
                const viewersText = document.querySelector('[data-test-id="viewer-count"]')?.textContent || "0";
                const viewers = parseInt(viewersText.replace(/[^0-9]/g, '')) || 0;
                const category = document.querySelector('[data-test-id="category"]')?.textContent || "Just Chatting";
                const thumbnail = document.querySelector('video')?.poster || null;
                return { title, viewers, category, thumbnail };
            });

            await page.close();

            console.log(`[INFO] ${username} está AO VIVO! Título: ${liveInfo.title}, Viewers: ${liveInfo.viewers}, Categoria: ${liveInfo.category}`);
            return {
                session_title: liveInfo.title,
                viewers: liveInfo.viewers,
                category: liveInfo.category,
                thumbnail: liveInfo.thumbnail
            };
        } catch (error) {
            console.error(`[ERRO] Falha ao verificar ${username} com Puppeteer:`, error.message);
            return null;
        }
    }

    async updateLiveRole(streamerName, isLive) {
            // Carrega as configurações dos servidores
            const configPath = path.join(__dirname, "../data/server_config.json");
            let config = { servers: {} };

            if (fs.existsSync(configPath)) {
                config = JSON.parse(fs.readFileSync(configPath));
            }

            // Itera sobre todos os servidores que o bot está presente
            for (const [guildId, guild] of this.client.guilds.cache) {
                // Verifica se há configuração para este servidor
                if (
                    !config.servers[guildId] ||
                    !config.servers[guildId].streamerRoles
                ) {
                    continue; // Pula se não houver configuração para este servidor
                }

                // Verifica se há configuração para este streamer específico
                if (!config.servers[guildId].streamerRoles[streamerName]) {
                    continue; // Pula se não houver configuração para este streamer
                }

                try {
                    const streamerConfig =
                        config.servers[guildId].streamerRoles[streamerName];
                    const userId = streamerConfig.userId;
                    const roleId = streamerConfig.roleId;

                    // Busca o membro pelo ID
                    const member = await guild.members
                        .fetch(userId)
                        .catch(() => null);
                    if (!member) {
                        console.log(
                            `[ERRO] Usuário com ID ${userId} não encontrado no servidor ${guild.name}`,
                        );
                        continue;
                    }

                    const role = guild.roles.cache.get(roleId);
                    if (!role) {
                        console.log(
                            `[ERRO] Cargo com ID ${roleId} não encontrado no servidor ${guild.name}`,
                        );
                        continue;
                    }

                    if (isLive) {
                        // Adiciona o cargo se estiver ao vivo
                        if (!member.roles.cache.has(roleId)) {
                            await member.roles.add(role);
                            console.log(
                                `[INFO] Cargo ${role.name} adicionado para ${member.user.tag} no servidor ${guild.name} (streamer: ${streamerName})`,
                            );
                        }
                    } else {
                        // Remove o cargo se estiver offline
                        if (member.roles.cache.has(roleId)) {
                            await member.roles.remove(role);
                            console.log(
                                `[INFO] Cargo ${role.name} removido de ${member.user.tag} no servidor ${guild.name} (streamer: ${streamerName})`,
                            );
                        }
                    }
                } catch (error) {
                    console.log(
                        `[ERRO] Erro ao atualizar cargo no servidor ${guild.name}: ${error.message}`,
                    );
                }
            }
        }

    async notifyChannel(streamer, liveData) {
        const channelIds = this.getChannelIds();
        if (!channelIds.length) return;

        let url = streamer.type === "twitch" 
            ? `https://twitch.tv/${streamer.name}` 
            : `https://kick.com/${streamer.name}`;

        let embed;
        if (streamer.type === "twitch") {
            const thumb = liveData.thumbnail_url
                ?.replace("{width}", "640")
                .replace("{height}", "360");

            embed = {
                title: liveData.title,
                url,
                description: `Jogando: ${liveData.game_name || "Just Chatting"}`,
                image: { url: thumb },
                author: {
                    name: `${streamer.name} - Twitch`,
                    icon_url: "https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png"
                },
                color: 0x6441a5,
                footer: { text: `${liveData.viewer_count || 0} espectadores` }
            };
        } else {
            embed = {
                title: liveData.session_title || "Live na Kick",
                url,
                thumbnail: liveData.banner_image ? { url: liveData.banner_image } : null,
                image: liveData.banner_image ? { url: liveData.banner_image } : null,
                author: {
                    name: `${streamer.name} - Kick`,
                    icon_url: "https://pbs.twimg.com/profile_images/1896451420531912704/dmVVwNP-_400x400.jpg"
                },
                color: 0x00ff00,
                footer: { text: `MLD-Live` }
            };
        }

        // Botão "ACESSAR"
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel("ACESSAR")
                .setStyle(ButtonStyle.Link)
                .setURL(url)
        );

        for (const channelId of channelIds) {
            try {
                const channel = await this.client.channels.fetch(channelId);
                if (!channel) continue;

                // Mensagem com @everyone acima do embed
                await channel.send(`📢 O **${streamer.name}** ESTÁ AO VIVO! @everyone`);

                // Envia embed com botão
                await channel.send({ embeds: [embed], components: [row] });

                console.log(`[INFO] Notificação enviada para ${channelId} sobre ${streamer.name}`);
            } catch (err) {
                console.error(`[ERRO] Falha ao enviar notificação para ${channelId}:`, err.message);
            }
        }
    }

    startWatching() {
        this.checkStreamers().catch(console.error);
        setInterval(() => this.checkStreamers().catch(console.error), this.checkInterval);
    }
}

module.exports = StreamerWatcher;