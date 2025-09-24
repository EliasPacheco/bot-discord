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
        this.checkInterval = 180000; // 3 minutos
        this.notificacaoPath = path.join(__dirname, "../data/notificacao.json");
        this.notifiedStreamsPath = path.join(__dirname, "../data/notified_streams.json");
        this.notifiedStreams = new Set();

        this.browser = null;
        this.page = null;
        this.pages = new Map();

        // Twitch token
        this.twitchToken = null;
        this.twitchTokenExpires = 0;
        
        // Carregar streamers já notificados
        this.loadNotifiedStreams();
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
    async _setupPage(page) {
        // define UA e viewport
        await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36");
        await page.setViewport({ width: 1280, height: 720 });

        // stealth-ish: esconde webdriver e define alguns props comuns
        await page.evaluateOnNewDocument(() => {
            try {
                // false webdriver
                Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });

                // fake plugins / languages
                Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'en-US'], configurable: true });
                Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5], configurable: true });

                // chrome object
                window.chrome = window.chrome || { runtime: {} };
            } catch (e) {
                // ignore
            }
        });
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

    // Carregar streamers já notificados do arquivo
    loadNotifiedStreams() {
        try {
            if (fs.existsSync(this.notifiedStreamsPath)) {
                const data = JSON.parse(fs.readFileSync(this.notifiedStreamsPath));
                if (Array.isArray(data.streams)) {
                    // Limpa o Set antes de adicionar novos itens
                    this.notifiedStreams.clear();
                    data.streams.forEach(stream => this.notifiedStreams.add(stream));
                    console.log(`[INFO] Carregados ${data.streams.length} streamers já notificados.`);
                }
            } else {
                // Cria o arquivo se não existir
                this.saveNotifiedStreams();
            }
        } catch (error) {
            console.error("[ERRO] Falha ao carregar streamers notificados:", error.message);
            // Garante que o arquivo seja criado mesmo em caso de erro
            this.saveNotifiedStreams();
        }
    }

    // Salvar streamers notificados em arquivo
    saveNotifiedStreams() {
        try {
            const data = {
                streams: Array.from(this.notifiedStreams),
                lastUpdated: new Date().toISOString()
            };
            // Garante que o diretório existe
            const dir = path.dirname(this.notifiedStreamsPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.notifiedStreamsPath, JSON.stringify(data, null, 2));
            console.log(`[INFO] Salvos ${data.streams.length} streamers notificados.`);
        } catch (error) {
            console.error("[ERRO] Falha ao salvar streamers notificados:", error.message);
        }
    }

    async checkStreamers() {
        // Carrega os streamers e garante que o estado persistido seja carregado
        await this.loadStreamers();
        this.loadNotifiedStreams();
        await this.initBrowser();

        for (const streamer of this.streamers) {
            const streamKey = `${streamer.type}:${streamer.name}`;
            console.log(`[DEBUG] Checando streamer: ${streamer.name} (${streamer.type})`);

            try {
                const liveData = await this.checkIfLive(streamer);
                console.log(`[DEBUG] Status de ${streamer.name}: ${liveData ? "AO VIVO" : "offline"}`);

                // Streamer está ao vivo
                if (liveData) {
                    // Verifica se já foi notificado
                    if (!this.notifiedStreams.has(streamKey)) {
                        console.log(`[INFO] ${streamer.name} entrou ao vivo!`);
                        await this.notifyChannel(streamer, liveData);
                        await this.updateLiveRole(streamer.name, true);
                        this.notifiedStreams.add(streamKey);
                        this.saveNotifiedStreams(); // Salva o estado após adicionar
                    } else {
                        console.log(`[INFO] ${streamer.name} continua ao vivo. Notificação já enviada anteriormente.`);
                    }
                } 
                // Streamer está offline
                else {
                    if (this.notifiedStreams.has(streamKey)) {
                        console.log(`[INFO] ${streamer.name} saiu do ar.`);
                        await this.updateLiveRole(streamer.name, false);
                        this.notifiedStreams.delete(streamKey);
                        this.saveNotifiedStreams(); // Salva o estado após remover
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
        return await this.checkKickLiveWithPuppeteer(username);
    }

    async checkKickLiveWithPuppeteer(username) {
        try {
            if (!this.browser) await this.initBrowser();

            const url = `https://kick.com/${username}`;
            console.log(`[INFO] Acessando página do streamer ${username} via Puppeteer: ${url}`);

            // Reaproveita a aba se já existir
            let page;
            if (this.pages.has(username)) {
                page = this.pages.get(username);
                try {
                    // tenta navegar na mesma aba
                    await page.goto(url, { waitUntil: ['domcontentloaded', 'networkidle2'], timeout: 90000 });
                } catch (err) {
                    // se der erro, fecha e recria a aba
                    try { await page.close(); } catch (_) {}
                    this.pages.delete(username);
                    page = null;
                }
            }

            if (!page) {
                page = await this.browser.newPage();
                await this._setupPage(page);
                this.pages.set(username, page);
                await page.goto(url, { waitUntil: ['domcontentloaded', 'networkidle2'], timeout: 90000 });
            }

            // pequenas tentativas para dar tempo a conteúdo dinâmico
            const attemptRun = async () => {
                // espera curta (compatível com qualquer versão)
                await new Promise(r => setTimeout(r, 1500));

                // Executa no contexto da página várias verificações robustas
                const liveInfo = await page.evaluate(() => {
                    function isVisible(el) {
                        if (!el) return false;
                        const style = window.getComputedStyle(el);
                        return style && style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0 && el.offsetWidth > 0;
                    }

                    // lista de seletores possíveis (varia conforme UI)
                    const liveBadgeSelectors = [
                        '[data-test-id="live-indicator"]', // comum
                        '.channel-live-indicator', '.live-indicator', '.badge-live', '.status-live'
                    ];
                    const viewerSelectors = [
                        '[data-test-id="viewer-count"]', '.viewer-count', '.live-count', '.watchers-count', '.channel-status__viewers'
                    ];

                    let foundLiveBadge = null;
                    for (const s of liveBadgeSelectors) {
                        const el = document.querySelector(s);
                        if (el && isVisible(el) && /live|ao vivo|ao-vivo|ao_vivo/i.test((el.textContent || ''))) {
                            foundLiveBadge = el;
                            break;
                        }
                    }

                    let viewers = 0;
                    for (const s of viewerSelectors) {
                        const el = document.querySelector(s);
                        if (el && isVisible(el)) {
                            const txt = el.textContent || '';
                            const n = parseInt(txt.replace(/\D/g, ''), 10);
                            if (!Number.isNaN(n) && n > 0) {
                                viewers = n;
                                break;
                            } else {
                                // se não encontrou número, tenta extrair qualquer dígito
                                const m = txt.match(/(\d{1,3}(?:[.,]\d{3})*)/);
                                if (m) {
                                    viewers = parseInt(m[0].replace(/\D/g, ''), 10) || viewers;
                                }
                            }
                        }
                    }

                    // verifica elemento video e se está tocando
                    const video = document.querySelector('video');
                    let playing = false;
                    if (video) {
                        try {
                            playing = (video.readyState >= 2) && !video.paused;
                        } catch (e) {
                            // ignore cross-origin or properties not acessíveis
                        }
                    }

                    // fallback: procura textos "ao vivo", "live" ou "espectadores" no DOM
                    let textHint = false;
                    if (!foundLiveBadge && !viewers && !playing) {
                        const allText = document.body.innerText.toLowerCase();
                        if (allText.includes('ao vivo') || allText.includes('live') || allText.includes('espectadores') || allText.includes('viewers')) {
                            textHint = true;
                        }
                    }

                    // Se qualquer verificação positiva, extrai meta info
                    if (foundLiveBadge || viewers > 0 || playing || textHint) {
                        const title = document.querySelector('h1')?.textContent?.trim() || document.title || 'Live na Kick';
                        const thumbnail = (video && video.poster) || (document.querySelector('.channel-header img')?.src) || null;
                        const category = document.querySelector('[data-test-id="category"]')?.textContent ||
                                        document.querySelector('.channel-status__game-name')?.textContent ||
                                        null;
                        return {
                            session_title: title,
                            viewers: viewers || 0,
                            category: category || 'Unknown',
                            thumbnail
                        };
                    }

                    return null;
                });

                return liveInfo;
            };

            // tenta 2 vezes com pequenos delays para evitar falso negativo
            let liveResult = await attemptRun();
            if (!liveResult) {
                // tenta novamente depois de esperar um pouco mais
                await new Promise(r => setTimeout(r, 2000));
                liveResult = await attemptRun();
            }

            if (!liveResult) {
                console.log(`[INFO] ${username} NÃO está ao vivo.`);
                // não fecha a aba: reaproveitamos depois
                return null;
            }

            console.log(`[INFO] ${username} está AO VIVO! Título: ${liveResult.session_title}, Viewers: ${liveResult.viewers}, Categoria: ${liveResult.category}`);
            return liveResult;
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