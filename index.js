require("dotenv").config();
const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const { handleAdicionarkick } = require("./src/commands/adicionarkick");
const { handleAdicionartwitch } = require("./src/commands/adicionartwitch");
const StreamerWatcher = require("./src/services/streamerWatcher");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});
const PREFIX = "/";

client.once("clientReady", () => {
    console.log(`Logged in as ${client.user.tag}!`);
    const watcher = new StreamerWatcher(client);
    watcher.startWatching();
});

client.on("messageCreate", async (message) => {
    if (!message.content.startsWith(PREFIX) || message.author.bot) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === "adicionarkick") {
        await handleAdicionarkick(message, args);
    } else if (command === "adicionartwitch") {
        await handleAdicionartwitch(message, args);
    }
});

client.on("interactionCreate", async (interaction) => {
    // Autocomplete unificado para todos os comandos com autocomplete
    if (interaction.isAutocomplete()) {
        const focusedValue = interaction.options.getFocused() ?? '';
        const streamersFilePath = path.join(__dirname, './src/data/streamers.json');
        const notificacaoPath = path.join(__dirname, './src/data/notificacao.json');

        // Carregar streamers
        let streamers = [];
        if (fs.existsSync(streamersFilePath)) {
            const data = JSON.parse(fs.readFileSync(streamersFilePath));
            streamers = Array.isArray(data.streamers) ? data.streamers : [];
        }

        let choices = [];
        if (interaction.commandName === 'testetwitch' || interaction.commandName === 'removertwitch') {
            choices = streamers
                .filter(s => s.type === 'twitch' && s.name.toLowerCase().includes(focusedValue.toLowerCase()))
                .map(s => ({ name: s.name, value: s.name }));
        } else if (interaction.commandName === 'testekick' || interaction.commandName === 'removerkick') {
            choices = streamers
                .filter(s => s.type === 'kick' && s.name.toLowerCase().includes(focusedValue.toLowerCase()))
                .map(s => ({ name: s.name, value: s.name }));
        } else if (interaction.commandName === 'removercanal') {
            // Carregar canais de notificação
            let canais = [];
            if (fs.existsSync(notificacaoPath)) {
                const notif = JSON.parse(fs.readFileSync(notificacaoPath));
                if (Array.isArray(notif.canais)) canais = notif.canais;
                else if (notif.canalId) canais = [notif.canalId]; // migração de formato antigo
            }
            choices = canais
                .filter(id => id && id.toString().includes(focusedValue))
                .map(id => {
                    const ch = interaction.guild?.channels?.cache?.get(id);
                    const name = ch ? `#${ch.name}` : `Canal ${id}`;
                    return { name: `${name} (${id})`, value: id };
                });
        } else if (interaction.commandName === 'escolhercargo') {
            // Retorna todos os streamers para seleção
            choices = streamers
                .filter(s => s.name.toLowerCase().includes(focusedValue.toLowerCase()))
                .map(s => ({ name: `${s.name} (${s.type})`, value: s.name }));
        }
        await interaction.respond(choices.slice(0, 25));
        return;
    }

    if (!interaction.isCommand()) return;

    const { commandName, options } = interaction;
    
    if (commandName === "escolhercargo") {
        const cargo = options.getRole("cargo");
        const usuario = options.getUser("usuario");
        const serverId = interaction.guildId;

        // Carrega as configurações do servidor
        const fs = require("fs");
        const path = require("path");
        const configPath = path.join(__dirname, "./src/data/server_config.json");
        let config = { servers: {} };
        
        if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath));
        }

        // Inicializa a configuração do servidor se não existir
        if (!config.servers[serverId]) {
            config.servers[serverId] = {
                liveRoles: {}
            };
        }

        // Inicializa a estrutura de cargos ao vivo se não existir
        if (!config.servers[serverId].liveRoles) {
            config.servers[serverId].liveRoles = {};
        }

        // Configura o cargo para o usuário
        config.servers[serverId].liveRoles[usuario.id] = cargo.id;

        // Salva as configurações
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        await interaction.reply(
            `Cargo ${cargo.name} configurado para ser atribuído ao usuário ${usuario.tag} quando estiver ao vivo neste servidor!`
        );
        return;
    }

    if (commandName === "adicionar") {
        const plataforma = options.getString("plataforma");
        const nome = options.getString("nome");
        const streamer = { type: plataforma, name: nome };

        // Carrega e salva igual ao seu comando antigo
        const fs = require("fs");
        const path = require("path");
        const streamersFilePath = path.join(
            __dirname,
            "./src/data/streamers.json",
        );
        let data = { streamers: [] };
        if (fs.existsSync(streamersFilePath)) {
            data = JSON.parse(fs.readFileSync(streamersFilePath));
            if (!Array.isArray(data.streamers)) data.streamers = [];
        }
        data.streamers.push(streamer);
        fs.writeFileSync(streamersFilePath, JSON.stringify(data, null, 2));
        await interaction.reply(
            `Streamer ${nome} adicionado na plataforma ${plataforma}!`,
        );
    }

    if (commandName === "removertwitch" || commandName === "removerkick") {
        const nome = options.getString("nome");
        const plataforma = commandName === "removertwitch" ? "twitch" : "kick";

        const fs = require("fs");
        const path = require("path");
        const streamersFilePath = path.join(
            __dirname,
            "./src/data/streamers.json",
        );
        let data = { streamers: [] };
        if (fs.existsSync(streamersFilePath)) {
            data = JSON.parse(fs.readFileSync(streamersFilePath));
            if (!Array.isArray(data.streamers)) data.streamers = [];
        }
        const originalLength = data.streamers.length;
        data.streamers = data.streamers.filter(
            (s) => !(s.type === plataforma && s.name === nome),
        );
        fs.writeFileSync(streamersFilePath, JSON.stringify(data, null, 2));
        if (data.streamers.length < originalLength) {
            await interaction.reply(
                `Streamer ${nome} removido da plataforma ${plataforma}!`,
            );
        } else {
            await interaction.reply(
                `Streamer ${nome} não encontrado na plataforma ${plataforma}.`,
            );
        }
    }

    if (commandName === "testetwitch" || commandName === "testekick") {
        const nome = options.getString("nome");
        const plataforma = commandName === "testetwitch" ? "twitch" : "kick";
        let url = "";
        let thumb = "";
        let embedTitle = "";
        let embedColor = 0x9146ff; // Roxo Twitch

        if (plataforma === "twitch") {
            url = `https://twitch.tv/${nome}`;
            // Thumbnail padrão da Twitch (pode customizar se quiser buscar ao vivo)
            thumb = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${nome}.jpg?width=320&height=180`;
            embedTitle = `Twitch: ${nome}`;
        } else {
            url = `https://kick.com/${nome}`;
            // Kick não tem thumbnail pública, usar avatar ou imagem padrão
            thumb = `https://files.kick.com/user/default-avatar.jpg`; // Ou personalize se souber o avatar
            embedTitle = `Kick: ${nome}`;
            embedColor = 0x53fc18; // Verde Kick
        }

        const embed = new EmbedBuilder()
            .setTitle(embedTitle)
            .setDescription(`O ${nome} está ao vivo! @everyone`)
            .setURL(url)
            .setColor(embedColor)
            .setImage(thumb);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel("Acessar")
                .setStyle(ButtonStyle.Link)
                .setURL(url),
        );

        await interaction.reply({
            embeds: [embed],
            components: [row],
        });
    }

    if (commandName === "escolhercanal") {
        const canal = options.getChannel('canal');
        if (!canal || canal.type !== 0) { // 0 = GUILD_TEXT
            await interaction.reply({ content: 'Escolha um canal de texto válido!', ephemeral: true });
            return;
        }
        const notificacaoPath = path.join(__dirname, './src/data/notificacao.json');
        let data = {};
        if (fs.existsSync(notificacaoPath)) {
            try { data = JSON.parse(fs.readFileSync(notificacaoPath)); } catch { data = {}; }
        }
        // Migrar formato antigo { canalId } para { canais: [] }
        let canais = [];
        if (Array.isArray(data.canais)) canais = data.canais;
        else if (data.canalId) canais = [data.canalId];
        
        if (!canais.includes(canal.id)) canais.push(canal.id);
        fs.writeFileSync(notificacaoPath, JSON.stringify({ canais }, null, 2));
        await interaction.reply(`Canal de notificações adicionado: <#${canal.id}>. Total de canais: ${canais.length}`);
    }

    if (commandName === "removercanal") {
        const canalId = options.getString('canal');
        const notificacaoPath = path.join(__dirname, './src/data/notificacao.json');
        let data = {};
        if (fs.existsSync(notificacaoPath)) {
            try { data = JSON.parse(fs.readFileSync(notificacaoPath)); } catch { data = {}; }
        }
        let canais = [];
        if (Array.isArray(data.canais)) canais = data.canais;
        else if (data.canalId) canais = [data.canalId];

        const before = canais.length;
        canais = canais.filter(id => id !== canalId);
        fs.writeFileSync(notificacaoPath, JSON.stringify({ canais }, null, 2));
        if (canais.length < before) {
            await interaction.reply(`Canal removido: ${canalId}. Restantes: ${canais.length}`);
        } else {
            await interaction.reply({ content: `Canal não encontrado: ${canalId}`, ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);