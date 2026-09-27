import type { MongoClientOptions } from 'mongodb';

export function sourceProbeTarget(environment: NodeJS.ProcessEnv = process.env): {
  label: 'local' | 'atlas'; uri: string; options: MongoClientOptions;
} {
  const options = { serverSelectionTimeoutMS: 10000, timeoutMS: 10000 };
  if (!environment.GH29_SOURCE_PROBE_TARGET || environment.GH29_SOURCE_PROBE_TARGET === 'local') {
    return { label: 'local', uri: 'mongodb://127.0.0.1:27018/?replicaSet=gh29', options };
  }
  if (environment.GH29_SOURCE_PROBE_TARGET !== 'atlas') throw new Error('Unknown source probe target');

  const expectedHost = environment.GH29_SOURCE_PROBE_EXPECTED_HOST;
  const username = environment.MONGODB_USERNAME;
  const password = environment.MONGODB_PASSWORD;
  if (!expectedHost || !username || !password) throw new Error('Atlas probe requires explicit host and credentials');

  let parsed: URL;
  try { parsed = new URL(environment.MONGODB_URI ?? ''); }
  catch { throw new Error('Invalid Atlas probe URI; credential-bearing input suppressed'); }
  if (parsed.protocol !== 'mongodb+srv:' || parsed.port ||
      !parsed.hostname.endsWith('.mongodb.net') || parsed.hostname !== expectedHost) {
    throw new Error('Atlas URI must match the explicitly approved SRV host');
  }

  // Use only the approved hostname. Neither a supplied database nor URI options
  // may redirect fixtures, override TLS, or embed credentials in diagnostic URLs.
  return {
    label: 'atlas', uri: `mongodb+srv://${parsed.hostname}/`,
    options: {
      ...options, auth: { username, password }, authSource: 'admin',
      tls: true, writeConcern: { w: 'majority' }, appName: 'gh29-source-capability-probe',
    },
  };
}
