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
]
    .map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands },
).then(() => console.log('Comandos registrados com sucesso!'))
 .catch(console.error);