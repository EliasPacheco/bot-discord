require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('acao')
        .setDescription('Registra uma nova ação'),
    new SlashCommandBuilder()
        .setName('relatorio')
        .setDescription('Mostra o relatório semanal de vitórias e derrotas')
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
    try {
        console.log('Iniciando atualização dos comandos (/)...');

        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );

        console.log('Comandos (/) atualizados com sucesso!');
    } catch (error) {
        console.error('Erro ao atualizar comandos:', error);
    }
})();