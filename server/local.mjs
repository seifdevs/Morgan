// Local development database: runs a real mongod (via mongodb-memory-server) whose data persists in
// ./.data/mongo. Always local — it deliberately ignores MONGODB_URI so experiments never touch Atlas.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { start } from './index.mjs';

// Keep the mongod binary cache inside the project regardless of the launching directory.
process.env.MONGOMS_DOWNLOAD_DIR ??= fileURLToPath(new URL('../node_modules/.cache/mongodb-memory-server', import.meta.url));
const { MongoMemoryServer } = await import('mongodb-memory-server');

const dbPath = fileURLToPath(new URL('../.data/mongo', import.meta.url));
mkdirSync(dbPath, { recursive: true });
const mongod = await MongoMemoryServer.create({ instance: { dbPath, storageEngine: 'wiredTiger', port: 27019 } });
console.log('Local MongoDB at', mongod.getUri(), '(data in .data/mongo — not Atlas)');
await start({ uri: mongod.getUri(), dbName: 'morgan' });
