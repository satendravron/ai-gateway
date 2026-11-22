const autocannon = require('autocannon');
console.log(autocannon);
const client = autocannon({
  url: 'http://127.0.0.1:4000/health',
  duration: 1,
  connections: 1,
  setupClient(c) {
    console.log('Client keys:', Object.keys(c));
    console.log('Client prototype keys:', Object.getOwnPropertyNames(Object.getPrototypeOf(c)));
    c.on('response', (...args) => {
      console.log('response args count:', args.length);
      console.log('args[0]:', args[0]);
      console.log('args[1]:', args[1]);
      console.log('args[2]:', args[2]);
      console.log('args[3]:', args[3]);
      console.log('args[4]:', args[4]);
    });
    c.on('headers', (headers) => {
      console.log('headers event:', headers);
    });
    c.on('body', (body) => {
      console.log('body event:', body.toString());
    });
  }
});
