// PM2 yapılandırması: pm2 start ecosystem.config.cjs
// Ortam değişkenlerini burada veya .env ile (node --env-file) verebilirsiniz.
module.exports = {
  apps: [
    {
      name: 'canli-oturum',
      script: 'server.js',
      cwd: __dirname,
      node_args: '--env-file-if-exists=.env',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '0.0.0.0',
        // PUBLIC_URL: 'https://oturum.ornek.com',
        // ADMIN_KEY: 'guclu-bir-anahtar',
      },
    },
  ],
};
