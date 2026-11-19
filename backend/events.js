const clients = new Map();
const maxClients = 256;
const heartbeatInterval = 25_000;

export function openEventStream(response) {
  if (clients.size >= maxClients) return false;

  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const heartbeat = setInterval(() => {
    if (!response.write(': keep-alive\n\n')) {
      response.destroy();
    }
  }, heartbeatInterval);
  heartbeat.unref();
  clients.set(response, heartbeat);
  response.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(response);
  });
  response.write(': connected\n\n');
  return true;
}

export function publishUpdate(type) {
  if (type !== 'appointments' && type !== 'services') {
    throw new TypeError('Unsupported event type.');
  }

  const event = `event: ${type}\ndata: {}\n\n`;
  for (const [response, heartbeat] of clients) {
    if (response.destroyed || !response.write(event)) {
      clearInterval(heartbeat);
      clients.delete(response);
      response.destroy();
    }
  }
}

export function closeEventStreams() {
  for (const [response, heartbeat] of clients) {
    clearInterval(heartbeat);
    clients.delete(response);
    response.end();
  }
}
