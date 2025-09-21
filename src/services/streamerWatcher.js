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
        this.browserRetries = 0;
        this.maxRetries = 3;
    }

    // Inicializa o browser do Kick
    async initKickBrowser() {
        if (!this.kickBrowser) {
            try {
                console.log("[INFO] Iniciando Puppeteer com configurações personalizadas");
                
                // Configurações do Puppeteer - removendo qualquer executablePath
                const options = {
                    headless: "new",
                    // Não definir executablePath para usar o Chrome embutido do Puppeteer
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--disable-gpu',
                        '--no-first-run',
                        '--no-zygote',
                        '--single-process',
                        '--disable-extensions',
                        '--disable-web-security',
                        '--disable-features=VizDisplayCompositor'
                    ]
                };

                // Limpar qualquer variável de ambiente que possa interferir
                delete process.env.CHROME_BIN;
                delete process.env.CHROMIUM_BIN;

                this.kickBrowser = await puppeteer.launch(options);
                console.log("[INFO] Puppeteer (Kick) iniciado com sucesso!");
                this.browserRetries = 0;
                
                // Configura evento de desconexão para tentar reconectar
                this.kickBrowser.on('disconnected', async () => {
                    console.log("[INFO] Browser desconectado, tentando reconectar...");
                    this.kickBrowser = null;
                    await this.initKickBrowser();
                });
                
            } catch (error) {
                console.error("[ERRO] Falha ao iniciar Puppeteer:", error.message);
                this.browserRetries++;
                if (this.browserRetries >= this.maxRetries) {
                    console.error("[ERRO] Número máximo de tentativas de inicialização do browser atingido");
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
                return this.initKickBrowser();
            }
        }
    }

    // Checa se o streamer Kick está ao vivo
    async checkKickLive(username) {
        if (!this.kickBrowser) {
            try {
                await this.initKickBrowser();
            } catch (error) {
                console.error("[ERRO] Não foi possível inicializar o browser:", error.message);
                return null;
            }
        }

        let page;
        try {
            page = await this.kickBrowser.newPage();
            await page.setDefaultNavigationTimeout(30000);
            await page.setRequestInterception(true);
            
            // Otimiza o carregamento bloqueando recursos desnecessários
            page.on('request', (request) => {
                const resourceType = request.resourceType();
                if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                    request.abort();
                } else {
                    request.continue();
                }
            });

            await page.goto(`https://kick.com/${username}`, { 
                waitUntil: ["domcontentloaded", "networkidle2"],
                timeout: 30000 
            });

            const isLive = await page.evaluate(() => {
                const liveBadge = document.querySelector('[data-test-selector="live-badge"]');
                return liveBadge !== null;
            });

            if (isLive) {
                return {
                    session_title: `${username} ao vivo`,
                    thumbnail: { url: "https://kick.com/favicon.ico" }
                };
            }
            return null;

        } catch (err) {
            console.error(`[ERRO] Falha ao checar Kick para ${username}:`, err.message);
            
            // Se o erro for relacionado ao browser, tenta reiniciar
            if (err.message.includes('browser') || err.message.includes('target closed')) {
                await this.closeKickBrowser();
                this.kickBrowser = null;
            }
            
            return null;
        } finally {
            if (page) {
                try {
                    await page.close();
                } catch (err) {
                    console.error("[ERRO] Falha ao fechar página:", err.message);
                }
            }
        }
    }

    // Fecha o browser do Kick
    async closeKickBrowser() {
        if (this.kickBrowser) {
            try {
                await this.kickBrowser.close();
                this.kickBrowser = null;
                console.log("[INFO] Puppeteer (Kick) fechado!");
            } catch (error) {
                console.error("[ERRO] Falha ao fechar browser:", error.message);
                this.kickBrowser = null;
            }
        }
    }

    // Carrega a lista de streamers
    async loadStreamers() {
        try {
            const data = require("../data/streamers.json");
            this.streamers = data.streamers || [];
        } catch (error) {
            console.error("[ERRO] Falha ao carregar lista de streamers:", error.message);
            this.streamers = [];
        }
    }

    // Retorna os canais que receberão notificação
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

    // Checa todos os streamers
    async checkStreamers() {
        try {
            await this.loadStreamers();

            for (const streamer of this.streamers) {
                const streamKey = `${streamer.type}:${streamer.name}`;
                console.log(`[DEBUG] Checando streamer: ${streamer.name} (${streamer.type})`);

                try {
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
                } catch (error) {
                    console.error(`[ERRO] Falha ao processar streamer ${streamer.name}:`, error.message);
                }
            }
        } catch (error) {
            console.error("[ERRO] Falha ao verificar streamers:", error.message);
        }
    }

    async checkIfLive(streamer) {
        try {
            if (streamer.type === "twitch") {
                return await this.checkTwitchLive(streamer.name);
            } else if (streamer.type === "kick") {
                return await this.checkKickLive(streamer.name);
            }
        } catch (error) {
            console.error(`[ERRO] Falha ao verificar status de ${streamer.name}:`, error.message);
        }
        return null;
    }

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
                        Authorization: `Bearer ${this.twitchToken}`,
                    },
                }
            );
            const data = await res.json();
            if (data.data && data.data.length > 0 && data.data[0].type === "live") {
                return data.data[0];
            }
        } catch (error) {
            console.error(`[ERRO] Falha ao verificar Twitch para ${username}:`, error.message);
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
            new ButtonBuilder().setLabel("Acessar").setStyle(ButtonStyle.Link).setURL(url)
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
                console.error(`[ERRO] Erro ao enviar notificação para o canal ${channelId}:`, error.message);
            }
        }
    }

    async updateLiveRole(streamerName, isLive) {
        try {
            const configPath = path.join(__dirname, "../data/server_config.json");
            let config = { servers: {} };
            if (fs.existsSync(configPath)) {
                config = JSON.parse(fs.readFileSync(configPath));
            }

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
                    console.error(`[ERRO] Erro ao atualizar cargo no servidor ${guild.name}:`, error.message);
                }
            }
        } catch (error) {
            console.error("[ERRO] Falha ao atualizar roles:", error.message);
        }
    }

    startWatching() {
        this.checkStreamers().catch(error => {
            console.error("[ERRO] Falha ao iniciar verificação de streamers:", error.message);
        });
        
        setInterval(() => {
            this.checkStreamers().catch(error => {
                console.error("[ERRO] Falha na verificação periódica de streamers:", error.message);
            });
        }, this.checkInterval);
    }
}

module.exports = StreamerWatcher;
