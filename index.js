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
    return new EmbedBuilder()
        .setTitle(`Ação: ${action.name}`)
        .setDescription(`**Status:** ${action.status || 'Em andamento'}`)
        .addFields(
            { name: "Data", value: action.date, inline: true },
            { name: "Responsável", value: action.creator, inline: true },
            { name: "Participantes", value: action.participants.join(", "), inline: true }
        )
        .setColor("#0099ff")
        .setTimestamp();
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
            creator: interaction.member.displayName // Usando o nickname do servidor ao invés do tag global
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
                const participantButtons = new ActionRowBuilder();
                actionData.participants.forEach((participant, index) => {
                    participantButtons.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`select_${id}_${index}`)
                            .setLabel(participant)
                            .setStyle(ButtonStyle.Secondary)
                    );
                });

                const confirmButton = new ButtonBuilder()
                    .setCustomId(`confirm_${id}`)
                    .setLabel("Confirmar Seleção")
                    .setStyle(ButtonStyle.Success);

                const buttonRow = new ActionRowBuilder().addComponents(confirmButton);

                // Inicializa a lista de participantes selecionados no objeto da ação
                if (!data.actions) data.actions = [];
                const actionIndex = data.actions.findIndex(a => a.id === id);
                if (actionIndex !== -1) {
                    data.actions[actionIndex].selectedParticipants = [];
                    fs.writeFileSync(actionsPath, JSON.stringify(data, null, 2));
                }

                await interaction.update({ 
                    content: "Selecione os participantes que receberão a recompensa:",
                    components: [participantButtons, buttonRow],
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

        // Recria os botões com os estados atualizados
        const participantButtons = new ActionRowBuilder();
        actionData.participants.forEach((p, i) => {
            const isSelected = actionData.selectedParticipants.includes(p);
            const willBeSelected = i === parseInt(index) && !isSelected;
            const willBeDeselected = i === parseInt(index) && isSelected;

            participantButtons.addComponents(
                new ButtonBuilder()
                    .setCustomId(`select_${id}_${i}`)
                    .setLabel(p)
                    .setStyle(
                        (isSelected && !willBeDeselected) || willBeSelected
                            ? ButtonStyle.Primary
                            : ButtonStyle.Secondary
                    )
            );
        });

        // Atualiza a lista de participantes selecionados
        if (actionData.selectedParticipants.includes(participant)) {
            actionData.selectedParticipants = actionData.selectedParticipants.filter(p => p !== participant);
        } else {
            actionData.selectedParticipants.push(participant);
        }

        const confirmButton = new ButtonBuilder()
            .setCustomId(`confirm_${id}`)
            .setLabel("Confirmar Seleção")
            .setStyle(ButtonStyle.Success);

        const buttonRow = new ActionRowBuilder().addComponents(confirmButton);

        fs.writeFileSync(actionsPath, JSON.stringify(data, null, 2));
        await interaction.update({ 
            content: "Selecione os participantes que receberão a recompensa:",
            components: [participantButtons, buttonRow] 
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
            .setTitle(`Ação: ${actionData.name}`)
            .setDescription(`**Status:** Vitória`)
            .addFields(
                { name: "Data", value: actionData.date, inline: true },
                { name: "Responsável", value: actionData.creator, inline: true },
                { name: "Recompensa Total", value: `${rewardValue.toLocaleString()}k`, inline: true },
                { name: "Participantes", value: actionData.participants.map(p => 
                    actionData.selectedParticipants.includes(p) ? 
                    `${p}: ${shareValue.toLocaleString()}k` : 
                    p
                ).join("\n")
                }
            )
            .setColor("#00FF00")
            .setTimestamp();

        fs.writeFileSync(actionsPath, JSON.stringify(data, null, 2));
        await interaction.update({ embeds: [victoryEmbed], components: [], content: null });
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);