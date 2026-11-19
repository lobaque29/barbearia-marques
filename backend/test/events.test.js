import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { closeEventStreams, openEventStream, publishUpdate } from '../events.js';

class EventResponse extends EventEmitter {
  writes = [];
  destroyed = false;
  ended = false;

  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
  }

  write(value) {
    this.writes.push(value);
    return true;
  }

  end() {
    this.ended = true;
    this.emit('close');
  }

  destroy() {
    this.destroyed = true;
    this.emit('close');
  }
}

test('event streams publish change types without booking data', () => {
  const response = new EventResponse();

  assert.equal(openEventStream(response), true);
  assert.equal(response.status, 200);
  assert.equal(response.headers['Content-Type'], 'text/event-stream; charset=utf-8');

  publishUpdate('appointments');
  publishUpdate('services');

  assert.ok(response.writes.includes('event: appointments\ndata: {}\n\n'));
  assert.ok(response.writes.includes('event: services\ndata: {}\n\n'));
  assert.equal(response.writes.some(write => write.includes('customer')), false);
  closeEventStreams();
  assert.equal(response.ended, true);
});

test('event streams reject unsupported event types', () => {
  assert.throws(() => publishUpdate('customer-data'), /Unsupported event type/);
  closeEventStreams();
});
