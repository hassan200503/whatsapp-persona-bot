module.exports = {
  apps: [
    {
      name: "whatsapp-persona-bot",
      script: "src/index.js",
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 20,
      min_uptime: "30s",
      restart_delay: 5000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
