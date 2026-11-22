const WebSocket = require('ws');
const { execSync } = require('child_process');

const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:4001/ws';

console.log('\n=== WebSocket Reconnection Verification ===\n');

let ws;
let connectedTimes = 0;
let helloReceived = 0;
let metricsReceived = 0;
let isRestarting = false;

function connect() {
  console.log(`Connecting to ${WS_URL}...`);
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    connectedTimes++;
    console.log(`[WS] Connection #${connectedTimes} OPENED`);

    if (connectedTimes === 1) {
      // Wait 1.5s, then restart API service
      setTimeout(() => {
        console.log('\n[TEST] Triggering API service restart to test reconnection...');
        isRestarting = true;
        try {
          execSync('fuser -k 4001/tcp 2>/dev/null || true');
          console.log('[TEST] Killed API service on port 4001.');
          
          // Restart API service after 1 second
          setTimeout(() => {
            console.log('[TEST] Starting API service back up...');
            execSync('API_PORT=4001 REDIS_URL=redis://127.0.0.1:6379 DATABASE_URL=postgresql://gateway:gateway@127.0.0.1:5432/gateway nohup node "/mnt/c/Users/saten/OneDrive/Documents/projects/AI API Gateway/apps/api/dist/index.js" > /dev/null 2>&1 &');
            console.log('[TEST] API service launched.');
          }, 1000);
        } catch (err) {
          console.error('[TEST] Error during restart trigger:', err.message);
        }
      }, 1500);
    } else if (connectedTimes === 2) {
      console.log('\n🎉 [SUCCESS] Reconnected to WebSocket after API service restart!');
      setTimeout(() => {
        ws.close();
        console.log('\n=== Summary ===');
        console.log(`Total Connections Established : ${connectedTimes}`);
        console.log(`Hello Packets Received       : ${helloReceived}`);
        console.log(`Metrics Broadcasts Received  : ${metricsReceived}`);
        console.log('WebSocket Auto-Reconnection Verified: ✅ PASS\n');
        process.exit(0);
      }, 2000);
    }
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'hello') {
        helloReceived++;
        console.log(`[WS] Received hello message (buffer items: ${Array.isArray(msg.data) ? msg.data.length : 0})`);
      } else if (msg.type === 'metrics') {
        metricsReceived++;
        console.log(`[WS] Received live metrics (req/min: ${msg.data?.reqPerMin ?? 0})`);
      }
    } catch (e) {
      // ignore
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Connection closed. (isRestarting: ${isRestarting})`);
    // Reconnect with 1s delay
    setTimeout(connect, 1000);
  });

  ws.on('error', (err) => {
    console.log(`[WS] Connection error: ${err.message}`);
  });
}

connect();
