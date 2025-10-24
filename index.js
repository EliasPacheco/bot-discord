require("dotenv").config();
const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const fs = require("fs");
const path = require("path");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// Tratamento de erros não capturados
process.on('unhandledRejection', (reason, promise) => {
    console.log('[WARN] Rejeição de promessa não tratada:', reason);
});

client.once("ready", () => {
    console.log(`Bot logado como ${client.user.tag}!`);
});

// Função para obter a data atual no formato DD/MM
function getCurrentDate() {
    const date = new Date();
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// Função para salvar ação no JSON
function saveAction(action) {
    const actionsPath = path.join(__dirname, "./src/data/actions.json");
    let data = { actions: [] };
    
    if (fs.existsSync(actionsPath)) {
        data = JSON.parse(fs.readFileSync(actionsPath));
    }
    
    data.actions.push(action);
    fs.writeFileSync(actionsPath, JSON.stringify(data, null, 2));
}

// Função para criar embed da ação
function createActionEmbed(action) {
    const embed = new EmbedBuilder()
        .setTitle(`🎯 ${action.name}`)
        .setDescription(`${getStatusEmoji(action.status)} **Status:** ${action.status}`)
        .addFields(
            { 
                name: "📅 Data", 
                value: action.date, 
                inline: true 
            },
            { 
                name: "👑 Responsável", 
                value: action.creator, 
                inline: true 
            },
            { 
                name: "\u200B", 
                value: "\u200B", 
                inline: true 
            },
            { 
                name: "👥 Participantes", 
                value: formatParticipants(action.participants), 
                inline: false 
            }
        )
        .setColor(getStatusColor(action.status))
        .setFooter({ text: `ID da Ação: ${action.id}` })
        .setTimestamp();

    return embed;
}

// Função para formatar os participantes
function formatParticipants(participants) {
    return participants.map(p => `• ${p}`).join("\n");
}

// Função para obter o emoji do status
function getStatusEmoji(status) {
    switch (status) {
        case "Vitória":
            return "🏆";
        case "Derrota":
            return "💀";
        case "Cancelada":
            return "❌";
        default:
            return "⏳";
    }
}

// Função para obter a cor do status
function getStatusColor(status) {
    switch (status) {
        case "Vitória":
            return "#00FF00"; // Verde
        case "Derrota":
            return "#FF0000"; // Vermelho
        case "Cancelada":
            return "#808080"; // Cinza
        default:
            return "#FFA500"; // Laranja
    }
}

client.on("interactionCreate", async (interaction) => {
    if (interaction.isCommand() && interaction.commandName === "acao") {
        const modal = new ModalBuilder()
            .setCustomId("action-modal")
            .setTitle("Registro de Ação");

        const actionNameInput = new TextInputBuilder()
            .setCustomId("actionName")
            .setLabel("Nome da Ação")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const participantsInput = new TextInputBuilder()
            .setCustomId("participants")
            .setLabel("Participantes (separados por vírgula)")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        const firstRow = new ActionRowBuilder().addComponents(actionNameInput);
        const secondRow = new ActionRowBuilder().addComponents(participantsInput);

        modal.addComponents(firstRow, secondRow);
        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === "action-modal") {
        const actionName = interaction.fields.getTextInputValue("actionName");
        const participants = interaction.fields.getTextInputValue("participants")
            .split(",")
            .map(p => p.trim())
            .filter(p => p);

        const action = {
            id: Date.now().toString(),
            name: actionName,
            date: getCurrentDate(),
            participants: participants,
            status: "Em andamento",
            creator: interaction.member.displayName
        };

        saveAction(action);

        const embed = createActionEmbed(action);
        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`cancel_${action.id}`)
                .setLabel("Cancelar")
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`victory_${action.id}`)
                .setLabel("Vitória")
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`defeat_${action.id}`)
                .setLabel("Derrota")
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({ embeds: [embed], components: [buttons] });
    }

    if (interaction.isButton()) {
        const [action, id] = interaction.customId.split("_");
        const actionsPath = path.join(__dirname, "./src/data/actions.json");
        const data = JSON.parse(fs.readFileSync(actionsPath));
        const actionData = data.actions.find(a => a.id === id);

        if (!actionData) {
            await interaction.reply({ content: "Ação não encontrada!", ephemeral: true });
            return;
        }

        switch (action) {
            case "cancel":
                actionData.status = "Cancelada";
                const cancelEmbed = createActionEmbed(actionData);
                await interaction.update({ embeds: [cancelEmbed], components: [] });
                break;

            case "defeat":
                actionData.status = "Derrota";
                const defeatEmbed = createActionEmbed(actionData);
                await interaction.update({ embeds: [defeatEmbed], components: [] });
                break;

            case "victory":
                const actionIndex = data.actions.findIndex(a => a.id === id);
                if (actionIndex !== -1) {
                    data.actions[actionIndex].selectedParticipants = [];
                    fs.writeFileSync(actionsPath, JSON.stringify(data, null, 2));
                }

                // Cria os botões dividindo em linhas de até 5
                const participantRows = [];
                for (let i = 0; i < actionData.participants.length; i += 5) {
                    const row = new ActionRowBuilder();
                    actionData.participants.slice(i, i + 5).forEach((participant, j) => {
                        row.addComponents(
                            new ButtonBuilder()
                                .setCustomId(`select_${id}_${i + j}`)
                                .setLabel(participant)
                                .setStyle(ButtonStyle.Secondary)
                        );
                    });
                    participantRows.push(row);
                }

                const confirmButton = new ButtonBuilder()
                    .setCustomId(`confirm_${id}`)
                    .setLabel("Confirmar Seleção")
                    .setStyle(ButtonStyle.Success);

                const confirmRow = new ActionRowBuilder().addComponents(confirmButton);

                await interaction.update({ 
                    content: "Selecione os participantes que receberão a recompensa:",
                    components: [...participantRows, confirmRow],
                    embeds: []
                });
                break;
        }

        fs.writeFileSync(actionsPath, JSON.stringify(data, null, 2));
    }

    if (interaction.isButton() && interaction.customId.startsWith('select_')) {
        const [_, id, index] = interaction.customId.split('_');
        const actionsPath = path.join(__dirname, "./src/data/actions.json");
        const data = JSON.parse(fs.readFileSync(actionsPath));
        const actionData = data.actions.find(a => a.id === id);

        if (!actionData) {
            await interaction.reply({ content: "Ação não encontrada!", ephemeral: true });
            return;
        }

        const participant = actionData.participants[parseInt(index)];
        if (!actionData.selectedParticipants) {
            actionData.selectedParticipants = [];
        }

        // Atualiza seleção
        if (actionData.selectedParticipants.includes(participant)) {
            actionData.selectedParticipants = actionData.selectedParticipants.filter(p => p !== participant);
        } else {
            actionData.selectedParticipants.push(participant);
        }

        // 🔥 Recria os botões divididos em linhas de até 5
        const participantRows = [];
        for (let i = 0; i < actionData.participants.length; i += 5) {
            const row = new ActionRowBuilder();
            actionData.participants.slice(i, i + 5).forEach((p, j) => {
                const absoluteIndex = i + j;
                const isSelected = actionData.selectedParticipants.includes(p);

                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`select_${id}_${absoluteIndex}`)
                        .setLabel(p)
                        .setStyle(isSelected ? ButtonStyle.Primary : ButtonStyle.Secondary)
                );
            });
            participantRows.push(row);
        }

        const confirmButton = new ButtonBuilder()
            .setCustomId(`confirm_${id}`)
            .setLabel("Confirmar Seleção")
            .setStyle(ButtonStyle.Success);

        const confirmRow = new ActionRowBuilder().addComponents(confirmButton);

        fs.writeFileSync(actionsPath, JSON.stringify(data, null, 2));

        await interaction.update({
            content: "Selecione os participantes que receberão a recompensa:",
            components: [...participantRows, confirmRow],
            embeds: []
        });
    }

    if (interaction.isButton() && interaction.customId.startsWith('confirm_')) {
        const [_, id] = interaction.customId.split('_');
        const actionsPath = path.join(__dirname, "./src/data/actions.json");
        const data = JSON.parse(fs.readFileSync(actionsPath));
        const actionData = data.actions.find(a => a.id === id);

        if (!actionData || !actionData.selectedParticipants || actionData.selectedParticipants.length === 0) {
            await interaction.reply({ content: "Por favor, selecione pelo menos um participante!", ephemeral: true });
            return;
        }

        const rewardModal = new ModalBuilder()
            .setCustomId(`reward_${id}`)
            .setTitle("Valor da Recompensa");

        const rewardInput = new TextInputBuilder()
            .setCustomId("rewardValue")
            .setLabel("Valor total (ex: 1000 para 1k)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const rewardRow = new ActionRowBuilder().addComponents(rewardInput);
        rewardModal.addComponents(rewardRow);

        await interaction.showModal(rewardModal);
    }

    // Atualizando o embed de vitória
    if (interaction.isModalSubmit() && interaction.customId.startsWith("reward_")) {
        const id = interaction.customId.split("_")[1];
        const rewardValue = parseInt(interaction.fields.getTextInputValue("rewardValue"));
    
        const actionsPath = path.join(__dirname, "./src/data/actions.json");
        const data = JSON.parse(fs.readFileSync(actionsPath));
        const actionData = data.actions.find(a => a.id === id);
    
        if (!actionData) {
            await interaction.reply({ content: "Ação não encontrada!", ephemeral: true });
            return;
        }
    
        const participantCount = actionData.selectedParticipants.length;
        const shareValue = Math.floor(rewardValue / participantCount);
    
        actionData.status = "Vitória";
        actionData.reward = {
            total: rewardValue,
            perParticipant: shareValue,
            participants: actionData.selectedParticipants
        };
    
        const victoryEmbed = new EmbedBuilder()
            .setTitle(`**Ação:** ${actionData.name}`)
            .setDescription(`${getStatusEmoji(actionData.status)} **Status:** Vitória`)
            .addFields(
                { 
                    name: "📅 Data", 
                    value: actionData.date, 
                    inline: true 
                },
                { 
                    name: "👑 Responsável", 
                    value: actionData.creator, 
                    inline: true 
                },
                { 
                    name: "💰 Recompensa Total", 
                    value: `${rewardValue.toLocaleString()}k`, 
                    inline: true 
                },
                { 
                    name: "📊 Distribuição da Recompensa", 
                    value: actionData.participants.map(p => 
                        actionData.selectedParticipants.includes(p) ? 
                        `• ${p} ➜ ${shareValue.toLocaleString()}k 💰` : 
                        `• ${p} ➜ 0k`
                    ).join("\n"),
                    inline: false
                }
            )
            .setColor(getStatusColor("Vitória"))
            .setFooter({ text: `ID da Ação: ${actionData.id} • ${participantCount} participante(s) recompensado(s)` })
            .setTimestamp();
    
        fs.writeFileSync(actionsPath, JSON.stringify(data, null, 2));
        await interaction.update({ embeds: [victoryEmbed], components: [], content: null });
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);