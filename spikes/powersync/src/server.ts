import { MongoClient } from 'mongodb';
import { createSpikeServer } from './api.js';

if (process.env.SPIKE_LOCAL_ONLY !== '1') {
  throw new Error('Set SPIKE_LOCAL_ONLY=1. This fixture API cannot be deployed to cloud environments.');
}
const client = new MongoClient('mongodb://127.0.0.1:27018/?replicaSet=gh29');
await client.connect();
const db = client.db('checklist_proof');
if (!await db.listCollections({ name: 'checklists' }).hasNext()) {
  await db.createCollection('checklists', { changeStreamPreAndPostImages: { enabled: true } });
} else {
  await db.command({ collMod: 'checklists', changeStreamPreAndPostImages: { enabled: true } });
}
const server = await createSpikeServer(db);
server.listen(8012, '0.0.0.0', () => console.log('Local synthetic-data upload API listening on port 8012'));
async function stop() {
  server.closeAllConnections();
  server.close();
  await client.close();
}
process.once('SIGTERM', () => { void stop(); });
process.once('SIGINT', () => { void stop(); });
