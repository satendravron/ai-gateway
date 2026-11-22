const WebSocket = require('ws');

const ws = new WebSocket('ws://127.0.0.1:4001/ws');

ws.on('open', () => {
  console.log('WS connected!');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('WS received message type:', msg.type);
  if (msg.type === 'hello') {
    console.log('Hello data length:', Array.isArray(msg.data) ? msg.data.length : 'not array');
    setTimeout(() => {
      ws.close();
      process.exit(0);
    }, 1500);
  } else if (msg.type === 'metrics' || msg.type === 'providers') {
    console.log('Live message received:', msg.type);
    ws.close();
    process.exit(0);
  }
});

ws.on('error', (err) => {
  console.error('WS error:', err.message);
  process.exit(1);
});

setTimeout(() => {
  console.log('Timeout waiting for WS messages');
  ws.close();
  process.exit(0);
}, 5000);
