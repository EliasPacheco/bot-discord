const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
require("dotenv").config();

class StreamerWatcher {
    constructor(client) {
        this.client = client;
        this.streamers = [];
        this.checkInterval = 60000; // Check every 60 seconds
        this.notificacaoPath = path.join(__dirname, "../data/notificacao.json");

        // Sistema de controle de notificações já enviadas
        this.notifiedStreams = new Set(); // Guarda streamers que já foram notificados como ao vivo
    }

    async loadStreamers() {
        const data = require("../data/streamers.json");
        this.streamers = data.streamers || [];
    }

    getChannelIds() {
        if (fs.existsSync(this.notificacaoPath)) {
            const data = JSON.parse(fs.readFileSync(this.notificacaoPath));
            // Suporta novos e antigos formatos: { canais: [] } | { canalIds: [] } | { canalId: "..." }
            if (Array.isArray(data.canais)) return data.canais;
            if (Array.isArray(data.canalIds)) return data.canalIds;
            if (data.canalId) return [data.canalId];
        }
        return [];
    }

    async checkStreamers() {
        await this.loadStreamers();

        for (const streamer of this.streamers) {
            const streamKey = `${streamer.type}:${streamer.name}`;
            console.log(
                `[DEBUG] Checando streamer: ${streamer.name} (${streamer.type})`,
            );

            const liveData = await this.checkIfLive(streamer);
            console.log(
                `[DEBUG] Status de ${streamer.name}: ${liveData ? "AO VIVO" : "offline"}`,
            );

            if (liveData) {
                // Só notificar se ainda não foi notificado
                if (!this.notifiedStreams.has(streamKey)) {
                    console.log(
                        `[INFO] ${streamer.name} entrou ao vivo! Enviando notificação...`,
                    );
                    await this.notifyChannel(streamer, liveData);
                    await this.updateLiveRole(streamer.name, true); // Adicionar cargo ao vivo
                    this.notifiedStreams.add(streamKey);
                }
            } else {
                // Se estava ao vivo e agora está offline, remover da lista de notificados
                if (this.notifiedStreams.has(streamKey)) {
                    console.log(`[INFO] ${streamer.name} saiu do ar.`);
                    await this.updateLiveRole(streamer.name, false); // Remover cargo ao vivo
                    this.notifiedStreams.delete(streamKey);
                }
            }
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

    async checkIfLive(streamer) {
        if (streamer.type === "twitch") {
            return this.checkTwitchLive(streamer.name);
        } else if (streamer.type === "kick") {
            return this.checkKickLive(streamer.name);
        }
        return null;
    }

    async checkTwitchLive(username) {
        // Obter token de acesso
        if (!this.twitchToken || this.twitchTokenExpires < Date.now()) {
            const res = await fetch(
                `https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
                { method: "POST" },
            );
            const data = await res.json();
            this.twitchToken = data.access_token;
            this.twitchTokenExpires = Date.now() + data.expires_in * 1000;
        }
        // Checar live
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

    async ensureBrowser() {
        if (this.puppeteerBrowser && this.puppeteerBrowser.isConnected()) return this.puppeteerBrowser;
        const puppeteer = require('puppeteer-core');
        const launchOptions = Object.assign(
        {
            headless: true,
            args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--single-process',
            ],
        },
        this.puppeteerLaunchOptions || {}
        );

        this.puppeteerBrowser = await puppeteer.launch({
            executablePath: "/usr/bin/chromium-browser", // caminho do Chromium no Render/Discloud
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
        });
        return this.puppeteerBrowser;
    }

    async closeBrowser() {
        if (this.puppeteerBrowser) {
        try {
            await this.puppeteerBrowser.close();
        } catch (e) {}
        this.puppeteerBrowser = null;
        }
    }

        async checkKickLive(username) {
            // tenta a rota /livestream primeiro via fetch (mais leve)
            try {
                const apiUrl = `https://kick.com/api/v2/channels/${username.toLowerCase()}/livestream`;
                console.log(`[DEBUG] Tentando endpoint direto: ${apiUrl}`);
                const res = await fetch(apiUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                        Accept: 'application/json, text/plain, */*'
                    },
                    method: 'GET',
                });

                if (res.ok) {
                    const data = await res.json();
                    if (data && (data.session_title || data.stream_id || data.id)) {
                        console.log(`[LIVE - API] ${username} AO VIVO (via /livestream)`);
                        return data;
                    }
                    // se for 200 mas null, considera offline
                    return null;
                }

                console.log(`[DEBUG] endpoint /livestream retornou status ${res.status} para ${username}`);
            } catch (err) {
                console.log(`[DEBUG] erro ao tentar /livestream: ${err.message}`);
            }

            // Se a API bloqueou (403 etc.), usa Puppeteer para abrir a página (simula navegador)
            try {
                const browser = await this.ensureBrowser();
                const page = await browser.newPage();

                // Header e viewport realistas
                await page.setUserAgent(
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                );
                await page.setExtraHTTPHeaders({
                    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
                });
                await page.setViewport({ width: 1280, height: 800 });

                const url = `https://kick.com/${username.toLowerCase()}`;
                console.log(`[DEBUG] Abrindo página Kick: ${url}`);

                try {
                    await page.setCacheEnabled(false);
                    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
                } catch (err) {
                    console.log(`[DEBUG] page.goto falhou para ${username}: ${err.message}`);
                }

                // Tenta extrair o JSON do __NEXT_DATA__
                const nextDataHandle = await page.$('#__NEXT_DATA__');
                if (nextDataHandle) {
                    const raw = await page.evaluate(el => el.textContent, nextDataHandle);
                    try {
                        const json = JSON.parse(raw);
                        const livestream = json?.props?.pageProps?.channel?.livestream;
                        if (livestream) {
                            console.log(`[LIVE - Puppeteer] ${username} AO VIVO (extraído de __NEXT_DATA__)`);
                            await page.close();
                            return livestream;
                        } else {
                            console.log(`[DEBUG] __NEXT_DATA__ encontrado mas livestream é nulo`);
                        }
                    } catch (e) {
                        console.log(`[DEBUG] falha ao parsear __NEXT_DATA__: ${e.message}`);
                    }
                }

                // fallback: tentar capturar livestream no HTML
                const html = await page.content();
                const match = html.match(/"livestream":\s*(\{.*?\}|null)\s*,/s);
                if (match) {
                    try {
                        const objText = match[1];
                        if (objText !== 'null') {
                            const obj = JSON.parse(objText);
                            console.log(`[LIVE - Puppeteer/HTML] ${username} AO VIVO (extraído do HTML)`);
                            await page.close();
                            return obj;
                        }
                    } catch (e) {
                        // ignora parse errors
                    }
                }

                await page.close();
                console.log(`[DEBUG] ${username} parece OFFLINE (página aberta, sem livestream detectado)`);
                return null;

            } catch (err) {
                console.error(`[ERRO] Puppeteer falhou para ${username}: ${err.message}`);
                // fecha o browser pra forçar recriação na próxima vez
                await this.closeBrowser();
                return null;
            }
        }

    async notifyChannel(streamer, liveData) {
        const channelIds = this.getChannelIds();
        if (channelIds.length === 0) return;

        let url =
            streamer.type === "twitch"
                ? `https://twitch.tv/${streamer.name}`
                : `https://kick.com/${streamer.name}`;

        let embed;
        if (streamer.type === "twitch") {
            const thumb = liveData.thumbnail_url
                .replace("{width}", "640")
                .replace("{height}", "360");
            embed = {
                title: liveData.title,
                url: url,
                image: { url: thumb },
                author: {
                    name: `${streamer.name} - Twitch`,
                    icon_url:
                        "https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png",
                },
                color: 0x6441a5, // Twitch Purple
            };
        } else {
            // Kick
            const thumb =
                liveData?.thumbnail?.url || "https://kick.com/favicon.ico"; // fallback
            embed = {
                title: liveData?.session_title || "Live na Kick",
                url: url,
                image: { url: thumb },
                author: {
                    name: `${streamer.name} - Kick`,
                    icon_url: "https://kick.com/favicon.ico",
                },
                color: 0x53fc18,
            };
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel("Acessar")
                .setStyle(ButtonStyle.Link)
                .setURL(url),
        );

        // Envia notificação para todos os canais configurados
        for (const channelId of channelIds) {
            try {
                const channel = this.client.channels.cache.get(channelId);
                if (channel) {
                    await channel.send({
                        content: `O ${streamer.name} está ao vivo! @everyone`,
                        embeds: [embed],
                        components: [row],
                    });
                    console.log(
                        `[INFO] Notificação enviada para o canal ${channelId}`,
                    );
                }
            } catch (error) {
                console.log(
                    `[ERRO] Erro ao enviar notificação para o canal ${channelId}: ${error.message}`,
                );
            }
        }
    }

    startWatching() {
        setInterval(() => this.checkStreamers(), this.checkInterval);
    }
}

module.exports = StreamerWatcher;
