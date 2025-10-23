# Bot de Registro de Ações

Este bot do Discord permite registrar e gerenciar ações com participantes, incluindo distribuição de recompensas.

## Funcionalidades

- Registro de ações com nome e participantes
- Data automática no formato DD/MM
- Status da ação (Em andamento, Vitória, Derrota, Cancelada)
- Distribuição automática de recompensas em caso de vitória

## Comandos

- `/acao` - Abre um painel para registrar uma nova ação
  - Nome da Ação
  - Participantes (separados por vírgula)
  - Data (preenchida automaticamente)

## Configuração

1. Clone o repositório
2. Instale as dependências:
   ```bash
   npm install
   ```

3. Copie o arquivo `.env.example` para `.env` e preencha com suas informações:
   ```
   DISCORD_BOT_TOKEN=seu_token_aqui
   CLIENT_ID=seu_client_id_aqui
   ```

4. Registre os comandos do bot:
   ```bash
   npm run deploy
   ```

5. Inicie o bot:
   ```bash
   npm start
   ```

## Estrutura do Projeto

```
bot-discord/
├── src/
│   ├── data/           # Armazenamento de dados
│   │   └── actions.json
│   └── deploy-commands.js
├── .env
├── .env.example
├── index.js
└── package.json
```

## Como Usar

1. Use o comando `/acao` para registrar uma nova ação
2. Preencha o nome da ação e os participantes
3. O bot criará um embed com as informações e botões de ação
4. Use os botões para:
   - Cancelar a ação
   - Registrar vitória (permite distribuir recompensa)
   - Registrar derrota