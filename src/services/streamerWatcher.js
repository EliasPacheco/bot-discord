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
        
        // Twitch token
        this.twitchToken = null;
        this.twitchTokenExpires = 0;
        
        // Carregar streamers já notificados
        this.loadNotifiedStreams();
    }

    async initBrowser() {
        if (!this.browser) {
            console.log('[INFO] Iniciando navegador...');
            this.browser = await puppeteer.launch({
                headless: "new",
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                    '--window-size=1920x1080',
                ]
            });
            console.log('[INFO] Navegador iniciado com sucesso!');
        }
        return this.browser;
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
                if (data.streams && typeof data.streams === 'object') {
                    this.notifiedStreams = new Map(Object.entries(data.streams));
                    console.log(`[INFO] Carregados ${this.notifiedStreams.size} streamers já notificados.`);
                }
            } else {
                // Cria o arquivo se não existir
                this.notifiedStreams = new Map();
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
                streams: Object.fromEntries(this.notifiedStreams),
                lastUpdated: new Date().toISOString()
            };
            // Garante que o diretório existe
            const dir = path.dirname(this.notifiedStreamsPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.notifiedStreamsPath, JSON.stringify(data, null, 2));
            console.log(`[INFO] Salvos ${Object.keys(data.streams).length} streamers notificados.`);
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
                    const now = new Date();
                    const notifiedInfo = this.notifiedStreams.get(streamKey);
                    
                    // Se o streamer já está no registro
                    if (notifiedInfo) {
                        // Verifica se o streamer estava offline anteriormente e agora está online novamente
                        const wasOffline = notifiedInfo.lastOffline && 
                                          new Date(notifiedInfo.lastOffline) > new Date(notifiedInfo.lastNotified);
                        
                        // Verifica se passaram 8 horas desde a última notificação (apenas se não estava offline)
                        const timeSinceLastNotification = now - new Date(notifiedInfo.lastNotified);
                        const timeThreshold = 8 * 60 * 60 * 1000; // 8 horas em milissegundos
                        const shouldNotify = wasOffline || timeSinceLastNotification >= timeThreshold;
                        
                        if (shouldNotify) {
                            console.log(`[INFO] ${streamer.name} está ao vivo${wasOffline ? ' novamente' : ' há mais de 8 horas'}! Enviando nova notificação...`);
                            await this.notifyChannel(streamer, liveData);
                            await this.updateLiveRole(streamer.name, true);
                            
                            // Atualiza informações de notificação, mantendo lastOffline se existir
                            const newNotifiedInfo = {
                                ...notifiedInfo,
                                lastNotified: now.toISOString(),
                                notificationCount: (notifiedInfo.notificationCount || 0) + 1
                            };
                            this.notifiedStreams.set(streamKey, newNotifiedInfo);
                            this.saveNotifiedStreams();
                            
                            console.log(`[INFO] Notificação enviada para ${streamer.name} (${newNotifiedInfo.notificationCount}ª vez)`);
                        } else {
                            const hoursAgo = (timeSinceLastNotification / (60 * 60 * 1000)).toFixed(1);
                            console.log(`[INFO] ${streamer.name} continua ao vivo. Última notificação há ${hoursAgo} horas (${notifiedInfo.notificationCount} notificações).`);
                        }
                    } else {
                        // Primeira vez que o streamer está online
                        console.log(`[INFO] ${streamer.name} está ao vivo pela primeira vez! Enviando notificação...`);
                        await this.notifyChannel(streamer, liveData);
                        await this.updateLiveRole(streamer.name, true);
                        
                        // Cria informações de notificação
                        const newNotifiedInfo = {
                            lastNotified: now.toISOString(),
                            notificationCount: 1
                        };
                        this.notifiedStreams.set(streamKey, newNotifiedInfo);
                        this.saveNotifiedStreams();
                        
                        console.log(`[INFO] Notificação enviada para ${streamer.name} (primeira vez)`);
                    }
                } 
                // Streamer está offline
                else {
                    if (this.notifiedStreams.has(streamKey)) {
                        // Para Kick, faz uma segunda verificação para confirmar que está realmente offline
                        if (streamer.type === "kick") {
                            console.log(`[INFO] ${streamer.name} parece estar offline. Fazendo segunda verificação...`);
                            // Espera 30 segundos antes da segunda verificação
                            await new Promise(resolve => setTimeout(resolve, 30000));
                            const secondCheck = await this.checkIfLive(streamer);
                            
                            if (secondCheck) {
                                console.log(`[INFO] ${streamer.name} ainda está online (confirmado na segunda verificação).`);
                                return; // Mantém o streamer na lista de notificados
                            }
                        }
                        
                        console.log(`[INFO] ${streamer.name} saiu do ar.`);
                        await this.updateLiveRole(streamer.name, false);
                        
                        // Atualiza o registro com a data de offline, mas mantém o streamer no registro
                        const notifiedInfo = this.notifiedStreams.get(streamKey);
                        const updatedInfo = {
                            ...notifiedInfo,
                            lastOffline: new Date().toISOString()
                        };
                        this.notifiedStreams.set(streamKey, updatedInfo);
                        this.saveNotifiedStreams(); // Salva o estado após atualizar
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

            // Cria uma nova aba para cada verificação
            const page = await this.browser.newPage();
            
            try {
                // Configura a página
                await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36");
                await page.setViewport({ width: 1920, height: 1080 });

                // Configura timeout maior para carregar a página
                await page.goto(url, { 
                    waitUntil: ['domcontentloaded', 'networkidle2'], 
                    timeout: 120000 // 2 minutos
                });

                // Espera 15 segundos para garantir que todo o conteúdo dinâmico seja carregado
                console.log(`[INFO] Aguardando 60 segundos para verificar ${username}...`);
                await new Promise(r => setTimeout(r, 60000));

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

                // tenta 3 vezes com delays progressivos para evitar falso negativo
                let liveResult = await attemptRun();
                let attempts = 1;
                
                while (!liveResult && attempts < 3) {
                    console.log(`[INFO] Tentativa ${attempts + 1} de verificar ${username}...`);
                    // Aumenta o tempo de espera a cada tentativa
                    await new Promise(r => setTimeout(r, 3000 * attempts));
                    liveResult = await attemptRun();
                    attempts++;
                }

                if (!liveResult) {
                    console.log(`[INFO] ${username} NÃO está ao vivo após ${attempts} tentativas.`);
                    // Fecha a aba após a verificação
                    await page.close();
                    return null;
                }

                console.log(`[INFO] ${username} está AO VIVO! Título: ${liveResult.session_title}, Viewers: ${liveResult.viewers}, Categoria: ${liveResult.category}`);
                // Fecha a aba após a verificação
                await page.close();
                return liveResult;
            } catch (error) {
                console.error(`[ERRO] Falha ao verificar ${username} com Puppeteer:`, error.message);
                // Garante que a aba seja fechada mesmo em caso de erro
                try {
                    await page.close();
                } catch (closeErr) {
                    console.error(`[ERRO] Falha ao fechar aba para ${username}:`, closeErr.message);
                }
                return null;
            }
        } catch (error) {
            console.error(`[ERRO] Falha ao verificar ${username} com Puppeteer:`, error.message);
            // Em caso de erro grave, tenta limpar a aba para forçar recriação na próxima vez
            if (this.pages.has(username)) {
                try {
                    const page = this.pages.get(username);
                    await page.close();
                    this.pages.delete(username);
                    console.log(`[DEBUG] Aba removida para ${username} após erro grave`);
                } catch (closeErr) {
                    console.error(`[ERRO] Falha ao limpar aba com erro para ${username}:`, closeErr.message);
                }
            }
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

            // Verifica se o streamer está no arquivo notified_streams.json
            const streamKey = `${streamerName.includes('twitch:') ? 'twitch' : 'kick'}:${streamerName}`;
            const notifiedInfo = this.notifiedStreams.get(streamKey);
            
            // Se o streamer não estiver no arquivo ou tiver lastOffline, força isLive para false
            if (!notifiedInfo || (notifiedInfo && notifiedInfo.lastOffline)) {
                isLive = false;
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
        // Inicia a verificação inicial
        this.checkStreamers().catch(console.error);
        
        // Configura verificação periódica
        setInterval(() => this.checkStreamers().catch(console.error), this.checkInterval);
    }
}

module.exports = StreamerWatcher;