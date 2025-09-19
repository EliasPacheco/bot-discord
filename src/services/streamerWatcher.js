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

    async checkKickLive(username) {
        try {
            console.log(`[DEBUG] Verificando Kick para ${username}`);

            // Headers atualizados para simular melhor um navegador real
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': `https://kick.com/${username}`,
                'Origin': 'https://kick.com',
                'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
                'Connection': 'keep-alive',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            };

            // Primeiro, tentar obter o HTML da página do canal
            const pageRes = await fetch(`https://kick.com/${username}`, {
                headers: {
                    ...headers,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'sec-fetch-dest': 'document',
                    'sec-fetch-mode': 'navigate',
                    'sec-fetch-site': 'none',
                    'sec-fetch-user': '?1',
                    'upgrade-insecure-requests': '1'
                }
            });

            if (!pageRes.ok) {
                console.log(`[WARNING] Falha ao acessar página do canal ${username} (${pageRes.status})`);
                return null;
            }

            // Aguardar um pouco antes de fazer a próxima requisição
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Tentar diferentes endpoints
            const endpoints = [
                `https://kick.com/api/v2/channels/${username}`,
                `https://kick.com/api/v1/channels/${username}`,
                `https://kick.com/api/v1/channels/${username}/livestream`
            ];

            let data = null;
            let error = null;

            for (const endpoint of endpoints) {
                try {
                    console.log(`[DEBUG] Tentando endpoint: ${endpoint}`);
                    const res = await fetch(endpoint, {
                        headers,
                        method: 'GET'
                    });

                    if (res.ok) {
                        data = await res.json();
                        console.log(`[DEBUG] Sucesso com endpoint: ${endpoint}`);
                        break;
                    } else {
                        console.log(`[WARNING] Falha no endpoint ${endpoint} (${res.status})`);
                        // Aguardar um pouco antes de tentar o próximo endpoint
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                } catch (err) {
                    error = err;
                    console.log(`[WARNING] Erro no endpoint ${endpoint}: ${err.message}`);
                    continue;
                }
            }

            if (!data) {
                // Se todas as APIs falharem, tentar extrair informações da página HTML
                try {
                    const html = await pageRes.text();
                    const isLiveMatch = html.match(/isLive":true/i);
                    const titleMatch = html.match(/"title":"([^"]+)"/);
                    const thumbnailMatch = html.match(/"thumbnail":{"url":"([^"]+)"/);

                    if (isLiveMatch) {
                        console.log(`[DEBUG] Canal ${username} detectado como ao vivo via HTML`);
                        return {
                            session_title: titleMatch ? titleMatch[1] : "Live na Kick",
                            thumbnail: {
                                url: thumbnailMatch ? thumbnailMatch[1].replace(/\\/g, '') : null
                            }
                        };
                    }
                } catch (err) {
                    console.log(`[WARNING] Erro ao processar HTML do canal ${username}: ${err.message}`);
                }

                if (error) {
                    console.error(`[ERRO] Todos os endpoints falharam para ${username}:`, error.message);
                } else {
                    console.error(`[ERRO] Não foi possível obter dados para ${username}`);
                }
                return null;
            }

            // Log dos dados recebidos
            console.log(
                `[DEBUG] Dados do canal ${username}:`,
                JSON.stringify({
                    id: data.id,
                    slug: data.slug,
                    is_banned: data.is_banned,
                    livestream: data.livestream ? "presente" : "ausente"
                })
            );

            // Verifica se o streamer está realmente ao vivo
            const isLive = data.livestream !== null && !data.is_banned;

            if (isLive) {
                console.log(`[LIVE] ${username} está AO VIVO no Kick!`);
                return data.livestream;
            } else {
                console.log(`[DEBUG] ${username} está offline no Kick`);
                return null;
            }
        } catch (err) {
            console.error(`[ERRO] Falha ao verificar ${username} no Kick:`, err.message);
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
