const fs = require('fs');
const path = require('path');
const streamersFilePath = path.join(__dirname, '../data/streamers.json');

async function handleAdicionarkick(message, args) {
    const streamerNameOrUrl = args.join(' ');
    if (!streamerNameOrUrl) {
        return message.reply('Por favor, forneça o nome ou URL do streamer.');
    }

    // Carrega o arquivo e garante que é um objeto com array
    let data = { streamers: [] };
    if (fs.existsSync(streamersFilePath)) {
        data = JSON.parse(fs.readFileSync(streamersFilePath));
        if (!Array.isArray(data.streamers)) data.streamers = [];
    }

    // Adiciona o novo streamer
    data.streamers.push({ type: 'kick', name: streamerNameOrUrl });

    // Salva de volta
    fs.writeFileSync(streamersFilePath, JSON.stringify(data, null, 2));

    message.reply(`Streamer ${streamerNameOrUrl} adicionado com sucesso na Kick!`);
}

module.exports = { handleAdicionarkick };