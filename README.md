# Discord Bot for Streamer Notifications

This project is a Discord bot that allows users to add Twitch streamers and kick streamers to a watchlist. When a streamer goes live, the bot sends a notification to a specified Discord channel.

## Features

- Add Twitch streamers using the command `/adicionartwitch <streamer_name_or_url>`.
- Add Kick streamers using the command `/adicionarkick <streamer_name>`.
- Automatically checks the status of the added streamers and notifies the channel when they go live.
- Configure roles per server for each Discord user using `/escolhercargo <cargo> <usuario>` - the bot will automatically assign/remove the role when the user goes live/offline.

## Project Structure

```
discord-bot
├── src
│   ├── index.js               # Entry point of the bot
│   ├── commands                # Command handlers
│   │   ├── adicionarkick.js    # Handles adding Kick streamers
│   │   └── adicionartwitch.js   # Handles adding Twitch streamers
│   ├── services                # Services for the bot
│   │   └── streamerWatcher.js   # Checks streamer status
│   └── data                   # Data storage
│       └── streamers.json      # JSON file for storing streamers
├── package.json                # NPM configuration file
└── README.md                   # Project documentation
```

## Setup Instructions

1. Clone the repository:
   ```
   git clone <repository-url>
   cd discord-bot
   ```

2. Install the dependencies:
   ```
   npm install
   ```

3. Create a `.env` file in the root directory and add your Discord bot token:
   ```
   DISCORD_TOKEN=your_bot_token
   ```

4. Run the bot:
   ```
   node src/index.js
   ```

## Usage

- To add a Twitch streamer:
  ```
  /adicionartwitch <streamer_name_or_url>
  ```

- To add a Kick streamer:
  ```
  /adicionarkick <streamer_name>
  ```

The bot will monitor the added streamers and notify the channel when they go live.

## Contributing

Feel free to submit issues or pull requests for improvements or bug fixes.