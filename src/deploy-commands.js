const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const commands = [
    new SlashCommandBuilder()
        .setName('adicionar')
        .setDescription('Adicionar streamer')
        .addStringOption(option =>
            option.setName('plataforma')
                .setDescription('Plataforma (twitch ou kick)')
                .setRequired(true)
                .addChoices(
                    { name: 'Twitch', value: 'twitch' },
                    { name: 'Kick', value: 'kick' }
                ))
        .addStringOption(option =>
            option.setName('nome')
                .setDescription('Nome do streamer')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('removertwitch')
        .setDescription('Remover streamer da Twitch')
        .addStringOption(option =>
            option.setName('nome')
                .setDescription('Nome do streamer')
                .setRequired(true)
                .setAutocomplete(true)
    ),
    new SlashCommandBuilder()
        .setName('removerkick')
        .setDescription('Remover streamer do Kick')
        .addStringOption(option =>
            option.setName('nome')
                .setDescription('Nome do streamer')
                .setRequired(true)
                .setAutocomplete(true)
    ),
    new SlashCommandBuilder()
        .setName('testetwitch')
        .setDescription('Testa notificação de streamer da Twitch')
        .addStringOption(option =>
            option.setName('nome')
                .setDescription('Escolha o streamer')
                .setRequired(true)
                .setAutocomplete(true)
        ),
    new SlashCommandBuilder()
        .setName('testekick')
        .setDescription('Testa notificação de streamer do Kick')
        .addStringOption(option =>
            option.setName('nome')
                .setDescription('Escolha o streamer')
                .setRequired(true)
                .setAutocomplete(true)
        ),
    new SlashCommandBuilder()
        .setName('escolhercanal')
        .setDescription('Escolha o canal para receber notificações de live')
        .addChannelOption(option =>
            option.setName('canal')
                .setDescription('Canal de texto para notificações')
                .setRequired(true)
    ),
    new SlashCommandBuilder()
        .setName('removercanal')
        .setDescription('Remover um canal da lista de notificações de live')
        .addStringOption(option =>
            option.setName('canal')
                .setDescription('Escolha um canal já cadastrado (autocompletar)')
                .setRequired(true)
                .setAutocomplete(true)
        ),
    new SlashCommandBuilder()
        .setName('escolhercargo')
        .setDescription('Escolher cargo para ser atribuído quando o streamer estiver ao vivo')
        .addStringOption(option =>
            option.setName('streamer')
                .setDescription('Nome do streamer (precisa já estar no /adicionar)')
                .setRequired(true)
                .setAutocomplete(true)
        )
        .addRoleOption(option =>
            option.setName('cargo')
                .setDescription('Cargo que será dado quando estiver ao vivo')
                .setRequired(true)
        )
        .addUserOption(option =>
            option.setName('usuario')
                .setDescription('Usuário do Discord que receberá o cargo')
                .setRequired(true)
        ),
]
    .map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands },
).then(() => console.log('Comandos registrados com sucesso!'))
 .catch(console.error);