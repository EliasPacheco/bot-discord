require('dotenv').config();
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { handleAdicionarkick } = require('./src/commands/adicionarkick');
const { handleAdicionartwitch } = require('./src/commands/adicionartwitch');
const StreamerWatcher = require('./src/services/streamerWatcher');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const PREFIX = '/';

client.once('clientReady', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    const watcher = new StreamerWatcher(client);
    watcher.startWatching();
});

client.on('messageCreate', async (message) => {
    if (!message.content.startsWith(PREFIX) || message.author.bot) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'adicionarkick') {
        await handleAdicionarkick(message, args);
    } else if (command === 'adicionartwitch') {
        await handleAdicionartwitch(message, args);
    }
});

client.on('interactionCreate', async interaction => {
    // Autocomplete para testetwitch e testekick
    if (interaction.isAutocomplete()) {
        const focusedValue = interaction.options.getFocused();
        const fs = require('fs');
        const path = require('path');
        const streamersFilePath = path.join(__dirname, './src/data/streamers.json');
        let data = { streamers: [] };
        if (fs.existsSync(streamersFilePath)) {
            data = JSON.parse(fs.readFileSync(streamersFilePath));
            if (!Array.isArray(data.streamers)) data.streamers = [];
        }
        let filtered = [];
        if (interaction.commandName === 'testetwitch') {
            filtered = data.streamers
                .filter(s => s.type === 'twitch' && s.name.toLowerCase().includes(focusedValue.toLowerCase()))
                .map(s => ({ name: s.name, value: s.name }));
        } else if (interaction.commandName === 'testekick') {
            filtered = data.streamers
                .filter(s => s.type === 'kick' && s.name.toLowerCase().includes(focusedValue.toLowerCase()))
                .map(s => ({ name: s.name, value: s.name }));
        }
        await interaction.respond(filtered.slice(0, 25));
        return;
    }

    // Autocomplete para removertwitch e removerkick
    if (interaction.isAutocomplete()) {
        const focusedValue = interaction.options.getFocused();
        const fs = require('fs');
        const path = require('path');
        const streamersFilePath = path.join(__dirname, './src/data/streamers.json');
        let data = { streamers: [] };
        if (fs.existsSync(streamersFilePath)) {
            data = JSON.parse(fs.readFileSync(streamersFilePath));
        }
        let filtered = [];
        if (interaction.commandName === 'removertwitch') {
            filtered = data.streamers
                .filter(s => s.type === 'twitch' && s.name.toLowerCase().includes(focusedValue.toLowerCase()))
                .map(s => ({ name: s.name, value: s.name }));
        } else if (interaction.commandName === 'removerkick') {
            filtered = data.streamers
                .filter(s => s.type === 'kick' && s.name.toLowerCase().includes(focusedValue.toLowerCase()))
                .map(s => ({ name: s.name, value: s.name }));
        }
        await interaction.respond(filtered.slice(0, 25));
        return;
    }

    if (!interaction.isCommand()) return;

    const { commandName, options } = interaction;

    if (commandName === 'adicionar') {
        const plataforma = options.getString('plataforma');
        const nome = options.getString('nome');
        const streamer = { type: plataforma, name: nome };

        // Carrega e salva igual ao seu comando antigo
        const fs = require('fs');
        const path = require('path');
        const streamersFilePath = path.join(__dirname, './src/data/streamers.json');
        let data = { streamers: [] };
        if (fs.existsSync(streamersFilePath)) {
            data = JSON.parse(fs.readFileSync(streamersFilePath));
            if (!Array.isArray(data.streamers)) data.streamers = [];
        }
        data.streamers.push(streamer);
        fs.writeFileSync(streamersFilePath, JSON.stringify(data, null, 2));
        await interaction.reply(`Streamer ${nome} adicionado na plataforma ${plataforma}!`);
    }

    if (commandName === 'removertwitch' || commandName === 'removerkick') {
        const nome = options.getString('nome');
        const plataforma = commandName === 'removertwitch' ? 'twitch' : 'kick';

        const fs = require('fs');
        const path = require('path');
        const streamersFilePath = path.join(__dirname, './src/data/streamers.json');
        let data = { streamers: [] };
        if (fs.existsSync(streamersFilePath)) {
            data = JSON.parse(fs.readFileSync(streamersFilePath));
            if (!Array.isArray(data.streamers)) data.streamers = [];
        }
        const originalLength = data.streamers.length;
        data.streamers = data.streamers.filter(s => !(s.type === plataforma && s.name === nome));
        fs.writeFileSync(streamersFilePath, JSON.stringify(data, null, 2));
        if (data.streamers.length < originalLength) {
            await interaction.reply(`Streamer ${nome} removido da plataforma ${plataforma}!`);
        } else {
            await interaction.reply(`Streamer ${nome} não encontrado na plataforma ${plataforma}.`);
        }
    }

    if (commandName === 'testetwitch' || commandName === 'testekick') {
        const nome = options.getString('nome');
        const plataforma = commandName === 'testetwitch' ? 'twitch' : 'kick';
        let url = '';
        let thumb = '';
        let embedTitle = '';
        let embedColor = 0x9146FF; // Roxo Twitch

        if (plataforma === 'twitch') {
            url = `https://twitch.tv/${nome}`;
            // Thumbnail padrão da Twitch (pode customizar se quiser buscar ao vivo)
            thumb = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${nome}.jpg?width=320&height=180`;
            embedTitle = `Twitch: ${nome}`;
        } else {
            url = `https://kick.com/${nome}`;
            // Kick não tem thumbnail pública, usar avatar ou imagem padrão
            thumb = `https://files.kick.com/user/default-avatar.jpg`; // Ou personalize se souber o avatar
            embedTitle = `Kick: ${nome}`;
            embedColor = 0x53FC18; // Verde Kick
        }

        const embed = new EmbedBuilder()
            .setTitle(embedTitle)
            .setDescription(`O ${nome} está ao vivo! @everyone`)
            .setURL(url)
            .setColor(embedColor)
            .setImage(thumb);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Acessar')
                .setStyle(ButtonStyle.Link)
                .setURL(url)
        );

        await interaction.reply({
            embeds: [embed],
            components: [row]
        });
    }

    if (commandName === 'escolhercanal') {
        const canal = options.getChannel('canal');
        if (!canal || canal.type !== 0) { // 0 = GUILD_TEXT
            await interaction.reply({ content: 'Escolha um canal de texto válido!', ephemeral: true });
            return;
        }
        const notificacaoPath = path.join(__dirname, './src/data/notificacao.json');
        fs.writeFileSync(notificacaoPath, JSON.stringify({ canalId: canal.id }, null, 2));
        await interaction.reply(`Canal de notificações definido para <#${canal.id}>!`);
    }
});

client.login(process.env.DISCORD_BOT_TOKEN); // Replace with your bot token