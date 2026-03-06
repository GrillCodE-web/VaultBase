module.exports = {
  apps: [{
    name: 'cc-manager-server',
    script: 'index.js',
    instances: 1,
    exec_mode: 'cluster',
    max_memory_restart: '256M',
    error_file: 'logs/err-0.log',
    out_file: 'logs/out-0.log',
    merge_logs: true,
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
