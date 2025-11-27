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
    PermissionsBitField, // ADICIONADO
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

// Evita que erros não tratados no client provoquem crash da aplicação
client.on('error', (err) => {
    console.error('[CLIENT ERROR]', err);
});
client.on('shardError', (err) => {
    console.error('[SHARD ERROR]', err);
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

// Helper seguro para responder interações (reply ou followUp se já respondeu)
async function safeReply(interaction, options) {
    try {
        if (!interaction) return;
        if (interaction.replied || interaction.deferred) {
            return await interaction.followUp(options).catch(err => console.error('safeReply followUp failed:', err));
        } else {
            return await interaction.reply(options).catch(err => console.error('safeReply reply failed:', err));
        }
    } catch (err) {
        console.error('safeReply error:', err);
    }
}

// Helper seguro para atualizar interações (update) com fallback
async function safeUpdate(interaction, options) {
    try {
        return await interaction.update(options);
    } catch (err) {
        // Se a interação já expirou ou for desconhecida, tenta um followUp ou apenas loga
        if (err && err.code === 10062) {
            console.warn('safeUpdate: interaction unknown or expired');
            try {
                if (interaction.replied || interaction.deferred) {
                    return await interaction.followUp(options).catch(e => console.error('safeUpdate followUp failed:', e));
                }
            } catch (e) {
                console.error('safeUpdate fallback failed:', e);
            }
            return;
        }
        console.error('safeUpdate failed:', err);
        try {
            if (interaction.replied || interaction.deferred) {
                return await interaction.followUp(options).catch(e => console.error('safeUpdate followUp failed:', e));
            } else {
                return await interaction.reply(options).catch(e => console.error('safeUpdate reply failed:', e));
            }
        } catch (e) {
            console.error('safeUpdate final fallback failed:', e);
        }
    }
}

// Função para obter o relatório semanal
function getWeeklyReport() {
    const actionsPath = path.join(__dirname, "./src/data/actions.json");
    const data = JSON.parse(fs.readFileSync(actionsPath));
    
    // Obtém a data de 7 dias atrás
    const today = new Date();
    const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // Gera lista de dias no período (ordenada)
    const daysInRange = [];
    for (let d = new Date(lastWeek); d <= today; d.setDate(d.getDate() + 1)) {
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        daysInRange.push(`${day}/${month}`);
    }

    // Inicializa mapa de ganhos por dia
    const dailyEarnings = {};
    daysInRange.forEach(d => dailyEarnings[d] = 0);

    // Filtra ações da última semana
    const weeklyActions = data.actions.filter(action => {
        const [day, month] = action.date.split("/");
        const actionDate = new Date(today.getFullYear(), parseInt(month) - 1, parseInt(day));
        return actionDate >= lastWeek && actionDate <= today;
    });
    
    // Calcula estatísticas
    const victories = weeklyActions.filter(a => a.status === "Vitória").length;
    const defeats = weeklyActions.filter(a => a.status === "Derrota").length;
    const canceled = weeklyActions.filter(a => a.status === "Cancelada").length;
    const inProgress = weeklyActions.filter(a => a.status === "Em andamento").length;
    
    // Calcula total de recompensas e acumula por dia (assume reward.total existe como número)
    let totalRewards = 0;
    weeklyActions.forEach(a => {
        if (a.status === "Vitória" && a.reward && typeof a.reward.total === "number") {
            totalRewards += a.reward.total;
            if (dailyEarnings[a.date] !== undefined) {
                dailyEarnings[a.date] += a.reward.total;
            } else {
                // Caso a.data não esteja no mapa (por segurança), inicializa
                dailyEarnings[a.date] = a.reward.total;
            }
        }
    });
    
    return {
        total: weeklyActions.length,
        victories,
        defeats,
        canceled,
        inProgress,
        totalRewards,
        dailyEarnings,
        daysInRange
    };
}

client.on("interactionCreate", async (interaction) => {
    if (interaction.isCommand() && interaction.commandName === "relatorio") {
        const report = getWeeklyReport();
        
        // Get date range
        const today = new Date();
        const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        const dateRange = `${lastWeek.getDate().toString().padStart(2, '0')}/${(lastWeek.getMonth() + 1).toString().padStart(2, '0')} até ${today.getDate().toString().padStart(2, '0')}/${(today.getMonth() + 1).toString().padStart(2, '0')}`;
        
        const winRate = report.total > 0 
            ? ((report.victories / (report.victories + report.defeats)) * 100).toFixed(1)
            : 0;
        
        const perDayLines = report.daysInRange.map(d => {
            const amount = report.dailyEarnings[d] || 0;
            return `${d} - ${amount.toLocaleString()}k`;
        }).join("\n");
        
        const embed = new EmbedBuilder()
            .setTitle("📊 Relatório Semanal")
            .setDescription(`Período: ${dateRange}`)
            .addFields(
                {
                    name: "🎯 Total de Ações",
                    value: report.total.toString(),
                    inline: true
                },
                {
                    name: "🏆 Vitórias",
                    value: report.victories.toString(),
                    inline: true
                },
                {
                    name: "💀 Derrotas",
                    value: report.defeats.toString(),
                    inline: true
                },
                {
                    name: "📈 Taxa de Vitória",
                    value: `${winRate}%`,
                    inline: true
                },
                {
                    name: "❌ Canceladas",
                    value: report.canceled.toString(),
                    inline: true
                },
                {
                    name: "⏳ Em Andamento",
                    value: report.inProgress.toString(),
                    inline: true
                },
                {
                    name: "💰 Total de Recompensas",
                    value: `${report.totalRewards.toLocaleString()}k`,
                    inline: false
                },
                {
                    name: "💵 Ganhos por Dia",
                    value: perDayLines || "Nenhum ganho neste período",
                    inline: false
                }
            )
            .setColor("#00FF00")
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
        return;
    }

    // Comando /setar — envia botão que abre modal para nome | id
    if (interaction.isCommand() && interaction.commandName === "setar") {
        const embed = new EmbedBuilder()
            .setTitle("🔧 Definir Nome | ID")
            .setDescription("Clique no botão abaixo para abrir o formulário e definir seu nome e ID.")
            .setColor("#00AAFF");

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("setar_open")
                .setLabel("Definir Nome e ID")
                .setStyle(ButtonStyle.Primary)
        );

        // mostrar para todos (não ephemeral)
        await interaction.reply({ embeds: [embed], components: [row] });
        return;
    }

    // Comando /pedir-set — envia botão no chat que abre modal (igual ao /setar)
        if (interaction.isCommand() && interaction.commandName === "pedir-set") {
            const embed = new EmbedBuilder()
                .setTitle("SOLICITE SUA SETAGEM")
                .setDescription("Bem-vindo ao sistema de registro!\n\nInicie seu registro e torne-se um membro oficial.\n\nClique no botão abaixo para começar.")
                .setColor("#00AAFF")
                .setImage('attachment://bairro13.png');

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("pedir_set_open")
                    .setLabel("Iniciar Registro")
                    .setStyle(ButtonStyle.Success)
            );

            const imagePath = path.join(__dirname, 'assets', 'bairro13.png');
            const files = [];
            if (fs.existsSync(imagePath)) files.push(imagePath);

            await interaction.reply({ embeds: [embed], components: [row], files });
            return;
        }
    
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

    // Handler do botão que abre o modal de /setar (mover para antes do bloco genérico de buttons)
    if (interaction.isButton() && interaction.customId === "setar_open") {
        const modal = new ModalBuilder()
            .setCustomId("setar_modal")
            .setTitle("Definir Nome | ID");

        const nameInput = new TextInputBuilder()
            .setCustomId("setName")
            .setLabel("Nome (ex: pacheco)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(30);

        const idInput = new TextInputBuilder()
            .setCustomId("setId")
            .setLabel("ID (ex: 3414)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(16);

        modal.addComponents(
            new ActionRowBuilder().addComponents(nameInput),
            new ActionRowBuilder().addComponents(idInput)
        );

        await interaction.showModal(modal);
        return;
    }

    // Handler do botão que abre o modal de /pedir-set
    if (interaction.isButton() && interaction.customId === "pedir_set_open") {
        const modal = new ModalBuilder()
            .setCustomId("pedir_set_modal")
            .setTitle("Pedir Set | ID");

        const nameInput = new TextInputBuilder()
            .setCustomId("setName")
            .setLabel("Nome (ex: pacheco)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(30);

        const idInput = new TextInputBuilder()
            .setCustomId("setId")
            .setLabel("ID (ex: 3414)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(16);

        const indicouInput = new TextInputBuilder()
            .setCustomId("quemIndicou")
            .setLabel("Quem indicou")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(50);

        modal.addComponents(
            new ActionRowBuilder().addComponents(nameInput),
            new ActionRowBuilder().addComponents(idInput),
            new ActionRowBuilder().addComponents(indicouInput)
        );

        await interaction.showModal(modal);
        return;
    }

    if (interaction.isButton() && /^(cancel|defeat|victory)_/.test(interaction.customId)) {
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
                await safeUpdate(interaction, { embeds: [cancelEmbed], components: [] });
                break;

            case "defeat":
                actionData.status = "Derrota";
                const defeatEmbed = createActionEmbed(actionData);
                await safeUpdate(interaction, { embeds: [defeatEmbed], components: [] });
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

                await safeUpdate(interaction, { 
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

        await safeUpdate(interaction, {
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

        if (!actionData) {
            await interaction.reply({ content: "Ação não encontrada!", ephemeral: true });
            return;
        }

        // Permite confirmar mesmo que nenhum participante tenha sido selecionado (não obrigatório)
        if (!actionData.selectedParticipants) {
            actionData.selectedParticipants = [];
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

        // Segurança: permitir 0 participantes selecionados (não obrigatório)
        const participantCount = actionData.selectedParticipants ? actionData.selectedParticipants.length : 0;
        const shareValue = participantCount > 0 ? Math.floor(rewardValue / participantCount) : 0;

        actionData.status = "Vitória";
        actionData.reward = {
            total: rewardValue,
            perParticipant: shareValue,
            participants: actionData.selectedParticipants || []
        };

        const victoryEmbed = new EmbedBuilder()
            .setTitle(`**Ação:** ${actionData.name}`)
            .setDescription(`${getStatusEmoji(actionData.status)} **Status:** Vitória`)
            .addFields(
                { name: "📅 Data", value: actionData.date, inline: true },
                { name: "👑 Responsável", value: actionData.creator, inline: true },
                { name: "💰 Recompensa Total", value: `${rewardValue.toLocaleString()}k`, inline: true }
            )
            .setColor(getStatusColor("Vitória"))
            .setFooter({ text: `${participantCount} participante(s) recompensado(s)` })
            .setTimestamp();

        // 🔥 Ajuste principal:
        if (participantCount > 0) {
            // Com participantes selecionados → mostra a distribuição
            const distributionText = actionData.participants.map(p =>
                actionData.selectedParticipants.includes(p)
                    ? `• ${p} ➜ ${shareValue.toLocaleString()}k 💰`
                    : `• ${p} ➜ 0k`
            ).join("\n");

            victoryEmbed.addFields({
                name: "📊 Distribuição da Recompensa",
                value: distributionText,
                inline: false
            });
        } else {
            // Nenhum participante selecionado → mostra apenas lista
            const participantList = actionData.participants.map(p => `• ${p}`).join("\n");
            victoryEmbed.addFields({
                name: "👥 Participantes",
                value: participantList,
                inline: false
            });
        }

        fs.writeFileSync(actionsPath, JSON.stringify(data, null, 2));
        await safeUpdate(interaction, { embeds: [victoryEmbed], components: [], content: null });
    }

    // Handler do botão que abre o modal de /setar (mover para antes do bloco genérico de buttons)
    if (interaction.isButton() && interaction.customId === "setar_open") {
        const modal = new ModalBuilder()
            .setCustomId("setar_modal")
            .setTitle("Definir Nome | ID");

        const nameInput = new TextInputBuilder()
            .setCustomId("setName")
            .setLabel("Nome (ex: pacheco)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(30);

        const idInput = new TextInputBuilder()
            .setCustomId("setId")
            .setLabel("ID (ex: 3414)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(16);

        modal.addComponents(
            new ActionRowBuilder().addComponents(nameInput),
            new ActionRowBuilder().addComponents(idInput)
        );

        await interaction.showModal(modal);
        return;
    }

    // Handler do modal /pedir-set — envia embed para canal de aprovação com botões
    if (interaction.isModalSubmit() && interaction.customId === "pedir_set_modal") {
        const name = interaction.fields.getTextInputValue("setName").replace(/\|/g, "").trim();
        const idValue = interaction.fields.getTextInputValue("setId").replace(/\|/g, "").trim();
        const quemIndicou = interaction.fields.getTextInputValue("quemIndicou") || "Não informado";

        const requesterDisplay = interaction.member ? interaction.member.displayName : interaction.user.username;
        const embed = new EmbedBuilder()
            .setTitle("📩 Pedido de Setagem")
            .setDescription(`Pedido enviado por: <@${interaction.user.id}>`)
            .addFields(
                { name: "📝 Nome", value: name, inline: true },
                { name: "🔢 ID", value: idValue, inline: true },
                { name: "🤝 Quem indicou", value: quemIndicou, inline: true }
            )
            .setColor("#00AAFF")
            .setFooter({ text: `Solicitante: ${requesterDisplay} • ID: ${interaction.user.id}` })
            .setTimestamp();

        const authorizeButton = new ButtonBuilder()
            .setCustomId(`pedir_authorize_${interaction.user.id}`)
            .setLabel("Autorizar")
            .setStyle(ButtonStyle.Success);

        const rejectButton = new ButtonBuilder()
            .setCustomId(`pedir_reject_${interaction.user.id}`)
            .setLabel("Recusar")
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(authorizeButton, rejectButton);

        // Canal alvo (ID obtido da URL informada)
        const targetChannelId = "1442691467041837247";
        try {
            const channel = await client.channels.fetch(targetChannelId);
            if (!channel || !channel.send) {
                await safeReply(interaction, { content: "Erro: canal de envio não encontrado.", ephemeral: true });
                return;
            }

            await channel.send({ embeds: [embed], components: [row] });
            await safeReply(interaction, { content: "Pedido enviado para aprovação.", ephemeral: true });
        } catch (err) {
            console.error("Erro ao enviar pedido de set para canal:", err);
            await safeReply(interaction, { content: "Erro ao enviar pedido. Contate o administrador.", ephemeral: true });
        }

        return;
    }

    // Handler para botões de /pedir-set (autorizar / recusar)
    if (interaction.isButton() && (interaction.customId.startsWith('pedir_authorize_') || interaction.customId.startsWith('pedir_reject_'))) {
        const parts = interaction.customId.split('_');
        const action = parts[1]; // 'authorize' or 'reject'
        const targetId = parts[2];

        // permission check: only users with ManageRoles can authorize/rejeitar
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            await interaction.reply({ content: 'Você não tem permissão para executar esta ação.', ephemeral: true });
            return;
        }

        // fetch member in this guild
        if (!interaction.guild) {
            await interaction.reply({ content: 'Operação só pode ser feita em servidor.', ephemeral: true });
            return;
        }

        try {
            const targetMember = await interaction.guild.members.fetch(targetId);
            const botMember = interaction.guild.members.me;

            // prepare updated embed
            const approverDisplay = interaction.member ? interaction.member.displayName : interaction.user.username;
            const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0] || new EmbedBuilder())
                .setFooter({ text: `Decidido por: ${approverDisplay}` })
                .setTimestamp();

            // disable buttons
            const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('disabled_1').setLabel('Autorizar').setStyle(ButtonStyle.Success).setDisabled(true),
                new ButtonBuilder().setCustomId('disabled_2').setLabel('Recusar').setStyle(ButtonStyle.Danger).setDisabled(true)
            );

            if (action === 'authorize') {
                // check manage roles permission for bot
                if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                    await interaction.reply({ content: "Erro: o bot não tem permissão 'Manage Roles'.", ephemeral: true });
                    return;
                }

                // attempt to add/remove roles
                try {
                    await targetMember.roles.add('1314624079646687293');
                } catch (err) {
                    console.error('Falha ao adicionar cargo:', err);
                }
                try {
                    await targetMember.roles.remove('1371222752580862103');
                } catch (err) {
                    console.error('Falha ao remover cargo:', err);
                }

                // Try to extract requested name and id from the embed fields to set nickname
                try {
                    const originalEmbed = interaction.message.embeds[0];
                    let requestedName = null;
                    let requestedId = null;
                    if (originalEmbed && originalEmbed.fields) {
                        const nameField = originalEmbed.fields.find(f => f.name && f.name.toLowerCase().includes('nome'));
                        const idField = originalEmbed.fields.find(f => f.name && (f.name.toLowerCase().includes('id') || f.name.includes('🔢')));
                        requestedName = nameField ? nameField.value : null;
                        requestedId = idField ? idField.value : null;
                    }

                    if (requestedName && requestedId) {
                        const nickname = `${requestedName} | ${requestedId}`.slice(0, 32);

                        // Check bot permissions and role hierarchy similar to /setar
                        if (interaction.guild) {
                            const botMember = interaction.guild.members.me;
                            const botHighest = botMember.roles?.highest?.position ?? 0;
                            const targetHighest = targetMember.roles?.highest?.position ?? 0;

                            if (!botMember.permissions.has(PermissionsBitField.Flags.ManageNicknames)) {
                                console.warn('Bot sem permissão ManageNicknames, não será alterado nickname.');
                            } else if (interaction.guild.ownerId === targetMember.id) {
                                console.warn('Não é possível alterar apelido do dono do servidor.');
                            } else if (botHighest <= targetHighest) {
                                console.warn('Hierarquia impede alteração de nickname do usuário.');
                            } else {
                                try {
                                    await targetMember.setNickname(nickname);
                                } catch (err) {
                                    console.error('Falha ao setar nickname do usuário:', err);
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.error('Erro ao tentar alterar nickname do solicitante:', err);
                }

                updatedEmbed.setColor('#00FF00').setDescription((updatedEmbed.data.description || '') + `\n\n✅ Autorizado por **${approverDisplay}**`);
                await safeUpdate(interaction, { embeds: [updatedEmbed], components: [disabledRow] });
                return;
            }

            if (action === 'reject') {
                updatedEmbed.setColor('#FF0000').setDescription((updatedEmbed.data.description || '') + `\n\n❌ Recusado por **${approverDisplay}**`);
                await safeUpdate(interaction, { embeds: [updatedEmbed], components: [disabledRow] });
                return;
            }
        } catch (err) {
            console.error('Erro ao processar botão pedir-set:', err);
            await safeReply(interaction, { content: 'Erro ao processar essa solicitação.', ephemeral: true });
            return;
        }
    }

    // Handler do modal /setar — altera nickname para "nome | id"
    if (interaction.isModalSubmit() && interaction.customId === "setar_modal") {
        const name = interaction.fields.getTextInputValue("setName").replace(/\|/g, "").trim();
        const idValue = interaction.fields.getTextInputValue("setId").replace(/\|/g, "").trim();
        const nickname = `${name} | ${idValue}`;

        if (nickname.length > 32) {
            await interaction.reply({ content: "Apelido muito longo. Use nomes/IDs mais curtos para caber em `nome | id`.", ephemeral: true });
            return;
        }

        try {
            if (!interaction.guild) {
                await interaction.reply({ content: "Não foi possível alterar o apelido aqui.", ephemeral: true });
                return;
            }

            // busca o membro atual para ter dados atualizados
            const member = await interaction.guild.members.fetch(interaction.user.id);
            const botMember = interaction.guild.members.me;

            // verifica permissão Manage Nicknames
            if (!botMember.permissions.has(PermissionsBitField.Flags.ManageNicknames)) {
                await interaction.reply({ content: "Erro: o bot não tem a permissão 'Manage Nicknames'. Conceda essa permissão ao bot.", ephemeral: true });
                return;
            }

            // verifica hierarquia de cargos (bot precisa ter cargo acima do usuário)
            const botHighest = botMember.roles?.highest?.position ?? 0;
            const targetHighest = member.roles?.highest?.position ?? 0;
            // se for dono do servidor, o bot não consegue alterar mesmo com permissão
            if (interaction.guild.ownerId === member.id) {
                await interaction.reply({ content: "Não é possível alterar o apelido do dono do servidor.", ephemeral: true });
                return;
            }
            if (botHighest <= targetHighest) {
                await interaction.reply({ content: "Erro: hierarquia de cargos impede alteração do apelido. Coloque o cargo do bot acima do usuário.", ephemeral: true });
                return;
            }

            await member.setNickname(nickname);
            // confirmar apenas para quem submeteu (ephemeral true)
            await interaction.reply({ content: `Apelido alterado para: \`${nickname}\``, ephemeral: true });
        } catch (err) {
            console.error("Erro ao alterar nickname:", err);
            await interaction.reply({ content: "Erro ao alterar apelido. Verifique se o bot tem permissão 'Manage Nicknames' e se a hierarquia de cargos permite.", ephemeral: true });
        }
        return;
    }
});

// Safe login: verifica token e trata erros para evitar crashes em hosts como Discloud
(async () => {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
        console.error('DISCORD_BOT_TOKEN não está definido. Abortando login.');
        return;
    }

    try {
        await client.login(token);
    } catch (err) {
        console.error('Erro ao tentar logar o bot:', err);
        // Não relançar o erro — deixamos o processo vivo para permitir inspeção/recuperação
    }
})();