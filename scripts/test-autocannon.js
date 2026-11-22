const autocannon = require('autocannon');

const inst = autocannon({
  url: 'http://127.0.0.1:4000/v1/chat/completions',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer gw_demo_key'
  },
  body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'test-header' }] }),
  duration: 1,
  connections: 1,
  setupClient(client) {
    client.on('response', (statusCode, resBytes, responseTime, headers) => {
      console.log('statusCode:', statusCode);
      console.log('resBytes:', resBytes);
      console.log('responseTime:', responseTime);
      console.log('headers:', headers);
    });
  }
}, (err, res) => {
  console.log('done');
});
