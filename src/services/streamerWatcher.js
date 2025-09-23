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
    }

    async initBrowser() {
        if (!this.browser) {
            try {
                this.browser = await puppeteer.launch({
                    headless: true,
                    args: [
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-web-security",
                        "--disable-features=VizDisplayCompositor"
                    ],
                    defaultViewport: null,
                    channel: 'chrome'
                });
                this.page = await this.browser.newPage();
                await this.page.setUserAgent(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
                );
                console.log("[INFO] Puppeteer iniciado com sucesso.");
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

        if (!this.page) {
            console.error("[ERRO] Browser não inicializado. Verifique o Puppeteer.");
            return;
        }

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
                        this.notifiedStreams.add(streamKey);
                    }
                } else {
                    if (this.notifiedStreams.has(streamKey)) {
                        console.log(`[INFO] ${streamer.name} saiu do ar.`);
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
        return null;
    }

    async checkKickLive(username) {
        try {
            const url = `https://kick.com/api/v1/channels/${username}`;
            console.log(`[DEBUG] Consultando Kick API para ${username}: ${url}`);

            const headers = {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
                'Origin': 'https://kick.com',
                'Referer': `https://kick.com/${username}`
            };

            const response = await fetch(url, { headers });
            console.log(`[DEBUG] Status HTTP: ${response.status}`);

            if (!response.ok) {
                if (response.status === 403) {
                    console.log(`[INFO] Tentando verificar ${username} usando Puppeteer...`);
                    return await this.checkKickLiveWithPuppeteer(username);
                }
                console.error(`[ERRO] Resposta não OK da API Kick para ${username}`);
                return null;
            }

            const data = await response.json();
            console.log(`[DEBUG] Dados recebidos da Kick API para ${username}:`, data);

            if (data.livestream) {
                console.log(`[INFO] ${username} está AO VIVO!`);
                return {
                    session_title: data.livestream.session_title || "Live no Kick",
                    thumbnail: data.livestream.thumbnail?.url,
                    viewers: data.livestream.viewer_count || 0
                };
            } else {
                console.log(`[INFO] ${username} não está ao vivo.`);
                return null;
            }
        } catch (error) {
            console.error(`[ERRO] Falha ao consultar Kick para ${username}:`, error.message);
            return null;
        }
    }

    async checkKickLiveWithPuppeteer(username) {
        try {
            // Inicializa browser se não existir
            if (!this.browser) {
                await this.initBrowser();
            }

            const url = `https://kick.com/${username}`;
            console.log(`[INFO] Acessando página do streamer ${username} via Puppeteer: ${url}`);

            // Acessa a página com timeout maior e networkidle2
            await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

            // Define headers extras para simular navegador real
            await this.page.setExtraHTTPHeaders({
                'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                'Referer': url,
            });

            // Verifica se está ao vivo
            const isLive = await this.page.evaluate(() => {
                const liveBadge = document.querySelector('[data-test-id="live-indicator"]');
                const videoPlayer = document.querySelector('video');
                return liveBadge !== null || videoPlayer !== null;
            });

            if (!isLive) {
                console.log(`[INFO] ${username} não está ao vivo.`);
                return null;
            }

            // Pega informações da live
            const streamInfo = await this.page.evaluate(() => {
                const title = document.querySelector('h1')?.textContent || "Live no Kick";
                const viewersText = document.querySelector('[data-test-id="viewer-count"]')?.textContent || "0";
                const viewers = parseInt(viewersText.replace(/[^0-9]/g, '')) || 0;
                const thumbnail = document.querySelector('video')?.poster || null;

                return { title, viewers, thumbnail };
            });

            console.log(`[INFO] ${username} está AO VIVO! Título: ${streamInfo.title}, Viewers: ${streamInfo.viewers}`);
            return {
                session_title: streamInfo.title,
                viewers: streamInfo.viewers,
                thumbnail: streamInfo.thumbnail
            };
        } catch (error) {
            console.error(`[ERRO] Falha ao verificar ${username} com Puppeteer:`, error.message);
            return null;
        }
    }

    async checkLiveKick(username) {
        try {
            console.log(`[INFO] Verificando status do streamer ${username} no Kick`);
            const liveData = await this.checkKickLive(username);

            if (liveData) {
                // Criar um objeto streamer temporário para a notificação
                const streamer = {
                    name: username,
                    type: "kick"
                };

                // Verificar se já foi notificado
                const streamKey = `kick:${username}`;
                if (!this.notifiedStreams.has(streamKey)) {
                    console.log(`[INFO] Enviando notificação para ${username}`);
                    await this.notifyChannel(streamer, liveData);
                    this.notifiedStreams.add(streamKey);
                    return true;
                } else {
                    console.log(`[INFO] ${username} já está notificado`);
                    return true;
                }
            } else {
                console.log(`[INFO] ${username} não está ao vivo`);
                return false;
            }
        } catch (error) {
            console.error(`[ERRO] Falha ao verificar streamer ${username}:`, error.message);
            return false;
        }
    }

    async notifyChannel(streamer, liveData) {
        const channelIds = this.getChannelIds();
        if (!channelIds.length) return;

        const url = `https://kick.com/${streamer.name}`;
        const embed = {
            title: liveData.session_title,
            url,
            image: { url: liveData.thumbnail || "https://kick.com/favicon.ico" },
            author: { name: `${streamer.name} - Kick`, icon_url: "https://kick.com/favicon.ico" },
            color: 0x53fc18,
            footer: { text: `${liveData.viewers} espectadores` }
        };

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel("Acessar").setStyle(ButtonStyle.Link).setURL(url)
        );

        for (const channelId of channelIds) {
            try {
                const channel = this.client.channels.cache.get(channelId);
                if (channel) {
                    await channel.send({ content: `O ${streamer.name} está AO VIVO! @everyone`, embeds: [embed], components: [row] });
                    console.log(`[INFO] Notificação enviada para ${channelId}`);
                }
            } catch (error) {
                console.error(`[ERRO] Falha ao enviar notificação para ${channelId}:`, error.message);
            }
        }
    }

    startWatching() {
        this.checkStreamers().catch(console.error);
        setInterval(() => this.checkStreamers().catch(console.error), this.checkInterval);
    }
}

module.exports = StreamerWatcher;
