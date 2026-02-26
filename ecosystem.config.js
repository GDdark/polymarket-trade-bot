module.exports = {
    apps: [
        {
            name: 'polymarket-trade-bot',
            script: 'bun ./dist/main.js',
            instances: 1,
            kill_timeout: 15000,
            exec_mode: 'fork',
            max_memory_restart: '5120M'
        },
    ],
};
